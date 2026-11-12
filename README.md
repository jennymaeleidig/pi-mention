# pi-mention

Mention-aware prompt editor for pi. `$` names a skill, `%` names a tool, `&`
names an agent role, and `@` paths and URLs are coloured while you type.

> **Status:** the editor colour layer, the `$`, `%`, `&` picker, and `$` skill,
> `%` tool and `&` role expansion are live. A sent `$skill` becomes Pi's native
> `[skill] name (ctrl+o to expand)` entry; a sent `%tool` reaches the model as
> its registered name plus a `<tool_mentions>` block. A leading `&role`
> becomes a `subagent` dispatch prefix naming `agent: "<role>"`. See the
> [map issue](https://github.com/jennymaeleidig/pi-mention/issues/1).

## Colours

Palette C is the default: purple skills, cyan paths, orange tools, green roles,
pink URLs and yellow unresolved mentions. Colours are theme foreground roles,
so they follow the active theme. Configure them under `piMention.colors`.

## Compatibility

- Load `pi-mention` before `pi-zentui`; `pi-vim-editor` may load on either side.
  Zentui first is a fail-safe: no colour and one notice, never corruption.
- Another extension claiming `$`, `%` or `&` cannot be detected reliably. The
  outermost autocomplete provider wins. If that happens, change the trigger
  under `piMention.triggers` in `~/.pi/agent/settings.json` or
  `.pi/settings.json`.
- The tested combinations, load orders and fail-safe behaviour are in
  [docs/compatibility.md](docs/compatibility.md).

## Settings

Configuration lives in pi's own settings files under one top-level `piMention`
key, not in a package-specific file. Code defaults fill every missing field.
The shape is in [docs/architecture.md](docs/architecture.md#configuration).
