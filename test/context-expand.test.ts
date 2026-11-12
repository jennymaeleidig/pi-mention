import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expandContextMessages,
  type ContextMessage,
  type ContextPart,
} from "../src/core/context-expand.ts";
import { buildSkillBlock } from "../src/core/skill-expand.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Settings, Target } from "../src/core/types.ts";
import { dispatch, noTask } from "./fixtures/role-text.ts";

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

const toolCatalogs: Catalogs = {
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

const roleCatalogs: Catalogs = {
  skills: [],
  tools: [],
  roles: [
    { class: "role", label: "general", name: "general", description: "General-purpose subagent." },
    { class: "role", label: "review", name: "review", description: "Review work." },
  ],
  paths: { has: () => false, probe: () => {} },
};

const bothCatalogs: Catalogs = { ...toolCatalogs, roles: roleCatalogs.roles };

const directLine = `- \`read\` — call it directly. Signature: ${READ_SIGNATURE}`;
const indirectLine =
  "- `mcp__kagi__kagi_search_fetch` (kagi) — not declared to you. " +
  "Reach it inside a codemode script: " +
  "`await tools.mcp__kagi__kagi_search_fetch(...)`. " +
  `Signature: ${KAGI_SIGNATURE}`;

function block(...lines: string[]): string {
  return `<tool_mentions>\n${lines.join("\n")}\n</tool_mentions>`;
}

const user = (content: string | readonly ContextPart[]): ContextMessage => ({
  role: "user",
  content,
});

/** One user message through the context seam; an unchanged message returns as written. */
function expanded(
  text: string,
  settings: Settings = defaultSettings(),
  live: Catalogs = toolCatalogs,
): { text: string } {
  const next = expandContextMessages([user(text)], live, settings);
  return { text: next ? (next[0]?.content as string) : text };
}

function parts(
  content: readonly ContextPart[],
  settings: Settings = defaultSettings(),
  live: Catalogs = bothCatalogs,
): ContextMessage | undefined {
  return expandContextMessages([user(content)], live, settings)?.[0];
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

  const toolSearchOnly: Catalogs = { ...toolCatalogs, tools: [read] };
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

const skillBlock = buildSkillBlock({
  name: "tdd",
  location: "/abs/tdd/SKILL.md",
  baseDir: "/abs/tdd",
  body: "# TDD",
})!;

function roleExpanded(
  text: string,
  settings: Settings = defaultSettings(),
  live: Catalogs = roleCatalogs,
): { text: string } {
  const next = expandContextMessages([user(text)], live, settings);
  return { text: next ? (next[0]?.content as string) : text };
}

test("a leading role with a task becomes the dispatch instruction", () => {
  assert.deepEqual(roleExpanded("&general summarise this"), {
    text: dispatch("general", "summarise this"),
  });
  assert.equal(
    roleExpanded("  &general summarise this").text,
    dispatch("general", "summarise this").replace(/^/, "  "),
  );
});

test("a leading role with no task asks instead of emitting a malformed call", () => {
  assert.deepEqual(roleExpanded("&general"), { text: noTask("general") });
  assert.deepEqual(roleExpanded("&general   "), { text: noTask("general") });
  for (const punctuation of [",", ".", "!", ";", ",.;:!?)]}"]) {
    assert.deepEqual(roleExpanded(`&general${punctuation}`), { text: noTask("general") });
  }
});

test("punctuation after a leading role is stripped from a real task", () => {
  assert.deepEqual(roleExpanded("&general, do it"), {
    text: dispatch("general", "do it"),
  });
  assert.deepEqual(roleExpanded("&general:  do it"), {
    text: dispatch("general", "do it"),
  });
});

test("only the first non-whitespace role mention expands", () => {
  assert.deepEqual(roleExpanded("please &general summarise this"), {
    text: "please &general summarise this",
  });
  assert.deepEqual(roleExpanded("%read &general summarise this"), {
    text: "%read &general summarise this",
  });
  assert.deepEqual(roleExpanded("&general x &general y"), {
    text: dispatch("general", "x &general y"),
  });
});

test("unknown and excluded roles stay literal; an escaped role loses its escape", () => {
  assert.deepEqual(roleExpanded("&nope summarise this"), { text: "&nope summarise this" });

  const excluded = defaultSettings();
  excluded.exclude.roles = ["general"];
  assert.deepEqual(roleExpanded("&general summarise this", excluded), {
    text: "&general summarise this",
  });
  assert.deepEqual(roleExpanded("\\&general summarise this"), {
    text: "&general summarise this",
  });
});

test("a leading role after the native skill block expands and the block stays opaque", () => {
  assert.deepEqual(roleExpanded(`${skillBlock}\n\n&general do it`), {
    text: `${skillBlock}\n\n${dispatch("general", "do it")}`,
  });
  assert.deepEqual(roleExpanded(`${skillBlock}\n\nplease &general do it`), {
    text: `${skillBlock}\n\nplease &general do it`,
  });

  const opaque = buildSkillBlock({
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    baseDir: "/abs/tdd",
    body: "&general do not expand me",
  })!;
  assert.deepEqual(roleExpanded(opaque), { text: opaque });
});

test("an unterminated skill block has no prose start", () => {
  const open = skillBlock.slice(0, skillBlock.indexOf("\n\n"));
  assert.deepEqual(roleExpanded(`${open}\n\n&general do it`), {
    text: `${open}\n\n&general do it`,
  });
});

test("code mentions and prose without a leading role are unchanged", () => {
  assert.deepEqual(roleExpanded("```\n&general do it\n```"), {
    text: "```\n&general do it\n```",
  });
  assert.deepEqual(roleExpanded("`&general` do it"), { text: "`&general` do it" });
  assert.deepEqual(roleExpanded("plain prose"), { text: "plain prose" });
});

test("tool and role expansion compose in one message", () => {
  assert.equal(
    expanded("&general use %read", defaultSettings(), bothCatalogs).text,
    `${dispatch("general", "use `read`")}\n\n${block(directLine)}`,
  );
});

test("a multi-part message gets one block after its last text part", () => {
  const result = parts([
    { type: "text", text: "%read one" },
    { type: "image", data: "abc", mimeType: "image/png" } as ContextPart,
    { type: "text", text: "%kagi:kagi_search_fetch two" },
  ]);
  assert.ok(result);
  assert.deepEqual(result.content, [
    { type: "text", text: "`read` one" },
    { type: "image", data: "abc", mimeType: "image/png" } as ContextPart,
    {
      type: "text",
      text:
        "`mcp__kagi__kagi_search_fetch` two\n\n<tool_mentions>\n" +
        `${directLine}\n${indirectLine}\n</tool_mentions>`,
    },
  ]);
});

test("only the first prose part may lead with a role", () => {
  const result = parts([
    { type: "text", text: "&general do it" },
    { type: "text", text: "&general again" },
  ]);
  assert.ok(result);
  assert.deepEqual(result.content, [
    { type: "text", text: dispatch("general", "do it") },
    { type: "text", text: "&general again" },
  ]);
});

test("an unchanged multi-part message returns undefined", () => {
  assert.equal(
    expandContextMessages(
      [
        user([
          { type: "text", text: "plain prose" },
          { type: "image", data: "x", mimeType: "image/png" } as ContextPart,
        ]),
      ],
      bothCatalogs,
      defaultSettings(),
    ),
    undefined,
  );
});
