# Two expansion seams: input for skills, context for tools and roles

## Context

Pi renders its native `[skill] name (ctrl+o to expand)` row only when the whole
user message is the canonical `<skill>` block, optionally followed by `\n\n` and
the request. That block must be produced before Pi persists the message, so a
skill mention has to rewrite the message at the `input` event.

Tool and role mentions have no native presentation. Rewriting them at `input`
would replace the typed tokens in the transcript with registered names, a
`<tool_mentions>` block and a dispatch prefix. That loses what the user typed and
buys no rendering.

## Decision

Use two seams:

- `$skill` expands in an `input` handler, block first, prose hoisted after
  `\n\n`.
- `%tool` and `&role` expand in a `context` handler, model-facing only; the
  transcript keeps the typed tokens.

Both seams share the same parser, resolver and expansion contract. A skill block
is opaque to the context seam.

## Consequences

- The transcript is truthful: skills show Pi's native row; tools and roles show
  what was typed.
- `$skill` cannot stay inline. The prose moves after the block, and only one
  skill per message can be represented.
- The context seam must skip the skill block when expanding tools and roles.
- Two wiring points instead of one, but one pure `expand` contract behind both.

The alternative — expand everything at `input` — was rejected because it would
rewrite the transcript for no rendering benefit and would still not make
mid-sentence role dispatch unambiguous.
