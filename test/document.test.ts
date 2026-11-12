import assert from "node:assert/strict";
import { test } from "node:test";
import { mentionDocument } from "../src/core/document.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs } from "../src/core/types.ts";
import { detectUrls } from "../src/pi/catalogs/urls.ts";

const catalogs: Catalogs = {
  skills: [{ class: "skill", label: "wayfinder" }],
  tools: [{ class: "tool", label: "read", name: "read" }],
  roles: [{ class: "role", label: "general" }],
  paths: { has: (label) => label === "docs/mention-grammar.md", probe: () => {} },
};
const settings = defaultSettings();

const colourLines = (text: string, live: Catalogs = catalogs, config = settings) =>
  mentionDocument(text, live, config, { detectUrls }).lines;

test("one document paints every class on one line", () => {
  const text = "$wayfinder %read &general @docs/mention-grammar.md https://example.com";
  const [spans] = colourLines(text);
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

test("unresolved mentions are marked and code is ignored", () => {
  const text = "$unknown `%read` @docs/nope.md";
  const [spans] = colourLines(text);
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
  const [spans] = colourLines(text);
  assert.deepEqual(
    spans?.map((span) => [text.slice(span.start, span.end), span.role]),
    [
      ["$wayfinder", "syntaxNumber"],
      ["$wayfinder", "syntaxNumber"],
    ],
  );
});

test("spans are projected onto the right line", () => {
  const text = "one\n$wayfinder\nthree";
  const lines = colourLines(text);
  assert.deepEqual(lines[0], []);
  assert.deepEqual(lines[1], [{ start: 0, end: 10, role: "syntaxNumber" }]);
  assert.deepEqual(lines[2], []);
});

test("a path label and its punctuation-eligible prefixes are probed", () => {
  const probes: string[] = [];
  const live: Catalogs = {
    ...catalogs,
    paths: { has: () => false, probe: (label) => probes.push(label) },
  };

  colourLines("@src/index.ts,", live);

  assert.deepEqual(probes, ["src/index.ts,", "src/index.ts"]);
});

test("the whole document keeps document-order spans as well as lines", () => {
  const document = mentionDocument("$wayfinder\n$unknown", catalogs, settings, { detectUrls });
  assert.deepEqual(
    document.spans.map((span) => span.role),
    ["syntaxNumber", "warning"],
  );
  assert.equal(document.lines.length, 2);
});
