import { findCodeRanges, inRanges, parse, triggerSpecs } from "./grammar.ts";
import { resolve } from "./resolve.ts";
import { proseStart, skillBlockBounds } from "./skill-expand.ts";
import { targetKey } from "./target.ts";
import type { Catalogs, ResolvedMention, Settings, Target } from "./types.ts";

/** One content part the context seam can carry. Extra fields pass through. */
export interface ContextPart {
  type: string;
  text?: string;
}

/** One message the context seam can rewrite. Extra fields pass through. */
export interface ContextMessage {
  role: string;
  content?: string | readonly ContextPart[];
}

interface TextPart extends ContextPart {
  type: "text";
  text: string;
}

function isTextPart(part: ContextPart): part is TextPart {
  return part.type === "text" && typeof part.text === "string";
}

interface ExpandedText {
  text: string;
  entries: Target[];
}

/** True when the text has prose after any leading native skill block. */
function hasProseAfterSkillBlock(text: string): boolean {
  const start = proseStart(text);
  return start !== undefined && text.slice(start).trim() !== "";
}

function triggersFor(settings: Settings): Set<string> {
  return new Set([settings.triggers.skill, settings.triggers.tool, settings.triggers.role]);
}

/**
 * Drop escaped-trigger backslashes in model-facing prose, leaving code inert.
 * A skill block body never passes through here.
 */
function unescapeProse(text: string, triggers: ReadonlySet<string>): string {
  const codeRanges = findCodeRanges(text);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const next = text[i + 1];
    if (
      text[i] === "\\" &&
      next !== undefined &&
      triggers.has(next) &&
      !inRanges(i, codeRanges) &&
      !inRanges(i + 1, codeRanges)
    ) {
      out += next;
      i += 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Drop escaped-trigger backslashes in a model-facing message, skill block untouched. */
function unescapeExpandedText(text: string, settings: Settings): string {
  const triggers = triggersFor(settings);
  const block = skillBlockBounds(text);
  if (!block) return unescapeProse(text, triggers);
  if (block.end === undefined) return text;
  return text.slice(0, block.end) + unescapeProse(text.slice(block.end), triggers);
}

/** The first non-whitespace prose token, skipping a leading native skill block. */
function leadingRoleMention(
  message: string,
  resolved: readonly ResolvedMention[],
): ResolvedMention | undefined {
  const prose = proseStart(message);
  if (prose === undefined) return undefined;

  let start = prose;
  while (isWhitespace(message[start])) start++;

  return resolved.find(
    (candidate) => candidate.mention.class === "role" && candidate.mention.span.start === start,
  );
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

/**
 * Prefer the live catalog entry, so expansion names the role the spawner knows.
 * An out-of-catalog role stays literal by design: the role must still be live to
 * dispatch.
 */
function liveRoleTarget(target: Target, catalogs: Catalogs): Target | undefined {
  return catalogs.roles.find(
    (candidate) => candidate.label === target.label && targetKey(candidate) === targetKey(target),
  );
}

/** Leading whitespace and punctuation that do not count as a task. */
const TASK_PUNCTUATION = /^[\s,.;:!?)\]}]+/u;

/** The task after a role mention, or undefined when it carries only punctuation. */
function roleTask(text: string): string | undefined {
  const task = text.trim().replace(TASK_PUNCTUATION, "");
  return task === "" ? undefined : task;
}

/** The leading-only dispatch prefix from the expansion contract. */
function roleDispatchPrefix(name: string): string {
  return (
    `[subagent dispatch: role ${JSON.stringify(name)}]\n` +
    `Call the \`subagent\` tool now and delegate the rest of this message to the \`${name}\` role. ` +
    `Call it with \`tasks: [{ "agent": ${JSON.stringify(name)}, "task": "<the rest of this message>" }]\`, ` +
    "using the text after this line as the `task` brief. " +
    "Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, " +
    "but keep the user's intent and wording. " +
    "Do not do the task yourself."
  );
}

/** The no-task text from the expansion contract: ask, never dispatch. */
function roleNoTaskText(name: string): string {
  return (
    `[subagent dispatch: role ${JSON.stringify(name)}]\n` +
    `The user selected the \`${name}\` role but gave no task. ` +
    `Do not call the \`subagent\` tool. Ask the user what to delegate to \`${name}\`.`
  );
}

