import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { installContextExpansion } from "../src/pi/context.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Settings } from "../src/core/types.ts";

type Handler = (event: ContextEvent) => ContextEventResult | undefined;

function tool(
  name: string,
  exposure: ToolInfo["exposure"],
  extra: Partial<ToolInfo> = {},
): ToolInfo {
  return {
    name,
    description: name,
    parameters: {},
    exposure,
    sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" },
    ...extra,
  } as ToolInfo;
}

const READ_SIGNATURE = "read(args: unknown): Promise<unknown>;";
const KAGI_SIGNATURE =
  "mcp__kagi__kagi_search_fetch(args: { limit?: number; query: string; }): Promise<unknown>;";

const READ_LINE = `- \`read\` — call it directly. Signature: ${READ_SIGNATURE}`;
const CODEMODE_LINE =
  "- `codemode` — call it directly. Signature: codemode(args: unknown): Promise<unknown>;";
const TOOL_SEARCH_LINE =
  "- `tool_search` — call it directly. Signature: tool_search(args: unknown): Promise<unknown>;";
const KAGI_LINE =
  "- `mcp__kagi__kagi_search_fetch` (kagi) — not declared to you. " +
  "Reach it inside a codemode script: `await tools.mcp__kagi__kagi_search_fetch(...)`. " +
  `Signature: ${KAGI_SIGNATURE}`;
const KAGI_DIRECT_LINE = `- \`mcp__kagi__kagi_search_fetch\` — call it directly. Signature: ${KAGI_SIGNATURE}`;

function kagiTool(): ToolInfo {
  return tool("mcp__kagi__kagi_search_fetch", "deferred", {
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
    namespace: { name: "mcp__kagi", aliases: ["kagi"] },
  });
}

function toolSearchTool(): ToolInfo {
  return tool("tool_search", "model-only", { reachesTools: () => "all" });
}

function defaultTools(): ToolInfo[] {
  return [
    tool("read", "direct"),
    kagiTool(),
    tool("codemode", "model-only", { reachesTools: () => "all" }),
    toolSearchTool(),
  ];
}

function setup(
  tools: ToolInfo[] = defaultTools(),
  active: string[] = ["read", "codemode"],
  context: { cwd?: string; agentDir?: string; settings?: Settings } = {},
) {
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, callback: Handler) => {
      if (name === "context") handler = callback;
      return () => {};
    },
    getAllTools: () => tools,
    getActiveTools: () => active,
  } as unknown as ExtensionAPI;

  installContextExpansion(pi, context.settings ?? defaultSettings(), {
    ...(context.cwd ? { cwd: context.cwd } : {}),
    ...(context.agentDir ? { agentDir: context.agentDir } : {}),
  });

  return (messages: ContextEvent["messages"]) => {
    assert.ok(handler);
    return handler({ type: "context", messages });
  };
}

const user = (content: string) => ({ role: "user" as const, content, timestamp: 0 });

const contents = (messages: ContextEvent["messages"] | undefined) =>
  messages?.map((message) => ("content" in message ? message.content : undefined));

