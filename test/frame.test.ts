import assert from "node:assert/strict";
import { test } from "node:test";
import { frameRowMatches, paintFrame } from "../src/core/frame.ts";
import type { ColourSpan } from "../src/core/types.ts";

const border = (labelAt?: { at: number; label: string }, width = 40): string => {
  const dashes = "\u2500".repeat(width);
  if (!labelAt) return dashes;
  return (
    dashes.slice(0, labelAt.at) + labelAt.label + dashes.slice(labelAt.at + labelAt.label.length)
  );
};

test("a plain unchanged border is the frame", () => {
  assert.equal(frameRowMatches(border(), border(), 40, false), true);
});

test("vim's mode label in a border is still the same frame", () => {
  const expected = border();
  const labelled = border({ at: 30, label: " NORMAL " });
  assert.equal(frameRowMatches(labelled, expected, 40, true), true);
  assert.equal(frameRowMatches(labelled, expected, 40, false), false);
});

test("the top border stays strict even when a vim label is present", () => {
  const expected = border();
  const labelled = border({ at: 30, label: " NORMAL " });
  assert.equal(frameRowMatches(labelled, expected, 40, false), false);
});

test("a moved label inside a dash run is still the frame", () => {
  const expected = border();
  const moved = border({ at: 5, label: " INSERT " });
  assert.equal(frameRowMatches(moved, expected, 40, true), true);
});

test("a border at another width or with another shape is not the frame", () => {
  const expected = border();
  assert.equal(frameRowMatches(border(undefined, 39), expected, 40, true), false);
  assert.equal(frameRowMatches("\u2500".repeat(38) + "x ", expected, 40, true), false);
  assert.equal(frameRowMatches(border({ at: 5, label: " INSERT " }), expected, 41, true), false);
});

test("a label over non-dash border content is not the frame", () => {
  const prefix = "\u2500".repeat(10);
  const suffix = "\u2500".repeat(25);
  const expected = `${prefix}title${suffix}`;
  const rendered = `${prefix}MODE!${suffix}`;
  assert.equal(rendered.length, 40);
  assert.equal(frameRowMatches(rendered, expected, 40, true), false);
});

test("two separate changed runs in a dash row are not the frame", () => {
  const expected = border();
  const split = `${expected.slice(0, 5)}M${expected.slice(6, 7)}L${expected.slice(8)}`;
  assert.equal(split.length, 40);
  assert.equal(frameRowMatches(split, expected, 40, true), false);
});

const row = (width = 10) => "\u2500".repeat(width);
const layout = (logicalLine = 0, startCol = 0, length = 10) => [{ logicalLine, startCol, length }];
const span = (start: number, end: number, role = "skill"): ColourSpan => ({ start, end, role });
const wrap = (role: string) => ({ prefix: `<${role}>`, suffix: `</${role}>` });

test("paintFrame paints a matching frame row", () => {
  const lines = [row(), "$tdd      ", row()];
  const painted = paintFrame({
    lines,
    width: 10,
    top: row(),
    bottom: row(),
    layout: layout(),
    rows: 1,
    scroll: 0,
    paddingX: 0,
    spansForLines: () => [[span(0, 4)]],
    wrap,
    allowVimLabel: false,
  });
  assert.deepEqual(painted, [row(), "<skill>$tdd</skill>      ", row()]);
});

test("paintFrame leaves a tampered frame untouched", () => {
  const lines = ["==========", "$tdd      ", row()];
  assert.deepEqual(
    paintFrame({
      lines,
      width: 10,
      top: row(),
      bottom: row(),
      layout: layout(),
      rows: 1,
      scroll: 0,
      paddingX: 0,
      spansForLines: () => [[span(0, 4)]],
      wrap,
      allowVimLabel: false,
    }),
    lines,
  );
});

test("paintFrame paints nothing when every line has no spans", () => {
  const lines = [row(), "$tdd      ", row()];
  assert.deepEqual(
    paintFrame({
      lines,
      width: 10,
      top: row(),
      bottom: row(),
      layout: layout(),
      rows: 1,
      scroll: 0,
      paddingX: 0,
      spansForLines: () => [[]],
      wrap,
      allowVimLabel: false,
    }),
    lines,
  );
});

test("paintFrame composes with a vim label only on the bottom border", () => {
  const labelled = "\u2500 NORMAL \u2500";
  const lines = [row(), "$tdd      ", labelled];
  const painted = paintFrame({
    lines,
    width: 10,
    top: row(),
    bottom: row(),
    layout: layout(),
    rows: 1,
    scroll: 0,
    paddingX: 0,
    spansForLines: () => [[span(0, 4)]],
    wrap,
    allowVimLabel: true,
  });
  assert.deepEqual(painted, [row(), "<skill>$tdd</skill>      ", labelled]);
});

test("paintFrame follows scroll and the segment's logical line", () => {
  const lines = [row(), "visible   ", row()];
  const painted = paintFrame({
    lines,
    width: 10,
    top: row(),
    bottom: row(),
    layout: [
      { logicalLine: 0, startCol: 0, length: 10 },
      { logicalLine: 1, startCol: 0, length: 10 },
    ],
    rows: 1,
    scroll: 1,
    paddingX: 0,
    spansForLines: () => [[span(0, 7, "hidden")], [span(0, 7, "visible")]],
    wrap,
    allowVimLabel: false,
  });
  assert.deepEqual(painted, [row(), "<visible>visible</visible>   ", row()]);
});
