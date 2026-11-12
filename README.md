# pi-mention

Mention-aware prompt editor for pi. It colours mentions while you type and
expands the ones that can change what the model receives.

## What it does

pi-mention adds two things to pi's prompt editor:

- **Colour.** Resolved skills, paths, tools, agent roles and URLs are coloured
  in the editor as you type. Unresolved mentions use the warning colour;
  excluded targets use the dim colour. Colour is editor-only: neither the
  transcript nor the model-facing text is coloured. The tool catalog is read
  live, so a tool or MCP server that appears mid-session recolours already-typed
  mentions without editing the text.
- **Expansion.** A `$skill`, `%tool` or `&role` mention can change the message.
  `$skill` expands at pi's `input` event, so the transcript shows pi's native
  `[skill] name (ctrl+o to expand)` row and the model receives the canonical
  skill block. `%tool` and a leading `&role` expand at pi's `context` event, so
  the transcript keeps the typed token while the model receives the registered
  tool name plus a `<tool_mentions>` block, or a `subagent` dispatch prefix.

`@` is not pi-mention's namespace. It remains pi core's file trigger: pi's
picker finds the file and adds it to the prompt, and pi-mention only colours
the token. URLs are colour-only and are never expanded.

A triggered mention is a trigger followed by a label, with no closing
delimiter (the quoted path form adds a closing quote): `$tdd`, `@src/index.ts`,
`%read`, `%kagi:kagi_search_fetch`, `&general`. A URL is detected without a
trigger and is never expanded: `https://example.com`.

## Install

### Prerequisites

- pi 1.5.2. That is the version the extension is tested against.
- Node 22.22.1 or newer, matching the package's `engines` field.
- Optional: `pi-zentui` 0.34.0 and `pi-vim-editor` 0.10.0 if you use them.
  Those are the versions in the compatibility matrix.

