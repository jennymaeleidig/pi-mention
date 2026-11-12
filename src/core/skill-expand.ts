import { isWhitespace } from "./grammar.ts";
import type {
  ExpandOptions,
  ExpandedMessage,
  Range,
  ResolvedMention,
  SkillSource,
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
 * The offset where prose begins, after any leading native skill block. An
 * unterminated skill block has no prose start.
 */
export function proseStart(text: string): number | undefined {
  const block = skillBlockBounds(text);
  if (!block) return 0;
  return block.end;
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

/**
 * The first skill mention, when it resolved. Only that mention can become the
 * skill block: a later skill never expands, even when the first one does not
 * resolve. Later resolved skills are still coloured as skills.
 */
export function firstResolvedSkill(
  resolved: readonly ResolvedMention[],
): ResolvedMention | undefined {
  const first = resolved
    .filter((mention) => mention.mention.class === "skill")
    .sort((a, b) => a.mention.span.start - b.mention.span.start)[0];
  if (!first || first.status !== "resolved" || !first.target) return undefined;
  return first;
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
export function expandSkill(
  message: string,
  resolved: readonly ResolvedMention[],
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
