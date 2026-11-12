import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, type TriggerSpec } from "../src/core/grammar.ts";
import { resolve } from "../src/core/resolve.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Settings } from "../src/core/types.ts";

const SPECS: TriggerSpec[] = [
  { class: "skill", trigger: "$" },
  { class: "path", trigger: "@" },
  { class: "tool", trigger: "%" },
  { class: "role", trigger: "&" },
];

const paths = new Set(["src/foo.ts", "my notes/today.md"]);
const catalogs: Catalogs = {
  skills: [
    { class: "skill", label: "tdd" },
    { class: "skill", label: "code-review" },
  ],
  tools: [
    { class: "tool", label: "bash", name: "bash" },
    {
      class: "tool",
      label: "kagi:kagi_search_fetch",
      name: "mcp__kagi__kagi_search_fetch",
    },
  ],
  roles: [{ class: "role", label: "general" }],
  paths: { has: (label) => paths.has(label) },
};

function resolveText(text: string, settings: Settings = defaultSettings()) {
  const { mentions } = parse(text, SPECS);
  return resolve(mentions, catalogs, settings);
}

test("a resolving mention is narrowed to the longest eligible prefix", () => {
  const [resolved] = resolveText("$tdd?");
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.mention.span.end, 4);
  assert.equal(resolved?.target?.label, "tdd");
});

test("a non-resolving mention stays the whole token", () => {
  const [resolved] = resolveText("$tddfoo");
  assert.equal(resolved?.status, "unresolved");
  assert.equal(resolved?.mention.label, "tddfoo");
  assert.equal(resolved?.target, undefined);
});

test("a tool label resolves a server chain and a trailing comma stays prose", () => {
  const [resolved] = resolveText("%bash, please");
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.mention.span.end, 5);
  assert.equal(resolved?.target?.name, "bash");

  const [chain] = resolveText("%kagi:kagi_search_fetch");
  assert.equal(chain?.status, "resolved");
  assert.equal(chain?.target?.name, "mcp__kagi__kagi_search_fetch");
});

test("a role resolves exactly", () => {
  const [resolved] = resolveText("&general summarise this");
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.mention.span.end, 8);
});

test("a path resolves when the file exists and narrows trailing punctuation", () => {
  const [resolved] = resolveText("@src/foo.ts.");
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.mention.label, "src/foo.ts");
  assert.equal(resolved?.mention.span.end, 11);
});

test("a quoted path resolves with its spaces", () => {
  const [resolved] = resolveText('@"my notes/today.md"');
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.mention.label, "my notes/today.md");
});

test("an unresolved path keeps the whole token", () => {
  const [resolved] = resolveText("@docs/nope.md");
  assert.equal(resolved?.status, "unresolved");
  assert.equal(resolved?.mention.label, "docs/nope.md");
});

test("an excluded target is excluded, not unresolved", () => {
  const settings = defaultSettings();
  settings.exclude.skills = ["tdd"];
  const [resolved] = resolveText("$tdd", settings);
  assert.equal(resolved?.status, "excluded");
  assert.equal(resolved?.target?.label, "tdd");
});

test("paths are not treated as expandable exclusions", () => {
  const settings = defaultSettings();
  settings.exclude.skills = ["src/foo.ts"];
  const [resolved] = resolveText("@src/foo.ts", settings);
  assert.equal(resolved?.status, "resolved");
});

test("a trailing colon is an incomplete tool chain, never a peeled server", () => {
  const [resolved] = resolveText("%bash:");
  assert.equal(resolved?.status, "unresolved");
  assert.equal(resolved?.mention.label, "bash:");
});

test("only the first resolving skill expands; later skills are unresolved", () => {
  const resolved = resolveText("$tdd $code-review");
  assert.deepEqual(
    resolved.map((mention) => mention.status),
    ["resolved", "unresolved"],
  );
});

test("an unresolved first skill leaves the next skill eligible", () => {
  const resolved = resolveText("$nope $tdd");
  assert.deepEqual(
    resolved.map((mention) => mention.status),
    ["unresolved", "resolved"],
  );
});
