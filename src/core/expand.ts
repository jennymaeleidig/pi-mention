import { findCodeRanges, inRanges } from "./grammar.ts";
import type {
  Catalogs,
  ExpandOptions,
  ExpandedMessage,
  Range,
  ResolvedMention,
  Settings,
  SkillSource,
  Target,
} from "./types.ts";

/** The opening marker of Pi's native skill block. */
export const SKILL_BLOCK_OPEN = '<skill name="';
const SKILL_CLOSE_TAG = "</skill>";
const SKILL_BLOCK_CLOSE = `\n${SKILL_CLOSE_TAG}`;
const CLOSING_TAG_LINE = new RegExp(`^${SKILL_CLOSE_TAG}$`, "m");

/**
 * The extent of the native skill block that opens `text`, ignoring leading
 * whitespace. `start` is present whenever the opening marker is; `end` is
 * present once the closing-tag line is found.
 */
export function skillBlockBounds(text: string): { start: number; end?: number } | undefined {
  const start = text.length - text.trimStart().length;
  if (!text.startsWith(SKILL_BLOCK_OPEN, start)) return undefined;
  const close = text.indexOf(SKILL_BLOCK_CLOSE, start + SKILL_BLOCK_OPEN.length);
  return close < 0 ? { start } : { start, end: close + SKILL_BLOCK_CLOSE.length };
}

/**
 * Build Pi's byte-exact skill block.
 *
 * The body is normalised to LF and trimmed. A quote or newline in the name or
 * path, or a line that would close the block early, makes the block
 * unrepresentable and returns undefined.
 */
export function buildSkillBlock(source: SkillSource): string | undefined {
  const { name, location, baseDir } = source;
  if (/["\n]/.test(name) || /["\n]/.test(location)) return undefined;

  const body = source.body.replace(/\r\n?/g, "\n").trim();
  if (CLOSING_TAG_LINE.test(body)) return undefined;

  return (
    `${SKILL_BLOCK_OPEN}${name}" location="${location}">\n` +
    `References are relative to ${baseDir}.\n\n${body}${SKILL_BLOCK_CLOSE}`
  );
}

