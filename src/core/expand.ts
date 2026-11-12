import { findCodeRanges } from "./grammar.ts";
import type { Range, ResolvedMention, Settings, Target } from "./types.ts";

/** A skill body and its location, loaded and frontmatter-stripped by the pi adapter. */
export interface SkillSource {
  /** The skill's short label, used in the block's `name` attribute. */
  name: string;
  /** Absolute path to the SKILL.md file. */
  location: string;
  /** Directory that relative references in the body resolve against. */
  baseDir: string;
  /** SKILL.md content with frontmatter already stripped. */
  body: string;
}

export interface ExpandOptions {
  /**
   * Adapter-supplied source for a resolved skill. Expansion itself performs no
   * I/O; a missing source aborts the block and leaves the mention literal.
   */
  skillSource?: (target: Target) => SkillSource | undefined;
}

export interface SkillFailure {
  /** The skill label, for the adapter's one user-facing notice. */
  name: string;
}

export interface ExpandedMessage {
  text: string;
  /** Present only when a native skill block was built at the input seam. */
  skillBlock?: string;
  /** Present when a resolved skill could not become a block. */
  skillFailure?: SkillFailure;
}

const CLOSING_TAG_LINE = /^<\/skill>$/m;

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
    `<skill name="${name}" location="${location}">\n` +
    `References are relative to ${baseDir}.\n\n${body}\n</skill>`
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

function inRanges(index: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/**
 * Emit the remaining prose, dropping the escaped-trigger backslash outside code
 * and outside the removed mention. A skill block body never passes through here.
 */
function expandProse(
  text: string,
  remove: Range | undefined,
  codeRanges: readonly Range[],
  triggers: ReadonlySet<string>,
): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (remove && i === remove.start) {
      i = remove.end;
      continue;
    }
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

function triggersFor(settings: Settings): Set<string> {
  return new Set([settings.triggers.skill, settings.triggers.tool, settings.triggers.role]);
}

/**
 * Drop escaped-trigger backslashes in a message the model is about to receive,
 * without touching a leading native skill block. The context seam uses this so
 * the transcript keeps the escape while the expanded message does not.
 */
export function unescapeExpandedText(text: string, settings: Settings): string {
  const triggers = triggersFor(settings);
  let start = 0;
  if (text.startsWith('<skill name="')) {
    const close = text.indexOf("\n</skill>");
    if (close < 0) return text;
    start = close + "\n</skill>".length;
  }
  const prefix = text.slice(0, start);
  const suffix = text.slice(start);
  return prefix + expandProse(suffix, undefined, findCodeRanges(suffix), triggers);
}

/**
 * Expand a message at the pure seam.
 *
 * Skills are the only class expanded here. The first resolving skill becomes
 * Pi's canonical block; the mention is removed and the remaining prose follows
 * after `\n\n`. Unresolved or excluded skills, later skills, code ranges and
 * unrepresentable blocks stay literal. Escape backslashes are dropped only in
 * the prose, never in a skill body.
 */
export function expand(
  message: string,
  resolved: readonly ResolvedMention[],
  settings: Settings,
  options: ExpandOptions = {},
): ExpandedMessage {
  const codeRanges = findCodeRanges(message);
  const triggers = triggersFor(settings);
  const skill = firstResolvedSkill(resolved);
  const literal = expandProse(message, undefined, codeRanges, triggers);

  if (!skill?.target) return { text: literal };

  const source = options.skillSource?.(skill.target);
  if (!source) {
    return { text: literal, skillFailure: { name: skill.target.label } };
  }

  const skillBlock = buildSkillBlock(source);
  if (!skillBlock) {
    return { text: literal, skillFailure: { name: skill.target.label } };
  }

  const rest = expandProse(
    message,
    removalRange(message, skill.mention.span),
    codeRanges,
    triggers,
  ).trim();
  return {
    text: rest ? `${skillBlock}\n\n${rest}` : skillBlock,
    skillBlock,
  };
}
