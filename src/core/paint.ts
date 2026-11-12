import type { ColourSpan } from "./types.ts";

export interface PaintWrap {
  prefix: string;
  suffix: string;
}

/** The layout slice of one rendered row, in code units. */
export interface PaintSegment {
  startCol: number;
  length: number;
}

const ESC = "\u001b";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length of the escape (or APC/OSC string) at `index`, or 0 for text. */
function escapeAt(text: string, index: number): number {
  if (text[index] !== ESC) return 0;
  const next = text[index + 1];
  if (next === undefined) return 1;
  if (next === "[") {
    for (let i = index + 2; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i + 1 - index;
    }
    return text.length - index;
  }
  if (next === "]" || next === "_" || next === "P" || next === "^") {
    const bel = text.indexOf("\u0007", index + 2);
    const st = text.indexOf(`${ESC}\\`, index + 2);
    if (bel < 0 && st < 0) return text.length - index;
    if (bel >= 0 && (st < 0 || bel < st)) return bel + 1 - index;
    return st + 2 - index;
  }
  return 2;
}

/** Remove every escape (CSI, OSC, APC and friends) from an ANSI string. */
export function stripAnsi(text: string): string {
  let out = "";
  for (let i = 0; i < text.length;) {
    const esc = escapeAt(text, i);
    if (esc > 0) {
      i += esc;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Paint the grapheme runs of one rendered row that logical spans cover.
 *
 * Every existing byte is copied verbatim. Only colour prefixes and suffixes are
 * inserted, and a grapheme is never split, so a cursor on a surrogate pair or a
 * combining sequence stays intact.
 */
export function paintRow(
  row: string,
  padding: number,
  segment: PaintSegment,
  spans: readonly ColourSpan[],
  wrap: (role: string) => PaintWrap | undefined,
): string {
  if (spans.length === 0 || row.length === 0) return row;
  const lo = segment.startCol;
  const hi = lo + segment.length;
  const start = Math.min(padding, row.length);
  let out = row.slice(0, start);
  let i = start;
  let logical = lo;
  let open: (PaintWrap & { end: number }) | null = null;
  const close = () => {
    if (open) out += open.suffix;
    open = null;
  };

  while (i < row.length) {
    const esc = escapeAt(row, i);
    if (esc > 0) {
      // Close before the escape, never reopen after it. Pi's hardware-cursor
      // marker must stay immediately adjacent to the fake-cursor start marker;
      // inserting a colour prefix between them makes the fake cursor visible
      // instead of positioning the hardware cursor. The next grapheme reopens
      // the span if it is still inside one.
      if (open) {
        out += open.suffix;
        open = null;
      }
      out += row.slice(i, i + esc);
      i += esc;
      continue;
    }
    if (logical >= hi) {
      close();
      out += row.slice(i);
      break;
    }
    let next = row.indexOf(ESC, i);
    if (next < 0) next = row.length;
    for (const { segment: grapheme } of segmenter.segment(row.slice(i, next))) {
      if (logical >= hi) {
        close();
        out += grapheme;
        continue;
      }
      if (open && logical >= open.end) close();
      const span = spans.find(
        (candidate) => logical < candidate.end && logical + grapheme.length > candidate.start,
      );
      if (span && !open) {
        const paint = wrap(span.role);
        if (paint) {
          out += paint.prefix;
          open = { ...paint, end: span.end };
        }
      }
      out += grapheme;
      logical += grapheme.length;
    }
    i = next;
  }
  close();
  return out;
}
