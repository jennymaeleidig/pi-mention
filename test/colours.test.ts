import assert from "node:assert/strict";
import { test } from "node:test";
import { colourLines, spansForLinesFactory } from "../src/pi/colours.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Target } from "../src/core/types.ts";

const catalogs: Catalogs = {
  skills: [{ class: "skill", label: "wayfinder" }],
  tools: [{ class: "tool", label: "read", name: "read" }],
  roles: [{ class: "role", label: "general" }],
  paths: { has: (label) => label === "docs/mention-grammar.md", probe: () => {} },
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

test("configured triggers and colour roles drive the painter", () => {
  const custom = defaultSettings();
  custom.triggers.skill = "!";
  custom.colors.skill = "syntaxKeyword";
  custom.colors.url = "accent";

  const text = "!wayfinder %read https://example.com";
  const [spans] = colourLines(text, catalogs, custom);
  assert.deepEqual(
    spans?.map((span) => [text.slice(span.start, span.end), span.role]),
    [
      ["!wayfinder", "syntaxKeyword"],
      ["%read", "accent"],
      ["https://example.com", "accent"],
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

test("later skills that resolve keep the skill colour", () => {
  const text = "$wayfinder then $wayfinder";
  const [spans] = colourLines(text, catalogs, settings);
  assert.deepEqual(
    spans?.map((span) => [text.slice(span.start, span.end), span.role]),
    [
      ["$wayfinder", "syntaxNumber"],
      ["$wayfinder", "syntaxNumber"],
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

test("colourLines probes a path label and its punctuation-eligible prefixes", () => {
  const probes: string[] = [];
  const live: Catalogs = {
    ...catalogs,
    paths: { has: () => false, probe: (label) => probes.push(label) },
  };

  colourLines("@src/index.ts,", live, settings);

  assert.deepEqual(probes, ["src/index.ts,", "src/index.ts"]);
});

test("the colour memo recomputes the same text when a tool appears", () => {
  const tools: Target[] = [];
  let toolsVersion = 0;
  const live: Catalogs = {
    ...catalogs,
    get tools() {
      return tools;
    },
    get toolsVersion() {
      return toolsVersion;
    },
  };
  const spansForLines = spansForLinesFactory(live, settings);

  assert.deepEqual(spansForLines(["%late"])[0], [{ start: 0, end: 5, role: "warning" }]);

  tools.push({ class: "tool", label: "late", name: "late" });
  toolsVersion++;

  assert.deepEqual(spansForLines(["%late"])[0], [{ start: 0, end: 5, role: "accent" }]);
});
