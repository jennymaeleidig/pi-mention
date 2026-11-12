import { findCodeRanges, inRanges } from "./grammar.ts";
import type {
  ExpandOptions,
  ExpandedMessage,
  Range,
  ResolvedMention,
  Settings,
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
