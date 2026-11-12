# How Pi presents a natively expanded skill

- Status: research, closed ticket
- Date: 2026-11-11
- Pi version examined: 1.5.2 (`@earendil-works/pi-coding-agent@1.5.2`)
- Issue: [#2](https://github.com/jennymaeleidig/pi-mention/issues/2)
- Branch: `research/native-skill-presentation`

## Summary

Pi has **no skill message type and no API that takes a skill**. The native
`[skill] name (ctrl+o to expand)` row is produced by a *text convention*: a user
message whose entire text is a `<skill name="…" location="…">…</skill>` block,
optionally followed by `\n\n` and the user's request. Interactive mode parses
that text at render time with the exported `parseSkillBlock()`; everything else
(HTML export, session tree, resume) does the same. The model simply receives
that text as a user message.

`/skill:name args` is expanded into exactly that text inside
`AgentSession._expandSkillCommand()` (private), *after* the `input` event and
*before* the agent run. So the supported way for an extension to reproduce the
native row is:

> Register an `input` handler and return `{ action: "transform", text }` whose
> text is Pi's canonical skill block (block first, then the user's prose after a
> blank line). Pi then parses and renders it natively, persists it, and replays
> it on resume and export.

For an inline mention the prose **must be moved after the block**. `parseSkillBlock`'s
regex is anchored to the start and end of the whole message, so
`please <skill …>…</skill> this` does not parse; only
`<skill …>…</skill>\n\nplease this` does. That is the whole difference between
today's inline dump and the native row.

## 1. The entry is recognised by parsing user text, not by a message role

`dist/core/agent-session.js`:

```js
export function parseSkillBlock(text) {
    const match = text.match(
      /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/
    );
    if (!match) return null;
    return {
        name: match[1],
        location: match[2],
        content: match[3],
        userMessage: match[4]?.trim() || undefined,
    };
}
```

`ParsedSkillBlock`, `parseSkillBlock` and `SkillInvocationMessageComponent` are
all exported from the package root (`dist/index.d.ts`), but the *wire format* is
not documented anywhere in `docs/` — `docs/message-types.md` has no skill
variant, and `docs/session-format.md` mentions `skills` only as a system-prompt
section. Treat the format as an internal contract of 1.5.x, guarded by a test.

Who calls it:

| Surface | Code | Effect |
|---|---|---|
| Live TUI message | `interactive-mode.js` → `addMessageToChat` (user branch) | collapsed/expanded skill component |
| Resume / session replay | same `addMessageToChat` via `renderSessionItems` | identical |
| HTML export (`/export`) | `dist/core/export-html/template.js` (own copy of the regex) | click-to-expand skill card |
| Session tree view | same template, `getTreeNodeDisplayHtml` | `skill: name · user: …` label |
| print / `--mode json` / RPC | — | no parsing; raw text only |

Rendering (`dist/modes/interactive/components/skill-invocation-message.js`):

