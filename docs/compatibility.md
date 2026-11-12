# Compatibility matrix

What was tested against pi 1.5.2, `pi-zentui` 0.34.0 and `pi-vim-editor`
0.10.0, and what did not work. This is the evidence for
[#20](https://github.com/jennymaeleidig/pi-mention/issues/20).

## Environment

- pi 1.5.2, Node 22, macOS.
- `TERM=xterm-256color`, `COLORTERM=truecolor`, a 120x42 PTY, resized to 60x30
  where noted.
- A temporary `PI_CODING_AGENT_DIR` per combination. Each holds a minimal
  `settings.json`, `models.json`, the user's `agents/` and `skills/`, and a
  `zentui.json` copied from the live config with the editor style changed to
  `minimalist` or `opencode`. `settings.json` selects the local `mock` model
  defined in `models.json`, so the UI runs contact no live provider.
- Extensions are loaded explicitly with `--no-extensions -e …` so the order in
  the command is the load order:

```sh
repo=/Users/jennyleidig/Documents/projects/pi-extensions/pi-mention
zentui=$HOME/.pi/agent/npm/node_modules/pi-zentui
vim=$HOME/.pi/agent/npm/node_modules/pi-vim-editor/src/index.ts

# stock
pi --no-session --no-context-files --no-extensions --no-mcp \
  -e "$repo/src/index.ts"

# zentui after pi-mention
pi … -e "$repo/src/index.ts" -e "$zentui"

# vim after pi-mention
pi … -e "$repo/src/index.ts" -e "$vim"

# both, either vim side, zentui last
pi … -e "$repo/src/index.ts" -e "$vim" -e "$zentui"
pi … -e "$vim" -e "$repo/src/index.ts" -e "$zentui"
```

`--no-extensions` matters: without it the live `settings.json` package list
also loads the user's other editor extensions, which changes the result.

## Palette C observed

All five classes and the unresolved fallback, stock TUI:

```text
\e[38;2;171;157;242m$wayfinder\e[0m
\e[38;2;252;152;103m%read\e[0m
\e[38;2;169;220;118m&general\e[0m
\e[38;2;120;220;232m@docs/mention-grammar.md\e[0m
\e[38;2;255;97;136mhttps://example.com\e[0m
\e[38;2;255;216;102m$nope\e[0m
\e[38;2;255;216;102m%nope\e[0m
\e[38;2;255;216;102m&nope\e[0m
\e[38;2;255;216;102m@no/such/path\e[0m
```

Purple skill, orange tool, green role, cyan path, pink URL, yellow unresolved.
The same bytes appeared inside the zentui rail/frame and beside vim's mode
label; the wrapper did not change the palette.

## Load order

| Order                                    | Result                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `pi-mention`, `zentui`                   | **Pass.** Colours, pickers, editor rows intact.                                   |
| `pi-mention`, `vim`                      | **Pass after the fix below.** Colours, motions, selection, edits, pickers.        |
| `vim`, `pi-mention`                      | **Pass.** Colours, motions, selection, edits, pickers.                            |
| `pi-mention`, `vim`, `zentui`            | **Pass.** Colours and pickers; vim's mode label is the visible border.            |
| `vim`, `pi-mention`, `zentui`            | **Pass.** Same result.                                                            |
| `zentui`, `pi-mention` (vim either side) | **Fail-safe.** No colour, exactly one notice, text untouched. Pickers still work. |

Zentui first is the only unsupported order. There is no decoration API in
`pi-tui`; zentui's `PolishedEditor` calls `super.render()`, so an instance
render override is bypassed. The extension detects zentui's factory and refuses
to decorate rather than producing a half-painted frame. The one notice is:

```text
pi-mention: this editor doesn't expose its layout, so mention colours are off.
Load pi-mention before pi-zentui.
```

## Checklist

`P` = passed, `—` = not applicable, `F` = known fail.

| Combination                                | 5 classes     | Unresolved | INSERT cursor | NORMAL cursor | Visual / select | Delete / undo | Pickers | `@` / `/` | Wrap + wide | Resize |
| ------------------------------------------ | ------------- | ---------- | ------------- | ------------- | --------------- | ------------- | ------- | --------- | ----------- | ------ |
| stock TUI                                  | P             | P          | P             | —             | P (mouse)       | P             | P       | P         | P           | P      |
| zentui `minimalist` after                  | P             | P          | P             | —             | P (mouse)       | P             | P       | P         | P           | P      |
| zentui `opencode` after                    | P             | P          | P             | —             | P (mouse)       | P             | P       | P         | P           | P      |
| vim after pi-mention                       | P             | P          | P             | P             | P (Visual)      | P             | P       | P         | P           | P      |
| vim before pi-mention                      | P             | P          | P             | P             | P (Visual)      | P             | P       | P         | P           | P      |
| vim + zentui `minimalist`, either vim side | P             | P          | P             | P             | P (Visual)      | P             | P       | P         | P           | P      |
| vim + zentui `opencode`, either vim side   | P             | P          | P             | P             | P (Visual)      | P             | P       | P         | P           | P      |
| zentui first, with or without vim          | F (fail-safe) | no colour  | —             | —             | —               | —             | P       | P         | P           | P      |

Details behind the columns:

- **Colours.** A prompt with `$wayfinder %read &general
@docs/mention-grammar.md https://example.com` plus `$nope %nope &nope
@no/such/path` produced the palette-C codes above in every working order.
- **Cursor.** In INSERT, left/right over a token kept the token colour and the
  hardware cursor; no fake reverse-video cursor was left behind. A cursor on
  `😀` did not split the surrogate pair. In NORMAL, `0`, `l`, `w`, `$` and `h`
  moved through and onto coloured tokens without changing their text.
- **Selection.** Stock TUI and both zentui styles have no keyboard visual
  mode; selection is the TUI's mouse drag. Pressing on `$wayfinder`, dragging
  over it and releasing left reverse video on the purple foreground and
  produced `Copied!`. In vim, `v` followed by `l` over `$wayfinder` produced
  the same reverse-video overlay: `\e[7;38;2;171;157;242m$wayfinder\e[0m`.
- **Delete / undo.** In stock and both zentui styles, clicking the start of
  `%read` and pressing `Ctrl+K` removed the orange token; `Ctrl+-` restored
  `%read` with its orange colour. In vim, `y` left the text and colour intact,
  `d` removed the selected token, and `u` restored it with its colour. The
  same held with vim loaded before pi-mention.
- **Pickers.** `$`, `%`, `&`, `@` and `/` each opened; typing narrowed; Tab and
  Enter accepted; Esc cancelled. After accepting, the inserted token was
  coloured (`$wayfinder` purple, `%read` orange, `&general` green). In vim,
  pickers are INSERT-mode only: in NORMAL, `$` is end-of-line, `%` is
  matching-bracket and `&` is not a trigger. Esc closes an open picker before
  it enters NORMAL, so a NORMAL-mode test needs Esc, a pause, Esc.
- **File and slash completion.** `@docs/men` still reached pi core's file
  picker (`mention-grammar.md`); `/mo` still reached pi core's command list
  (`model`, `scoped-models`, `import`). pi-mention only decorated these rows.
- **Wrapping and wide characters.** A long URL split across screen rows with
  the pink span continued on both rows and no characters lost:
  `…abcdefghi` at the end of one row, `jabcdefghij…` at the start of the next.
  `😀` and Japanese text survived. Both zentui styles, run without vim, kept
  their rail/frame on every wrapped row.
- **Resize.** Resizing 120x42 to 60x30 kept the token text and colours; a long
  line re-wrapped inside the new border. Tested with stock, both zentui
  styles, vim, and vim + zentui.
- **Zentui chrome with vim.** When vim is loaded, the visible border is vim's
  mode border, not zentui's box. That happens with vim + zentui and no
  pi-mention loaded, so it is their interaction rather than a pi-mention
  regression. Colours, pickers, motions, wrapping and resizing still pass.
- **Fail-safe scope.** zentui-first was exercised with no vim, vim before
  zentui, and vim after pi-mention. Each gave one notice and no mention
  colours. All five pickers (`$`, `%`, `&`, `@`, `/`) opened, narrowed and
  cancelled with Esc, leaving the typed prefix. `&` has one role (`general`),
  so its list stayed at one entry while `$` narrowed 5→1, `%` 4→2, `@` 5→1
  and `/` 5→3. A long URL plus `😀 日本語END` wrapped in the frame and survived
  a 120x42→60x30 resize. Cursor motion and delete/undo were not separately
  exercised in this order; they are the plain zentui editor without
  decoration.
- **Send.** A real TUI submit under a local OpenAI-compatible mock provider
  produced the exact model-facing message, described next.

## Model-facing text

A submitted message:

```text
$wayfinder &general %read @docs/mention-grammar.md https://example.com
```

reached the model, through the real input and context seams, as:

```text
<skill name="wayfinder" location="…/skills/wayfinder/SKILL.md">
References are relative to …/skills.

…SKILL.md body…
</skill>

[subagent dispatch: role "general"]
Call the `subagent` tool now and delegate the rest of this message to the
`general` role. Call it with `tasks: [{ "agent": "general", "task": "<the rest
of this message>" }]`, using the text after this line as the `task` brief. …
Do not do the task yourself.

`read` @docs/mention-grammar.md https://example.com

<tool_mentions>
- `read` — call it directly. Signature: read(args: { limit?: number; offset?: number; path: string; }): Promise<unknown>;
</tool_mentions>
```

The exact body was checked byte-for-byte for the fixed parts: one native skill
block, one role dispatch prefix, `%read` replaced by the registered name, one
tool block, and the path and URL left literal. This was verified live under
stock, zentui `minimalist`, zentui `opencode`, and vim, by pointing pi at a
local mock `openai-completions` server and inspecting the request body. The
mock is a transport/test aid, not a live model provider.

The transcript is separate and keeps the typed form: it showed Pi's native
`[skill] wayfinder (ctrl+o to expand)` row followed by
`&general %read @docs/mention-grammar.md https://example.com`. The native skill
row is Pi's own rendering, not pi-mention's.

Ordering detail worth knowing when testing "all classes": tool expansion runs
before role expansion, and only the first prose token after the skill block can
be a role. In `$wayfinder %read &general …`, the role is no longer leading, so
it correctly stays literal. Put the role first
(`$wayfinder &general %read …`) to exercise every class at once.

## The fix

Loading vim **after** pi-mention used to lose every colour silently. vim writes
its mode label into the bottom border (`──── NORMAL ────`), and the extension's
frame proof compared the rendered border byte-for-byte with the unlabelled one.
It therefore refused to paint. The fix in `src/pi/editor.ts` recognises
`pi-vim-editor`'s `Symbol.for("pi-vim-editor")` and keeps the proof narrow:

- the top border is always compared byte-for-byte;
- the bottom border is byte-for-byte unless vim is present;
- with vim present, both plain rows must still be exactly `width` cells with
  matching corners, and the changed run in the expected row must be one
  contiguous run of `─` cells while the corresponding run in the rendered row
  is a non-empty label containing no `─`.

That accepts `──── NORMAL ────` wherever it sits inside the dash run, and
rejects a title inserted into other border content or a label split across two
runs. Stock and zentui frames still take the strict path on both borders. The
escape stripping now comes from `stripAnsi` in `src/core/paint.ts`, so the frame
proof and painting share one escape grammar instead of two disagreeing regexes.

A regression test in `test/frame.test.ts` and `test/editor.test.ts` covers the labelled and
unlabelled bottom border, a moved label, a shorter border, a different-width
frame, a label over non-dash content, two changed runs and the strict top
border. `test/paint.test.ts` covers `stripAnsi` for CSI, OSC/APC and
unterminated strings.

The paint layer also closes a colour span **before** an escape sequence rather
than reopening after it. That keeps Pi's zero-width hardware-cursor marker
immediately adjacent to the fake-cursor start marker, so the TUI drops the fake
cursor and positions the terminal cursor. Before this fix, the inserted colour
sequences broke that adjacency and INSERT showed a reverse-video block instead
of the configured bar. `test/paint.test.ts` now asserts the marker adjacency at
the end of a token and mid-token.

## Checks

- `npm test`: 205 passing (169 before the cursor-marker fix; 5 paint tests and 31 later tests).
- `npm run typecheck`: clean.
- `npm run format:check`: clean.

## Not verified

- The interactive mention smoke checklist in [manual-smoke.md](./manual-smoke.md).

- A live third-party model provider. Send-path verification used the local
  mock above; the seams and exact text were verified, not a provider's
  response.
- zentui settings hot-reload and `/reload` during a session. Each combination
  was started fresh.
- Terminals other than 120x42 and 60x30, and non-UTF-8 locales.
- Visual block (`Ctrl-V`) and vim's search while a picker is open. Only Visual
  character mode was needed for the matrix.
- Vim configured to put its mode label on the top border. The top border stays
  strict by design; the default bottom label is what the matrix exercised.
- Binary screenshots are deliberately not committed; the ANSI and text
  excerpts above are the evidence. Raw captures are in `/tmp`, not the repo.
