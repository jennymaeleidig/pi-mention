import { paintRow, stripAnsi, type PaintWrap } from "./paint.ts";
import type { ColourSpan } from "./types.ts";

/** The layout slice of one rendered row, in code units. */
export interface FrameSegment {
  logicalLine: number;
  startCol: number;
  length: number;
}

/**
 * True when `row` is the frame `expected`, allowing pi-vim-editor's mode
 * label on a border. Vim replaces a contiguous run of border dashes with its
 * status (`──── NORMAL ────`), so the changed cells in `expected` must all be
 * dashes and the corresponding cells in `row` must be a non-empty label with
 * no dashes. A title inserted into other border content is not the frame.
 */
export function frameRowMatches(
  row: string,
  expected: string,
  width: number,
  allowVimLabel: boolean,
): boolean {
  if (row === expected) return true;
  if (!allowVimLabel) return false;
  const got = stripAnsi(row);
  const want = stripAnsi(expected);
  if (got.length !== width || want.length !== width) return false;
  if (got.charAt(0) !== want.charAt(0)) return false;
  if (got.charAt(got.length - 1) !== want.charAt(want.length - 1)) return false;

  let start = -1;
  let end = -1;
  for (let i = 0; i < width; i++) {
    if (got[i] === want[i]) continue;
    if (start < 0) start = i;
    else if (end !== i - 1) return false;
    end = i;
  }
  if (start < 0) return false;
  for (let i = start; i <= end; i++) {
    if (want[i] !== "\u2500") return false;
    if (got[i] === "\u2500") return false;
  }
  return true;
}

export interface PaintFrameOptions {
  /** The rendered rows, including the top and bottom borders. */
  lines: string[];
  width: number;
  /** The border rows the editor rendered before decoration. */
  top: string;
  bottom: string;
  layout: readonly FrameSegment[];
  rows: number;
  scroll: number;
  padding: number;
  /** Called only after the frame proof succeeds. */
  spansForLines: () => readonly (readonly ColourSpan[])[];
  wrap: (role: string) => PaintWrap | undefined;
  allowVimLabel: boolean;
}

/**
 * Paint the visible rows of a rendered editor frame.
 *
 * The frame proof runs first: if either border is not the one the editor
 * rendered, or the row count does not fit, the lines are returned untouched.
 * Then each visible row is mapped to its logical line and painted with
 * `paintRow`, which never splits a grapheme or an escape.
 */
export function paintFrame(options: PaintFrameOptions): string[] {
  const { lines, width, top, bottom, layout, rows, scroll, padding } = options;
  if (rows <= 0 || lines.length < rows + 2) return lines;
  if (
    !frameRowMatches(lines[0] ?? "", top, width, false) ||
    !frameRowMatches(lines[rows + 1] ?? "", bottom, width, options.allowVimLabel)
  ) {
    return lines;
  }

  const perLine = options.spansForLines();
  if (perLine.every((spans) => spans.length === 0)) return lines;

  const out = [...lines];
  for (let row = 0; row < rows; row++) {
    const segment = layout[scroll + row];
    if (!segment) continue;
    const spans = perLine[segment.logicalLine]?.filter(
      (span) => span.start < segment.startCol + segment.length && span.end > segment.startCol,
    );
    if (!spans || spans.length === 0) continue;
    const line = lines[row + 1];
    if (line === undefined) continue;
    out[row + 1] = paintRow(line, padding, segment, spans, options.wrap);
  }
  return out;
}
