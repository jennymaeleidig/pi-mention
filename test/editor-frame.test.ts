import assert from "node:assert/strict";
import { test } from "node:test";
import { sameFrame } from "../src/pi/editor.ts";

const border = (labelAt?: { at: number; label: string }, width = 40): string => {
  const dashes = "\u2500".repeat(width);
  if (!labelAt) return dashes;
  return (
    dashes.slice(0, labelAt.at) + labelAt.label + dashes.slice(labelAt.at + labelAt.label.length)
  );
};

test("a plain unchanged border is the frame", () => {
  assert.equal(sameFrame(border(), border(), 40, false), true);
});

test("vim's mode label in a border is still the same frame", () => {
  const expected = border();
  const labelled = border({ at: 30, label: " NORMAL " });
  assert.equal(sameFrame(labelled, expected, 40, true), true);
  assert.equal(sameFrame(labelled, expected, 40, false), false);
});

test("a border at another width or with another shape is not the frame", () => {
  const expected = border();
  const moved = border({ at: 5, label: " INSERT " });
  assert.equal(sameFrame(border(undefined, 39), expected, 40, true), false);
  assert.equal(sameFrame("\u2500".repeat(38) + "x ", expected, 40, true), false);
  assert.equal(sameFrame(moved, expected, 40, true), true);
  assert.equal(sameFrame(moved, expected, 41, true), false);
});