function withRoles(roles: Record<string, string>): {
  cwd: string;
  agentDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "pi-mention-context-roles-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "user");
  const dir = join(cwd, ".pi", "agents");
  mkdirSync(dir, { recursive: true });
  for (const [name, description] of Object.entries(roles)) {
    writeFileSync(
      join(dir, `${name}.md`),
      `---\nname: ${name}\ndescription: ${description}\n---\n`,
    );
  }
  return { cwd, agentDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function dispatch(name: string, task: string): string {
  return (
    `[subagent dispatch: role "${name}"]\n` +
    `Call the \`subagent\` tool now and delegate the rest of this message to the \`${name}\` role. ` +
    `Call it with \`tasks: [{ "agent": "${name}", "task": "<the rest of this message>" }]\`, ` +
    `using the text after this line as the \`task\` brief. ` +
    "Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, " +
    "but keep the user's intent and wording. " +
    `Do not do the task yourself.\n\n${task}`
  );
}

function noTask(name: string): string {
  return (
    `[subagent dispatch: role "${name}"]\n` +
    `The user selected the \`${name}\` role but gave no task. ` +
    `Do not call the \`subagent\` tool. Ask the user what to delegate to \`${name}\`.`
  );
}

test("escaped triggers lose only the backslash in the model-facing message", () => {
  const run = setup();
  const result = run([user("please \\$PATH and \\%bash and \\&general")]);
  assert.deepEqual(contents(result?.messages), ["please $PATH and %bash and &general"]);
});

test("resolved tools become registered names with one model-facing block", () => {
  const run = setup();
  const result = run([user("%read list files")]);
  assert.deepEqual(contents(result?.messages), [
    `\`read\` list files\n\n<tool_mentions>\n${READ_LINE}\n</tool_mentions>`,
  ]);
});

test("active model-only, codemode and deferred tools are direct in the model text", () => {
  const run = setup(defaultTools(), [
    "read",
    "codemode",
    "tool_search",
    "mcp__kagi__kagi_search_fetch",
  ]);
  const result = run([user("%codemode %tool_search %kagi:kagi_search_fetch")]);
  assert.deepEqual(contents(result?.messages), [
    "`codemode` `tool_search` `mcp__kagi__kagi_search_fetch`\n\n<tool_mentions>\n" +
      `${CODEMODE_LINE}\n${TOOL_SEARCH_LINE}\n${KAGI_DIRECT_LINE}\n</tool_mentions>`,
  ]);
});

test("tool_search alone leaves an inactive deferred tool literal but mentions itself", () => {
  const run = setup([kagiTool(), toolSearchTool()], ["tool_search"]);
  assert.equal(run([user("%kagi:kagi_search_fetch cats")]), undefined);

  const result = run([user("%tool_search cats")]);
  assert.deepEqual(contents(result?.messages), [
    `\`tool_search\` cats\n\n<tool_mentions>\n${TOOL_SEARCH_LINE}\n</tool_mentions>`,
  ]);
});

test("%kagi:kagi_search_fetch reaches the registered MCP identifier", () => {
  const run = setup();
  const result = run([user("%kagi:kagi_search_fetch cats")]);
  assert.deepEqual(contents(result?.messages), [
    `\`mcp__kagi__kagi_search_fetch\` cats\n\n<tool_mentions>\n${KAGI_LINE}\n</tool_mentions>`,
  ]);
});

test("the persisted message is not mutated", () => {
  const run = setup();
  const original = [user("%read list files")];
  run(original);
  assert.deepEqual(contents(original), ["%read list files"]);
});

test("code is inert and the native skill block stays opaque while prose expands", () => {
  const run = setup();
  assert.equal(run([user("`%read`")]), undefined);
  assert.equal(run([user("```\n%read\n```")]), undefined);

  const block =
    '<skill name="tdd" location="/abs/tdd/SKILL.md">\n' +
    "References are relative to /abs/tdd.\n\nKeep %read in the body.\n</skill>";
  const result = run([user(`${block}\n\n%read do it`)]);
  assert.deepEqual(contents(result?.messages), [
    `${block}\n\n\`read\` do it\n\n<tool_mentions>\n${READ_LINE}\n</tool_mentions>`,
  ]);
});

test("a message with several text parts gets one block after its last text", () => {
  const run = setup();
  const result = run([
    {
      ...user(""),
      content: [
        { type: "text", text: "%read one" },
        { type: "image", data: "abc", mimeType: "image/png" },
        { type: "text", text: "%kagi:kagi_search_fetch two" },
      ],
    },
  ] as ContextEvent["messages"]);
  const first = result?.messages?.[0];
  const content = first && "content" in first ? first.content : undefined;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content, [
    { type: "text", text: "`read` one" },
    { type: "image", data: "abc", mimeType: "image/png" },
    {
      type: "text",
      text:
        "`mcp__kagi__kagi_search_fetch` two\n\n<tool_mentions>\n" +
        `${READ_LINE}\n${KAGI_LINE}\n</tool_mentions>`,
    },
  ]);
});

test("only user text parts change and a no-op returns no result", () => {
  const run = setup();
  assert.equal(run([user("nothing to unescape")]), undefined);
  assert.equal(
    run([
      { role: "assistant", content: [{ type: "text", text: "\\$PATH" }] },
    ] as ContextEvent["messages"]),
    undefined,
  );

  const result = run([
    {
      ...user(""),
      content: [
        { type: "text", text: "\\$PATH" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    },
  ] as ContextEvent["messages"]);
  const first = result?.messages?.[0];
  const content = first && "content" in first ? first.content : undefined;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], { type: "text", text: "$PATH" });
  assert.deepEqual(content[1], { type: "image", data: "abc", mimeType: "image/png" });
});

test("a leading resolved role becomes the dispatch instruction", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    const original = [user("&general summarise this")];
    const result = run(original);
    assert.deepEqual(contents(result?.messages), [dispatch("general", "summarise this")]);
    assert.deepEqual(contents(original), ["&general summarise this"]);
  } finally {
    roles.cleanup();
  }
});