/**
 * Expand a leading `&role` mention for the model-facing message.
 *
 * Only the first non-whitespace prose token, after any native skill block, is
 * eligible. Unresolved, excluded, mid-sentence, later and code mentions stay
 * literal. The role body is never inlined, and this function performs no I/O.
 */
function expandRoles(
  message: string,
  resolved: readonly ResolvedMention[],
  catalogs: Catalogs,
): ExpandedText {
  const mention = leadingRoleMention(message, resolved);
  if (!mention?.target || mention.status !== "resolved") return { text: message, entries: [] };

  const target = liveRoleTarget(mention.target, catalogs);
  if (!target) return { text: message, entries: [] };

  const name = targetKey(target);
  const before = message.slice(0, mention.mention.span.start);
  const task = roleTask(message.slice(mention.mention.span.end));
  return {
    text: task
      ? `${before}${roleDispatchPrefix(name)}\n\n${task}`
      : `${before}${roleNoTaskText(name)}`,
    entries: [],
  };
}

/** Collapse targets to their first occurrence, keyed by `targetKey`. */
function dedupeToolTargets(targets: readonly Target[]): Target[] {
  const seen = new Set<string>();
  const entries: Target[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(target);
  }
  return entries;
}

/** Prefer the live catalog entry, so the block always reads current metadata. */
function liveToolTarget(target: Target, catalogs: Catalogs): Target {
  const key = targetKey(target);
  return catalogs.tools.find((candidate) => targetKey(candidate) === key) ?? target;
}

/** The signature line a tool block carries, with a generic fallback. */
function toolFallbackSignature(target: Target): string {
  return (
    target.signature ??
    `${target.identifier ?? targetKey(target)}(args: unknown): Promise<unknown>;`
  );
}

/** One tool-block entry: direct wording, or the codemode route when indirect. */
function toolBlockLine(target: Target): string {
  const name = targetKey(target);
  if (target.reach === "indirect") {
    const identifier = target.identifier ?? name;
    const server = target.server ? ` (${target.server})` : "";
    return (
      `- \`${name}\`${server} — not declared to you. ` +
      `Reach it inside a codemode script: \`await tools.${identifier}(...)\`. ` +
      `Signature: ${toolFallbackSignature(target)}`
    );
  }
  return `- \`${name}\` — call it directly. Signature: ${toolFallbackSignature(target)}`;
}

interface ExpandToolsOptions {
  /** False when the caller joins several text parts into one block. */
  appendBlock?: boolean;
}

function eligibleToolMentions(
  message: string,
  resolved: readonly ResolvedMention[],
): ResolvedMention[] {
  const prose = proseStart(message) ?? message.length;
  return resolved
    .filter(
      (candidate) =>
        candidate.mention.class === "tool" &&
        candidate.status === "resolved" &&
        candidate.target !== undefined &&
        candidate.mention.span.start >= prose,
    )
    .sort((a, b) => a.mention.span.start - b.mention.span.start);
}

function uniqueToolTargets(mentions: readonly ResolvedMention[], catalogs: Catalogs): Target[] {
  return dedupeToolTargets(
    mentions.map((candidate) => liveToolTarget(candidate.target!, catalogs)),
  );
}

/** The distinct targets one message's tool block lists, in first-occurrence order. */
function toolBlockEntries(
  message: string,
  resolved: readonly ResolvedMention[],
  catalogs: Catalogs,
): Target[] {
  return uniqueToolTargets(eligibleToolMentions(message, resolved), catalogs);
}

/** Render the one `<tool_mentions>` block that follows the prose. */
function toolBlockText(entries: readonly Target[]): string {
  return `<tool_mentions>\n${entries.map(toolBlockLine).join("\n")}\n</tool_mentions>`;
}

/**
 * Expand eligible `%tool` mentions for the model-facing message.
 *
 * Every resolved mention is replaced inline by its registered name. One
 * `<tool_mentions>` block follows the prose, with one entry per distinct target
 * in first-occurrence order. The leading native skill block and code ranges are
 * opaque. Unresolved, excluded and out-of-catalog mentions stay literal, and
 * this function activates and declares nothing.
 */
