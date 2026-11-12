import assert from "node:assert/strict";
import { test } from "node:test";
import { expandTools, buildSkillBlock } from "../src/core/expand.ts";
import { parse, triggerSpecs } from "../src/core/grammar.ts";
import { resolve } from "../src/core/resolve.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Settings, Target } from "../src/core/types.ts";

const READ_SIGNATURE = "read(args: unknown): Promise<unknown>;";
const KAGI_SIGNATURE =
  "mcp__kagi__kagi_search_fetch(args: { limit?: number; query: string; }): Promise<unknown>;";

const read: Target = {
  class: "tool",
  label: "read",
  name: "read",
  reach: "direct",
  signature: READ_SIGNATURE,
};

const kagi: Target = {
  class: "tool",
  label: "kagi:kagi_search_fetch",
  name: "mcp__kagi__kagi_search_fetch",
  server: "kagi",
  reach: "indirect",
  identifier: "mcp__kagi__kagi_search_fetch",
  signature: KAGI_SIGNATURE,
};

function direct(label: string): Target {
  return {
    class: "tool",
    label,
    name: label,
    reach: "direct",
    signature: `${label}(args: unknown): Promise<unknown>;`,
  };
}

function indirect(label: string, identifier = label): Target {
  return {
    class: "tool",
    label,
    name: label,
    reach: "indirect",
    identifier,
    signature: `${label}(args: unknown): Promise<unknown>;`,
  };
}

const modelOnly = direct("model-only");
const activeCodemode = direct("codemode");
const activeDeferred = direct("deferred-tool");
const inactiveCodemode = indirect("inactive-code", "inactive_code");
const inactiveDeferred = indirect("inactive-deferred", "inactive_deferred");

const catalogs: Catalogs = {
  skills: [],
  tools: [
    read,
    kagi,
    modelOnly,
    activeCodemode,
    activeDeferred,
    inactiveCodemode,
    inactiveDeferred,
  ],
  roles: [],
  paths: { has: () => false, probe: () => {} },
};

const directLine = `- \`read\` — call it directly. Signature: ${READ_SIGNATURE}`;
const indirectLine =
  "- `mcp__kagi__kagi_search_fetch` (kagi) — not declared to you. " +
  "Reach it inside a codemode script: " +
  "`await tools.mcp__kagi__kagi_search_fetch(...)`. " +
  `Signature: ${KAGI_SIGNATURE}`;

function block(...lines: string[]): string {
  return `<tool_mentions>\n${lines.join("\n")}\n</tool_mentions>`;
}

function expanded(text: string, settings: Settings = defaultSettings(), live: Catalogs = catalogs) {
  const { mentions } = parse(text, triggerSpecs(settings));
  const resolved = resolve(
    mentions.filter((mention) => mention.class === "tool"),
    live,
    settings,
  );
  return expandTools(text, resolved, live);
}

const lineFor = (label: string) =>
  `- \`${label}\` — call it directly. Signature: ${label}(args: unknown): Promise<unknown>;`;

const routingRows = [
  { input: "%read", inline: "`read`", line: directLine },
  { input: "%model-only", inline: "`model-only`", line: lineFor("model-only") },
  { input: "%codemode", inline: "`codemode`", line: lineFor("codemode") },
  { input: "%deferred-tool", inline: "`deferred-tool`", line: lineFor("deferred-tool") },
  {
    input: "%inactive-code",
    inline: "`inactive-code`",
    line:
      "- `inactive-code` — not declared to you. " +
      "Reach it inside a codemode script: `await tools.inactive_code(...)`. " +
      "Signature: inactive-code(args: unknown): Promise<unknown>;",
  },
  {
    input: "%inactive-deferred",
    inline: "`inactive-deferred`",
    line:
      "- `inactive-deferred` — not declared to you. " +
      "Reach it inside a codemode script: `await tools.inactive_deferred(...)`. " +
      "Signature: inactive-deferred(args: unknown): Promise<unknown>;",
  },
];

for (const row of routingRows) {
  test(`routing row ${row.input} has exact model text`, () => {
    assert.equal(expanded(row.input).text, `${row.inline}\n\n${block(row.line)}`);
  });
}

test("a direct tool is replaced by its registered name and gets the direct line", () => {
  assert.equal(expanded("%read list files").text, "`read` list files\n\n" + block(directLine));
});

test("an indirect MCP tool is replaced by its registered name and gets the indirect line", () => {
  assert.equal(
    expanded("%kagi:kagi_search_fetch cats").text,
    "`mcp__kagi__kagi_search_fetch` cats\n\n" + block(indirectLine),
  );
});

test("every mention is replaced, but a repeated target is listed once", () => {
  assert.equal(expanded("%read %read").text, "`read` `read`\n\n" + block(directLine));
});

test("entries follow first occurrence and each distinct target is listed once", () => {
  assert.equal(
    expanded("%kagi:kagi_search_fetch %read %kagi:kagi_search_fetch").text,
    "`mcp__kagi__kagi_search_fetch` `read` `mcp__kagi__kagi_search_fetch`\n\n" +
      block(indirectLine, directLine),
  );
});

test("punctuation stays outside the replaced mention", () => {
  assert.equal(expanded("%read, please").text, "`read`, please\n\n" + block(directLine));
});

test("the block follows prose after a skill block and the skill block stays opaque", () => {
  const skillBlock = buildSkillBlock({
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    baseDir: "/abs/tdd",
    body: "# TDD",
  });
  assert.ok(skillBlock);

  assert.equal(
    expanded(`${skillBlock}\n\n%read this`).text,
    `${skillBlock}\n\n\`read\` this\n\n${block(directLine)}`,
  );

  const opaque = `${skillBlock?.replace("# TDD", "Keep %read in the body.")}`;
  assert.equal(expanded(`${opaque}\n\nprose`).text, `${opaque}\n\nprose`);
});

test("unresolved, hidden, tool_search-only, excluded and code mentions stay literal", () => {
  assert.equal(expanded("%nope").text, "%nope");
  assert.equal(expanded("%hidden").text, "%hidden");
  assert.equal(expanded("`%read`").text, "`%read`");
  assert.equal(expanded("```\n%read\n```").text, "```\n%read\n```");

  // The deferred MCP tool is absent when tool_search is the only reacher: that
  // route would activate it, so the catalog never offers it.
  const toolSearchOnly: Catalogs = { ...catalogs, tools: [read] };
  assert.equal(
    expanded("%kagi:kagi_search_fetch", defaultSettings(), toolSearchOnly).text,
    "%kagi:kagi_search_fetch",
  );

  const excluded = defaultSettings();
  excluded.exclude.tools = ["read"];
  assert.equal(expanded("%read", excluded).text, "%read");
});

test("a message without a resolved tool mention is unchanged", () => {
  assert.deepEqual(expanded("plain prose"), { text: "plain prose" });
  assert.deepEqual(expanded("%nope please"), { text: "%nope please" });
});
