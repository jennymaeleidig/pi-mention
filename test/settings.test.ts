import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, FOREGROUND_ROLES, loadSettings } from "../src/core/settings.ts";
import type { Diagnostic } from "../src/core/types.ts";

const keys = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.key).sort();

test("an absent piMention yields every code default and no diagnostics", () => {
  const { settings, diagnostics } = loadSettings(undefined);
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(diagnostics, []);
});

test("a non-object piMention falls back to every default with one diagnostic", () => {
  for (const raw of [null, "nope", 42, ["skill"]]) {
    const { settings, diagnostics } = loadSettings(raw);
    assert.deepEqual(settings, DEFAULT_SETTINGS, `raw: ${JSON.stringify(raw)}`);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.key, "piMention");
    assert.match(diagnostics[0]?.message ?? "", /piMention must be an object/);
  }
});

test("a partial object deep-merges, keeping defaults for every missing field", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { skill: "!" },
    ranking: { strategy: "alphabetical", pinned: { skills: ["tdd"] } },
    colors: { tool: "syntaxString" },
    url: { sourceExtensions: [".md"] },
  });

  assert.deepEqual(settings.triggers, { skill: "!", tool: "%", role: "&" });
  assert.equal(settings.completionSuffix, DEFAULT_SETTINGS.completionSuffix);
  assert.equal(settings.hideSlashSkills, DEFAULT_SETTINGS.hideSlashSkills);
  assert.equal(settings.ranking.strategy, "alphabetical");
  assert.deepEqual(settings.ranking.pinned.skills, ["tdd"]);
  assert.deepEqual(settings.ranking.pinned.tools, []);
  assert.deepEqual(settings.ranking.pinned.roles, []);
  assert.equal(settings.ranking.projectSkillsFirst, false);
  assert.equal(settings.colors.tool, "syntaxString");
  assert.equal(settings.colors.skill, DEFAULT_SETTINGS.colors.skill);
  assert.deepEqual(settings.url.sourceExtensions, [".md"]);
  assert.deepEqual(diagnostics, []);
});

test("one invalid leaf falls back alone and does not reject the rest", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { skill: "!" },
    completionSuffix: 3,
    hideSlashSkills: "yes",
    ranking: {
      strategy: "sideways",
      pinned: { tools: ["bash", 2] },
      projectSkillsFirst: "no",
    },
    exclude: { roles: "general" },
    colors: { tool: 42, role: "accentBg" },
    url: { sourceExtensions: [".md", 1] },
  });

  assert.equal(settings.triggers.skill, "!");
  assert.equal(settings.completionSuffix, DEFAULT_SETTINGS.completionSuffix);
  assert.equal(settings.hideSlashSkills, DEFAULT_SETTINGS.hideSlashSkills);
  assert.equal(settings.ranking.strategy, "frecency");
  assert.deepEqual(settings.ranking.pinned.tools, []);
  assert.equal(settings.ranking.projectSkillsFirst, false);
  assert.deepEqual(settings.exclude.roles, []);
  assert.equal(settings.colors.tool, "accent");
  assert.equal(settings.colors.role, "success");
  assert.deepEqual(settings.url.sourceExtensions, DEFAULT_SETTINGS.url.sourceExtensions);

  assert.deepEqual(keys(diagnostics), [
    "piMention.colors.role",
    "piMention.colors.tool",
    "piMention.completionSuffix",
    "piMention.exclude.roles",
    "piMention.hideSlashSkills",
    "piMention.ranking.pinned.tools",
    "piMention.ranking.projectSkillsFirst",
    "piMention.ranking.strategy",
    "piMention.url.sourceExtensions",
  ]);
  for (const diagnostic of diagnostics) {
    assert.match(diagnostic.message, new RegExp(diagnostic.key.replaceAll(".", "\\.")));
    assert.match(diagnostic.message, /using/);
  }
});

test("a malformed nested object falls back only that subtree", () => {
  const { settings, diagnostics } = loadSettings({
    colors: "bright",
    triggers: { skill: "!" },
    hideSlashSkills: false,
  });

  assert.deepEqual(settings.colors, DEFAULT_SETTINGS.colors);
  assert.equal(settings.triggers.skill, "!");
  assert.equal(settings.hideSlashSkills, false);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.key, "piMention.colors");
});

test("trigger overrides accept valid single characters", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { skill: "!", tool: "^", role: "?" },
  });
  assert.deepEqual(settings.triggers, { skill: "!", tool: "^", role: "?" });
  assert.deepEqual(diagnostics, []);
});

test("an invalid trigger falls back to its default with one diagnostic", () => {
  for (const value of ["ab", " ", "/", "\\", "`", "😀", "", 7]) {
    const { settings, diagnostics } = loadSettings({ triggers: { skill: value } });
    assert.equal(settings.triggers.skill, "$", `value: ${JSON.stringify(value)}`);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.key, "piMention.triggers.skill");
  }
});

test("a custom trigger equal to another class's default falls back to its own default", () => {
  for (const [input, key] of [
    [{ skill: "%" }, "piMention.triggers.skill"],
    [{ tool: "$" }, "piMention.triggers.tool"],
  ] as const) {
    const { settings, diagnostics } = loadSettings({ triggers: input });
    assert.deepEqual(settings.triggers, DEFAULT_SETTINGS.triggers, JSON.stringify(input));
    assert.deepEqual(keys(diagnostics), [key]);
  }
});

