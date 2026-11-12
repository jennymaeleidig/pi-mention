# Editor decoration under zentui and vim mode

- Ticket: [#3](https://github.com/jennyleidig/pi-extensions/pi-mention/issues/3)
- Date: 2026-11-11
- Status: research, decided
- Branch: `research/editor-decoration-compat`
- Examined: `@earendil-works/pi-coding-agent@1.5.2`, `@earendil-works/pi-tui@1.5.2`,
  `pi-zentui@0.34.0`, `pi-vim-editor@0.10.0`

## Answers

| Question | Answer |
| --- | --- |
| Public decoration API? | **No.** There is no line/span/token hook, no editor render event, no theme-level "editor highlighter". The only editor seam is `ctx.ui.setEditorComponent(factory)` plus the component protocol `render(width): string[]`. Colouring therefore *requires* a custom editor component — concretely, a wrapper around the already-installed editor that post-processes the strings its `render()` returns. |
| Where in the chain? | The **innermost** editor: the instance whose `render(width)` still returns Pi's own rows (`[top border, …body rows, bottom border, …autocomplete]`). Under zentui that is the editor *zentui wraps*, not the editor zentui hands to Pi. |
| zentui composition | `pi-zentui` 0.34 either **wraps** the current factory (`WrappedPolishedEditor`) or, when nothing is installed, replaces it (`PolishedEditor extends CustomEditor`). In both cases it **re-renders the base editor at a narrower width** (`width − railWidth`) and **rebuilds every row** (`${rail}${fillLine(row, innerWidth)}`). Decorating zentui's *output* is therefore always wrong; decorating its *input* is exact. |
| vim composition | `pi-vim-editor` 0.10 mutates the editor instance in place (`handleInput`, `render`, `renderTopBorder`, `renderBottomBorder`) and publishes its state as `editor[Symbol.for("pi-vim-editor")]`. It never replaces the editor and never re-lays-out rows, so it composes with a decoration wrapper in either order. Its Visual highlight is gated on a layout-identity check that our decoration cannot break (we do not touch border rows or visible widths). |
| Load order | **pi-mention before pi-zentui.** Best: `pi-mention`, `pi-vim-editor`, `pi-zentui`. `pi-vim-editor` may sit on either side of `pi-mention`, but must be before `pi-zentui` for Visual highlighting. Order is *not* contractual in pi, so pi-mention must also be order-tolerant (walk to the innermost editor) and fail safe when it is not. |
| Safe theme roles | Foreground tokens only, resolved with `theme.fg()`: `accent`, `success`, `error`, `warning`, `syntaxKeyword`, `syntaxFunction`, `mdLink`, `mdLinkUrl`, `mdHeading`, `muted`, `dim`, `bashMode`, `text`. Avoid every `*Bg` token (`fg()` throws), avoid faint roles inside spans that must not cancel bold, and treat "role resolves to `\x1b[39m` only" as "no colour" (terminal-default tokens). `colorSource: "terminal"` is zentui-local: it does **not** change what `theme.fg()` returns. |
| Prior-art ANSI insertion still needed? | **Yes, as the mechanism** — there is nothing to migrate to. But the prior art's *implementation* has four defects (row search by `includes`, split-at-cursor by `+1` code unit, per-row token matching, no body-row proof). Keep the decorate-only contract, fix the mapping. |
| Breaks first | (1) wrong load order → colour silently absent (never corruption); (2) a token longer than the row width if detection is done per row instead of per logical line; (3) the cursor cell on a multi-code-unit grapheme if you split spans by code unit; (4) anything after the bottom border (autocomplete menu) if you decorate by row index instead of by layout. |

## 1. There is no decoration API (evidence)

`ExtensionUIContext` exposes exactly two editor entry points and a theme:

```ts
// dist/core/extensions/types.d.ts:83, 163-190
setEditorComponent(factory: EditorFactory | undefined): void;
getEditorComponent(): EditorFactory | undefined;
readonly theme: Theme;
```

The factory is `(tui, theme: EditorTheme, keybindings) => EditorComponent`
(`types.d.ts:163-190`; invoked at `dist/modes/interactive/interactive-mode.js:2327-2372`).
`EditorTheme` is **borders and the autocomplete list only** — it is not the
application theme (`dist/modes/interactive/components/custom-editor.d.ts:11-29`;
`@earendil-works/pi-tui/dist/components/editor.d.ts`, `EditorTheme`). Full colour
roles come from `ctx.ui.theme`, whose getter is live
(`interactive-mode.js:2203-2205`).

`EditorComponent` has no span hook at all:

```ts
// pi-tui dist/editor-component.d.ts
interface EditorComponent extends Component {
  getText(): string; setText(text: string): void; handleInput(data: string): void;
  onSubmit?; onChange?; addToHistory?; insertTextAtCursor?; getExpandedText?;
  setAutocompleteProvider?; borderColor?; setPaddingX?; setAutocompleteMaxVisible?;
}
```

Everything a component can emit is the return value of
`Component.render(width): string[]` (`docs/tui.md:20-52`). There is no render
event either: `ExtensionAPI.on()` covers session/tool/input/payload events
(`docs/extensions.md:414`, `docs/tui.md`), none of which fire per editor row.

What *is* public and useful:

| Symbol | Location | Use |
| --- | --- | --- |
| `Editor`, `EditorTheme`, `CustomEditor` | `pi-tui/dist/index.d.ts:6`; `pi-coding-agent/dist/index.d.ts` | subclass instead of reimplementing |
| `Editor.getLines()`, `getCursor()`, `getText()`, `getPaddingX()`, `isShowingAutocomplete()` | `editor.d.ts:40-58`, `editor.js:922-930` | text and geometry |
| `protected renderTopBorder(width, hidden)`, `renderBottomBorder(width, hidden)` | `editor.js:389-395` | identify the body rows without guessing |
| `CURSOR_MARKER` (`\x1b_pi:c\x07`), `FAKE_CURSOR_START/END`, `renderFakeCursor()` | `pi-tui/dist/tui.js:69-77` | recognise the cursor cell |
| `visibleWidth`, `sliceByColumn`, `truncateToWidth`, `wrapTextWithAnsi` | `pi-tui/dist/index.d.ts:35` | width invariants, testing |
| `Theme.fg(role, text)` | `theme.js:202-207` | the colour |

Everything a real decoration needs beyond this (`lastWidth`, `scrollOffset`,
`renderedVisibleLineCount`, `buildVisualLineMap`) is TypeScript-private
(`editor.d.ts:62-90`, `editor.js:1537`), exactly the set `pi-vim-editor` already
reaches for through its `port.ts`. pi exposes no way to ask "which logical
characters are in rendered row *i*". That is the upstream gap; pi-vim-editor's
integration notes state the same for Visual highlighting ("There's no API yet
to highlight a selection in rows that another extension rearranged").

## 2. The seam: decorate the innermost editor's `render()` output

### 2.1 Row anatomy (measured, pi 1.5.2)

`Editor.render(width)` (`editor.js:397-486`) returns, in order:

1. `renderTopBorder(width, scrollOffset)` — one row (`editor.js:432`)
2. one row per visible layout line: `leftPadding + text + padding + rightPadding`,
   with the cursor cell rewritten in place to
   `CURSOR_MARKER + renderFakeCursor(grapheme)` (`editor.js:438-475`)
3. `renderBottomBorder(width, linesBelow)` (`editor.js:477`)
4. autocomplete menu rows, if open (`editor.js:481-486`)

A real capture (`width = 30`, cursor inside `@src/index.ts`, `paddingX = 0`):

```text
0  30  "──────────────────────────────"
1  30  "read @src/in\u001b_pi:c\u0007\u001b_pi:fc\u0007d\u001b_pi:/fc\u0007ex.ts and        "
2  30  "──────────────────────────────"
map [{"logicalLine":0,"startCol":0,"length":23}]
lastWidth 29  scrollOffset 0  renderedVisibleLineCount 1
```

Facts that the decorator depends on:

- Body rows are `line.slice(startCol, startCol + length)` from
  `buildVisualLineMap(lastWidth)` — **raw slices, no trimming**. `wordWrapLine`
  cuts on grapheme boundaries and tiles the line contiguously
  (`editor.js:821-905`, `wordWrapLine` at `editor.js:82`). Verified with
  spaces, doubled spaces and forced char-wraps.
- The map is in **code units**, not columns: a 32-char URL splits as
  `{startCol:23,length:29}` / `{startCol:52,length:22}`.
- The cursor keeps its grapheme: `before + CURSOR_MARKER + renderFakeCursor(g) + after`.
  `\x1b[7m`/`\x1b[27m` are injected by the TUI later
  (`pi-tui/dist/tui.js:1089-1095`), and `27` does **not** reset the foreground.
- Cursor at end-of-line appends `renderFakeCursor(" ")`, a cell that is not in
  the logical text.
- `getLines()` returns the stored lines, so large pastes appear as their
  collapsed marker (`[paste #3 +120 lines]`) and are never coloured; the full
  text is only in `getExpandedText()`.
- Padding is `min(getPaddingX(), floor((width-1)/2))`; `editorPaddingX`
  defaults to `0` (`dist/core/settings-defaults.js:46`) but is user-settable
  0–3, and `interactive-mode.js:2349-2351` forces the *returned* editor to the
  default editor's padding.

### 2.2 Why not replace the editor

A from-scratch editor component would (a) re-own layout, wrapping, history,
undo, paste blocks and autocomplete, and (b) **break vim**: `pi-vim-editor`
attaches through `portFor(editor)`, which requires `state.lines`,
`state.cursorLine/Col`, `pastes`, `pasteCounter`, `lastAction`, `undoStack`,
`getText`, `isShowingAutocomplete`, `setCursorCol`, `pushUndoSnapshot`,
`undo`, `exitHistoryBrowsing`, `cancelAutocomplete` (`src/port.ts:100-145`).
Anything that is not pi's `Editor`/`CustomEditor` is refused with
"pi-vim-editor doesn't support this editor or Pi version; Vim mode is off."
(`src/attach.ts:91-110`). Subclassing or wrapping the installed editor keeps
all of that.

### 2.3 Finding the innermost editor

`pi-zentui` may already be installed when pi-mention's factory runs. Then the
instance handed back by the previous factory is `WrappedPolishedEditor`, which
forwards `getText`/`getLines`/`getCursor`/`render`/`handleInput` but **not**
the layout internals (`extensions/zentui/ui.ts:1403-1560`). The real editor is
reachable as `.base` (`ui.ts:1408`, `private readonly base: WrappedEditor`).

So the factory does:

```ts
const outer = previous?.(tui, theme, keybindings)
           ?? new CustomEditor(tui, theme, keybindings);
const inner = innermost(outer);      // follow `.base` up to 4 hops
installDecoration(inner, deps);      // decorate the pi Editor, in place
return outer;                        // hand back what we were given
```

`innermost()` accepts the instance itself when it exposes `buildVisualLineMap`
+ `render` (plain `CustomEditor`, or zentui's `PolishedEditor`, which *is* an
`Editor`), otherwise follows `.base`. This makes decoration independent of
whether zentui installed before or after us.

## 3. How zentui composes (and why "inside" is the only correct side)

Install path (`extensions/zentui/index.ts`):

```ts
// index.ts:1234-1256
const currentFactory = ctx.ui.getEditorComponent();
const baseFactory = getZentuiEditorBaseFactory(currentFactory)
  ?? (currentFactory && !isZentuiEditorFactory(currentFactory) ? currentFactory : undefined);
const nextFactory = baseFactory && host.wrapEditor !== false
  ? makeWrappedEditorFactory(ctx, baseFactory)   // index.ts:1165
  : makeEditorFactory(ctx, baseFactory);         // index.ts:1101
```

- `wrapEditor` defaults to on under pi (only `omp.ts:126` sets it false), so
  **if any editor factory exists, zentui wraps it**; `PolishedEditor` is used
  only when nobody installed an editor first.
- zentui re-installs on any editor-relevant settings change
  (`reconcileEditor`, `index.ts:1450-1485`), wrapping whatever factory is
  current at that moment.

Rendering, every style (`ui.ts:1280-1401` wrap path `ui.ts:1580-1690`):

```ts
const { rail, railWidth } = getEditorChromeWidths(config, uiTheme, "\x1b[0m", shellMode); // ui.ts:435
const innerWidth = width - railWidth;                                        // ui.ts:1035, 1366
captured = renderWithAutocompleteCapture(this, () => this.renderBase(innerWidth));
...
`${top}`, ...lines.map(line => `${rail}${fillLine(line, innerWidth)}`), `${bottom}`, ...completionLines
```

`rail` is the frame glyph (`▎` by default, `icons.rail` at `config.ts:572`)
plus a space, coloured by `EDITOR_ACCENT_STYLE`/`EDITOR_ACCENT_FALLBACK`
(`style.ts:13-31`, `ui.ts:435-461`), so **every** style indents the body by at
least two columns — and `accent-rail` (`width − 3`) and `minimalist`
(`width − 4`) add their own chrome on top. Consequences:

- Decorating zentui's output means colouring the *rail-prefixed, re-padded*
  rows: offsets are wrong, and the top border may be metadata text rather than
  a rule. The prior art's `rowText` search partially survives that, but the
  cursor columns and `startCol` do not.
- Decorating zentui's input means decorating the editor it calls
  `base.render(innerWidth)` — Pi's own rows at that width. Decorations are
  width-relative and recomputed per call, so the narrower width is a non-issue.
- zentui preserves our escapes: body rows are extracted with
  `sliceEditorColumns` → `sliceByColumn(..., true)` (`ui.ts:551-565`), which
  carries pending SGR into the slice (`pi-tui/dist/utils.js:1215-1259`), and
  re-padded by `fillLine`/`truncateToWidth` (`ui.ts:381-390`). Verified: a
  decorated row survives `sliceByColumn` + `truncateToWidth` with colour and
  cursor markers intact.
- zentui's provenance check compares the captured row strings for identity
  (`inspectPolishedFrameProvenance`, `ui.ts:751-774`), so decoration must be
  **deterministic**: same text + width + theme ⇒ same bytes. Static colouring
  is; time- or animation-driven colouring is not, and would make zentui fall
  back to undecorated rows for that frame.
- zentui calls the base render exactly once per frame (`renderWithAutocompleteCapture`
  patches the *autocomplete list*, `ui.ts:290-343`), so a per-render decorator
  is not multiplied.

## 4. How vim composes

`pi-vim-editor` (`src/index.ts:86-124`) is itself a factory wrapper:

```ts
const previous = ui.getEditorComponent();
const factory = (tui, theme, kb) => {
  const editor = previous?.(tui, theme, kb) ?? new CustomEditor(tui, theme, kb, { embedWorkingStatus: true });
  attach(editor, kb, shared, ...);
  return editor;
};
ui.setEditorComponent(Object.assign(factory, { [OURS]: true }));
```

`attach()` requires only `handleInput`/`render`/`renderTopBorder`/`renderBottomBorder`
(`src/attach.ts:91-120`), takes over those four methods, and publishes
`editor[Symbol.for("pi-vim-editor")] = { version: 1, status() }`
(`src/status.ts:9,51-58`; `docs/integration.md`). It does not touch
`render`'s rows except for Visual selection, and it does not own layout.

Two vim details matter to us:

1. **Its highlight is additive and identity-checked.** `target.render` calls the
   saved render, then, only if `native(lines, width, layout, borders)` holds
   (`src/attach.ts:643-654, 691-703`), paints selection columns with
   `reverse()` (`src/attach.ts:755-817`). `native()` requires the top/bottom
   border rows it just produced to be exactly `rendered[0]` and
   `rendered[rows+1]`. **We must never touch border rows or change visible
   widths**, and then vim's gate keeps passing regardless of which of us is
   outer.
2. **`reverse()` tolerates foreign SGR.** It re-emits `\x1b[7m` after
   `\x1b[0m`, `\x1b[m`, `\x1b[27m` and the fake-cursor end marker
   (`RESETS`, `src/attach.ts:755-760`). `theme.fg()` closes with `\x1b[39m`
   (or `\x1b[22;39m` for faint roles) — neither resets reverse video, so a
   coloured span inside a Visual selection keeps both. Both nesting orders
   (mention‑outside‑vim, vim‑outside‑mention) are safe.

Because both extensions wrap the same instance, **mention and vim can be in
either order**. Zentui cannot: it rewrites rows.

## 5. Load order

Extension handlers run in load order (`docs/extensions.md:414`), and both zentui
and vim install from `session_start` (`zentui/index.ts:1631`,
`vim/src/index.ts:68-122`). Load order is the concatenation of project
`.pi/extensions`, global `~/.pi/agent/extensions` (both `readdirSync`) and then
the `packages`/`extensions` setting arrays — no documented ordering contract,
and no sorting beyond what the filesystem returns.

Recommended order (and the order already used in this machine's
`~/.pi/agent/settings.json`, where `npm:pi-vim-editor` precedes
`npm:pi-zentui`):

```jsonc
"packages": [
  "npm:pi-mention",       // innermost: colours Pi's rows
  "npm:pi-vim-editor",    // wraps the editor instance
  "npm:pi-zentui"         // outermost: chrome, rail, metadata
]
```

| Order | Result |
| --- | --- |
| mention → vim → zentui | All three work. zentui frames, vim highlights, mention colours. **Recommended.** |
| vim → mention → zentui | Works. mention wraps vim's methods; zentui frames both. |
| zentui → mention | mention is outside a framing editor. Layout probe fails ⇒ **no colour**, one warning. No corruption. |
| zentui → vim | vim's `native()` fails ⇒ Visual highlight and `H`/`M`/`L` quietly off (documented by vim). Editing still works. |
| zentui → vim → mention | Both degraded as above. |

Two order hazards to design for:

- **zentui re-install nests its old factory.** If zentui installed first and
  pi-mention later, zentui's `reconcileEditor` sees a foreign factory and
  wraps it (`index.ts:1450-1470`), while pi-mention's closure still calls the
  *old* zentui factory — producing a zentui editor inside pi-mention inside a
  new zentui wrapper (double chrome). Guard with a re-entrancy flag in the
  factory: when the factory is re-entered while constructing, return a plain
  `new CustomEditor(...)` and let the new wrapper supply chrome. (The prior art
  has this flag; keep it.)
- **`pi` overwrites the returned editor's callbacks.** After the factory
  returns, pi copies `onSubmit`/`onChange`, `borderColor`, `setPaddingX`,
  `setAutocompleteMaxVisible` and the autocomplete provider
  (`interactive-mode.js:2337-2372`). Decoration must not live in those; it
  lives in `render`.

## 6. Theme roles

`Theme.fg(role, text)` is `${open}${text}${close}` where `close` is `\x1b[39m`,
or `\x1b[22;39m` for a faint role (`theme.js:202-207`). Measured on `dark`:

| Role | ANSI | Note |
| --- | --- | --- |
| `accent` | `38;2;167;152;215` | safe; brand colour |
| `mdLink` | `38;2;105;173;208` | safe; URLs |
| `mdLinkUrl` | `38;2;157;165;169` | safe; paths; faint in the `system` fallback (`\x1b[2m…\x1b[22;39m`) |
| `mdHeading` / `syntaxFunction` / `warning` | `38;2;205;154;34` | safe; `$` skills |
| `syntaxKeyword` | `38;2;105;173;208` | safe; `%` tools / `&` roles |
| `success` / `error` | `38;2;104;183;141` / `38;2;234;127;129` | safe; unresolved / invalid |
| `muted` / `dim` | `38;2;157;165;169` / `38;2;126;136;142` | safe but low contrast; faint in fallback |
| `text`, `toolTitle`, `userMessageText`, `toolOutput`, `borderAccent` | all fg tokens | usable |
| `selectedBg`, `userMessageBg`, any `*Bg` | — | **throws** `Unknown theme color` from `fg()` |
| any role the theme sets to `""` | `\x1b[39m` only | **invisible**; must be detected |

Rules:

1. Resolve the role on every render, never cache ANSI strings: a theme change
   replaces the `Theme` object behind the live `ctx.ui.theme` getter, and
   `docs/tui.md:160-170` explicitly forbids storing themed strings without an
   `invalidate()` path. Cache `role → {prefix, suffix}` in a `WeakMap` keyed by
   the theme object instead.
2. Find prefix/suffix by probing with a sentinel (`theme.fg(role, "\0")`), not
   by assuming `\x1b[39m`: faint roles close with `\x1b[22;39m`, which also
   cancels bold. Avoid faint roles anywhere a bold label could wrap them.
3. Validate user-configured roles with the same probe in a `try/catch`
   (`fg` throws on unknown or background tokens) and fall back to `accent`.
4. If the probe's open sequence contains no colour parameter (only `0`/`2`/
   `22`/`39` and attributes), the role is terminal-default in this theme —
   treat it as "no colour" and fall back.

**`colorSource: "terminal"` is zentui-local.** It selects between
`renderTerminalStyle` (fixed ANSI names: `blue`, `bright-black`, `bright-cyan`,
`style.ts:283-330`) and `renderThemeStyle` (name→role mapping
`red→error, blue→syntaxFunction, purple→syntaxKeyword, black→muted, …`,
`style.ts:89-110`) for **zentui's own chrome** — borders, rail, metadata,
working line (`style.ts:369-410`, default `editor: "terminal"` at
`config.ts:702`, documented at `docs/configuration.md:190-200`). It never
touches body text. So user span colours stay theme-relative and remain legible
on any background; the only artefact is aesthetic (a fixed blue rail next to a
theme blue link). If a future ticket wants to mimic it, the same 16 names are a
small opt-in, but do not derive span colours from zentui's config.

## 7. Does the prior-art ANSI approach still hold?

Yes for the contract, no for the implementation. The vault prototype
(`pi-mention-colors.ts`) is correct on the essentials — copy escapes verbatim,
insert only prefix/suffix, never move a byte, decorate only Pi's rows — and it
proves the approach works. Four defects should not be carried over:

1. **Row discovery by `plain.includes(expected)`** with a monotonically
   advancing index (`enhanceEditor`, `layoutRows`). It guesses which rendered
   row belongs to which layout row, can land on the wrong row when the same
   text repeats, and it *requires* `buildVisualLineMap`+`lastWidth` anyway. Use
   the layout map and index body rows from the borders; verify, then paint.
2. **Split-at-cursor by one code unit** (`splitAtCursor`:
   `start: cursorPlain + 1`). `cursor.col` and `cursorPos` are **code units**;
   a cursor on `😀`, a flag or a combining sequence splits a grapheme and
   injects an escape between surrogate halves. Measured: `😀` is 2 code units.
   Worse, splitting is not needed at all: `\x1b[27m` does not reset the
   foreground, so a span may run straight through the cursor cell. Colour the
   token once and let the TUI's reverse video sit inside it.
3. **Per-row token detection.** A URL or long path is sliced by the wrapper;
   matching on the row loses the continuation (`...-th` / `at-wraps` in the
   measured capture). Detect on `getLines()` (logical text, code-unit offsets),
   then project spans onto rows through the layout map.
4. **No body-row proof.** Anything that decorates rows by index will colour the
   autocomplete menu (rows after the bottom border) and can wrap a
   `SelectList` row in an escape that its truncation does not expect. Record
   the strings returned by `renderTopBorder`/`renderBottomBorder` and decorate
   strictly between them, only after they match.

The two "hard rules" in the vault note therefore become: (1) escapes verbatim,
prefix/suffix only — keep; (2) "leave the cursor cell alone, split spans around
it" — **drop**, it is unnecessary and unsafe. Keep "leave the cursor *marker*
alone" in the narrow sense that the marker/fence bytes are copied, not
rewritten.

## 8. What breaks first

Ordered by likelihood, with the failure mode:

1. **Wrong load order (zentui first).** `WrappedPolishedEditor` has no
   `buildVisualLineMap`/`lastWidth`/`scrollOffset` (`ui.ts:1403-1560`), and
   `PolishedEditor`'s rows are rail-prefixed and re-padded (`ui.ts:1035-1153`).
   The layout probe fails, decoration is skipped for the session. This is
   fail-safe — the prompt looks plain, never wrong.
2. **Token longer than the layout width.** Only broken if detection is per row
   (prior art). With logical spans it is correct on every fragment, because
   both fragments are painted from the same logical span.
3. **Cursor on a wide/compound grapheme.** Only broken by the split-at-cursor
   rule. Without splitting, the cell is reverse video in the token colour.
4. **Autocomplete menu.** Rows after the bottom border must not be touched.
5. **Selection (vim Visual).** Not broken by decoration — provided border rows
   and visible widths are untouched and escapes are re-opened after resets.
   It *is* broken by installing vim after zentui (vim's own documented limit).
6. **Multi-line prompts, scroll offsets.** Fine with the layout map
   (`scrollOffset` slices the map), broken by any implementation that assumes
   body row 1 is logical line 0.
7. **Theme change.** Broken by caching finished row strings; fixed by caching
   only role probes per theme.
8. **zentui re-install** (settings change): double chrome unless the factory
   guards re-entry.

## 9. Code sketch

Verified against real pi-tui 1.5.2 rows in both its working and its
fail-safe path (see §10): the sketch below is the prototype, with the token
detector (`spansForLine`) left to pi-mention's detection layer.

```ts
import { CustomEditor, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";

type Role = Parameters<Theme["fg"]>[0];
type Wrap = { prefix: string; suffix: string };
/** A coloured range in one logical line, in code units (what getLines() returns). */
type Span = { start: number; end: number; role: Role };

/** The private slice of pi-tui's Editor a decorator needs. Probed, never assumed. */
type Port = {
  getLines(): string[];
  getPaddingX?(): number;
  render(width: number): string[];
  buildVisualLineMap?(width: number): { logicalLine: number; startCol: number; length: number }[];
  lastWidth?: number;
  scrollOffset?: number;
  renderedVisibleLineCount?: number;
  renderTopBorder(width: number, hidden: number): string;
  renderBottomBorder(width: number, hidden: number): string;
};

const ESC = "\u001b";
const DONE = Symbol.for("pi-mention.decorated");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length of the escape (or APC/OSC string) at `i`, or 0 for text. */
function escapeAt(text: string, i: number): number {
  if (text[i] !== ESC) return 0;
  const next = text[i + 1];
  if (next === undefined) return 1;
  if (next === "[") {
    for (let j = i + 2; j < text.length; j++) {
      const code = text.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) return j + 1 - i;
    }
    return text.length - i;
  }
  if (next === "]" || next === "_" || next === "P" || next === "^") {
    const bel = text.indexOf("\u0007", i + 2);
    const st = text.indexOf(`${ESC}\\`, i + 2);
    if (bel < 0 && st < 0) return text.length - i;
    if (bel >= 0 && (st < 0 || bel < st)) return bel + 1 - i;
    return st + 2 - i;
  }
  return 2;
}

/** True when an SGR prefix actually sets a foreground colour. */
function setsColour(sequence: string): boolean {
  for (const match of sequence.matchAll(/\u001b\[([0-9;]*)m/g)) {
    for (const part of match[1].split(";")) {
      const code = Number(part === "" ? "0" : part);
      if ((code >= 30 && code <= 38) || (code >= 90 && code <= 97)) return true;
    }
  }
  return false;
}

/** Wrap the one grapheme run of a row that a logical span covers, copying all escapes. */
function paintRow(
  row: string,
  padding: number,
  seg: { startCol: number; length: number },
  spans: readonly Span[],
  wrap: (role: Role) => Wrap | undefined,
): string {
  if (spans.length === 0 || row.length === 0) return row;
  const lo = seg.startCol;
  const hi = lo + seg.length;
  const start = Math.min(padding, row.length); // left padding is not prompt text
  let out = row.slice(0, start);
  let i = start;
  let logical = lo;
  let open: (Wrap & { end: number }) | null = null;
  const close = () => {
    if (open) out += open.suffix;
    open = null;
  };

  while (i < row.length) {
    const esc = escapeAt(row, i);
    if (esc > 0) {
      // Copy the escape verbatim, then keep our colour alive across it. Pi's
      // cursor markers and another extension's SGR must keep their bytes.
      out += row.slice(i, i + esc);
      if (open) out += open.suffix + open.prefix;
      i += esc;
      continue;
    }
    if (logical >= hi) {
      close();
      out += row.slice(i); // row padding, or the cursor-at-end cell
      break;
    }
    let next = row.indexOf(ESC, i);
    if (next < 0) next = row.length;
    for (const { segment } of segmenter.segment(row.slice(i, next))) {
      if (logical >= hi) {
        close();
        out += segment;
        continue;
      }
      if (open && logical >= open.end) close();
      const span = spans.find((s) => logical < s.end && logical + segment.length > s.start);
      if (span && !open) {
        const w = wrap(span.role);
        if (w) {
          out += w.prefix;
          open = { ...w, end: span.end };
        }
      }
      out += segment; // one grapheme, unchanged; the cursor cell is just a grapheme here
      logical += segment.length;
    }
    i = next;
  }
  close();
  return out;
}

function installDecoration(
  editor: object,
  getTheme: () => Theme | undefined,
  spansForLine: (line: string) => Span[],
): boolean {
  const ed = editor as Port;
  const marked = editor as Record<symbol, unknown>;
  if (marked[DONE]) return true;
  if (typeof ed.render !== "function" || typeof ed.getLines !== "function") return false;
  if (typeof ed.renderTopBorder !== "function" || typeof ed.renderBottomBorder !== "function") return false;
  Object.defineProperty(editor, DONE, { value: true });

  const render = ed.render.bind(editor);
  const top = ed.renderTopBorder.bind(editor);
  const bottom = ed.renderBottomBorder.bind(editor);
  let topLine = "";
  let bottomLine = "";
  // Record the borders Pi drew this frame; they prove which rows are the prompt.
  ed.renderTopBorder = (w, h) => (topLine = top(w, h));
  ed.renderBottomBorder = (w, h) => (bottomLine = bottom(w, h));

  const wraps = new WeakMap<Theme, Map<Role, Wrap | null>>();
  const wrapFor = (theme: Theme, role: Role): Wrap | undefined => {
    let map = wraps.get(theme);
    if (!map) wraps.set(theme, (map = new Map()));
    if (!map.has(role)) {
      let value: Wrap | null = null;
      try {
        const probe = theme.fg(role, "\0");
        const at = probe.indexOf("\0");
        const prefix = at > 0 ? probe.slice(0, at) : "";
        // No colour parameter (e.g. only "\x1b[39m"): the theme leaves this
        // token at the terminal default, so there is nothing to apply.
        if (at > 0 && setsColour(prefix)) value = { prefix, suffix: probe.slice(at + 1) };
      } catch {
        // Unknown token, or a background token: fg() throws.
      }
      map.set(role, value);
    }
    return map.get(role) ?? undefined;
  };

  ed.render = (width: number): string[] => {
    const lines = render(width);
    const theme = getTheme();
    const layout = ed.buildVisualLineMap?.(ed.lastWidth ?? width);
    const rows = ed.renderedVisibleLineCount ?? 0;
    const scroll = ed.scrollOffset ?? 0;
    if (!theme || !layout || rows <= 0 || lines.length < rows + 2) return lines;
    // Refuse to touch anything that is not Pi's own frame: a framer may have
    // rendered the base at another width, or replaced these rows.
    if (lines[0] !== topLine || lines[rows + 1] !== bottomLine) return lines;

    const text = ed.getLines();
    const perLine = text.map(spansForLine);
    if (perLine.every((spans) => spans.length === 0)) return lines;
    const padding = Math.min(ed.getPaddingX?.() ?? 0, Math.max(0, Math.floor((width - 1) / 2)));

    const out = [...lines];
    for (let r = 0; r < rows; r++) {
      const seg = layout[scroll + r];
      if (!seg) continue;
      const spans = perLine[seg.logicalLine].filter(
        (s) => s.start < seg.startCol + seg.length && s.end > seg.startCol,
      );
      if (spans.length === 0) continue;
      out[r + 1] = paintRow(lines[r + 1], padding, seg, spans, (role) => wrapFor(theme, role));
    }
    return out;
  };
  return true;
}

/** zentui's WrappedPolishedEditor forwards the component API but not the layout. */
function innermost(editor: object): object {
  let current: object = editor;
  for (let hop = 0; hop < 4; hop++) {
    if (typeof (current as Port).buildVisualLineMap === "function") return current;
    const base = (current as { base?: unknown }).base;
    if (!base || typeof base !== "object") return current;
    current = base;
  }
  return current;
}

export default function mention(pi: ExtensionAPI): void {
  let installed = false;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || installed) return;
    installed = true;
    const previous = ctx.ui.getEditorComponent();
    // zentui re-installs on settings changes and will wrap this factory; if it
    // does, calling the captured `previous` would nest its old editor inside us.
    let constructing = false;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      if (constructing) return new CustomEditor(tui, theme, keybindings);
      constructing = true;
      try {
        const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        if (!installDecoration(innermost(editor), () => ctx.ui.theme, spansForLine)) {
          ctx.ui.notify(
            "pi-mention: this editor doesn't expose its layout, so mention colours are off. " +
              "Load pi-mention before pi-zentui.",
            "info",
          );
        }
        return editor;
      } finally {
        constructing = false;
      }
    });
  });
}

```

`innermost()` walks `editor.base` (zentui's `WrappedPolishedEditor`) at most
four hops and returns the first object with `render` + `buildVisualLineMap`.

## 10. Verification performed

A prototype of `paintRow` + the row/border plumbing (the §9 sketch) was run
against real pi-tui 1.5.2 output, mounted through its own `setEditorComponent`
factory (temp script, not committed). Invariants asserted for every case:
`visibleWidth(row)` unchanged, text unchanged after stripping SGR,
`CURSOR_MARKER` count per row unchanged, and the intended rows coloured.

| Case | width | text | markers | coloured rows |
| --- | --- | --- | --- | --- |
| token, cursor after | ✓ | ✓ | ✓ | 1/1 |
| cursor inside token | ✓ | ✓ | ✓ | 1/1 |
| cursor on the `@` | ✓ | ✓ | ✓ | 1/1 |
| URL longer than the row (wrapped) | ✓ | ✓ | ✓ | 3/3 |
| emoji before token | ✓ | ✓ | ✓ | 1/1 |
| cursor on an emoji | ✓ | ✓ | ✓ | 1/1 |
| `editorPaddingX: 1` | ✓ | ✓ | ✓ | 1/1 |
| width 12 | ✓ | ✓ | ✓ | 2/3 (blank row legitimately uncoloured) |
| multi-line prompt | ✓ | ✓ | ✓ | 2/2 |

Decorated capture (width 30, cursor inside the path):

```text
1 30 "read \e[35m@sr\e_pi:c\a\e[39m\e[35m\e_pi:fc\a\e[39m\e[35mc\e_pi:/fc\a\e[39m\e[35m/index.ts\e[39m and        "
2 30 "\e[36mhttps://example.com/a-very-lo\e[39m "
3 30 "\e[36mng-path-that-wraps\e[39m now        "
```

The cursor cell is inside one continuous colour run; `\e[27m` injected by the
TUI only cancels reverse video.

Also verified: `sliceByColumn(row, 2, n, true)` (zentui's body-row slicer)
preserves the SGR and the cursor markers, and `truncateToWidth` re-pads without
dropping them.

Fail-safe path verified separately: when the factory returns a component that
forwards only the `EditorComponent` API (what zentui's `WrappedPolishedEditor`
does), the port probe fails, `render()` returns Pi's rows byte for byte, and
exactly one informational notification is raised — no colour, no corruption.

## 11. Open items / upstream asks

- pi exposes no row/span hook and no way to ask which logical characters a
  rendered row contains. A public `Editor.decorate(spans)` or a
  `renderLine(lineIndex, text)` hook would remove the last private dependency.
  Worth filing upstream; `pi-vim-editor` asks for the same for Visual
  selections.
- zentui reads vim mode through a `getMode()` duck type
  (`ui.ts:101, 793-800`) that `pi-vim-editor` 0.10 does not publish (it
  publishes `Symbol.for("pi-vim-editor").status()`). pi-mention should read the
  symbol; a `/zentui` mode label stays empty until one of the two adapts.
- Render cost: one `Intl.Segmenter` pass over the visible rows plus a role
  probe per render. Memoise spans by `(text, settings)` and role wraps by
  `Theme`; do not memoise finished rows.

## References

pi 1.5.2 (`node_modules/@earendil-works/pi-coding-agent`):

- `dist/core/extensions/types.d.ts:83,163-190` — `ExtensionUIContext`,
  `setEditorComponent`/`getEditorComponent`, live `theme`.
- `dist/modes/interactive/interactive-mode.js:2327-2372` — factory invocation,
  callback wiring, forced padding.
- `dist/modes/interactive/components/custom-editor.d.ts:11-29` — `CustomEditor`.
- `docs/extensions.md:414` — handlers run in load order; `:3116-3164` — custom
  editor guidance; `docs/tui.md:20-52,160-170` — component/ANSI contract.
- `dist/core/settings-defaults.js:46` — `editorPaddingX: 0`.

pi-tui 1.5.2 (`node_modules/@earendil-works/pi-tui`):

- `dist/components/editor.js:397-486` — row order, cursor rewrite, autocomplete
  rows; `:389-395` borders; `:821-905` `layoutText`; `:1537` `buildVisualLineMap`;
  `:922-930` `getLines`/`getCursor`.
- `dist/components/editor.d.ts` — public API, `EditorTheme`, private layout.
- `dist/tui.js:69-77,1089-1095` — `CURSOR_MARKER`, fake-cursor fence,
  `\x1b[7m`/`\x1b[27m`.
- `dist/utils.js:1215-1259` — `sliceByColumn` carries pending SGR.
- `dist/index.d.ts:6,35` — exports used above.

pi-zentui 0.34 (`node_modules/pi-zentui/extensions/zentui`):

- `index.ts:1101-1160` standalone factory; `:1165-1233` wrapper factory;
  `:1234-1256` install choice; `:1450-1485` reconcile; `:1077-1099`
  layered-editor record; `:1631` `session_start`.
- `ui.ts:1160-1240` `PolishedEditor`; `:1403-1560` `WrappedPolishedEditor`
  (no layout internals); `:1035-1153` rail + `fillLine` composition;
  `:1280-1401,1580-1690` style dispatch; `:435-461` rail widths;
  `:551-565` body-row slicing; `:381-390` clamp/fill; `:751-774` provenance;
  `:290-343` autocomplete capture; `:101,793-800` vim mode duck type.
- `style.ts:13-37,89-110,283-330,369-410` — colour sources; `config.ts:702`
  default `colorSources.editor = "terminal"`; `docs/configuration.md:190-200`.

pi-vim-editor 0.10 (`node_modules/pi-vim-editor`):

- `src/index.ts:68-124` — factory wrapper, `OURS` marker, status paint.
- `src/attach.ts:91-120` — attach surface; `:489-496` input; `:643-654` render +
  `native()` gate; `:663-678` border decoration; `:691-703` `native()`;
  `:755-817` `reverse`/`highlight`.
- `src/port.ts:100-145` — required editor internals.
- `src/status.ts:9,51-58` — `Symbol.for("pi-vim-editor")` capability.
- `README.md` "Usage"; `docs/integration.md` (upstream) — load order and the
  framing limitation.

Prior art: `Vault/ideas/tech/config/pi/extensions/pi-mention/colors.md`
(`pi-mention-colors.ts`) — keep the contract, fix row discovery, cursor
splitting and per-row detection.
