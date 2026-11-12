import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, type TriggerSpec } from "../src/core/grammar.ts";

const SPECS: TriggerSpec[] = [
  { class: "skill", trigger: "$" },
  { class: "path", trigger: "@" },
  { class: "tool", trigger: "%" },
  { class: "role", trigger: "&" },
];

const labels = (text: string) => parse(text, SPECS).mentions.map((m) => m.label);
const spans = (text: string) =>
  parse(text, SPECS).mentions.map((m) => text.slice(m.span.start, m.span.end));

test("a trigger starts a mention only at a boundary", () => {
  assert.deepEqual(labels("$tdd"), ["tdd"]);
  assert.deepEqual(labels("100%foo"), []);
  assert.deepEqual(labels("me@example.com"), []);
  assert.deepEqual(labels("(%read)"), ["read"]);
  assert.deepEqual(labels('"$tdd"'), ["tdd"]);
  assert.deepEqual(labels("x$tdd"), []);
  assert.deepEqual(labels("100 %foo"), ["foo"]);
  assert.deepEqual(labels("&&"), []);
});

test("an escaped trigger is literal", () => {
  assert.deepEqual(labels("\\$PATH"), []);
  assert.deepEqual(labels("\\%bash"), []);
  assert.deepEqual(labels("\\\\$PATH"), []);
});

test("a quoted path keeps spaces and its quotes in the span", () => {
  const text = 'see @"my notes/today.md" now';
  const parsed = parse(text, SPECS);
  assert.equal(parsed.mentions.length, 1);
  const [mention] = parsed.mentions;
  assert.equal(mention?.class, "path");
  assert.equal(mention?.label, "my notes/today.md");
  assert.equal(mention?.quoted, true);
  assert.equal(text.slice(mention?.span.start, mention?.span.end), '@"my notes/today.md"');
});

test("a tool chain takes at most two segments", () => {
  assert.deepEqual(labels("%kagi:kagi_search_fetch"), ["kagi:kagi_search_fetch"]);
  assert.deepEqual(labels("%bash:"), ["bash:"]);
  assert.deepEqual(labels("%a:b:c"), ["a:b"]);
});

test("a path label is a non-whitespace run", () => {
  const text = "@src/foo.ts. and @docs/nope.md";
  assert.deepEqual(spans(text), ["@src/foo.ts.", "@docs/nope.md"]);
});

test("mentions inside code are inert and code ranges are returned", () => {
  const text = "a `$x` b\n```\n$y\n```\n$z";
  const parsed = parse(text, SPECS);
  assert.deepEqual(
    parsed.mentions.map((m) => m.label),
    ["z"],
  );
  assert.deepEqual(
    parsed.codeRanges.map((r) => text.slice(r.start, r.end)),
    ["`$x`", "```\n$y\n```"],
  );
});

test("mentions do not overlap and the longest match at a position wins", () => {
  assert.deepEqual(spans("$a$b"), ["$a"]);
  assert.deepEqual(spans("$a $b"), ["$a", "$b"]);
});
