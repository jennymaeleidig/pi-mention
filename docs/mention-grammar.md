# Mention grammar

The syntax every mention shares, and the per-class differences. Settled in
[#9](https://github.com/jennymaeleidig/pi-mention/issues/9).

Vocabulary is in [GLOSSARY.md](../GLOSSARY.md). This document is the grammar,
not the expansion contract: what the model receives is settled separately.

## Shape

A mention is `<trigger><label>` with no closing delimiter. A bare trigger is
never a mention: it may open the picker, but it stays literal on send.

| Token class | Trigger | Label                                                                 | Expandable |
| ----------- | ------- | --------------------------------------------------------------------- | ---------- |
| Skill       | `$`     | `[A-Za-z0-9][A-Za-z0-9._-]*`                                          | yes        |
| Path        | `@`     | a non-whitespace run, or `@"..."` for a path containing spaces        | no         |
| Tool        | `%`     | one or two segments of `[A-Za-z0-9][A-Za-z0-9._-]*`, separated by `:` | yes        |
| Agent role  | `&`     | `[A-Za-z0-9][A-Za-z0-9._-]*`                                          | yes        |
| URL         | none    | whatever the URL detector matches                                     | no         |

- Labels are matched **case-sensitively**. The picker's fuzzy matching is
  case-insensitive.
- `%server:tool` is two segments. A trailing colon (`%kagi:`) is an incomplete
  chain, never a server mention and never a peeled `%kagi` plus `:`.
- Arguments are never part of a token. `$tdd this file` names the skill and
  leaves `this file` as prose; `&general summarise this` names the role and
  leaves the task as prose.
- `@` always starts a path, never a URL. `@https://example.com` is a path
  mention whose label happens to look like a URL.

## Boundary

A trigger starts a mention only at:

- start of text,
- after whitespace or CJK punctuation,
- after an opening bracket `(`, `[`, `{`, `<`, a quote, or a backtick.

A trigger after a word character does not start a mention. The boundary is the
same one pi's editor uses for natural autocomplete triggering, so the colourer,
the picker and the expansion agree.

| Input            | Result                                     |
| ---------------- | ------------------------------------------ |
| `100%foo`        | literal; `%` follows a digit               |
| `me@example.com` | literal; `@` follows a word character      |
| `$PATH`          | skill mention, almost certainly unresolved |
| `\$PATH`         | literal `$PATH`                            |
| `&&`             | literal; `&` is not a valid label start    |
| `&general`       | agent-role mention                         |
| `(%read)`        | tool mention inside brackets               |
| `"$tdd"`         | skill mention after a quote                |
| `x$tdd`          | literal                                    |
| `100 %foo`       | tool mention; the space is a boundary      |

## Terminator and trailing punctuation

The label is the **longest resolving prefix of the token**. Only prefixes that
end at the token end or immediately before a punctuation character are eligible,
so a label is never silently truncated in the middle of a word.

| Input           | Resolves as                                                         | Leftover   |
| --------------- | ------------------------------------------------------------------- | ---------- |
| `%bash, please` | `%bash`                                                             | `, please` |
| `$tdd?`         | `$tdd`                                                              | `?`        |
| `@src/foo.ts.`  | `@src/foo.ts` when that file exists                                 | `.`        |
| `@src/foo.ts`   | the whole path                                                      | —          |
| `%bashfoo`      | unresolved; `bash` is not eligible because `f` is a label character | —          |
| `%bash:`        | incomplete chain, unresolved                                        | —          |
| `%unknown,`     | unresolved as a whole token                                         | —          |

If no eligible prefix resolves, the whole token is one unresolved span. A path
that genuinely ends in punctuation wins when the file exists, because the whole
token is the longest resolving prefix.

## Whitespace and quoted paths

Expandable labels never contain spaces. A path containing spaces uses the
quoted form pi core already recognises for attachments:

```
@"my notes/today.md"
```

The quoted form is coloured but never expanded. `$"my skill"` is not a quoted
form: the editor closes the token at the space, and the mention stays literal.

## Escape

A backslash before a trigger suppresses the mention:

```
\%bash is not a mention
\$PATH is literal
```

The draft and the message keep the backslash, so the transcript shows what was
typed. The **expanded message drops it**, so the model receives a literal
`%bash`, `$PATH` or `&general` rather than a directive. This asymmetry is
deliberate and is stated in the README.

## Code

Mentions inside fenced code blocks or inline code are neither coloured nor
expanded. The same ranges are masked before URL detection. A pasted shell
command or script keeps its `%`, `$` and `&` literally.

## Multiple mentions

Mentions are read left to right and do not overlap; the longest match at a
position wins. Duplicate targets are expanded at every occurrence and deduped
where the expansion contract says so.

Only one native skill block can be parsed per message. The **first** `$skill`
wins; later `$skill` mentions stay literal and are coloured as unresolved.

## URLs

Explicit `http:`, `https:`, `ftp:` and `mailto:` links always colour. Fuzzy
links (bare hosts) colour only when the host does not end in a source-file
extension. The guard list is configuration, seeded with:

```
.ts .tsx .js .jsx .md .py .sh .json .yaml .yml .toml .rs .go .css .html
```

So `README.md`, `script.py` and `foo.sh` stay prose, while `github.com` colours.
The guard list can grow without a code change.
