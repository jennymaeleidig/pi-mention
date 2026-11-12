import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "../src/core/settings.ts";
import {
  findPickerToken,
  orderMatches,
  rankTargets,
  type RankingOptions,
} from "../src/core/picker.ts";
import type { SelectionRecord } from "../src/core/selection.ts";
import type { Target } from "../src/core/types.ts";

const settings = defaultSettings();
const specs = [
  { class: "skill" as const, trigger: settings.triggers.skill },
  { class: "tool" as const, trigger: settings.triggers.tool },
  { class: "role" as const, trigger: settings.triggers.role },
];

const token = (text: string) => findPickerToken(text, specs);

test("a bare trigger opens its class with an empty query", () => {
  assert.deepEqual(token("$"), {
    class: "skill",
    trigger: "$",
    query: "",
    prefix: "$",
    start: 0,
  });
  assert.deepEqual(token("see %"), {
    class: "tool",
    trigger: "%",
    query: "",
    prefix: "%",
    start: 4,
  });
  assert.deepEqual(token("&"), {
    class: "role",
    trigger: "&",
    query: "",
    prefix: "&",
    start: 0,
  });
});

test("the token carries the typed label and its full prefix", () => {
  assert.deepEqual(token("$co"), {
    class: "skill",
    trigger: "$",
    query: "co",
    prefix: "$co",
    start: 0,
  });
  assert.deepEqual(token("(%read"), {
    class: "tool",
    trigger: "%",
    query: "read",
    prefix: "%read",
    start: 1,
  });
  assert.deepEqual(token("&general")?.query, "general");
});

test("the tool chain keeps its server prefix, including a trailing colon", () => {
  assert.equal(token("%kagi:kagi_")?.query, "kagi:kagi_");
  assert.equal(token("%kagi:")?.query, "kagi:");
  assert.equal(token("%a:b:c"), undefined);
});

test("trigger boundaries, escapes, code and punctuation close the picker", () => {
  assert.equal(token("x$"), undefined);
  assert.equal(token("100%"), undefined);
  assert.equal(token("\\$PATH"), undefined);
  assert.equal(token("`$tdd`"), undefined);
  assert.equal(token("$tdd?"), undefined);
  assert.equal(token("%bash,"), undefined);
  assert.equal(token('$"my skill"'), undefined);
  assert.equal(token("$tdd "), undefined);
});

test("source order and alphabetical follow the configured strategy", () => {
  const targets: Target[] = [
    { class: "skill", label: "b" },
    { class: "skill", label: "a" },
    { class: "skill", label: "c" },
  ];
  const options = (strategy: RankingOptions["strategy"]): RankingOptions => ({
    strategy,
    pinned: [],
    projectFirst: false,
    history: {},
    now: 0,
  });

  assert.deepEqual(
    rankTargets(targets, options("sourceOrder")).map((target) => target.label),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    rankTargets(targets, options("alphabetical")).map((target) => target.label),
    ["a", "b", "c"],
  );
});

test("pinned entries come first in configured order, by label or registered name", () => {
  const targets: Target[] = [
    { class: "skill", label: "a" },
    { class: "tool", label: "kagi:search", name: "mcp__kagi__search" },
    { class: "skill", label: "b" },
  ];
  const ranked = rankTargets(targets, {
    strategy: "alphabetical",
    pinned: ["b", "mcp__kagi__search", "missing"],
    projectFirst: false,
    history: {},
    now: 0,
  });
  assert.deepEqual(
    ranked.map((target) => target.label),
    ["b", "kagi:search", "a"],
  );
});

test("project-first is a tier after pinned and survives alphabetical", () => {
  const targets: Target[] = [
    { class: "skill", label: "user-a", scope: "user" },
    { class: "skill", label: "project-z", scope: "project" },
    { class: "skill", label: "project-b", scope: "project" },
    { class: "skill", label: "pinned", scope: "user" },
  ];
  const ranked = rankTargets(targets, {
    strategy: "alphabetical",
    pinned: ["pinned"],
    projectFirst: true,
    history: {},
    now: 0,
  });
  assert.deepEqual(
    ranked.map((target) => target.label),
    ["pinned", "project-b", "project-z", "user-a"],
  );
});

test("recent, frequent and frecency use the selection history", () => {
  const targets: Target[] = [
    { class: "skill", label: "a" },
    { class: "skill", label: "b" },
    { class: "skill", label: "c" },
  ];
  const day = 86_400_000;
  const history: Record<string, SelectionRecord> = {
    a: { count: 2, lastSelectedAt: 10 },
    b: { count: 2, lastSelectedAt: 20 },
    c: { count: 1, lastSelectedAt: 30 },
  };
  const options = (strategy: RankingOptions["strategy"]): RankingOptions => ({
    strategy,
    pinned: [],
    projectFirst: false,
    history,
    now: 300 * day,
  });

  assert.deepEqual(
    rankTargets(targets, options("recent")).map((target) => target.label),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    rankTargets(targets, options("frequent")).map((target) => target.label),
    ["b", "a", "c"],
  );

  const frecencyHistory: Record<string, SelectionRecord> = {
    a: { count: 2, lastSelectedAt: 300 * day - 60 * day },
    b: { count: 1, lastSelectedAt: 300 * day },
    c: { count: 1, lastSelectedAt: 300 * day - 30 * day },
  };
  assert.deepEqual(
    rankTargets(targets, { ...options("frecency"), history: frecencyHistory }).map(
      (target) => target.label,
    ),
    ["b", "a", "c"],
  );
});

test("selection history is keyed by the stable registered name first", () => {
  const targets: Target[] = [
    { class: "tool", label: "kagi:search", name: "mcp__kagi__search" },
    { class: "tool", label: "bash", name: "bash" },
  ];
  const ranked = rankTargets(targets, {
    strategy: "frequent",
    pinned: [],
    projectFirst: false,
    history: {
      mcp__kagi__search: { count: 5, lastSelectedAt: 10 },
      "kagi:search": { count: 1, lastSelectedAt: 20 },
    },
    now: 0,
  });
  assert.deepEqual(
    ranked.map((target) => target.label),
    ["kagi:search", "bash"],
  );
});

test("a fuzzy result list keeps pinned and project-first tiers", () => {
  const targets: Target[] = [
    { class: "skill", label: "user-a", scope: "user" },
    { class: "skill", label: "project-b", scope: "project" },
    { class: "skill", label: "pinned", scope: "user" },
  ];

  assert.deepEqual(
    orderMatches(targets, { pinned: ["pinned"], projectFirst: false }).map(
      (target) => target.label,
    ),
    ["pinned", "user-a", "project-b"],
  );
  assert.deepEqual(
    orderMatches(targets, { pinned: ["pinned"], projectFirst: true }).map((target) => target.label),
    ["pinned", "project-b", "user-a"],
  );
});