function expandTools(
  message: string,
  resolved: readonly ResolvedMention[],
  catalogs: Catalogs,
  options: ExpandToolsOptions = {},
): ExpandedText {
  const mentions = eligibleToolMentions(message, resolved);
  if (mentions.length === 0) return { text: message, entries: [] };

  let text = message;
  for (const candidate of [...mentions].reverse()) {
    const target = liveToolTarget(candidate.target!, catalogs);
    const { start, end } = candidate.mention.span;
    text = `${text.slice(0, start)}\`${targetKey(target)}\`${text.slice(end)}`;
  }
  const entries = uniqueToolTargets(mentions, catalogs);
  if (options.appendBlock === false) return { text, entries };

  return { text: `${text}\n\n${toolBlockText(entries)}`, entries };
}

/**
 * Expand one message's prose at the context seam.
 *
 * Tool mentions expand inline first; then the leading role mention, after any
 * native skill block, becomes the dispatch prefix. Escapes lose their backslash
 * for the model only. Entries are the distinct tool targets for the block.
 */
function expandText(
  text: string,
  catalogs: Catalogs,
  settings: Settings,
  allowRole = true,
): ExpandedText {
  const hasToolTrigger = text.includes(settings.triggers.tool);
  const hasRoleTrigger = text.includes(settings.triggers.role);
  if (!hasToolTrigger && !hasRoleTrigger) {
    return { text: unescapeExpandedText(text, settings), entries: [] };
  }

  const { mentions } = parse(text, triggerSpecs(settings));
  const expandable = mentions.filter(
    (mention) => mention.class === "tool" || mention.class === "role",
  );
  if (expandable.length === 0) {
    return { text: unescapeExpandedText(text, settings), entries: [] };
  }

  const resolved = resolve(expandable, catalogs, settings);
  let expandedText = text;
  let entries: Target[] = [];
  if (resolved.some((mention) => mention.mention.class === "tool")) {
    const tools = expandTools(text, resolved, catalogs, { appendBlock: false });
    expandedText = tools.text;
    entries = tools.entries;
  }

  if (allowRole) {
    expandedText = expandRoles(expandedText, resolved, catalogs).text;
  }
  return { text: unescapeExpandedText(expandedText, settings), entries };
}

/**
 * Expand the user messages the model is about to receive.
 *
 * This is the context seam's one interface. It owns per-part expansion, the
 * leading-role rule, one tool block after the last text part of a message, the
 * deduplication of that block, model-facing unescaping and change detection.
 * Non-user messages, non-text parts, and a message with nothing to expand are
 * returned by reference. `undefined` means no message changed.
 */
export function expandContextMessages<T extends ContextMessage>(
  messages: readonly T[],
  catalogs: Catalogs,
  settings: Settings,
): T[] | undefined {
  let changed = false;

  const next = messages.map((message) => {
    if (message.role !== "user" || message.content === undefined) return message;

    if (typeof message.content === "string") {
      const { text, entries } = expandText(message.content, catalogs, settings);
      const rewritten = entries.length === 0 ? text : `${text}\n\n${toolBlockText(entries)}`;
      if (rewritten === message.content) return message;
      changed = true;
      return { ...message, content: rewritten } as T;
    }

    let messageChanged = false;
    const allEntries: Target[] = [];
    let proseSeen = false;
    const content = message.content.map((part) => {
      if (!isTextPart(part)) return part;
      const allowRole = !proseSeen;
      if (hasProseAfterSkillBlock(part.text)) proseSeen = true;
      const { text, entries } = expandText(part.text, catalogs, settings, allowRole);
      allEntries.push(...entries);
      if (text === part.text) return part;
      messageChanged = true;
      return { ...part, text };
    });

    const entries = dedupeToolTargets(allEntries);
    if (entries.length > 0) {
      const lastText = content.findLastIndex((part) => isTextPart(part));
      const part = content[lastText];
      if (part && isTextPart(part)) {
        content[lastText] = { ...part, text: `${part.text}\n\n${toolBlockText(entries)}` };
        messageChanged = true;
      }
    }

    if (!messageChanged) return message;
    changed = true;
    return { ...message, content } as T;
  });

  return changed ? next : undefined;
}
