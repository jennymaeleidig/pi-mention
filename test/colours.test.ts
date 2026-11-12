import assert from "node:assert/strict";
import { test } from "node:test";
import { colourLines } from "../src/pi/colours.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs } from "../src/core/types.ts";

const catalogs: Catalogs = {
  skills: [{ label: "wayfinder", target: { class: "skill", label: "wayfinder" } }],
  tools: [{ label: "read", target: { class: "tool", label: "read", name: "read" } }],
  roles: [{ label: "general", target: { class: "role", label: "general" } }],
  paths: { has: (label) => label === "docs/mention-grammar.md" },
};
const settings = defaultSettings();

test("colourLines paints every class on one line", () => {
  const text = "$wayfinder %read &general @docs/mention-grammar.md https://example.com";
  const [spans] = colourLines(text, catalogs, settings);
  assert.deepEqual(
    spans?.map((span) => [text.slice(span.start, span.end), span.role]),
    [
      ["$wayfinder", "syntaxNumber"],
      ["%read", "accent"],
      ["&general", "success"],
      ["@docs/mention-grammar.md", "mdLinkUrl"],
      ["https://example.com", "mdLink"],
    ],
  );
});

test("colourLines marks unresolved mentions and ignores code", () => {
  const text = "$unknown `%read` @docs/nope.md";
  const [spans] = colourLines(text, catalogs, settings);
  assert.deepEqual(
    spans?.map((span) => [text.slice(span.start, span.end), span.role]),
    [
      ["$unknown", "warning"],
      ["@docs/nope.md", "warning"],
    ],
  );
});

test("colourLines projects spans onto the right line", () => {
  const text = "one\n$wayfinder\nthree";
  const lines = colourLines(text, catalogs, settings);
  assert.deepEqual(lines[0], []);
  assert.deepEqual(lines[1], [{ start: 0, end: 10, role: "syntaxNumber" }]);
  assert.deepEqual(lines[2], []);
});
