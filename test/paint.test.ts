import assert from "node:assert/strict";
import { test } from "node:test";
import { paintRow, type PaintWrap } from "../src/core/paint.ts";
import type { ColourSpan } from "../src/core/types.ts";

const wrap = (role: string): PaintWrap | undefined =>
  role === "skill"
    ? { prefix: "\u001b[35m", suffix: "\u001b[39m" }
    : role === "path"
      ? { prefix: "\u001b[36m", suffix: "\u001b[39m" }
      : undefined;

const ESCAPES = /\u001b\[[0-9;]*m|\u001b_pi:[^\u0007]*\u0007/g;
const visible = (row: string) => row.replace(ESCAPES, "");

test("paintRow inserts a prefix and suffix without changing the text", () => {
  const row = "hello @tdd";
  const out = paintRow(
    row,
    0,
    { startCol: 0, length: row.length },
    [{ start: 6, end: 10, role: "skill" }],
    wrap,
  );
  assert.equal(visible(out), row);
  assert.equal(out, "hello \u001b[35m@tdd\u001b[39m");
});

test("paintRow copies cursor markers and other escapes verbatim", () => {
  const row = "\u001b_pi:c\u0007x\u001b_pi:fc\u0007";
  const out = paintRow(
    row,
    0,
    { startCol: 0, length: 1 },
    [{ start: 0, end: 1, role: "skill" }],
    wrap,
  );
  assert.equal(visible(out), "x");
  assert.equal(out.includes("\u001b_pi:c\u0007"), true);
  assert.equal(out.includes("\u001b_pi:fc\u0007"), true);
});

test("a cursor on an emoji does not split the surrogate pair", () => {
  const row = "\u001b_pi:c\u0007😀\u001b_pi:fc\u0007";
  const out = paintRow(
    row,
    0,
    { startCol: 0, length: 2 },
    [{ start: 0, end: 2, role: "skill" }],
    wrap,
  );
  const emoji = out.indexOf("😀");
  assert.notEqual(emoji, -1);
  const high = out.charCodeAt(emoji);
  const low = out.charCodeAt(emoji + 1);
  assert.equal(high >= 0xd800 && high <= 0xdbff, true);
  assert.equal(low >= 0xdc00 && low <= 0xdfff, true);
  assert.equal(visible(out), "😀");
});

test("a span that starts before a wrapped row paints from the row start", () => {
  const row = "ng-path";
  const out = paintRow(
    row,
    0,
    { startCol: 10, length: 7 },
    [{ start: 5, end: 17, role: "path" }],
    wrap,
  );
  assert.equal(visible(out), row);
  assert.equal(out.startsWith("\u001b[36m"), true);
  assert.equal(out.endsWith("\u001b[39m"), true);
});

test("left padding is not painted", () => {
  const row = "  @x";
  const out = paintRow(
    row,
    2,
    { startCol: 0, length: 2 },
    [{ start: 0, end: 2, role: "skill" }],
    wrap,
  );
  assert.equal(out, "  \u001b[35m@x\u001b[39m");
});

test("an unknown theme role leaves the row byte-identical", () => {
  const row = "hello @tdd";
  const out = paintRow(
    row,
    0,
    { startCol: 0, length: row.length },
    [{ start: 6, end: 10, role: "unknown" }],
    wrap,
  );
  assert.equal(out, row);
});

test("spans outside the row fragment are ignored", () => {
  const row = "hello";
  const spans: ColourSpan[] = [{ start: 10, end: 14, role: "skill" }];
  assert.equal(paintRow(row, 0, { startCol: 0, length: 5 }, spans, wrap), row);
});