This package is installed from git or a local checkout. It is not published to
npm. Do not install `npm:pi-mention`: that name belongs to an unrelated package
([jack1582/pi-mention](https://github.com/jack1582/pi-mention)), not this
extension.

### From git

```sh
pi install git:github.com/jennymaeleidig/pi-mention
```

pi clones the repository into its package directory and installs the package's
dependencies. Add `@<ref>` to pin a tag or commit.

### From a local checkout

```sh
git clone https://github.com/jennymaeleidig/pi-mention.git
cd pi-mention
npm install
pi install /absolute/path/to/pi-mention
```

`pi install` writes the package declaration to `~/.pi/agent/settings.json`.
Use an absolute path; a local package is loaded from that path without being
copied. Because pi does not install dependencies for local packages, run
`npm install` in the checkout before installing it.

For a project-scoped declaration, use `pi install --local /absolute/path/to/pi-mention`.
That writes `.pi/settings.json`, which pi reads after project trust is granted.
`pi list` shows the configured packages and `pi remove <source>` removes one.

To try it for a single run without changing settings:

```sh
pi -e /absolute/path/to/pi-mention
```

### Load order

Load `pi-mention` **before** `pi-zentui`. In an explicit `-e` sequence the
order on the command line is the load order. For installed packages, keep both
in the same settings scope and list `pi-mention` first; project-scoped packages
load before user-scoped packages. `pi-vim-editor` may load on either side.

```sh
pi -e /absolute/path/to/pi-mention -e /absolute/path/to/pi-zentui
pi -e /absolute/path/to/pi-vim-editor \
  -e /absolute/path/to/pi-mention \
  -e /absolute/path/to/pi-zentui
```

Loading zentui first is a fail-safe, not a crash: mention colours are off, one
notice is shown, the text is untouched, and the pickers still work. The notice
is:

```text
pi-mention: this editor doesn't expose its layout, so mention colours are off.
Load pi-mention before pi-zentui.
```

The reason is in [docs/compatibility.md](docs/compatibility.md): zentui's
editor bypasses the instance render path pi-mention decorates, so the extension
refuses to produce a half-painted frame.

## Migrating from @zigai/pi-mention-skill

`@zigai/pi-mention-skill` and pi-mention both claim `$`, `%` and `&`. Remove the
old package before installing this one, or the two providers will compete for
the same triggers.

This is the sequence used for the live install on macOS:

```sh
# 1. Remove the old mention package and its dependency tree.
cd ~/.pi/agent/npm
npm uninstall --legacy-peer-deps @zigai/pi-mention-skill

# 2. Install this repo from the checkout (absolute path, npm install done).
pi install /Users/jennyleidig/Documents/projects/pi-extensions/pi-mention
```

`npm uninstall` may stop on an unrelated peer conflict elsewhere in the live
package set. `--legacy-peer-deps` resolves only the removal; check the diff to
confirm it removed only `@zigai/pi-mention-skill`,
`@zigai/pi-mention-anything` and their lock entries.

`pi install` appends to the end of `packages`. Move the new entry immediately
before `npm:pi-zentui` in `~/.pi/agent/settings.json`, keeping the rest of the
order. A local install is written as an absolute path:

```jsonc
"packages": [
  // …
  "/Users/jennyleidig/Documents/projects/pi-extensions/pi-mention",
  "npm:pi-zentui",
  // …
]
```

Optionally remove the old package's settings and selection state; they are
inert once the old extension is gone:

```sh
rm ~/.pi/agent/extension-settings/pi-mention-skill.json
rm ~/.pi/agent/extension-settings/schemas/pi-mention-skill.schema.json
rm ~/.pi/agent/state/pi-mention-anything-skill-selections.json
```

The old settings map onto the new key: `trigger` is `piMention.triggers.skill`,
`hideSlashSkills` and `completionSuffix` keep their names, and
`initialSuggestions` becomes `piMention.ranking`. A default old config needs no
`piMention` key at all. Selection history is not migrated; the new store starts
empty. Restart pi after moving the package entry (or edit settings and use
`/reload` to rebind the extension). Confirm with `pi list` that this package is
present and `@zigai/pi-mention-skill` is not.

## Token classes

There are five token classes: skill, path, tool, agent role and URL. A quoted
path is a path form, and a server tool is a tool form; both stay in their token
class.

| Token class | Form        | Trigger | Example                   | Coloured as  | Expands at         | Transcript vs expanded message                                                                                                                |
| ----------- | ----------- | ------- | ------------------------- | ------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill       | Skill       | `$`     | `$tdd`                    | skill colour | `input`            | Transcript: pi's `[skill] tdd` row. Expanded: the canonical `<skill>` block, then any remaining prose.                                        |
| Path        | Path        | `@`     | `@src/index.ts`           | path colour  | never              | Both keep `@src/index.ts`; pi core's file handling adds the file to the prompt.                                                               |
| Path        | Quoted path | `@`     | `@"my notes/today.md"`    | path colour  | never              | Same as path; this is the form for a path containing spaces.                                                                                  |
| Tool        | Tool        | `%`     | `%read`                   | tool colour  | `context`          | Transcript keeps `%read`. Expanded: `` `read` `` inline, plus one `<tool_mentions>` block after the prose.                                    |
| Tool        | Server tool | `%`     | `%kagi:kagi_search_fetch` | tool colour  | `context`          | Same as tool. An indirect server tool is mentionable only while `codemode` is active; the model is told to reach it inside a codemode script. |
| Agent role  | Agent role  | `&`     | `&general`                | role colour  | `context`, leading | Transcript keeps `&general`. Expanded: a `[subagent dispatch: role "general"]` prefix, then the task.                                         |
| URL         | URL         | none    | `https://example.com`     | URL colour   | never              | Both keep the URL literal.                                                                                                                    |

The default colour keys render on `monokai-pro` as purple skills, cyan paths,
orange tools, green roles, pink URLs, yellow unresolved mentions and dim
excluded targets. The values are foreground theme-token names, not fixed RGB
values, so they follow the active theme.

Colour tells you what the resolver found. A mention with no target is
**unresolved** and gets the warning colour. A target removed by configuration
is **excluded**, gets the dim colour, and is omitted from the picker. Neither
unresolved nor excluded mentions expand; they stay literal.

### One message through the stages

```text
Draft       $tdd &general %read @src/index.ts https://example.com
Transcript  [skill] tdd (ctrl+o to expand)
            &general %read @src/index.ts https://example.com
Model       <skill name="tdd" location="…">…</skill>

            [subagent dispatch: role "general"]
            Call the `subagent` tool now and delegate …

            `read` @src/index.ts https://example.com

            <tool_mentions>…</tool_mentions>
```

The skill block is opaque: `%` and `&` inside it are not expanded. Only the
first `$skill` mention is eligible, and only the first non-whitespace prose
token after the skill block can be a role. In the example the role is leading;
`%read` is expanded at the context seam, and the path and URL stay literal.

## Grammar essentials

The full grammar and its golden examples are in
[docs/mention-grammar.md](docs/mention-grammar.md).

### Boundary

A trigger starts a mention only at the start of the text, after whitespace or
CJK punctuation, or after an opening bracket `(`, `[`, `{`, `<`, a quote, or a
backtick. A trigger after a word character is literal.

| Draft            | Result                                |
| ---------------- | ------------------------------------- |
| `100%foo`        | literal; `%` follows a digit          |
| `me@example.com` | literal; `@` follows a word character |
| `x$tdd`          | literal                               |
| `(%read)`        | tool mention inside brackets          |
| `"$tdd"`         | skill mention after a quote           |
| `100 %foo`       | tool mention; the space is a boundary |

### Labels and punctuation

- Skill and role labels match `[A-Za-z0-9][A-Za-z0-9._-]*`; a tool label is one
  or two such segments separated by `:`. Resolution is case-sensitive; the
  picker's fuzzy matching is case-insensitive.
- There is no closing delimiter, and arguments are never part of a token.
  `$tdd this file` names the skill and leaves `this file` as prose.
- The label is the longest resolving prefix that ends at the token end or
  immediately before punctuation. `%bash, please` resolves `%bash` and leaves
  `, please`; `$tdd?` leaves `?`; `%bashfoo` is unresolved because `f` is a
  label character; `%bash:` is an incomplete chain and unresolved.
- `@https://example.com` is a path mention whose label looks like a URL. It is
  not a URL mention.

### Escapes

```text
\%bash is literal
\$PATH is literal
\&general is literal
```

A backslash before a skill, tool or role trigger suppresses the mention. The
draft and the persisted transcript keep the backslash; the model-facing
expanded message drops it, so the model receives a literal `%bash`, `$PATH` or
`&general`. A backslash before `@` also keeps the path literal, but that
backslash stays in model-facing text. Code ranges are not unescaped.

### Code

Mentions inside fenced code blocks or inline code are neither coloured nor
expanded, and URLs inside them are not detected. A pasted shell command or
script keeps its `%`, `$` and `&` literally.

### Quoted paths

A path containing spaces uses pi core's quoted form:

```text
@"my notes/today.md"
```

The quoted form is coloured but never expanded. `$"my skill"` is not a quoted
form: the editor closes the token at the space and the mention stays literal.

### Multiple mentions, skills and roles

Mentions are read left to right, do not overlap, and the longest match at a
position wins. A repeated tool mention is replaced at every occurrence, while
the tool block lists each distinct target once, in first-occurrence order. A
repeated role mention stays literal after the leading one, and a repeated skill
beyond the first stays literal.

- Only the **first** `$skill` mention is eligible. Later `$skill` mentions stay
  literal and are shown as unresolved, even when the first one does not
  resolve. A message has at most one native skill block, and the skill always
  comes first; the mention's original position in the prose is lost.
- Only a **leading** `&role` expands: the first non-whitespace prose token,
  after any skill block. A later or mid-sentence role stays literal. The role
  body is never inlined.

## Configuration

### Where settings live

Configuration lives in pi's settings files under one top-level `piMention`
key. There is no package-specific settings file.

- `~/.pi/agent/settings.json` holds user defaults.
- `.pi/settings.json` holds the project override and is read after project
  trust is granted.
- `pi.getSettings()` returns the deep-merged effective object, so a project
  value overrides a user value for the same key.
- Code defaults fill every missing field.

pi 1.5.2 has no settings-change event. The extension reads the effective key at
the first `session_start` of a registration and caches it. Edit settings, then
`/reload` (which rebinds the extension) or restart pi to re-read them.

### Complete example

```jsonc
{
  // One top-level key. Every field is optional.
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

Every field is optional; the example shows the code defaults. It is written as
JSONC for readability. pi 1.5.2 reads the settings files as strict JSON, so
remove the comment and trailing commas before saving it to `settings.json`.

### Settings reference

| Key                          | Default                                                                                                             | Effect                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggers.skill`             | `"$"`                                                                                                               | Character that starts a skill mention. Exactly one BMP character, not whitespace, `/`, `@`, `\` or backtick, and different from the other triggers. An invalid or colliding value falls back to `"$"` with a diagnostic. |
| `triggers.tool`              | `"%"`                                                                                                               | Character that starts a tool mention, under the same rules. Falls back to `"%"`.                                                                                                                                         |
| `triggers.role`              | `"&"`                                                                                                               | Character that starts an agent-role mention, under the same rules. Falls back to `"&"`.                                                                                                                                  |
| `completionSuffix`           | `" "`                                                                                                               | Text inserted after a picker label, unless the character after the token is already whitespace or one of `, ; : ! ? ) ] }`. An empty string disables it. At end of line the suffix is added.                             |
| `hideSlashSkills`            | `true`                                                                                                              | Hides `/skill:…` entries from pi's `/` autocomplete. Typing the command yourself still works.                                                                                                                            |
| `ranking.strategy`           | `"frecency"`                                                                                                        | Ordering for an empty picker query: `frecency`, `recent`, `frequent`, `alphabetical` or `sourceOrder`. Pinned entries stay first. The definitions are in [Picker](#picker).                                              |
| `ranking.pinned.skills`      | `[]`                                                                                                                | Skill labels shown first in the picker, in array order.                                                                                                                                                                  |
| `ranking.pinned.tools`       | `[]`                                                                                                                | Tool labels or registered names shown first in the picker, in array order.                                                                                                                                               |
| `ranking.pinned.roles`       | `[]`                                                                                                                | Role labels shown first in the picker, in array order.                                                                                                                                                                   |
| `ranking.projectSkillsFirst` | `false`                                                                                                             | Puts project skills ahead of user skills in the skill picker. Expansion uses the project copy when both scopes define the same label.                                                                                    |
| `exclude.skills`             | `[]`                                                                                                                | Skill labels to remove. An excluded target gets the dim colour, is omitted from the picker, and stays literal in the message and expanded message.                                                                       |
| `exclude.tools`              | `[]`                                                                                                                | Tool labels or registered names to remove, with the same effect.                                                                                                                                                         |
| `exclude.roles`              | `[]`                                                                                                                | Agent-role labels to remove, with the same effect.                                                                                                                                                                       |
| `colors.skill`               | `"syntaxNumber"`                                                                                                    | Colour for a resolved skill mention.                                                                                                                                                                                     |
| `colors.tool`                | `"accent"`                                                                                                          | Colour for a resolved tool mention.                                                                                                                                                                                      |
| `colors.role`                | `"success"`                                                                                                         | Colour for a resolved agent-role mention.                                                                                                                                                                                |
| `colors.path`                | `"mdLinkUrl"`                                                                                                       | Colour for a resolved path.                                                                                                                                                                                              |
| `colors.url`                 | `"mdLink"`                                                                                                          | Colour for a detected URL.                                                                                                                                                                                               |
| `colors.unresolved`          | `"warning"`                                                                                                         | Colour for an unresolved mention: no target, or a later `$skill` that is not eligible to expand.                                                                                                                         |
| `colors.excluded`            | `"dim"`                                                                                                             | Colour for a target removed by `exclude`.                                                                                                                                                                                |
| `url.sourceExtensions`       | `.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.py`, `.sh`, `.json`, `.yaml`, `.yml`, `.toml`, `.rs`, `.go`, `.css`, `.html` | Fuzzy bare-host URLs whose host ends in one of these stay prose. Explicit `http:`, `https:`, `ftp:` and `mailto:` URLs always colour. The comparison is case-insensitive.                                                |

The path trigger is fixed at `@` because pi core owns file attachment. It is
not configurable; a `triggers.path` key is ignored.

### Validation and reload

- A missing field takes its code default.
- An invalid leaf falls back to that key's default and produces one diagnostic.
  Other keys are unaffected.
- A malformed section (for example `"colors": "bright"`) falls back to that
  section's defaults and produces one diagnostic. A malformed `piMention`
  value (not an object) falls back to all defaults with one diagnostic.
- A colour value must be a foreground theme-token name. Background tokens
  such as `userMessageBg`, unknown names and non-strings are invalid for a
  colour key; that key falls back with a diagnostic.
- Triggers are validated together. Each must be exactly one BMP character (one
  UTF-16 code unit; astral characters and lone surrogates are rejected), not
  whitespace, `/`, `@`, `\` or backtick, and distinct from every other class's
  effective trigger. An invalid or colliding value falls back to that class's
  own default with a diagnostic.
- Unknown keys are ignored. Diagnostics are shown as one warning at session
  start.
- Settings are cached for the life of the extension instance. `/reload` or a
  restart re-reads them; there is no live settings change.

To change a trigger, set just that key:

```jsonc
{
  "piMention": {
    "triggers": { "tool": "!" },
  },
}
```

(The trigger example is also JSONC; remove its trailing commas before saving.)

The other two keep `$` and `&`, and the path trigger stays `@`.

## Picker

The picker owns the configured skill, tool and role triggers; by default those
are `$`, `%` and `&`. `@` remains pi core's file picker, and pi-mention only
colours the path. `/` stays pi core's command picker, apart from the optional
`/skill:…` filter below. A bare trigger opens a picker but is not a mention, so
it stays literal if you send it without accepting an item.

- Triggering uses the same boundary, escape and code rules as colouring and
  expansion.
- Typing narrows the list with case-insensitive fuzzy matching on the label.
  Tab or Enter accepts; Esc cancels. Accepting replaces the whole token from
  the trigger to its end, even if the cursor is in the middle of the label.
- Items insert the short label (`$tdd`, not the internal `skill:tdd`).
  `completionSuffix` is added after the label when the next character does not
  already separate it.
- While a mention picker is open, pi's file completion is suppressed so the two
  providers do not compete.
- `/skill:…` entries are hidden from the `/` autocomplete by default. Set
  `hideSlashSkills` to `false` to show them.

Empty-query ordering is:

- `frecency` (default): `count / (1 + age in days / 30)`, then most recent,
  then catalog order.
- `recent`: most recently selected, then catalog order.
- `frequent`: selection count, then most recently selected, then catalog order.
- `alphabetical`: label A–Z, then catalog order.
- `sourceOrder`: catalog order.

Pinned entries always come first, in `ranking.pinned` order. An empty query
orders the remaining entries by `ranking.strategy`. A non-empty query orders
them by fuzzy relevance through `orderMatches` instead, keeping pinned entries
first and preserving the project-first tier. With `projectSkillsFirst`, project
skills form a tier ahead of user skills in the skill picker, and expansion uses
the project copy when both scopes define the same label.

Accepting an item records one selection. The store is:

```text
~/.pi/agent/state/pi-mention-selections.json
{ "version": 1, "skills": {}, "tools": {}, "roles": {} }
```

Writes are atomic. A missing or malformed file starts empty, and there is no
migration from the old `pi-mention-skill-selections.json` store: the new store
begins fresh. Removing the file is a safe reset.

Each class (`skills`, `tools`, `roles`) keeps at most 1000 targets. On write,
the oldest entries by last-selection time are evicted first, so selection
counts do not preserve an entry that has not been used for a long time.

## Compatibility

The full matrix, tested versions and ANSI evidence are in
[docs/compatibility.md](docs/compatibility.md). The tested combinations are:

| Combination                                                         | Result    |
| ------------------------------------------------------------------- | --------- |
| stock TUI                                                           | pass      |
| `pi-zentui` 0.34.0 after `pi-mention` (`minimalist` and `opencode`) | pass      |
| `pi-vim-editor` 0.10.0 before `pi-mention`                          | pass      |
| `pi-vim-editor` after `pi-mention`                                  | pass      |
| vim + zentui, either vim side, `pi-mention` before zentui           | pass      |
| zentui before `pi-mention`                                          | fail-safe |

The zentui-first fail-safe means no mention colours, exactly one notice, text
untouched, and pickers still working. Load `pi-mention` first for colour.

In vim NORMAL mode, `$` is end-of-line and `%` is matching-bracket, so the
pickers are INSERT-only; `&` is not a trigger in NORMAL. Esc closes an open
picker before entering NORMAL, so a NORMAL-mode check needs Esc, a pause, then
Esc.

Another extension claiming the same trigger characters cannot be detected
reliably. The outermost autocomplete provider wins. If that happens, change
the trigger under `piMention.triggers`; that is the escape hatch, and the
defaults guarantee the three triggers stay distinct.

## Limits

- **TUI only for colour and pickers.** Print, JSON and RPC modes have no
  editor to colour and no picker. The input and context seams are still
  installed, so expansion applies to messages in those modes.
- **No transcript colouring.** Colour exists only in the prompt editor. The
  transcript keeps typed `%tool` and `&role` tokens, and shows pi's native skill
  row for a skill.
- **`@` is not expanded.** pi core's picker finds the file and adds it to the
  prompt; pi-mention never reads or inlines a path's contents, and it stats the
  path only to decide its colour. A path containing spaces needs the quoted form
  `@"…"`, which is also colour-only.
- **Code is inert.** Fenced code blocks and inline code are not coloured, not
  completed and not expanded, and URLs inside them are not detected.
- **Unresolved and excluded stay literal.** There is no partial expansion. A
  path is reported unresolved for the first frame while its existence check
  runs in the background, then repaints when the answer arrives.
- **One skill per message.** Only the first `$skill` is eligible; later ones
  stay literal. The skill block is hoisted first and cannot stay inline. If the
  skill name or path contains a quote or newline, or the body contains a line
  `</skill>`, the block is not built and the mention stays literal with one
  notice when there is a UI.
- **Tool catalogs are not activation.** `tool_search`-only tools are omitted
  from the catalog, and a mention never activates a tool. An indirect
  `codemode` or `deferred` tool, including `%kagi:…`, is mentionable only while
  `codemode` is active.
- **Roles are leading-only.** A mid-sentence or later `&role` stays literal.
  Role files are read once per extension instance; add a role, then `/reload`.
- **No subagent profiles.** Only agent roles found in `~/.pi/agent/agents/*.md`
  and `<cwd>/.pi/agents/*.md` are targets; project roles overwrite user roles
  with the same name. A model/thinking profile is never a mention target.
- **No URL validation.** Explicit `http:`, `https:`, `ftp:` and `mailto:` URLs
  colour; fuzzy bare hosts are filtered by `url.sourceExtensions`. Nothing
  checks reachability, and a URL never expands.
- **No live third-party provider test.** The send path was verified against a
  local OpenAI-compatible mock. See [docs/compatibility.md](docs/compatibility.md).
- **Settings are not hot-reloaded.** `/reload` or a restart re-reads the
  cached settings.

## Development

```sh
npm install
npm test
npm run typecheck
npm run format:check
npm run format
```

The suite uses the Node test runner: pure grammar, resolver, expansion, colour,
paint, picker and settings tests; editor-frame and history tests; and catalog
tests for skills, paths, tools and roles. There is also one wiring smoke test
with a fake `ExtensionAPI`. There is no browser and no live pi session in the
unit suite.

## Documentation

- [Mention grammar](docs/mention-grammar.md): triggers, boundaries, escapes,
  code and per-class labels.
- [Expansion contract](docs/expansion-contract.md): exactly what the model
  receives, with the message/transcript table.
- [Architecture](docs/architecture.md): module layout, pure seams,
  configuration and test strategy.
- [Compatibility](docs/compatibility.md): tested combinations, load order,
  fail-safe and evidence.
- [ADR 0001](docs/adr/0001-two-expansion-seams.md): why skills expand at input
  while tools and roles expand at context.
- [Glossary](GLOSSARY.md): the project's vocabulary.
