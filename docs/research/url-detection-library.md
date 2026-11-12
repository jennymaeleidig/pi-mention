# URL detection library

- Ticket: [#5](https://github.com/jennyleidig/pi-mention/issues/5)
- Date: 2026-11-11
- Status: decided

## Decision

Use **`linkify-it@6.1.0`** (MIT), fed the **`tlds@1.261.0`** data list for fuzzy
(scheme-less) links.

`linkify-it` is the link recogniser behind markdown-it. It returns explicit
character offsets, handles trailing punctuation and balanced brackets, is fully
Unicode/IDN aware, ships ESM + CJS + TypeScript types behind an `exports` map,
and adds one runtime dependency (`uc.micro`). Measured install footprint is
200 kB / 2 packages, or 236 kB / 3 packages with `tlds`.

The exact call that yields spans:

```js
import { createRequire } from 'node:module';
import { LinkifyIt } from 'linkify-it';

const require = createRequire(import.meta.url);

const linkify = new LinkifyIt({
  fuzzyLink: true,   // detect bare domains such as github.com
  fuzzyEmail: false, // true if bare email addresses should be spans too
}).tlds(require('tlds')); // 18.5 kB IANA data list; omit for the built-in subset

const matches = linkify.match(text); // Match[] | null

for (const m of matches ?? []) {
  m.index;     // start offset (inclusive)
  m.lastIndex; // end offset (exclusive)
  m.raw;       // exact matched text
  m.url;       // normalized href
  m.schema;    // 'https:', 'mailto:', 'http:', 'ftp:', '//', or '' for fuzzy
}
```

### Usage in the colour layer

The detector only sees text. It does not know which ranges are code, so the
caller must pass the code/fence ranges it already has from the editor and drop
any match that overlaps them:

```js
const spans = (linkify.match(text) ?? [])
  .filter((m) => !codeRanges.some((r) => m.index < r.end && m.lastIndex > r.start))
  .map((m) => ({
    start: m.index,
    end: m.lastIndex,
    text: m.raw,
    href: m.url,
  }));
```

If the colour layer only wants URLs and not email addresses, keep
`fuzzyEmail: false`; explicit `mailto:` links are still detected. Set it to
`true` and inspect `m.schema === 'mailto:'` when emails should be links too.

## Comparison

Install sizes are the on-disk `node_modules` after
`npm install --omit=dev --ignore-scripts`, measured 2026-11-11. "Last commit"
is the default-branch head from the GitHub API on the same date.

| Library / version | Released (last commit) | Runtime deps / installed size | Module + types | Span API | Strengths | Weaknesses | Licence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`linkify-it@6.1.0`** | 2026-07-22 (2026-09-20) | 1 (`uc.micro`); 200 kB, 236 kB with `tlds` | ESM + CJS via `exports`; bundled `.d.ts`; Node 22 verified | `match(text)` → `{ index, lastIndex, raw, url, schema }` | Best punctuation/bracket handling; Unicode/IDN; markdown-it pedigree; tiny and actively maintained | Built-in fuzzy TLD list is small; no custom schemes by default; userinfo URLs truncated; no match beside a backtick | MIT |
| `linkifyjs@4.4.0` | 2026-10-23 (2026-10-26) | 0; 288 kB | `"type": "module"`, CJS `main`, ESM `module`; no `exports`/`types` fields, but `.d.mts`/`.d.cts` resolve under TS `nodenext`; Node 22 verified | `find(text)` → `{ start, end, value, type, href }` | Zero deps; broad bare-domain TLD coverage; ports, userinfo and `file:` URLs; very active | Includes a closing backtick in the span; no custom schemes; packaging metadata is incomplete; no code awareness | MIT |
| `url-regex-safe@4.0.0` | 2023-08-15 (2023-08-15) | 2 (`ip-regex`, `tlds`); 148 kB | CJS only; no bundled types (`@types/url-regex-safe`) | returns a `RegExp`; use `matchAll` for indices | ReDoS-safe, full TLD list, widely deployed | Unmaintained since 2023; regex cannot balance parentheses (cuts at first `)`); partial matches in emails/userinfo; no custom schemes | MIT |
| `anchorme@3.0.8` | 2024-04-08 (2024-04-08) | 0; 164 kB | CJS only, `types` field; ESM default interop yields `{ default }`; no `exports` | `list(text)` → `{ start, end, string }` | Full IANA list; good punctuation/bracket handling; emails and file URLs | No release since 2024; CJS-only packaging; no custom schemes | MIT |
| `autolinker@4.1.5` | 2025-05-01 (2025-05-01) | 1 (`tslib`); 2.9 MB | CJS `main` + ESM `module`; `typings`; no `exports` | `parse(text)` → `Match` with `getOffset()`; end requires `getMatchedText().length` | Excellent punctuation handling; arbitrary schemes; HTML-aware; O(n) | 2.9 MB; class-based API with no direct end offset; parses more than URLs (filter match types); no code awareness | MIT |

Weekly npm downloads at the same date: `linkify-it` 47.8M, `linkifyjs` 33.7M,
`autolinker` 2.7M, `url-regex-safe` 370k, `anchorme` 168k.

## Verified behaviour

Run against each library's default prose configuration (`fuzzyLink` enabled for
`linkify-it`). The table records the returned substrings, not just a pass/fail.