test("colliding custom triggers fall back without inventing a character", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { skill: "!", tool: "!", role: "?" },
  });

  assert.deepEqual(settings.triggers, { skill: "!", tool: "%", role: "?" });
  assert.deepEqual(keys(diagnostics), ["piMention.triggers.tool"]);
  assert.equal(new Set(Object.values(settings.triggers)).size, 3);
});

test("all three valid custom triggers are accepted when distinct", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { skill: "!", tool: "^", role: "?" },
  });

  assert.deepEqual(settings.triggers, { skill: "!", tool: "^", role: "?" });
  assert.deepEqual(diagnostics, []);
});

test("the path trigger has no setting and stays out of Settings", () => {
  const { settings, diagnostics } = loadSettings({ triggers: { path: "!" } });
  assert.deepEqual(settings.triggers, DEFAULT_SETTINGS.triggers);
  assert.equal("path" in settings.triggers, false);
  assert.deepEqual(diagnostics, []);
});

test("the three class triggers cannot claim the reserved path character", () => {
  const { settings, diagnostics } = loadSettings({ triggers: { skill: "@" } });
  assert.equal(settings.triggers.skill, "$");
  assert.deepEqual(keys(diagnostics), ["piMention.triggers.skill"]);
});

test("every documented ranking strategy is accepted", () => {
  for (const strategy of ["frecency", "recent", "frequent", "alphabetical", "sourceOrder"]) {
    const { settings, diagnostics } = loadSettings({ ranking: { strategy } });
    assert.equal(settings.ranking.strategy, strategy);
    assert.deepEqual(diagnostics, []);
  }
});

test("pinned and exclude lists accept strings and reject mixed arrays", () => {
  const valid = loadSettings({
    ranking: { pinned: { skills: ["b", "a"], tools: ["bash"] } },
    exclude: { skills: ["tdd"], tools: ["mcp__kagi__search"], roles: ["general"] },
  });
  assert.deepEqual(valid.settings.ranking.pinned.skills, ["b", "a"]);
  assert.deepEqual(valid.settings.ranking.pinned.tools, ["bash"]);
  assert.deepEqual(valid.settings.exclude.skills, ["tdd"]);
  assert.deepEqual(valid.settings.exclude.tools, ["mcp__kagi__search"]);
  assert.deepEqual(valid.settings.exclude.roles, ["general"]);
  assert.deepEqual(valid.diagnostics, []);

  const invalid = loadSettings({
    ranking: { pinned: { skills: "tdd" } },
    exclude: { roles: ["general", 1] },
  });
  assert.deepEqual(invalid.settings.ranking.pinned.skills, []);
  assert.deepEqual(invalid.settings.exclude.roles, []);
  assert.deepEqual(keys(invalid.diagnostics), [
    "piMention.exclude.roles",
    "piMention.ranking.pinned.skills",
  ]);
});

test("colour overrides must be pi foreground theme roles", () => {
  const valid = loadSettings({
    colors: { skill: "syntaxKeyword", path: "accent", url: "mdLinkUrl" },
  });
  assert.equal(valid.settings.colors.skill, "syntaxKeyword");
  assert.equal(valid.settings.colors.path, "accent");
  assert.equal(valid.settings.colors.url, "mdLinkUrl");
  assert.deepEqual(valid.diagnostics, []);

  const invalid = loadSettings({
    colors: { skill: "syntaxKeywordBg", path: "notAThemeRole", role: 5 },
  });
  assert.equal(invalid.settings.colors.skill, "syntaxNumber");
  assert.equal(invalid.settings.colors.path, "mdLinkUrl");
  assert.equal(invalid.settings.colors.role, "success");
  assert.deepEqual(keys(invalid.diagnostics), [
    "piMention.colors.path",
    "piMention.colors.role",
    "piMention.colors.skill",
  ]);
});

test("every default colour is a foreground theme role", () => {
  for (const role of Object.values(DEFAULT_SETTINGS.colors)) {
    assert.ok(FOREGROUND_ROLES.has(role), role);
  }
});

test("unknown keys are ignored without changing behaviour or warning", () => {
  const { settings, diagnostics } = loadSettings({
    triggers: { path: "!", extra: "$" },
    colors: { cursor: "accent" },
    surprise: { enabled: true },
  });
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(diagnostics, []);
});

test("boolean and string fields validate individually", () => {
  const valid = loadSettings({ completionSuffix: "", hideSlashSkills: false });
  assert.equal(valid.settings.completionSuffix, "");
  assert.equal(valid.settings.hideSlashSkills, false);
  assert.deepEqual(valid.diagnostics, []);

  const invalid = loadSettings({ completionSuffix: null, hideSlashSkills: 0 });
  assert.equal(invalid.settings.completionSuffix, DEFAULT_SETTINGS.completionSuffix);
  assert.equal(invalid.settings.hideSlashSkills, DEFAULT_SETTINGS.hideSlashSkills);
  assert.deepEqual(keys(invalid.diagnostics), [
    "piMention.completionSuffix",
    "piMention.hideSlashSkills",
  ]);
});