/** The first skill mention that resolved; later skill mentions stay literal. */
export function firstResolvedSkill(
  resolved: readonly ResolvedMention[],
): ResolvedMention | undefined {
  return resolved
    .filter(
      (mention) =>
        mention.mention.class === "skill" && mention.status === "resolved" && mention.target,
    )
    .sort((a, b) => a.mention.span.start - b.mention.span.start)[0];
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

/** Remove the mention and one adjacent whitespace run, so prose keeps single spacing. */
function removalRange(text: string, span: Range): Range {
  let start = span.start;
  let end = span.end;
  if (isWhitespace(text[end])) {
    while (isWhitespace(text[end])) end++;
  } else {
    while (start > 0 && isWhitespace(text[start - 1])) start--;
  }
  return { start, end };
}

/** The message with one mention removed, leaving every escape exactly as typed. */
function removeMention(text: string, span: Range): string {
  const range = removalRange(text, span);
  return text.slice(0, range.start) + text.slice(range.end);
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

/**
 * Drop escaped-trigger backslashes in a message the model is about to receive,
 * without touching a leading native skill block. The context seam uses this so
 * the transcript keeps the escape while the expanded message does not.
 */
export function unescapeExpandedText(text: string, settings: Settings): string {
  const triggers = triggersFor(settings);
  const block = skillBlockBounds(text);
  if (!block) return unescapeProse(text, triggers);
  if (block.end === undefined) return text;
  return text.slice(0, block.end) + unescapeProse(text.slice(block.end), triggers);
}

/**
 * Expand a message at the pure input seam.
 *
 * Skills are the only class expanded here. The first skill mention is the only
 * one eligible; when it resolves, it becomes Pi's canonical block, the mention
 * is removed and the remaining prose follows after `\n\n`. Unresolved or
 * excluded skills, later skills, code ranges and unrepresentable blocks stay
 * literal. Escapes are left exactly as typed: this seam persists the
 * transcript, and the context seam drops the backslashes for the model.
 */
export function expand(
  message: string,
  resolved: readonly ResolvedMention[],
  _settings: Settings,
  options: ExpandOptions = {},
): ExpandedMessage {
  const skill = firstResolvedSkill(resolved);
  if (!skill?.target) return { text: message };

  const source = options.skillSource?.(skill.target);
  if (!source) {
    return { text: message, skillFailure: { name: skill.target.label } };
  }

  const skillBlock = buildSkillBlock(source);
  if (!skillBlock) {
    return { text: message, skillFailure: { name: skill.target.label } };
  }

  const prose = removeMention(message, skill.mention.span).trim();
  return {
    text: prose ? `${skillBlock}\n\n${prose}` : skillBlock,
    skillBlock,
  };
}

/** The registered name, falling back to the label a user typed. */
export function toolKey(target: Target): string {
  return target.name ?? target.label;
}

/**
 * Collapse targets to their first occurrence, keyed by `toolKey`.
 *
 * Both the single-message block and the multi-part context adapter use this,
 * so a repeated target is listed once.
 */
export function dedupeToolTargets(targets: readonly Target[]): Target[] {
  const seen = new Set<string>();
  const entries: Target[] = [];
  for (const target of targets) {
    const key = toolKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(target);
  }
  return entries;
}

/** Prefer the live catalog entry, so the block always reads current metadata. */
function liveToolTarget(target: Target, catalogs: Catalogs): Target {
  const key = toolKey(target);
  return catalogs.tools.find((candidate) => toolKey(candidate) === key) ?? target;
}

/** The signature line a tool block carries, with a generic fallback. */
function toolSignature(target: Target): string {
  return (
    target.signature ?? `${target.identifier ?? toolKey(target)}(args: unknown): Promise<unknown>;`
  );
}

/** One tool-block entry: direct wording, or the codemode route when indirect. */
function toolBlockLine(target: Target): string {
  const name = toolKey(target);
  if (target.reach === "indirect") {
    const identifier = target.identifier ?? name;
    const server = target.server ? ` (${target.server})` : "";
    return (
      `- \`${name}\`${server} — not declared to you. ` +
      `Reach it inside a codemode script: \`await tools.${identifier}(...)\`. ` +
      `Signature: ${toolSignature(target)}`
    );
  }
  return `- \`${name}\` — call it directly. Signature: ${toolSignature(target)}`;
}

export interface ExpandToolsOptions {
  /** False when the caller joins several text parts into one block. */
  appendBlock?: boolean;
}

function eligibleToolMentions(
  message: string,
  resolved: readonly ResolvedMention[],
): ResolvedMention[] {
  const skillBlock = skillBlockBounds(message);
  const proseStart = skillBlock ? (skillBlock.end ?? message.length) : 0;
  return resolved
    .filter(
      (candidate) =>
        candidate.mention.class === "tool" &&
        candidate.status === "resolved" &&
        candidate.target !== undefined &&
        candidate.mention.span.start >= proseStart,
    )
    .sort((a, b) => a.mention.span.start - b.mention.span.start);
}

function uniqueToolTargets(mentions: readonly ResolvedMention[], catalogs: Catalogs): Target[] {
  return dedupeToolTargets(
    mentions.map((candidate) => liveToolTarget(candidate.target!, catalogs)),
  );
}

/**
 * The distinct targets one message's tool block lists, in first-occurrence
 * order. Mentions inside the leading skill block, unresolved mentions and
 * excluded mentions are skipped.
 */
export function toolBlockEntries(
  message: string,
  resolved: readonly ResolvedMention[],
  catalogs: Catalogs,
): Target[] {
  return uniqueToolTargets(eligibleToolMentions(message, resolved), catalogs);
}

/** Render the one `<tool_mentions>` block that follows the prose. */
export function toolBlockText(entries: readonly Target[]): string {
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
export function expandTools(
  message: string,
  resolved: readonly ResolvedMention[],
  catalogs: Catalogs,
  options: ExpandToolsOptions = {},
): ExpandedMessage {
  const mentions = eligibleToolMentions(message, resolved);
  if (mentions.length === 0) return { text: message };

  let text = message;
  for (const candidate of [...mentions].reverse()) {
    const target = liveToolTarget(candidate.target!, catalogs);
    const { start, end } = candidate.mention.span;
    text = `${text.slice(0, start)}\`${toolKey(target)}\`${text.slice(end)}`;
  }
  if (options.appendBlock === false) return { text };

  const entries = uniqueToolTargets(mentions, catalogs);
  return { text: `${text}\n\n${toolBlockText(entries)}` };
}
