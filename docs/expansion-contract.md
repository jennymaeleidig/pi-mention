# Expansion contract

What the model receives for each expandable mention class, and what the transcript
shows. Settled in [#10](https://github.com/jennymaeleidig/pi-mention/issues/10).

Grammar is in [mention-grammar.md](./mention-grammar.md); vocabulary is in
[GLOSSARY.md](../GLOSSARY.md).

## Two seams

- **`$skill` expands at input.** It rewrites the message, because Pi renders the
  native skill row only when the whole message is the canonical skill block.
- **`%tool` and `&role` expand at context.** They rewrite the expanded message
  only; the transcript keeps what was typed.

Both seams skip fenced and inline code. Escaped triggers lose their backslash
only in the expanded message, and only in the user's prose — never inside a
skill block body.

Expansion is all-or-nothing per mention: an unresolved or excluded mention stays
literal everywhere, and no partial block is emitted.

## Order

1. Parse code ranges and mentions with the grammar.
2. If a resolvable `$skill` is present, build the skill block, remove that
   mention, and hoist the remaining prose after `\n\n`.
3. Expand `%tool` mentions in the remaining prose, then append one tool block.
4. If the prose begins with `&role`, replace it with the dispatch prefix and
   leave the task text after a blank line.
5. Unescape `\%`, `\$`, `\&` in the expanded prose.

A skill block is opaque: `%` and `&` inside it are never expanded. "Leading"
for a role mention means the first non-whitespace token of the **prose**, after
any skill block.

## Skill

The canonical block is byte-exact:

```text
<skill name="tdd" location="/abs/path/to/tdd/SKILL.md">
References are relative to /abs/path/to/tdd.

<SKILL.md body with frontmatter stripped and trimmed>
</skill>
```

If prose remains, append `\n\n` and the prose with the mention removed and
trimmed. If no prose remains, the block stands alone.

- The first `$skill` wins. Later `$skill` mentions stay literal.
- The mention's position in the prose is lost; the skill row always comes first.
- Normalize CRLF, strip frontmatter, trim.
- If the skill name or path contains `"`, or the body contains a line
  `</skill>`, do not build the block: leave the mention literal and notify once
  when there is a UI.
- The transcript shows Pi's collapsed `[skill] name (ctrl+o to expand)` row,
  followed by the hoisted prose.

## Tool

A resolved tool mention is replaced inline by its registered name in backticks.
One `<tool_mentions>` block is appended after the prose.

```text
<tool_mentions>
- `bash` — call it directly. Signature: bash(args: { command: string; timeout?: number; }): Promise<unknown>;
- `mcp__kagi__kagi_search_fetch` (kagi) — not declared to you. Reach it inside a codemode script: `await tools.mcp__kagi__kagi_search_fetch(...)`. Signature: mcp__kagi__kagi_search_fetch(args: { limit?: number; query: string; }): Promise<unknown>;
</tool_mentions>
```

- One entry per distinct target, in first-occurrence order. A repeated mention
  is replaced every time and listed once.
- Direct means the tool is active and declared, including active `codemode` or
  `deferred` tools: "call it directly."
- Indirect means an inactive `codemode` or `deferred` tool while `codemode` is
  active: "not declared to you. Reach it inside a codemode script:
  `await tools.<identifier>(...)`."
- A tool reachable only through `tool_search` is **omitted from the catalog**.
  That route activates the tool, and a mention never activates.
- Signatures come from `@earendil-works/pi-codemode@1.5.2/declarations`, rendered
  with `inputMaxChars: 240`, flattened to one line, `//` comment lines dropped,
  and capped at 280 characters with an ellipsis. Output is `Promise<unknown>`
  because pi exposes no output schema.
- The block is appended after the prose. If a skill block is present, the model
  sees `skill block\n\nprose\n\ntool block`.
- The transcript keeps the typed `%tool` tokens; only the expanded message has
  the registered names and the block.

## Agent role

Only a leading role mention expands: the first non-whitespace token of the
prose. A mid-sentence or second `&role` stays literal. The role body is never
inlined.

With a task, replace the mention in place with:

```text
[subagent dispatch: role "general"]
Call the `subagent` tool now and delegate the rest of this message to the `general` role. Call it with `tasks: [{ "agent": "general", "task": "<the rest of this message>" }]`, using the text after this line as the `task` brief. Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, but keep the user's intent and wording. Do not do the task yourself.

<task text>
```

With no task text, replace the mention with:

```text
[subagent dispatch: role "general"]
The user selected the `general` role but gave no task. Do not call the `subagent` tool. Ask the user what to delegate to `general`.
```

- The transcript keeps the typed `&role` token; only the expanded message has
  the dispatch prefix.
- A role that resolves to a profile-only name is unresolved and stays literal.

## Table

`M` is the expanded message; `T` is the transcript.

| Input | Target | M | T |
| --- | --- | --- | --- |
| `$tdd please review this` | skill `tdd` | skill block + `\n\nplease review this` | `[skill] tdd` row + `please review this` |
| `please $tdd this` | skill `tdd` | skill block + `\n\nplease this` | `[skill] tdd` row + `please this` |
| `$tdd` | skill `tdd` | skill block | `[skill] tdd` row |
| `$nope` | none | `$nope` | `$nope` |
| `$tdd $other` | skill `tdd` | skill block + `\n\n$other` | `[skill] tdd` row + `$other` |
| `%bash list files` | tool `bash`, direct | `` `bash` list files `` + tool block | `%bash list files` |
| `%kagi:kagi_search_fetch cats` | tool, indirect | `` `mcp__kagi__kagi_search_fetch` cats `` + tool block | `%kagi:kagi_search_fetch cats` |
| `%bash %bash` | tool `bash` | `` `bash` `bash` `` + one tool block entry | `%bash %bash` |
| `%bash, please` | tool `bash` | `` `bash`, please `` + tool block | `%bash, please` |
| `&general summarise this` | role `general` | dispatch prefix + `\n\nsummarise this` | `&general summarise this` |
| `please &general summarise this` | role `general` | unchanged | `please &general summarise this` |
| `&general` | role `general` | no-task dispatch text | `&general` |
| `&general x &general y` | role `general` | dispatch prefix + `\n\nx &general y` | unchanged |
| `\$PATH` | none | `$PATH` | `\$PATH` |
| fenced `%bash` | none | unchanged | unchanged |
| `$tdd %read this` | skill + tool | skill block + `\n\n` + `` `read` this `` + tool block | `[skill] tdd` row + `%read this` |
| `$tdd &general do it` | skill + role | skill block + `\n\n` + dispatch prefix + `\n\ndo it` | `[skill] tdd` row + `&general do it` |

## Seam

The pure seam is:

```ts
expand(message: Message, catalogs: Catalogs, config: Config): ExpandedMessage
```

It takes the message text, the live catalogs and configuration, and returns the
expanded text plus the skill block to use at input, if any. It performs no I/O,
registers nothing, activates nothing, and never edits the prompt's tool section.
