# The custom-trigger autocomplete contract (pi 1.5.2)

Research for [#4](https://github.com/jennymaeleidig/pi-mention/issues/4).

We need our own `$`, `%` and `&` pickers, colour-only `@`/URL decoration, and
zigai-level ranking, while pi core keeps `@` file attachment and `/` commands.
This note pins down what pi actually exposes, what a provider owns, and what we
must reimplement without `@zigai/pi-mention-anything`.

Pinned sources:

| Short name | Package / location |
| --- | --- |
| `PI` | `@earendil-works/pi-coding-agent@1.5.2` — installed tree under the pnpm store |
| `TUI` | `@earendil-works/pi-tui@1.5.2` — sibling `pi-tui` install |
| `ZA` | `~/.pi/agent/npm/node_modules/@zigai/pi-mention-anything` (0.2.0) |
| `ZS` | `~/.pi/agent/npm/node_modules/@zigai/pi-mention-skill` (0.11.0) |
| `VIM` | `~/.pi/agent/npm/node_modules/pi-vim-editor` (0.10.0) |

Line numbers are from those installed builds. They are evidence, not a stable
API; re-check when pi is upgraded. I also ran a throwaway probe against the
installed `Editor` (see [§10](#10-empirical-probe)) to confirm the trigger,
Tab and undo behaviour.

## Recommendation

Build **one** autocomplete-provider wrapper that owns all three triggers and
delegates everything else to `current`. Own token parsing, candidate loading,
initial ranking, selection history and insertion inside that wrapper. Do not
intercept `@` in `getSuggestions`; keep the core file provider. Add a separate
**editor render enhancer** for colour-only `@`/URL decoration, composed with
`getEditorComponent()`/`setEditorComponent()`. Hide `/skill:*` by filtering the
result of the delegated slash query. Everything needed for this is public API;
the pieces we would otherwise import from zigai are small enough to reimplement,
and the large zigai surface (hub protocol, source controller, command provider,
settings/typebox schemas) is not needed.

## 1. The provider interface

### 1.1 Shape

`TUI dist/autocomplete.d.ts:1-30` is the whole contract:

```ts
export interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
}

export interface AutocompleteSuggestions {
  items: AutocompleteItem[];
  prefix: string;
}

export interface AutocompleteProvider {
  /** Characters that should naturally trigger this provider at token boundaries. */
  triggerCharacters?: string[];

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null>;

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number };

  shouldTriggerFileCompletion?(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean;
}
```

`AutocompleteProvider` and `AutocompleteItem` are exported from
`@earendil-works/pi-tui` (`TUI dist/index.d.ts:2`), **not** from
`@earendil-works/pi-coding-agent`. The coding-agent package only exports the
factory type (`PI dist/core/extensions/types.d.ts:65-66`):

```ts
export type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;
```

and the UI method (`PI dist/core/extensions/types.d.ts:160-161`):

```ts
addAutocompleteProvider(factory: AutocompleteProviderFactory): void;
```

### 1.2 Registration and lifecycle

1. On `session_start`, call `ctx.ui.addAutocompleteProvider(factory)`
   (`PI docs/extensions.md:3003-3044`).
2. The interactive mode pushes the factory onto `autocompleteProviderWrappers`
   and immediately rebuilds the provider (`PI dist/modes/interactive/interactive-mode.js:2197-2200`).
3. Rebuilding starts from pi's `CombinedAutocompleteProvider` over built-ins,
   prompt templates, extension commands and `skill:*` commands, then applies
   every wrapper in registration order (`PI dist/modes/interactive/interactive-mode.js:481-577`).
   The last-registered wrapper is outermost.
4. The union of every wrapper's `triggerCharacters` is assigned to the final
   provider (`interactive-mode.js:563-570`), then handed to the default editor
   and to any custom editor (`interactive-mode.js:571-575`).
5. `Editor.setAutocompleteProvider` appends the provider's trigger characters
   to the editor's built-in set and clears any open menu
   (`TUI dist/components/editor.js:303-307`, `1959-1970`).
6. Typing a trigger char at a token boundary calls
   `tryTriggerAutocomplete()` → `getSuggestions()`; typing more characters while
   the menu is open calls `updateAutocomplete()` → another `getSuggestions()`
   (`editor.js:1025-1055`, `2045-2049`).
7. The editor renders suggestions in a `SelectList`; the best row is chosen by a
   simple prefix heuristic, not by re-ranking (`editor.js:1867-1881`, `2015-2023`).
8. Tab, Enter or a mouse selection calls `applyCompletion(...)`, replaces the
   editor buffer with the returned `lines`, sets the returned cursor, closes the
   menu and fires `onChange` (`editor.js:618-645`, `1882-1897`).
9. A request is cancelled when the text or cursor changes; results from an older
   request are discarded (`editor.js:2008-2013`). `options.signal` is also
   aborted on the next request (`editor.js:2024-2030`).

There is no per-provider list consulted in turn. Registration creates a
**decorator chain**: each factory receives the provider built so far and returns
a replacement. Delegation is a convention, not something pi enforces.

### 1.3 When `getSuggestions` is called

| Input | Call |
| --- | --- |
| `/` at start of message | `getSuggestions(..., { force: false })` (`editor.js:1027-1029`) |
| `@`, `#`, or one of our triggers at a token boundary | same (`editor.js:1031-1038`) |
| any letter/digit/`.-_` typed while inside a slash command or a trigger token | same (`editor.js:1039-1051`) |
| any text change while the menu is open | `updateAutocomplete()` (`editor.js:1053-1055`) |
| Tab with no menu open | `forceFileAutocomplete(true)` → `getSuggestions(..., { force: true })`, after `shouldTriggerFileCompletion` (`editor.js:1902-1929`) |

So a provider can be called with `force: true` even when there is no token it
recognises. It must delegate, not return `null`, or it suppresses core file
completion.

`shouldTriggerFileCompletion` is consulted **only** on forced Tab
(`editor.js:1923-1929`). Return `false` when the cursor is inside a token we own
so Tab does not fall back to a file list; otherwise delegate.

There is a 20 ms debounce for trigger-shaped tokens and none for explicit Tab
(`editor.js:170-184`, `1971-1978`). `getSuggestions` itself may be async and is
aborted by `signal`. Use the signal for I/O and check it before returning.

`getSuggestions` is called even when the cursor is not at the end of a token
(the editor only guarantees `cursorCol`). Providers must slice before the cursor
for the query and own the rest of the token on insertion.

### 1.4 What pi does not provide

- No token/prefix parser for custom triggers. You get the raw lines and cursor.
- No ranking beyond the editor's best-row highlight. Sorting is entirely yours.
- No completion suffix. `applyCompletion` must add spaces/punctuation itself.
- No selection history, pinning, project priority, or frecency.
- No "accept item programmatically" API. Insertion is the provider's return
  value.
- No styling hook for editor text; only the editor factory can decorate render
  output.
- No-op in RPC mode: `addAutocompleteProvider()` and `setEditorComponent()` are
  no-ops (`PI docs/rpc-extension-ui.md:18`). Guard with `ctx.mode === "tui"`.

## 2. Trigger and token parsing

### 2.1 Trigger character rules

`Editor.setAutocompleteTriggerCharacters` (`editor.js:1959-1970`):

```js
const next = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS]; // ["@", "#"]
for (const character of triggerCharacters) {
  if (character.length !== 1 || character === "/" || isWhitespaceChar(character) || next.includes(character)) {
    continue;
  }
  next.push(character);
}
```

Consequences:

- `$`, `%`, `&` are valid single-character triggers.
- `/` is **not** a trigger character; slash is special-cased at the start of a
  message (`editor.js:1027-1029`, `1850-1853`). A multi-character trigger is
  ignored by the editor; only its first code point fires naturally (zigai picks
  the first code point explicitly: `ZA src/mention-syntax.ts:17-19`).
- `@` and `#` are always active even if no provider lists them. `@` is claimed
  by core (file attachment); `#` is a default trigger that core does **not**
  handle, so it is effectively free for extensions (the bundled
  `github-issue-autocomplete` example uses it).
- Trigger characters are a union across the chain, not per provider. Two
  extensions registering `%` both receive the request; the outermost one wins
  unless it delegates.

### 2.2 Natural trigger regex and boundaries

The editor builds this pattern (`editor.js:170-184`):

```js
const autocompleteTokenStartSource =
  `${autocompleteBoundaryRegex.source}[([{<\`]*`;
const unquotedSuffix = `(?:(?!${autocompleteSeparatorRegex.source}).)*`;
new RegExp(`${autocompleteTokenStartSource}(?:@"[^"]*|[${triggers}]${unquotedSuffix})$`, "u")
```

where `autocompleteBoundaryRegex` is start-of-text or whitespace/CJK punctuation
(`TUI dist/utils.js:44-49`). Therefore:

- `$` at the start of a line or after whitespace/CJK punctuation triggers.
- `($`, `[$`, `{$`, `<$` and `` `$ `` trigger because of the wrapper prefix.
- `x$` does not trigger (no boundary).
- A token ends at whitespace or CJK punctuation. `/`, `:`, quotes and other
  punctuation stay inside the token.
- Only `@"..."` is special-cased for quoting. `$"foo bar"` does not remain one
  token while typing: the space closes the trigger window. Zigai works around
  this by re-triggering from its editor enhancer with its own parser, which
  accepts quoted names (`ZA src/mention-syntax.ts:81-101`; `ZA src/editor.ts:118-153`).
  If we avoid spaces in skill/environment names, we do not need that hack.

### 2.3 Provider-side parser

Match the editor's boundary set so natural triggering and our parser agree.
Longest trigger first if multi-character triggers are ever added.

```ts
function parseToken(textBeforeCursor: string) {
  for (const spec of orderedSpecs) {
    const t = escapeRegExp(spec.trigger);
    // Omit the optional backtick wrapper here for a readable sketch; add it
    // if you want to match the editor's full wrapper prefix.
    const m = new RegExp(`(?:^|[\\s([{<])${t}([^\\s]*)$`, "u")
      .exec(textBeforeCursor);
    if (!m) continue;
    const query = m[1] ?? "";
    return {
      spec,
      query,
      prefix: spec.trigger + query,
      start: textBeforeCursor.length - spec.trigger.length - query.length,
    };
  }
  return undefined;
}
```

In `getSuggestions`, call it with `(lines[cursorLine] ?? "").slice(0, cursorCol)`.

In `applyCompletion`, do **not** trust the stored token: recompute start as
`cursorCol - prefix.length`, scan forward from the cursor to the next delimiter,
and replace the whole token. This handles the cursor sitting mid-token. The
simple zigai autocomplete only replaces `prefix` and leaves the rest of the
token after the cursor (`ZA src/autocomplete.ts:68-85`, `203-224`); its chained
provider is the one that tracks `ownedEnd` and replaces the full span
(`ZA src/chain-autocomplete.ts:274-325`, `509-596`). We should own the full span
from the start.

### 2.4 Multiple triggers in one provider

Prefer one wrapper with a trigger→source registry:

```ts
type TriggerSpec = {
  trigger: "$" | "%" | "&";
  load(ctx: ExtensionContext, pi: ExtensionAPI): Promise<readonly Candidate[]>;
  completionSuffix?: string;
  initial?: { strategy: Strategy; pinned: readonly string[] };
};
```

One wrapper gives us one parser, one `applyCompletion`, and one place to
coordinate history and project-first. Multiple wrappers would also work (the
trigger union is global), but each must delegate on every other token and
registration order becomes behaviour.

## 3. Ranking and insertion ownership

### 3.1 Ownership table

| Concern | Owner | Evidence |
| --- | --- | --- |
| Trigger detection | pi editor | `editor.js:1027-1051`, `1959-1970` |
| Token/prefix extraction | provider | interface has only lines/cursor (`autocomplete.d.ts:17-30`) |
| Candidate loading/caching | provider | nothing in pi calls a data source for custom triggers |
| Fuzzy filtering | either: `fuzzyFilter` is public | `TUI dist/index.d.ts:21`, `dist/fuzzy.js` |
| Empty-query ordering | provider | `fuzzyFilter` returns input unchanged for empty query (`fuzzy.js:94-96`) |
| History/pinning/frecency | provider | no pi API |
| Best-row highlight | pi editor | `editor.js:1867-1881`, `2015-2023` |
| Insertion text and cursor | provider | `applyCompletion` return value |
| Completion suffix | provider | no field in `AutocompleteItem` |
| Undo unit | pi editor | one `pushUndoSnapshot()` per accepted item (`editor.js:618-645`, `1882-1897`) |
| Menu rendering | pi editor | `SelectList` (`editor.js:1882-1884`) |

### 3.2 Fuzzy matching

`fuzzyFilter(items, query, getText)` is exported from pi-tui. It:

- lowercases both sides;
- greedily matches all query characters in order;
- scores consecutive matches, word-boundary matches, gaps and match position
  (`TUI dist/fuzzy.js:6-52`);
- tries contiguous alignments and keeps the best;
- supports `12ab`/`ab12` swaps;
- splits the query on whitespace and `/`, requiring every token to match
  (`fuzzy.js:83-125`);
- sorts ascending by score, stably, and returns the input unchanged when the
  query is blank (`fuzzy.js:94-96`, `123`).

That is the same fuzzy engine pi core uses for slash commands
(`TUI dist/autocomplete.js:245-247`). Use it unless a source needs
provider-side search (then return its own order).

### 3.3 Initial (empty-query) ranking

Zigai's algorithm is a good specification (`ZA src/initial-suggestions.ts:50-119`):

1. **Pinned** names first, in configured order. A name that is not present is
   ignored; zigai matches a pin against either candidate id or segment
   (`ZA src/source-runtime.ts:72-76`).
2. **Priority** ascending (`initialPriorityOf` / `priorityOf`).
3. **Strategy**:
   - `alphabetical`: `localeCompare(..., { sensitivity: "base" })`;
   - `recent`: `lastSelectedAt` descending;
   - `frequent`: `count` descending, then recency;
   - `frecency`: `count / (1 + ageDays / 30)` descending, then recency
     (`initial-suggestions.ts:1-2`, `43-48`);
   - `sourceOrder`: keep load order.
4. **Source index** ascending as the final tie-break. JavaScript sort is stable,
   so this preserves provider order when scores tie.

The default in zigai is `{ strategy: "frecency", pinned: [] }`
(`ZA src/source-runtime.ts:65-68`).

**Project-first.** Zigai implements it as a pre-sort of the skill command list:
project-scoped skills first, then the rest (`ZS src/skill-provider.ts:73-87`),
using `sourceInfo.scope` from `pi.getCommands()` (`PI docs/extensions.md:1772-1808`;
`PI dist/core/source-info.d.ts:4-12`). Because that pre-sort feeds the
`sourceIndex` tier, it survives frecency/recent/frequent/sourceOrder ties but
**is lost under `alphabetical`**, which re-sorts by label. If we want
project-first to be a guarantee, make it an explicit tier after pinned (or pass
`priorityOf`) rather than a pre-sort. `rankInitialSuggestions` accepts
`priorityOf` but zigai's `source-runtime` does not pass one, so its own
project-first is weaker than the README implies.

**Pinned vs project.** Decide precedence deliberately. Zigai's effective order is
pinned → priority → strategy → source order, with project only in source order.

### 3.4 Selection history

Zigai records a selection only in `applyCompletion`
(`ZA src/autocomplete.ts:203-216`), not on manually typed mentions. That is the
right semantic: frecency measures picker usage.

Shape and persistence (`ZA src/selection-history.ts`):

- `{ version: 1, selections: { [name]: { count, lastSelectedAt } } }`;
- `count` increments, `lastSelectedAt = Date.now()`;
- atomic write (temp file + rename) to
  `join(getAgentDir(), "state", stateFileName)` (`selection-history.ts:74-108`);
- default file per source:
  `pi-mention-anything-<id>-selections.json` (`ZA src/source-runtime.ts:38-42`);
- at most 1,000 entries, newest first (`selection-history.ts:13-14`, `40-58`);
- writes are serialized through a promise chain (`selection-history.ts:115-130`);
- load errors are reported once and treated as empty (`selection-history.ts:82-103`).

`getAgentDir()` is public (`PI dist/index.d.ts:2`). We can use the same shape
under a `pi-mention` filename. Record a stable candidate id, not the display
label (zigai's simple provider records `item.label`, which breaks when a label
changes).

### 3.5 Prefix and highlight

The editor saves `suggestions.prefix` and later passes it verbatim to
`applyCompletion` (`editor.js:2015-2017`). It also uses it for the best-row
heuristic:

- exact `value === prefix` wins;
- otherwise the first item whose `value.startsWith(prefix)`;
- otherwise leave the first row selected (`editor.js:1867-1881`).

This is **case-sensitive**, checks `value` only, and does not reorder. Return the
full token prefix (`$query`), not just the query, so highlighting and our
insertion agree. A fuzzy top result that does not start with the literal prefix
will not be auto-highlighted; that is cosmetic and unavoidable through the
public API.

### 3.6 Insertion semantics

`applyCompletion` returns the complete new `lines` array, `cursorLine` and
`cursorCol`. Pi assigns them directly; it does not post-process the value
(`editor.js:623-626`, `638-641`, `1888-1893`, `1994-1999`). Requirements:

- **Replace the whole token**, not only the prefix, so a cursor inside
  `$alp|ha` does not duplicate `pha`.
- **Add the completion suffix yourself.** Zigai defaults to one space
  (`ZA src/source-runtime.ts:57`). Its rule is: no suffix if configured empty;
  suffix at end of line; no duplicate suffix when the following text already
  starts with whitespace; otherwise the suffix (`ZA src/autocomplete.ts:55-60`).
- **Support multi-line values** by splitting the replacement and computing the
  final line/column (`ZA src/autocomplete.ts:62-85`). Not needed if values are
  single-line, but cheap to support.
- **Return `null` or an empty `items` array to close the menu.** Both paths
  cancel it (`editor.js:1987-1991`).
- **Keep an item→candidate map.** `applyCompletion` receives only the
  `AutocompleteItem`, and items can share labels across triggers. Zigai keeps a
  map keyed by label (`ZA src/autocomplete.ts:194-198`, `215-216`); keying by
  `value` (full token) is safer if values are unique, and a per-request map
  keyed by object identity is safest.
- **Check the prefix before inserting.** Other providers' items can reach our
  `applyCompletion` if our wrapper is in the chain; delegate when `prefix` is not
  ours (`ZA src/autocomplete.ts:203-206`).
- **Tab with exactly one forced match auto-inserts without rendering a menu**
  (`editor.js:1992-2003`). Make sure the suffix is correct for that path.
- **Enter on a non-slash item only accepts the item; it does not submit**
  (`editor.js:633-651`). A second Enter submits. Slash-prefixed prefixes fall
  through to submit, which is why `/` behaves differently.
- **Mouse selection** uses the same `SelectList.onSelect` path and also pushes
  undo (`editor.js:1882-1897`).

### 3.7 Undo

Every insertion path calls `pushUndoSnapshot()` before `applyCompletion`.
`UndoStack.push` deep-clones the editor state (`TUI dist/undo-stack.js:1-20`), so
one undo reverts the whole insertion, not the individual characters. There is no
redo in the core editor; `pi-vim-editor` adds redo on top of the undo stack.
Do not make insertion call `setText` or multiple editor APIs: return the new
lines and let the editor apply them as one unit.

## 4. Multi-provider coexistence

### 4.1 The decorator chain

- `setupAutocompleteProvider()` starts from core and wraps in registration order
  (`interactive-mode.js:561-570`).
- The union of `triggerCharacters` is computed from each wrapper's returned
  provider (`interactive-mode.js:563-569`).
- `resetExtensionUI()` clears all wrappers and rebuilds
  (`interactive-mode.js:2033-2035`); extensions must re-register on
  `session_start`, not at module load.
- Re-binding a session calls `setupAutocompleteProvider()` again with the same
  wrapper array (`interactive-mode.js:1653`). Registering again on a second
  `session_start` without clearing will duplicate wrappers.
- A wrapper that returns `null` for an unmatched token stops the inner chain for
  that request. Delegate with `current.getSuggestions(...)` instead.

### 4.2 Relationship to core

Core's `CombinedAutocompleteProvider` handles, in order
(`TUI dist/autocomplete.js:212-289`):

1. `@` file attachment (fuzzy paths, quoted paths, directories);
2. `/` command names when not forced, and command arguments after a space;
3. otherwise a path prefix (`.`/`/`/`~/`, or forced Tab).

There is no `#`, `$`, `%` or `&` branch, so those triggers fall through to the
path logic and normally return `null`. That is why `#` is free and why our
triggers do not collide with core as long as we delegate for `@` and `/`.

### 4.3 `@` is colour-only

Do **not** intercept `@` in `getSuggestions`: core owns it, including quoting
and directory continuation (`autocomplete.js:212-228`, `290-327`). Let the
wrapper delegate for `@` exactly like any other unmatched token.

Colouring has no provider hook. The only public route is to decorate the editor
returned by the previous factory: patch `render(width)` and colour the text rows.
Zigai does exactly that (`ZA src/editor.ts:155-165`; colour logic in
`ZA src/mention-hub.ts:165-189`). Practical rules:

- The editor render is `top border, visible text rows, bottom border, autocomplete rows`
  (`TUI dist/components/editor.js:397-498`). The last row starting with `─` is
  the bottom border; colour rows `1 .. bottomBorderIndex - 1`, excluding the
  borders and everything after (zigai's `autocompleteStartIndex`,
  `ZA src/rendering.ts:40-54`).
- Rendered rows already contain ANSI styling, padding and the fake cursor
  sequence. Recolouring is a best-effort text transformation, not a styled
  document. Prefer matching known tokens (`@<existing path>`) and skip insertions
  inside escape sequences. A token split across a wrapped visual line will not
  be coloured as one span.
- Compose with `pi-vim-editor`: it captures
  `previous = ui.getEditorComponent()` and decorates the editor returned by it
  (`VIM src/index.ts:89-121`). Our enhancer must do the same, or we drop vim.
  Registering after vim means our `render` wraps vim's; registering before means
  vim wraps ours. Both work, but ANSI-heavy operations are safer as the inner
  wrapper (colour first, vim's visual-selection reverse-video afterwards).
- Installing an editor resets text into the new instance and copies padding,
  autocomplete visibility, provider and app handlers
  (`PI dist/modes/interactive/interactive-mode.js:2327-2360`). It does not carry
  undo history, so install at `session_start`, before the user types.

### 4.4 Editor enhancer composition

Zigai uses `@zigai/pi-extension-internals` `registerEditorEnhancer` to key
enhancers by a global `Symbol.for(...)` and avoid double-wrapping across reloads
and independently bundled copies (`.../pi-extension-internals/dist/editor-enhancer-registry.js:1-190`).
That package is not public pi API. For us, a small local composer is enough:

```ts
const KEY = Symbol.for("pi-mention.editor");
function installEditor(ctx: ExtensionContext, enhance: (editor: EditorLike) => EditorLike) {
  const previous = ctx.ui.getEditorComponent();
  const factory = (tui, theme, kb) => enhance(
    previous?.(tui, theme, kb) ?? new CustomEditor(tui, theme, kb),
  );
  (factory as any)[KEY] = true;
  ctx.ui.setEditorComponent(factory);
}
```

If we need idempotency across reloads, keep a module-level registry keyed by
`Symbol.for` (or check the marker on the current factory), because
`setEditorComponent` replaces the factory rather than stacking it.

## 5. Hiding `/skill:*`

Core adds skill commands to the slash list as `name = "skill:<name>"` when
`enableSkillCommands` is true (`interactive-mode.js:546-558`). The autocomplete
item is `{ value: name, label: name, description }` (`autocomplete.js:234-252`),
so filtering on `value` works.

Zigai's entire implementation is 30 lines (`ZS src/slash-skill-filter.ts:1-30`):

```ts
function withoutSlashSkills(suggestions) {
  if (suggestions === null || !suggestions.prefix.startsWith("/")) return suggestions;
  const items = suggestions.items.filter((item) => !item.value.startsWith("skill:"));
  if (items.length === suggestions.items.length) return suggestions;
  if (items.length === 0) return null;
  return { ...suggestions, items };
}

export function createSlashSkillFilter(current) {
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, line, col, options) {
      return withoutSlashSkills(await current.getSuggestions(lines, line, col, options));
    },
    applyCompletion(...args) { return current.applyCompletion(...args); },
  };
}
```

Register it from `session_start` when the setting is on
(`ZS src/index.ts:27-38`). We can fold this into our one wrapper's fallback
path: when there is no `$`/`%`/`&` token, delegate to `current`, then filter
slash results before returning.

Notes:

- Filtering applies only when `suggestions.prefix.startsWith("/")`; this is the
  command-name query, not an argument query (arguments have a prefix of the
  argument text, not `/`).
- Returning `null` when every item was filtered closes the menu. Typing
  `/skill:foo` still works because manually typed input is expanded by pi before
  dispatch (`PI dist/core/agent-session.js:1811-1825`); it just has no picker.
- `enableSkillCommands: false` is a user setting that removes skill commands
  from interactive discovery while leaving manual `/skill:name` working
  (`PI docs/settings.md:160`, `PI docs/skills.md:53`). It is not an extension
  setter; an extension can read `pi.getSettings()` but the supported way to hide
  only the picker is the wrapper above.
- The filter only removes rows whose `value` starts with `skill:`. If another
  extension adds skill-like rows with a different value convention, they are not
  covered; that is desirable isolation.

## 6. Vim, cursor and undo interaction

`pi-vim-editor` decorates the editor returned by the previous factory, not a
replacement (`VIM src/index.ts:89-121`). In INSERT/REPLACE it forwards keys to
pi (`VIM src/attach.ts:571-574`), so pi's autocomplete handling runs before vim's
normal-mode logic. The interactions that matter:

- **Esc closes the picker first.** In INSERT, vim checks
  `port.autocompleteOpen()` and closes autocomplete instead of leaving INSERT
  (`VIM src/attach.ts:559-562`; README table, `VIM README.md:59`). The second Esc
  leaves INSERT. So a selection is accepted with Tab/Enter, or dismissed with the
  first Esc; Esc does not submit.
- **Accepting a completion is an ordinary edit to vim.** Pi replaces the buffer
  and fires `onChange`; vim notices the changed fingerprint on its next
  key/render and reconciles (`VIM src/attach.ts:386-399`). There is no separate
  vim hook to call.
- **Undo grouping.** Pi pushes one snapshot per accepted item; vim tracks its own
  insert session and collapses undo steps when leaving INSERT
  (`VIM src/attach.ts:257-275`, `326-338`; `VIM src/port.ts:225-231`). In
  practice a completion may be grouped with the insert change, so `u` after
  leaving INSERT can undo the whole insert, not just the completion. If we need
  exact "undo only the completion" semantics, we would need a vim-specific
  integration; pi alone already gives one-snapshot undo.
- **Cursor.** `applyCompletion` sets the column through `setCursorCol`, which
  clears vim's/pi's sticky visual column (`editor.js:626`, `1820+`). Vim clamps
  the normal-mode cursor to a character on its next settle; no special handling
  is needed.
- **Normal mode does not trigger.** Trigger chars are only inserted in INSERT;
  pi's `insertCharacter` is what calls `tryTriggerAutocomplete`. Vim's normal
  mode consumes those keys as commands, which is correct.
- **`tryTriggerAutocomplete` is private.** Zigai's editor enhancer duck-types it
  for chained continuations (`ZA src/editor.ts:45-68`, `131-133`), and
  `pi-vim-editor` uses the public `isShowingAutocomplete` via its port. Our
  simple single-token pickers do not need a forced re-trigger; natural typing
  covers them. If we add chained `$skill:` navigation later, we either use the
  same private duck-typing or synthesize a second character to let the editor
  re-open naturally. Prefer avoiding it.

## 7. Expansion: `input` vs `context`

Autocomplete only inserts `$name` text. Turning that into model context is a
separate lifecycle decision.

- **`input`** fires before extension-command/skill/template expansion
  (`PI docs/extensions.md:1112-1121`; `PI dist/core/agent-session.js:1733-1757`).
  A `transform` result becomes the text that is stored as the user message and
  expanded like `/skill:` (`agent-session.js:1744-1746`).
- **`context`** fires before each LLM call on a deep copy, without system
  messages; changes are per-request and not persisted
  (`PI docs/extensions.md:815-827`; `PI dist/core/extensions/runner.js:1014-1029`).
  The transcript keeps the original mention text.

Zigai expands in `context` (`ZA src/mention-hub.ts:265-283`) using:
- the current editor text snapshot recorded on submit (`hub.input`,
  `mention-hub.ts:259-264`),
- selected-path snapshots recorded on picker selection
  (`ZA src/mention-resolution.ts:1-100`),
- full mention parsing for manually typed mentions,
- `expandMentionsInMessages` over **recent** user messages only
  (`ZA src/expand-mentions.ts:64-98`, `142-162`).

Skill expansion mirrors pi's `/skill:` block exactly:

```
<skill name="..." location="...">
References are relative to <baseDir>.

<body without frontmatter>
</skill>
```

(`PI dist/core/agent-session.js:1811-1825`; zigai's
`ZS src/skill-content.ts:19-43`, `66-68`).

Trade-off worth calling out: because zigai's context handler only scans messages
after the last assistant response (`firstRecentMessageIndex`,
`expand-mentions.ts:64-71`), earlier turns' mentions are not re-expanded on later
requests. The original `$skill` text is what the transcript stores, so a later
request sees the literal mention, not the skill body it saw in the prior request.
That keeps token costs down but changes the historical context. If we want
stable history, transform in `input` (skill body becomes the stored message,
like `/skill:`), or expand all historical user messages deterministically on
every request (more expensive, but stable). For picker selections, keeping a
path snapshot matters so a renamed/removed candidate still resolves to what the
user picked.

## 8. Public API vs reimplementation

### 8.1 Public API we can rely on

| Need | Public surface | Evidence |
| --- | --- | --- |
| Provider/item/suggestions types | `@earendil-works/pi-tui` | `TUI dist/autocomplete.d.ts:1-30`, `dist/index.d.ts:2` |
| Fuzzy match/filter | `fuzzyMatch`, `fuzzyFilter` | `TUI dist/index.d.ts:21`, `dist/fuzzy.js` |
| Register provider | `ctx.ui.addAutocompleteProvider` | `PI dist/core/extensions/types.d.ts:160-161`, `interactive-mode.js:2197-2200` |
| Editor factory composition | `ctx.ui.getEditorComponent` / `setEditorComponent` | `PI dist/core/extensions/types.d.ts:196-198`, `interactive-mode.js:2327-2360` |
| Base editor class | `CustomEditor` | `PI dist/index.d.ts:37`, `docs/extensions.md:3116-3153` |
| Theme colours | `ctx.ui.theme.fg` | `PI dist/core/extensions/types.d.ts` ExtensionUIContext |
| Commands/skills + provenance | `pi.getCommands()` | `PI dist/core/extensions/types.d.ts:1338`, `docs/extensions.md:1772-1808` |
| Agent dir | `getAgentDir()` | `PI dist/index.d.ts:2` |
| Events | `session_start`, `input`, `context`, `session_shutdown` | `docs/extensions.md`, `agent-session.js` |
| Editor primitives | `getText/getLines/getCursor/setText/isShowingAutocomplete` | `TUI dist/components/editor.d.ts` |
| Key matching | `matchesKey` | `TUI dist/index.d.ts` |

### 8.2 What we must reimplement

| Piece | Why | Zigai reference |
| --- | --- | --- |
| Trigger registry + dispatch | no pi registry | `ZA src/mention-hub.ts:123-230`, `chain-autocomplete.ts:306-330` |
| Token parser/formatter | no custom parser in pi | `ZA src/mention-syntax.ts:1-105`, `chain-syntax.ts:1-345` |
| Fuzzy/initial ranking | pi only offers `fuzzyFilter` | `ZA src/initial-suggestions.ts:50-134` |
| Selection history | no pi API | `ZA src/selection-history.ts:1-135` |
| Project-first | provider policy | `ZS src/skill-provider.ts:73-87` |
| Insertion + suffix + multi-line | `applyCompletion` return value | `ZA src/autocomplete.ts:55-85`, `203-224` |
| Slash-skill filter | wrapper over core results | `ZS src/slash-skill-filter.ts:1-30` |
| Editor render enhancer | no styling hook | `ZA src/editor.ts:118-180` |
| Colour parser for `@`/URLs | no styling hook | `ZA src/rendering.ts`, `mention-hub.ts:175-188` |
| Skill enumeration/expansion | public via `pi.getCommands` + file read | `ZS src/skill-commands.ts`, `skill-content.ts` |
| Context expansion + snapshots | provider policy | `ZA src/mention-resolution.ts`, `expand-mentions.ts` |

### 8.3 Zigai internals not to depend on

`@zigai/pi-extension-internals` (editor enhancer registry, linked method/render
patches, guarded internal module loading) is a private composition package, not
pi API. Zigai's source controller (cache TTLs, persistence, command providers,
typebox validation, paging, chain navigation, hub protocol on `ctx.ui`) is
engine implementation. We do not need any of it for three flat pickers. The
public-looking `@zigai/pi-mention-anything/api` is zigai's own API, not pi's; it
exists only if we install zigai.

## 9. Minimal code sketch

This is deliberately small: one wrapper, three triggers, flat candidates,
frecency, suffix, slash filter, and a colour-only editor hook. It omits concrete
loaders (skills, environments, etc.) and error notifications for brevity.

```ts
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

type Strategy = "frecency" | "recent" | "frequent" | "alphabetical" | "sourceOrder";

type Candidate = {
  id: string;
  label: string;
  value: string; // fully formatted: "$review", "%staging", ...
  description?: string;
  searchText?: string;
  scope?: "project" | "user" | "temporary";
};

type TriggerSpec = {
  trigger: "$" | "%" | "&"; // one code point, never "/" or whitespace
  load(ctx: ExtensionContext, pi: ExtensionAPI): Promise<readonly Candidate[]>;
  completionSuffix?: string;
  initial?: { strategy: Strategy; pinned: readonly string[] };
};

const specs: TriggerSpec[] = [
  { trigger: "$", load: loadSkills, initial: { strategy: "frecency", pinned: [] } },
  { trigger: "%", load: loadEnvironments, initial: { strategy: "sourceOrder", pinned: [] } },
  { trigger: "&", load: loadSomething, initial: { strategy: "alphabetical", pinned: [] } },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const orderedSpecs = [...specs].sort((a, b) => b.trigger.length - a.trigger.length);

function parseToken(textBeforeCursor: string) {
  for (const spec of orderedSpecs) {
    const t = escapeRegExp(spec.trigger);
    const m = new RegExp(`(?:^|[\\s([{<])${t}([^\\s]*)$`, "u").exec(textBeforeCursor);
    if (!m) continue;
    const query = m[1] ?? "";
    return { spec, query, prefix: spec.trigger + query };
  }
  return undefined;
}

function rankInitial(
  items: readonly Candidate[],
  strategy: Strategy,
  pinned: readonly string[],
  score: (id: string) => number,
): Candidate[] {
  const pins = new Map(pinned.map((name, i) => [name, i]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ap = pins.get(a.item.id);
      const bp = pins.get(b.item.id);
      if (ap !== undefined || bp !== undefined) {
        if (ap === undefined) return 1;
        if (bp === undefined) return -1;
        return ap - bp;
      }
      // Project-first is an explicit tier, not a pre-sort, so alphabetical
      // cannot erase it.
      const aProject = a.item.scope === "project" ? 0 : 1;
      const bProject = b.item.scope === "project" ? 0 : 1;
      if (aProject !== bProject) return aProject - bProject;

      if (strategy === "alphabetical") {
        const c = a.item.label.localeCompare(b.item.label, undefined, { sensitivity: "base" });
        if (c !== 0) return c;
      } else if (strategy === "recent" || strategy === "frequent" || strategy === "frecency") {
        const c = score(b.item.id) - score(a.item.id); // higher score first
        if (c !== 0) return c;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function createProvider(
  current: AutocompleteProvider,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  score: (id: string) => number, // metric for the configured history strategy
  record: (id: string) => void,
): AutocompleteProvider {
  const candidates = new Map<string, Candidate>();

  const withSlashFilter = (s: AutocompleteSuggestions | null) => {
    if (!s || !s.prefix.startsWith("/")) return s;
    const items = s.items.filter((item) => !item.value.startsWith("skill:"));
    return items.length === 0 ? null : { ...s, items };
  };

  return {
    triggerCharacters: specs.map((s) => s.trigger),

    async getSuggestions(lines, line, col, options) {
      const before = (lines[line] ?? "").slice(0, col);
      const token = parseToken(before);
      if (!token) {
        return withSlashFilter(await current.getSuggestions(lines, line, col, options));
      }

      const loaded = await token.spec.load(ctx, pi);
      if (options.signal.aborted) return null;

      const ranked = token.query
        ? fuzzyFilter([...loaded], token.query, (c) => c.searchText ?? `${c.label} ${c.description ?? ""}`)
        : rankInitial(
            loaded,
            token.spec.initial?.strategy ?? "frecency",
            token.spec.initial?.pinned ?? [],
            score,
          );

      candidates.clear();
      for (const c of loaded) candidates.set(c.value, c);

      const items: AutocompleteItem[] = ranked.map((c) => ({
        value: c.value,
        label: c.label,
        ...(c.description ? { description: c.description } : {}),
      }));
      return items.length === 0 ? null : { prefix: token.prefix, items };
    },

    applyCompletion(lines, line, col, item, prefix) {
      const token = parseToken((lines[line] ?? "").slice(0, col));
      if (!token || !prefix.startsWith(token.spec.trigger)) {
        return current.applyCompletion(lines, line, col, item, prefix);
      }

      const text = lines[line] ?? "";
      const start = col - prefix.length;
      let end = col;
      while (end < text.length && !/\s/u.test(text[end]!)) end += 1;

      const after = text.slice(end);
      const configured = token.spec.completionSuffix ?? " ";
      const suffix = configured.length === 0 ? "" : after.length === 0 ? configured
        : /^\s/u.test(after) ? "" : configured;

      const replacement = `${text.slice(0, start)}${item.value}${suffix}${after}`;
      const next = [...lines];
      next[line] = replacement;
      const candidate = candidates.get(item.value);
      if (candidate) record(candidate.id);
      return { lines: next, cursorLine: line, cursorCol: start + item.value.length + suffix.length };
    },

    shouldTriggerFileCompletion(lines, line, col) {
      const before = (lines[line] ?? "").slice(0, col);
      if (parseToken(before)) return false;
      return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
    },
  };
}

function colorRow(row: string): string {
  // Best-effort: ANSI-aware and idempotent in the real implementation.
  return row
    .replace(/(^|[\s([{<`])(@(?:"[^"]*"|[^\s]+))/gu, "$1\u001b[36m$2\u001b[39m")
    .replace(/\bhttps?:\/\/[^\s]+/gu, (url) => `\u001b[34m${url}\u001b[39m`);
}

function installColour(ui: ExtensionContext["ui"]) {
  const previous = ui.getEditorComponent();
  ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
    const render = editor.render.bind(editor);
    editor.render = (width: number) => {
      const rows = render(width);
      let bottom = rows.length - 1;
      while (bottom >= 0 && !rows[bottom]!.replace(/\u001b\[[0-9;]*m/g, "").startsWith("─")) bottom -= 1;
      for (let i = 1; i < bottom; i += 1) rows[i] = colorRow(rows[i]!);
      return rows;
    };
    return editor;
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const history = createHistory(pi); // load/record/flush; use getAgentDir()/state
    ctx.ui.addAutocompleteProvider((current) =>
      createProvider(current, ctx, pi, history.score, history.record),
    );
    installColour(ctx.ui);
  });
}
```

Implementation notes for the sketch:

- `createProvider` is called every time the chain is rebuilt. Any mutable
  candidate map is per-provider; do not share it across rebuilds.
- `score`/`record` come from a small history module: `count / (1 + ageDays/30)`
  for frecency, atomic JSON writes, one file per install (not per source, unless
  ids collide).
- `parseToken` in `applyCompletion` intentionally recomputes from `prefix` and
  `col`; do not use a token captured in `getSuggestions`.
- The colour regex is illustrative. Use the theme (`theme.fg("accent", ...)`)
  rather than hard-coded SGR, and test against the fake-cursor sequence and
  wrapped rows.
- Keep `@` and `/` out of the trigger list and always delegate for them.

## 10. Empirical probe

I instantiated the installed `Editor` with a stub TUI and a provider declaring
`triggerCharacters: ["$", "%", "&"]`, then typed through `handleInput`:

| Input | Result |
| --- | --- |
| `$`, `a`, `l` | three `getSuggestions` calls (`before: "$"`, `"$a"`, `"$al"`), menu open |
| Enter | buffer `$alpha `, cursor column 7; no submit |
| `x`, `$` | no `getSuggestions` call (`x$` is not a token start) |
| `(`, `$` | `getSuggestions` called (`(` is an allowed wrapper) |
| `%`, `b` | `getSuggestions` called for `%` and `%b` |
| `&` then Tab | single forced match inserted `&alpha ` directly, no menu render |
| insert then core undo | first undo restored `hello $al`; second undo restored the pre-`setText` buffer |

This confirms the trigger-union, boundary/wrapper rules, mid-menu Enter
behaviour, single-match Tab path, and one-snapshot undo described above.

## 11. Risks and open questions

1. **`@` colouring is the only non-provider piece with no public hook.** It is a
   render-text patch. It can be wrong on wrapped rows and must be ANSI-aware.
   Keep it strictly cosmetic: never change the text, only styling.
2. **Expansion history.** `context`-based expansion is per-request; older turns
   keep literal mentions in later requests (zigai's recent-message scan). Decide
   whether we want `/skill:`-style persistence via `input` or display-preserving
   literal text via `context`.
3. **Project-first vs alphabetical.** If project-first must always win, implement
   it as a rank tier before the strategy, not as a pre-sort.
4. **Duplicate wrapper registration.** `addAutocompleteProvider` appends; a
   second `session_start` without `resetExtensionUI` stacks. Register once, or
   guard with a session-scoped flag.
5. **Trigger collisions.** There is no public query for "who else owns `%`".
   The outermost wrapper wins unless it delegates. We should own all three
   triggers in one wrapper and document the conflict behaviour.
6. **Quoted tokens with spaces.** Pi's natural trigger stops at whitespace. Avoid
   spaces in names, or add a private re-trigger enhancer if we ever need
   `$"two words"`.
7. **`tryTriggerAutocomplete` is private.** Avoid needing it; if chained
   navigation arrives, prefer a design that lets ordinary typing re-open the
   menu.

## Appendix: source map

| Topic | Reference |
| --- | --- |
| Provider interface | `TUI dist/autocomplete.d.ts:1-30` |
| Factory/UI method | `PI dist/core/extensions/types.d.ts:65-66, 160-161` |
| Core provider | `TUI dist/autocomplete.js:202-289`, `290-357` |
| Trigger chars/defaults | `TUI dist/components/editor.js:170-184, 1959-1970` |
| Trigger call sites | `editor.js:1025-1055, 1902-1929` |
| Request lifecycle | `editor.js:1930-2030` |
| Best-row highlight | `editor.js:1867-1881, 2015-2023` |
| Insertion paths | `editor.js:618-645, 1882-1897, 1992-2003` |
| Undo | `editor.js:1779-1795`; `TUI dist/undo-stack.js:1-20` |
| Wrapper chain | `PI dist/modes/interactive/interactive-mode.js:481-577, 1653, 2033-2035, 2197-2200` |
| Editor replacement | `interactive-mode.js:2327-2360`; `PI docs/extensions.md:3116-3153` |
| Fuzzy | `TUI dist/fuzzy.js:1-125`; `TUI dist/index.d.ts:21` |
| Slash skills | `interactive-mode.js:546-558`; `TUI dist/autocomplete.js:234-252` |
| Skill provenance/expansion | `PI docs/extensions.md:1772-1808`; `PI dist/core/agent-session.js:1811-1825` |
| `input` / `context` | `PI docs/extensions.md:815-827, 1112-1121`; `PI dist/core/extensions/runner.js:1014-1029` |
| Zigai provider | `ZA src/autocomplete.ts:28-231` |
| Zigai ranking/history | `ZA src/initial-suggestions.ts:50-134`; `ZA src/selection-history.ts:1-135` |
| Zigai registry/editor | `ZA src/mention-hub.ts:123-307`; `ZA src/editor.ts:118-180` |
| Zigai chain/token parser | `ZA src/chain-syntax.ts:1-345`; `ZA src/chain-autocomplete.ts:306-596` |
| Zigai slash filter | `ZS src/slash-skill-filter.ts:1-30`; `ZS src/index.ts:27-38` |
| Zigai project-first | `ZS src/skill-provider.ts:73-87` |
| Vim composition | `VIM src/index.ts:89-121`; `VIM src/attach.ts:386-399, 559-574` |
| Vim undo | `VIM src/attach.ts:257-275`; `VIM src/port.ts:225-231` |
| RPC no-ops | `PI docs/rpc-extension-ui.md:18` |
