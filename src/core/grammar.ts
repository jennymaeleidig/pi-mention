import type { Mention, Range, TriggerSpec } from "./types.ts";

export type { TriggerSpec };

/** Whitespace or CJK punctuation separates prose from a trigger. */
const CJK_BREAK =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
const CJK_PUNCTUATION = new RegExp(
  `(?:(?=\\p{Punctuation})${CJK_BREAK.source}|[，．：；！？（）［］｛｝“”‘’…—])`,
  "u",
);
const BOUNDARY_BEFORE = new RegExp(`^(?:\\s|${CJK_PUNCTUATION.source}|[([{<'"\`])$`, "u");

const LABEL_START = /[A-Za-z0-9]/;
const LABEL_CHAR = /[A-Za-z0-9._-]/;
const PUNCTUATION_ONLY = /^[.,;:!?)\]}]+$/;

/** The code ranges that make triggers inert: fenced blocks and inline code. */
export function findCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ start: lineStart, end: i, text: text.slice(lineStart, i) });
      lineStart = i + 1;
    }
  }

  let fenceStart: number | undefined;
  let fence: string | undefined;
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line.text)?.[1];
    if (marker) {
      if (fenceStart === undefined) {
        fenceStart = line.start;
        fence = marker[0];
      } else if (marker[0] === fence) {
        ranges.push({ start: fenceStart, end: line.end });
        fenceStart = undefined;
        fence = undefined;
      }
      continue;
    }
    if (fenceStart !== undefined) continue;
    ranges.push(...inlineCodeRanges(line));
  }
  if (fenceStart !== undefined) ranges.push({ start: fenceStart, end: text.length });
  return mergeRanges(ranges);
}

function inlineCodeRanges(line: { start: number; end: number; text: string }): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  while (i < line.text.length) {
    if (line.text[i] !== "`") {
      i++;
      continue;
    }
    let run = 1;
    while (line.text[i + run] === "`") run++;
    const close = line.text.indexOf("`".repeat(run), i + run);
    const end = close < 0 ? line.text.length : close + run;
    ranges.push({ start: line.start + i, end: line.start + end });
    i = end;
  }
  return ranges;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function inRanges(index: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return BOUNDARY_BEFORE.test(text[index - 1] ?? "");
}

function scanLabel(text: string, start: number): number {
  if (!LABEL_START.test(text[start] ?? "")) return start;
  let end = start + 1;
  while (end < text.length && LABEL_CHAR.test(text[end] ?? "")) end++;
  return end;
}

function scanTool(text: string, start: number): number {
  const firstEnd = scanLabel(text, start);
  if (firstEnd === start) return start;
  if (text[firstEnd] !== ":") return firstEnd;
  const secondStart = firstEnd + 1;
  const secondEnd = scanLabel(text, secondStart);
  if (secondEnd === secondStart) return firstEnd + 1;
  return secondEnd;
}

/** True when the whole string is a skill/role label, using the parser's scanner. */
export function isLabel(label: string): boolean {
  return label.length > 0 && scanLabel(label, 0) === label.length;
}

/** True when the whole string is a tool label, including an incomplete chain. */
export function isToolLabel(label: string): boolean {
  return label.length > 0 && scanTool(label, 0) === label.length;
}

/** Parse every triggered mention and the code ranges that suppress them. */
export function parse(
  text: string,
  specs: readonly TriggerSpec[],
): { mentions: Mention[]; codeRanges: Range[] } {
  const codeRanges = findCodeRanges(text);
  const byTrigger = new Map(specs.map((spec) => [spec.trigger, spec.class]));
  const mentions: Mention[] = [];

  let i = 0;
  while (i < text.length) {
    if (inRanges(i, codeRanges)) {
      i++;
      continue;
    }
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    const tokenClass = byTrigger.get(text[i] ?? "");
    if (!tokenClass || !isBoundary(text, i)) {
      i++;
      continue;
    }

    if (tokenClass === "path" && text[i + 1] === '"') {
      const close = text.indexOf('"', i + 2);
      const end = close < 0 ? text.length : close + 1;
      const labelEnd = close < 0 ? text.length : close;
      const label = text.slice(i + 2, labelEnd);
      if (label.length > 0) {
        mentions.push({
          class: "path",
          trigger: text[i] ?? "@",
          label,
          span: { start: i, end },
          quoted: true,
        });
        i = end;
        continue;
      }
      i++;
      continue;
    }

    const labelStart = i + 1;
    let end = labelStart;
    if (tokenClass === "path") {
      while (end < text.length && !/\s/u.test(text[end] ?? "")) end++;
    } else if (tokenClass === "tool") {
      end = scanTool(text, labelStart);
    } else {
      end = scanLabel(text, labelStart);
    }

    if (end > labelStart) {
      const label = text.slice(labelStart, end);
      mentions.push({
        class: tokenClass,
        trigger: text[i] ?? "",
        label,
        span: { start: i, end },
      });
      i = end;
      continue;
    }
    i++;
  }

  return { mentions, codeRanges };
}

/** True when `rest` may follow a resolved prefix without eating a word character. */
export function isPunctuationOnly(rest: string): boolean {
  return rest.length === 0 || PUNCTUATION_ONLY.test(rest);
}

/**
 * The end of the mention token that starts at `start`, using the same scanners as
 * `parse`. The picker uses it to replace a whole token even when the cursor sits
 * in the middle of the label.
 */
export function scanMentionEnd(
  text: string,
  start: number,
  tokenClass: Exclude<TriggerSpec["class"], "path">,
): number {
  const labelStart = start + 1;
  return tokenClass === "tool" ? scanTool(text, labelStart) : scanLabel(text, labelStart);
}