- collapsed: `[skill] ` + name + ` (ctrl+o to expand)` — `keyText("app.tools.expand")`
- expanded: bold `[skill]`, then `**name**`, then the block content (which
  includes Pi's `References are relative to …` line) through the markdown
  pipeline
- click toggles it; `ctrl+o` toggles it too because `setToolsExpanded()` calls
  `setExpanded()` on every chat child that has that method.

There is no extension seam that styles *part* of a user message. Custom
messages (`pi.sendMessage` + `registerMessageRenderer`) are separate messages:
they cannot interleave with the user's text, they do not render Pi's native row,
and they break HTML-export/tree parity. `SkillInvocationMessageComponent` can
only be used inside `ctx.ui.custom()`, i.e. a dialog, not the transcript.

## 2. What `/skill:name args` actually produces

`dist/core/agent-session.js`, `_expandSkillCommand()` (private):

```js
const content = readFileSync(skill.filePath, "utf-8");
const body = stripFrontmatter(content).trim();
const skillBlock =
  `<skill name="${skill.name}" location="${skill.filePath}">\n` +
  `References are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
return args ? `${skillBlock}\n\n${args}` : skillBlock;
```

So the canonical text is byte-exact:

```text
<skill name="tdd" location="/abs/path/to/tdd/SKILL.md">
References are relative to /abs/path/to/tdd.

<SKILL.md body with frontmatter stripped and trimmed>
</skill>
```

…optionally followed by `\n\n<args>`, where `args` is everything after the first
space of `/skill:name …`, `.trim()`ed. The model sees this as an ordinary user
text block (`convertToLlm` passes `role: "user"` through untouched).

**Arguments.** There is no argument field. "Arguments" are simply the text after
the block. So a mention must hoist the rest of the message into that trailing
position; the model's view then matches `/skill:name <rest>` exactly.

**Content access.** No public API returns a skill body: `pi.getCommands()` gives
`source === "skill"` entries with `sourceInfo.path` (the `SKILL.md`) and optional
`sourceInfo.baseDir`; `before_agent_start` exposes `systemPromptOptions.skills`
(`Skill[]` with `filePath`/`baseDir`) but still no body. The body has to be read
from disk. Pi exports `stripFrontmatter()` from the package root, so parity is
cheap.

## 3. Answers to the issue's questions

**Which event/API creates the skill entry?** The `input` event's `transform`
action. Return the canonical block text and Pi does the rest. Not
`sendUserMessage` (no skill metadata, and it starts a *new* message), not a
custom message + renderer (wrong surface), not `context` (model-only, invisible).

**How does the body reach the model without showing inline?** It *is* the user
message; it is not hidden. It is collapsed only in presentation. The block and
the prose are the same text block, separated by `\n\n`. The model receives the
body verbatim, exactly as with `/skill:name`.

**How are arguments after the name appended?** As the trailing `\n\n`-separated
section. Practically: `text.replace(mention, "").trim()` becomes the trailing
part; if empty, the block stands alone.

**How is it persisted and rendered?** Persisted verbatim as the user message
content (`session-format.md`: `message` entry with
`content: [{ "type": "text", "text": "<skill …>" }]`). Resume replays the parse.
HTML export re-parses with its own copy of the regex. `ctrl+o` expands it because
the component is a chat child with `setExpanded`. Editing the `SKILL.md` later
does **not** change past entries (same as `/skill:`).

**What about an inline mention?** `parseSkillBlock` is anchored (`^…$`), so the
block must be the whole message up to the optional `\n\n` tail. An inline
mention has to be rewritten into block-first + prose-after. The visible side
effect: the skill row comes first and the prose follows it, instead of the prose
appearing around the mention. There is no way to keep the prose on both sides of
the row.

**Print / JSON / RPC / no UI.** The `input` event runs in every mode because all
of them funnel through `AgentSession.prompt()` (`print-mode.js` line ~112,
`rpc-mode.js` `case "prompt"`). Consequences:

- **print (`-p`)**: transform applies; only the last assistant text is printed,
  so nothing leaks to stdout. Never `console.log` in the handler. `hasUI` is
  false.
- **`--mode json`**: `message_start`/`message_end` carry
  `message.content[0].text` containing the raw `<skill …>` block. There is no
  structured skill object in the JSON schema; JSON consumers see XML.
- **RPC**: `prompt` takes a plain `message` string; there is no skill field and
  no skill response type. `get_commands` lists `skill:<name>` so a client can
  build `/skill:` text itself. Server-side transforms still run, so an RPC
  client sending `$tdd` gets the native block for the model and no rendering.
- **no UI**: guard every `ctx.ui.*` call. Unresolved or unreadable mentions
  should pass through as literal text, not throw.

## 4. Contrast: @zigai/pi-mention-skill 0.11.0

Verified against `~/.pi/agent/npm/node_modules/@zigai/pi-mention-skill` and
`@zigai/pi-mention-anything`:

- `register-mention.ts` registers `pi.on("input")` only to snapshot editor text
  (`hub.input(text)` → `pendingSnapshots`); it returns `{ action: "continue" }`.
- `pi.on("context")` expands mentions *for the provider request only*
  (`expandMentionsInMessages` → `resolveSkillCandidate` → `formatSkillBlock`,
  which emits the same canonical block, with HTML-escaped attributes).
- The editor completion inserts the literal `$name` (`applyCompletion` →
  `formatChain`); it never inserts the block.

Therefore with 0.11.0 the persisted user message still reads `please $tdd this`
and Pi renders plain prose — there is **no skill row at all**, and the model
receives the block spliced in mid-sentence. That spliced form is the "inline
`<skill>` dump" the issue describes: it is what any consumer of model context
(JSON event logs, provider payloads, debugging tools) shows, and it is what a
version that expanded at submit time (or in the editor) would show in the
transcript. Either way the fix is the same: expand in `input`, block-first.

## 5. Recommended integration for pi-mention

1. On `input`, skip if the text is already a `/skill:` command; Pi owns that path.
2. Resolve `$name` against live `pi.getCommands()` entries with
   `source === "skill"` (do **not** cache across sessions; `getCommands()` is
   live and reflects `/reload` and `--no-skills`).
3. Read `sourceInfo.path`, `stripFrontmatter`, normalise CRLF, `trim()`.
4. Build the canonical block; take the remainder of the message (mentions
   removed, trimmed) as the trailing request.
5. Return `{ action: "transform", text }`, omitting `images` so attachments pass
   through.
6. If the block cannot be built (unreadable file, unrepresentable name/path),
   return `continue` and, when `ctx.hasUI`, notify once.

Sketch (grammar details belong to the mention-grammar ticket, #9):

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  stripFrontmatter,
  type ExtensionAPI,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";

const SKILL_PREFIX = "skill:";

function skillIndex(pi: ExtensionAPI): Map<string, SlashCommandInfo> {
  return new Map(
    pi.getCommands()
      .filter((c) => c.source === "skill" && c.name.startsWith(SKILL_PREFIX))
      .map((c) => [c.name.slice(SKILL_PREFIX.length), c]),
  );
}

async function canonicalSkillBlock(
  command: SlashCommandInfo,
): Promise<string | undefined> {
  const name = command.name.slice(SKILL_PREFIX.length);
  const location = command.sourceInfo.path;
  const baseDir = command.sourceInfo.baseDir ?? path.dirname(location);

  // The attribute regex is `[^"]+`: a quote or newline is not representable.
  if (/["\n]/.test(name) || /["\n]/.test(location)) return undefined;

  try {
    const raw = await readFile(location, "utf8");
    const body = stripFrontmatter(raw).replace(/\r\n?/g, "\n").trim();
    // Pi's regex stops at the first "\n</skill>"; such a body cannot round-trip.
    if (body.includes("\n</skill>")) return undefined;

    return (
      `<skill name="${name}" location="${location}">\n` +
      `References are relative to ${baseDir}.\n\n${body}\n</skill>`
    );
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (!event.text.includes("$")) return { action: "continue" };
    if (event.text.trimStart().startsWith("/skill:")) return { action: "continue" };

    const skills = skillIndex(pi);
    // findSkillMentions/removeMentions are the grammar work from #9:
    // they return { start, end, name } spans and delete them from the text.
    const mentions = findSkillMentions(event.text, skills); // #9
    if (mentions.length === 0) return { action: "continue" };

    const block = await canonicalSkillBlock(skills.get(mentions[0].name)!);
    if (block === undefined) {
      if (ctx.hasUI) ctx.ui.notify(`Could not expand $${mentions[0].name}`, "warning");
      return { action: "continue" };
    }

    const remainder = removeMentions(event.text, mentions).trim();
    const text = remainder ? `${block}\n\n${remainder}` : block;
    return { action: "transform", text };
  });
}
```

Notes that matter for the implementation ticket (#16):

- **Do not escape attributes.** Pi's own expansion does not, and
  `parseSkillBlock` does not unescape; escaping turns `&` into a literal
  `&amp;` in `location`. Fall back to `continue` instead.
- **Trim the final text.** A single trailing `\n` defeats the `$` anchor
  (verified below). `trimEnd()` the whole result.
- **Normalise line endings in the body.** CRLF anywhere in the block defeats the
  regex.
- **One native row per message.** The regex allows one block. Today the cleanest
  v1 rule is: the first skill mention becomes the block; further `$skill`
  mentions are appended to the trailing section in canonical form (model-correct,
  visually literal) or left literal with a warning. Pick one in #16; do not
  silently drop them.
- **Prose order changes.** `please $tdd this` renders as `[skill] tdd` then
  `please this`. Document it; there is no alternative that keeps the row.
- **Do not delegate to `/skill:` by rewriting to a slash command** as the
  primary design: `sendUserMessage` defaults `expandPromptTemplates: false`, so
  the rewrite would reach the model as literal `/skill:name …`. Constructing the
  block works in every mode. (A `/skill:`-rewrite *is* useful as a parity
  trick for interactive prompts, but it is a second code path with a mode-shaped
  hole.)
- **Do not use `context`** to hide the body: the model then gets it, but the
  transcript never gets a row (this is exactly the zigai 0.11.0 behaviour).
- **Queue previews show the block.** Steering/follow-up previews are one
  truncated dim line built from the expanded text
  (`updatePendingMessagesDisplay`), and "edit queued messages" restores the
  block into the editor. This is identical to what Pi does for a queued
  `/skill:`, so it is parity, not a regression — but users will see it.

## 6. Verified failure modes of the format

Run against `dist/index.js` `parseSkillBlock` from the installed 1.5.2:

| Input | Result |
|---|---|
| canonical block | parses |
| block + `\n\n` + `please this` | parses, `userMessage: "please this"` |
| block + one trailing `\n` | **null** (no native row) |
| `please ` + block | **null** (inline dump) |
| CRLF block | **null** |
| `<skill …" >` (space before `>`) | **null** |
| body containing `\n</skill>` | parses, but content is **truncated** at the first such line |