| Input | `linkify-it` | `linkifyjs` | `url-regex-safe` | `anchorme` | `autolinker` |
| --- | --- | --- | --- | --- | --- |
| `See https://example.com/path?q=1.` | strips `.` | strips `.` | strips `.` | strips `.` | strips `.` |
| `Here (https://example.com/foo_(bar)) ok` | keeps inner `(...)`, drops outer | same | cuts at first `)` | same as lit | same as lit |
| `Markdown [docs](https://example.com/a).` | URL only | URL only | URL only | URL only | URL only |
| `` `https://example.com` `` | no match | includes closing backtick | clean | clean | clean |
| `Bare example.dev and github.com` | `github.com` only (unless `tlds` fed) | both | both | both | both |
| `example.com:8080/path` | no match | full | full | full | full |
| `https://user:pass@example.com/x` | `https://user` | full | host onwards | full | `https://user` |
| `slack://channel?id=1` | no match | no match | no match | no match | full |
| `file:///etc/passwd` | no match | full | no match | full | full |
| `Path /usr/local/bin/node and src/index.ts and ./dist/foo.js` | none | none | none | none | none |
| `Version 1.2.3 and v2.0.0` | none | none | none | none | none |
| `script.py README.md` | both (fuzzy) | both (fuzzy) | both (fuzzy) | both (fuzzy) | both (fuzzy) |

The filename row is the inherent fuzzy-link ambiguity: `.py` and `.md` are real
country-code TLDs, so every fuzzy detector flags `script.py` / `README.md`.
Masking code spans removes most of this in practice; prose filenames can be
guarded by rejecting a fuzzy host whose final label is a known source-file
extension.

`linkify-it` also keeps a trailing colon (`https://example.com/foo:`), which is
ambiguous because a colon can be a valid path character. It strips `.`, `,`,
`?`, `!`, `;`, quotes, `]` and `>` in the tested positions.

## What `linkify-it` deliberately does not detect

- **Markdown, code or HTML structure.** It is a plain-text scanner. It does not
  skip fenced blocks, inline code, link destinations or tag attributes; the
  caller must supply those ranges. This is why the usage snippet filters
  `codeRanges`.
- **Schemes outside its rule set.** By default: `http:`, `https:`, `ftp:`,
  `mailto:` and protocol-relative `//`. `ssh:`, `git:`, `file:`, `slack:`,
  `vscode:`, `obsidian:` and similar need `.add('scheme:', rule)`; a rule of
  `null` disables a scheme.
- **Fuzzy hosts outside the supplied TLD list.** With the built-in list it
  recognises two-letter root zones and a short gTLD set, so `example.dev`,
  `example.app` and `example.xyz` are missed. Feeding `tlds` fixes this.
- **Schemeless host:port.** `example.com:8080/path` is not a fuzzy match;
  `http://example.com:8080/path` is. `fuzzyIP` is off by default, so bare IPv4
  and IPv6 addresses are not detected either.
- **Bare email addresses when `fuzzyEmail: false`.** `mailto:` links remain
  detected.
- **Network validation.** `m.url` is a normalized string; nothing is resolved,
  fetched or DNS-checked.
- **Relative paths and local paths.** `/usr/local/bin`, `src/index.ts` and
  `./dist/foo.js` are not links.

Known limitations that are not design choices:

- Userinfo is truncated: `https://user:pass@example.com/x` yields
  `https://user`.
- A URL immediately surrounded by backticks yields no match; this happens to
  avoid colouring the URL inside an inline code span, but it is incidental and
  not a code-aware rule.
- With `fuzzyLink` on, filenames ending in a valid ccTLD (`script.py`,
  `README.md`, `foo.sh`) are reported as bare domains.

## Why not the others

- **`linkifyjs`** is the strongest runner-up: zero dependencies, broader TLD
  coverage and better handling of ports/userinfo/`file:` URLs. It loses on
  packaging (no `exports` or `types` entry) and on exact spans: a URL wrapped in
  backticks includes the closing backtick. Its `find()` also returns email
  tokens, so callers must filter by `type`.
- **`url-regex-safe`** is effectively unmaintained (last release 2023) and its
  single regex cannot balance nested parentheses, producing truncated spans.
  It also returns fragments of emails and userinfo URLs.
- **`anchorme`** has good matching and a full TLD list, but no release since
  2024, CJS-only packaging and an awkward ESM default interop.
- **`autolinker`** has the best scheme coverage and punctuation handling, but
  2.9 MB installed, a class-based API without an end offset, and HTML parsing
  that is unnecessary for plain prose. Overweight for a colour layer.

## Verification method

- Read npm registry metadata with `npm view` and inspected the published
  tarballs (`linkifyjs@4.4.0`, `linkify-it@6.1.0`, `url-regex-safe@4.0.0`,
  `anchorme@3.0.8`, `autolinker@4.1.5`).
- Read the shipped READMEs, type declarations and, for `url-regex-safe`, the
  compiled source.
- Ran the tricky-string harness on Node 26.12.1 and re-ran imports on Node
  22.23.5. Type-checked `import { LinkifyIt } from 'linkify-it'` and
  `import { find } from 'linkifyjs'` with TypeScript 5.9 using
  `module`/`moduleResolution: nodenext`.
- Measured install size and dependency count in isolated temporary projects.
- Checked default-branch commit dates through the GitHub API and weekly
  downloads through the npm downloads API.

Primary sources:

- <https://www.npmjs.com/package/linkify-it>
- <https://github.com/markdown-it/linkify-it>
- <https://www.npmjs.com/package/linkifyjs>
- <https://github.com/nfrasser/linkifyjs>
- <https://www.npmjs.com/package/url-regex-safe>
- <https://github.com/spamscanner/url-regex-safe>
- <https://www.npmjs.com/package/anchorme>
- <https://github.com/alexcorvi/anchorme.js>
- <https://www.npmjs.com/package/autolinker>
- <https://github.com/gregjacobs/Autolinker.js>
- <https://www.npmjs.com/package/tlds>
