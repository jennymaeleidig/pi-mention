# pi-mention

The shared language for a pi extension that lets a user name a skill, path, tool, agent role or URL in a prompt, and colours those names while typing.

## Language

**Mention**:
A whole typed token that names one target, from its trigger through its label.
_Avoid_: Tag, reference, link, sigil

**Token class**:
The kind of target a mention names: skill, path, tool, agent role, or URL.
_Avoid_: Mention type, category, kind

**Mention span**:
The exact range of draft text a mention occupies.
_Avoid_: Token range, highlight

**Trigger**:
The character or characters that start a mention.
_Avoid_: Prefix, sigil, marker, delimiter

**Label**:
The short name a user types for a target.
_Avoid_: Name, id, alias, key

**Target**:
The thing a label resolves to: a skill, path, tool, agent role, or URL.
_Avoid_: Entity, item, entry, candidate

**Expandable**:
A property of a token class whose mentions can change the expanded message. Skills, tools and agent roles are expandable; paths and URLs are not.
_Avoid_: Active, live, actionable

**Resolve**:
To turn a label into a target.
_Avoid_: Look up, match, load

**Expand**:
To rewrite the message for the model, using the targets its mentions resolve to.
_Avoid_: Substitute, transform, rewrite

**Replace**:
To put a tool's registered name in place of its mention. A special case of expansion; skills and agent roles do not replace.
_Avoid_: Substitute, swap

**Catalog**:
The live set of targets available to one token class at a given moment.
_Avoid_: Registry, index, list, cache

**Unresolved**:
A mention whose label names no target in the live catalog.
_Avoid_: Invalid, missing, broken, failed

**Excluded**:
A target that exists but is removed from its catalog by configuration.
_Avoid_: Blacklisted, blocked, filtered

**Boundary**:
The rule that a trigger starts a mention only at a permitted position in the text.
_Avoid_: Prefix rule, delimiter rule

**Escape**:
A backslash that suppresses a trigger. The draft and persisted transcript keep it; the model-facing expanded message drops it.
_Avoid_: Quote, literal marker

**Picker**:
The list of candidate targets opened by a trigger.
_Avoid_: Menu, dropdown, selector, completion list

**Completion**:
Accepting the highlighted picker item into the draft, by Tab or Enter.
_Avoid_: Selection, insertion, autocomplete

## Text stages

**Draft**:
The text currently in the prompt editor.
_Avoid_: Input, buffer, prompt

**Message**:
The text the user sends.
_Avoid_: Prompt, request, input

**Expanded message**:
The text the model receives after expansion.
_Avoid_: Final prompt, transformed message

## Token classes

**Skill**:
A pi skill, named by a skill label.
_Avoid_: Command, prompt template

**Skill block**:
The anchored text block that pi renders as its native skill row.
_Avoid_: Skill entry, skill card, skill header

**Path**:
A filesystem path, named by a path label. A path containing spaces uses the quoted form.
_Avoid_: File, file mention, attachment

**Quoted path**:
A path label written as `@"..."` so it may contain spaces. Coloured, never expanded.
_Avoid_: Quoted file, attachment string

**Tool**:
A tool the model can call, named by a tool label.
_Avoid_: Function, capability, action

**Registered name**:
The identifier the model must use to call a tool.
_Avoid_: Tool name, full name, canonical name

**Tool block**:
The appended `<tool_mentions>` section that carries each tool's reach and signature.
_Avoid_: Mention block, prompt nudge, hint block

**Agent role**:
A named agent definition that the `subagent` tool can dispatch.
_Avoid_: Agent, subagent, profile

**Dispatch prefix**:
The text that replaces a leading role mention and tells the model to call `subagent`.
_Avoid_: Nudge, wrapper, prompt prefix

**Subagent**:
The child agent a role is dispatched into.
_Avoid_: Agent, worker, child process

**Profile**:
A model and thinking preset for a subagent. Never a mention target.
_Avoid_: Role, agent

**URL**:
A web address, recognised without a trigger and never expanded.
_Avoid_: Link, hyperlink

## Tool routing

**Exposure**:
pi's registered property of a tool that decides whether and how it is reachable.
_Avoid_: Mode, type, kind, level

**Reach**:
The routing class derived from a tool's exposure and the session's active tools: direct or indirect.
_Avoid_: Route, strategy, mechanism

**Reacher**:
An active tool whose presence makes indirect tools reachable.
_Avoid_: Gateway, bridge, proxy