Other edge cases:

- A second `<skill>` block after `\n\n` becomes part of `userMessage` and is
  rendered by the user-message markdown path in the user bubble — not as a
  second skill row.
- Empty `location=""` fails `[^"]+`.
- `parseSkillBlock`'s `location` is unused by the renderers; the tree and export
  use `name` only.
- Mentions expanded in a message that is later compacted are summarised as plain
  text; there is no special compaction handling.
- The format is not in `docs/`, so a Pi minor release can change it. Add a
  contract test that imports `parseSkillBlock` from the installed pi and asserts
  our builder round-trips (name, content, userMessage). That test is the
  upgrade alarm.

## 7. APIs that do not exist

- `sendUserMessage(text, { skill })`, a skill content block, or any message
  role/type for skills. `AgentMessage` has no skill variant.
- `pi.expandSkill(name, args)`, `ctx.skills`, `getSkill(name)`, or any accessor
  that returns a skill body.
- A renderer hook for a *segment* of the user message, or an API to inject
  `SkillInvocationMessageComponent` into the chat transcript.
- Skill objects/fields in RPC (`prompt`) or JSON events.
- Documented semantics for the `<skill …>` wire format. `parseSkillBlock` is
  exported but undocumented.

## 8. Evidence

Read in full or in the cited spans:

- `docs/extensions.md` (input events, `sendUserMessage`, `getCommands`, custom
  messages, `hasUI`/`mode`)
- `docs/skills.md`, `docs/message-types.md`, `docs/session-format.md`,
  `docs/json.md`, `docs/rpc.md`, `docs/rpc-commands.md`
- `dist/core/agent-session.js` (`parseSkillBlock`, `_expandSkillCommand`,
  `_preparePrompt`, `_runInputHandlers`, `_queueUserInput`, `sendUserMessage`)
- `dist/core/extensions/runner.js`, `dist/core/extensions/types.d.ts`
  (`InputEvent`, `InputEventResult`)
- `dist/core/messages.js` (`convertToLlm`)
- `dist/core/skills.js` (`baseDir`, frontmatter stripping)
- `dist/modes/interactive/interactive-mode.js` (`addMessageToChat`,
  `renderSessionItems`, `setToolsExpanded`, `updatePendingMessagesDisplay`)
- `dist/modes/interactive/components/skill-invocation-message.js`
- `dist/core/export-html/template.js` (`parseSkillBlock`, skill card, tree label)
- `dist/modes/print-mode.js`, `dist/modes/rpc/rpc-mode.js`
- zigai: `pi-mention-skill/src/{index,skill-content,skill-provider}.ts`,
  `pi-mention-anything/src/{register-mention,mention-hub,mention-resolution,
  expand-mentions,chain-autocomplete,editor}.ts`
