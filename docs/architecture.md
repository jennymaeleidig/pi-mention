# Architecture

The package shape, the pure seams, and the configuration surface. Settled in
[#12](https://github.com/jennymaeleidig/pi-mention/issues/12).

Grammar: [mention-grammar.md](./mention-grammar.md). Expansion:
[expansion-contract.md](./expansion-contract.md). Vocabulary:
[GLOSSARY.md](../GLOSSARY.md).

## Package shape

One ESM package, TypeScript source published as-is, no build step, Node 22.

- `pi` manifest points at `src/index.ts`.
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`
  and `typebox` with the `"*"` range Pi expects for host-provided packages.
  Dev dependencies pin `@earendil-works/pi-coding-agent ^1.5` for types.
- Runtime dependencies: `linkify-it`, `tlds`, and
  `@earendil-works/pi-codemode` pinned exactly `1.5.2`.
- Dev dependencies: TypeScript and the Node test runner.

No bundler. No second package for colours.

## Module layout

```text
src/core/            no pi imports, no I/O
  grammar.ts         parse: mentions, spans, code ranges
  resolve.ts         label + catalog -> target
  expand.ts          message + resolved + config -> expanded message
  colors.ts          text + resolved + config -> colour spans
  paint.ts           one rendered row + spans -> insertion-only ANSI
  picker.ts          trigger token + ranking
  selection.ts       picker class and selection history shape
  settings.ts        raw object -> settings + diagnostics
  types.ts           Mention, Target, ResolvedMention, SkillSource, ExpandedMessage,
                     ColourSpan, Settings

src/pi/              the only code that knows pi
  index.ts           registration and wiring
  input.ts           $ skill transform
  context.ts         % and & expansion
  editor.ts          decorate-only editor wrapper
  colours.ts         parse + resolve + URLs -> per-line colour spans
  autocomplete.ts    one provider wrapper owning $, %, &
  history.ts         picker selection store for frecency
  settings.ts        read pi.getSettings().piMention
  catalogs/
    skills.ts        pi.getCommands() skill entries
    tools.ts         pi.getAllTools() / pi.getActiveTools()
    roles.ts         agents/*.md files
    paths.ts         filesystem checks
    urls.ts          linkify-it spans

src/index.ts         default extension entry
test/                core fixtures + one wiring smoke test
```

Target-class adapters share the `Target` shape from `src/core/types.ts`.
`src/core` is testable with strings and fixtures; only `src/pi` touches pi.

## Pure seams

```ts
parse(text: string, specs: TriggerSpec[]) -> { mentions: Mention[]; codeRanges: Range[] }

resolve(mentions: Mention[], catalogs: Catalogs, config: Settings) -> ResolvedMention[]

expand(message: string, resolved: ResolvedMention[], config: Settings,
       options?: ExpandOptions) -> ExpandedMessage

colourSpans(text: string, resolved: ResolvedMention[], config: Settings)
  -> ColourSpan[]

loadSettings(raw: unknown) -> { settings: Settings; diagnostics: Diagnostic[] }
```

`ExpandedMessage` carries the expanded `text`, the native `skillBlock` when the
input seam built one, and a `skillFailure` when a resolved skill could not
become a block. `ExpandOptions.skillSource` is the adapter-supplied lookup for a
resolved skill's `SkillSource` (location, base directory and frontmatter-stripped
body); expansion itself never reads a file. The optional source keeps the seam
pure while the pi adapter owns the I/O.

`catalogs` is plain data built by the adapters. None of these five does I/O,
registers anything, activates a tool, or edits the prompt's tool section.

## Configuration

Configuration lives in the pi settings files, not in a package-specific file:

- `~/.pi/agent/settings.json` holds the user defaults.
- `.pi/settings.json` holds the project override.
- `pi.getSettings()` returns the deep-merged effective object.
- Code defaults fill every missing field.

The extension reads one top-level key:

```jsonc
{
  "piMention": {
    "triggers": { "skill": "$", "tool": "%", "role": "&" },
    "completionSuffix": " ",
    "hideSlashSkills": true,
    "ranking": {
      "strategy": "frecency",
      "pinned": { "skills": [], "tools": [], "roles": [] },
      "projectSkillsFirst": false,
    },
    "exclude": { "skills": [], "tools": [], "roles": [] },
    "colors": {
      "skill": "syntaxNumber",
      "tool": "accent",
      "role": "success",
      "path": "mdLinkUrl",
      "url": "mdLink",
      "unresolved": "warning",
      "excluded": "dim",
    },
    "url": {
      "sourceExtensions": [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".md",
        ".py",
        ".sh",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".rs",
        ".go",
        ".css",
        ".html",
      ],
    },
  },
}
```

- The key may be absent; defaults apply.
- The path trigger is fixed at `@` because pi core owns file attachment. It is
  not configurable.
- Exclusions match tools by registered name or label, and skills and roles by
  label.
- `ranking.strategy` is one of `frecency`, `recent`, `frequent`,
  `alphabetical`, `sourceOrder`.
- Colour values must be pi foreground theme-token names (`accent`, `mdLinkUrl`,
  …). Background tokens, unknown names and non-strings are invalid.
- The defaults are palette C from the accepted prototype: purple skill, cyan
  path, orange tool, green role, pink URL, yellow unresolved. Six distinct
  hues on `monokai-pro`.
- `typebox` validates the `piMention` object in code; there is no checked-in
  `config.schema.json`.

`loadSettings` validates the effective object. An invalid value falls back to
the code default for that key and produces one diagnostic; diagnostics are
notified at every `session_start`. A malformed `piMention` value (not an object)
falls back to all defaults with one diagnostic. A malformed section (for
example `"colors": "bright"`) falls back to that section's defaults with one
diagnostic and leaves the other sections alone. Unknown keys are ignored and
never change behaviour. pi 1.5.2 has no settings-change event, and
`pi.getSettings()` throws before the session is bound. The extension therefore
reads it at the first `session_start` and caches the result for that extension
instance; a `/reload` that rebinds the extension, or a process restart, re-reads
the effective key. The input and context seams are installed from that first
`session_start` so they receive the real settings; the TUI-only editor and
autocomplete are also installed there, once.

## Selection history

Frecency is state, not configuration:

- `~/.pi/agent/state/pi-mention-selections.json`
- `{ "version": 1, "skills": {}, "tools": {}, "roles": {} }`
- Atomic writes.
- No migration from `~/.pi/agent/state/pi-mention-skill-selections.json`; the
  new store starts empty.

## Trigger collisions

At load, the three triggers must be distinct, one character, not whitespace,
not `/`, and not `@` (reserved for paths). The rule starts from the three
defaults. A custom value is accepted only when it is valid and does not collide
with any class's effective trigger, including the default of a class that has
no override. An invalid or colliding value falls back to that class's own
default with one diagnostic. The three triggers therefore stay distinct and no
character is invented.

Another extension claiming the same character cannot be detected reliably. The
outermost autocomplete provider wins; the configurable trigger is the escape
hatch. The README states both facts.

## Test strategy

Node test runner, no browser and no live pi session in the unit suite.

- Golden tests for every grammar example and every row of the expansion table.
- Pure `colourSpans` and `paintRow` tests, including cursor-grapheme handling
  and escape preservation.
- Fixture-driven catalog tests, one per target class.
- Settings validation tests, including per-key fallback and diagnostics.
- One wiring smoke test with a fake `ExtensionAPI` that drives the real
  registration.

The pure seams carry the behaviour; the smoke test proves the wiring.

## ADR

The two-seam split is recorded in
[ADR 0001](./adr/0001-two-expansion-seams.md).
