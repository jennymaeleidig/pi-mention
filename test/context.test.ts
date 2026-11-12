import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { installContextExpansion } from "../src/pi/context.ts";
import { defaultSettings } from "../src/core/settings.ts";

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
const KAGI_LINE =
  "- `mcp__kagi__kagi_search_fetch` (kagi) — not declared to you. " +
  "Reach it inside a codemode script: `await tools.mcp__kagi__kagi_search_fetch(...)`. " +
  `Signature: ${KAGI_SIGNATURE}`;

function setup() {
  let handler: Handler | undefined;
  const tools: ToolInfo[] = [
    tool("read", "direct"),
    tool("mcp__kagi__kagi_search_fetch", "deferred", {
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
      },
      namespace: { name: "mcp__kagi", aliases: ["kagi"] },
    }),
    tool("codemode", "model-only", { reachesTools: () => "all" }),
  ];
  const pi = {
    on: (name: string, callback: Handler) => {
      if (name === "context") handler = callback;
      return () => {};
    },
    getAllTools: () => tools,
    getActiveTools: () => ["read", "codemode"],
  } as unknown as ExtensionAPI;

  installContextExpansion(pi, defaultSettings());

  return (messages: ContextEvent["messages"]) => {
    assert.ok(handler);
    return handler({ type: "context", messages });
  };
}

const user = (content: string) => ({ role: "user" as const, content, timestamp: 0 });

const contents = (messages: ContextEvent["messages"] | undefined) =>
  messages?.map((message) => ("content" in message ? message.content : undefined));

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
