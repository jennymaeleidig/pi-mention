import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, type TriggerSpec } from "../src/core/grammar.ts";
import { pathCandidates, resolve } from "../src/core/resolve.ts";
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

test("path candidates are the full label followed by punctuation-only prefixes", () => {
  assert.deepEqual(pathCandidates("a.b.."), ["a.b..", "a.b.", "a.b"]);
  assert.deepEqual(pathCandidates("src/foo.ts"), ["src/foo.ts"]);
});

test("a resolving path mention is narrowed to the longest eligible prefix", () => {
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

test("tool exclusions match the registered name as well as the label", () => {
  const byName = defaultSettings();
  byName.exclude.tools = ["mcp__kagi__kagi_search_fetch"];
  const [chain] = resolveText("%kagi:kagi_search_fetch", byName);
  assert.equal(chain?.status, "excluded");
  assert.equal(chain?.target?.label, "kagi:kagi_search_fetch");

  const byLabel = defaultSettings();
  byLabel.exclude.tools = ["bash"];
  assert.equal(resolveText("%bash", byLabel)[0]?.status, "excluded");
});

test("skill and role exclusions use the label only", () => {
  const settings = defaultSettings();
  settings.exclude.skills = ["skill:tdd"];
  assert.equal(resolveText("$tdd", settings)[0]?.status, "resolved");

  settings.exclude.skills = ["tdd"];
  assert.equal(resolveText("$tdd", settings)[0]?.status, "excluded");

  settings.exclude.roles = ["general"];
  assert.equal(resolveText("&general", settings)[0]?.status, "excluded");
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

test("every skill mention resolves on its own; eligibility is expansion's concern", () => {
  const resolved = resolveText("$tdd $code-review");
  assert.deepEqual(
    resolved.map((mention) => mention.status),
    ["resolved", "resolved"],
  );
});

test("an unresolved first skill does not hide a later resolving skill", () => {
  const resolved = resolveText("$nope $tdd");
  assert.deepEqual(
    resolved.map((mention) => mention.status),
    ["unresolved", "resolved"],
  );
});
