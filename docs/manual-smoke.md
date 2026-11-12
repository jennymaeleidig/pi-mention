# Manual mention smoke checklist

Run in an interactive pi session with the extension loaded. The automated suite
covers the pure seams and the fake-editor install; this checklist covers the
host TUI, which the suite cannot drive.

- [ ] `$skill` renders its native `[skill]` row, with prose hoisted after it.
- [ ] A pathless or unresolved `$skill` stays literal without a notice.
- [ ] `%tool` expands inline and produces one `<tool_mentions>` block.
- [ ] A repeated `%tool` is replaced every time but listed once.
- [ ] A leading `&role` becomes the dispatch prefix; a later role stays literal.
- [ ] `\` escapes survive the transcript and disappear from the model message.
- [ ] Skills, tools, roles, paths and URLs use their configured colours.
- [ ] Unresolved and excluded mentions use their fallback colours.
- [ ] `$`, `%` and `&` open their pickers; Tab completes with the suffix.
- [ ] A path that appears while typing recolours after the probe lands.
- [ ] Invalid `piMention` settings produce one warning at `session_start`.
- [ ] The plain editor and a vim editor both keep their frame and colours.