test("a role with no task asks instead of emitting a malformed call", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    assert.deepEqual(contents(run([user("&general")])?.messages), [noTask("general")]);
  } finally {
    roles.cleanup();
  }
});

test("only the leading role expands, and later roles stay literal", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    assert.equal(run([user("please &general summarise this")]), undefined);
    assert.deepEqual(contents(run([user("&general x &general y")])?.messages), [
      dispatch("general", "x &general y"),
    ]);
  } finally {
    roles.cleanup();
  }
});

test("an unknown or excluded role stays literal while tools still expand", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  const excluded = defaultSettings();
  excluded.exclude.roles = ["general"];
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    assert.deepEqual(contents(run([user("&nope %read do it")])?.messages), [
      `&nope \`read\` do it\n\n<tool_mentions>\n${READ_LINE}\n</tool_mentions>`,
    ]);

    const excludedRun = setup(defaultTools(), ["read", "codemode"], {
      ...roles,
      settings: excluded,
    });
    assert.equal(excludedRun([user("&general summarise this")]), undefined);
  } finally {
    roles.cleanup();
  }
});

test("a role after the native skill block expands, with tools replaced in its task", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  const block =
    '<skill name="tdd" location="/abs/tdd/SKILL.md">\n' +
    "References are relative to /abs/tdd.\n\nKeep %read in the body.\n</skill>";
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    assert.deepEqual(contents(run([user(`${block}\n\n&general %read do it`)])?.messages), [
      `${block}\n\n${dispatch("general", "`read` do it")}\n\n<tool_mentions>\n${READ_LINE}\n</tool_mentions>`,
    ]);
  } finally {
    roles.cleanup();
  }
});

test("a role in a later text part is not leading prose", () => {
  const roles = withRoles({ general: "General-purpose subagent." });
  try {
    const run = setup(defaultTools(), ["read", "codemode"], roles);
    assert.equal(
      run([
        {
          ...user(""),
          content: [
            { type: "text", text: "please" },
            { type: "text", text: "&general summarise this" },
          ],
        },
      ] as ContextEvent["messages"]),
      undefined,
    );

    const block =
      '<skill name="tdd" location="/abs/tdd/SKILL.md">\n' +
      "References are relative to /abs/tdd.\n\nKeep %read in the body.\n</skill>";
    const result = run([
      {
        ...user(""),
        content: [
          { type: "text", text: block },
          { type: "text", text: "&general summarise this" },
        ],
      },
    ] as ContextEvent["messages"]);
    assert.deepEqual(contents(result?.messages), [
      [
        { type: "text", text: block },
        { type: "text", text: dispatch("general", "summarise this") },
      ],
    ]);
  } finally {
    roles.cleanup();
  }
});
