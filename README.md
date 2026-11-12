# pi-mention

Mention-aware prompt editor for pi. `$` names a skill, `%` names a tool, `&`
names an agent role, and `@` paths and URLs are coloured while you type.

> **Status:** scaffold. The extension loads and registers nothing yet. Behaviour
> lands ticket by ticket; see the [map issue](https://github.com/jennymaeleidig/pi-mention/issues/1).

## Compatibility

- Load `pi-mention` before `pi-zentui`; `pi-vim-editor` may load on either side.
  Zentui first is a fail-safe: no colour and one notice, never corruption.
- Another extension claiming `$`, `%` or `&` cannot be detected reliably. The
  outermost autocomplete provider wins. If that happens, change the trigger
  under `piMention.triggers` in `~/.pi/agent/settings.json` or
  `.pi/settings.json`.

## Settings

Configuration lives in pi's own settings files under one top-level `piMention`
key, not in a package-specific file. Code defaults fill every missing field.
The shape is in [docs/architecture.md](docs/architecture.md#configuration).
