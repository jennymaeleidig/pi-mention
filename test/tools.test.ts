import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { toolCatalog, toolSignature } from "../src/pi/catalogs/tools.ts";

type Exposure = ToolInfo["exposure"];

interface ToolOptions {
  description?: string;
  parameters?: Record<string, unknown>;
  namespace?: ToolInfo["namespace"];
  reachesTools?: ToolInfo["reachesTools"];
}

function tool(name: string, exposure: Exposure, options: ToolOptions = {}): ToolInfo {
  return {
    name,
    description: options.description ?? name,
    parameters: options.parameters ?? {},
    exposure,
    sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" },
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.reachesTools ? { reachesTools: options.reachesTools } : {}),
  } as ToolInfo;
}

function codemode(active: boolean): ToolInfo {
  return tool("codemode", "model-only", {
    reachesTools: active ? () => "all" : undefined,
  });
}

function toolSearch(): ToolInfo {
  return tool("tool_search", "model-only", { reachesTools: () => "all" });
}

function searchParameters() {
  return {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  };
}

function kagiSearch(): ToolInfo {
  return tool("mcp__kagi__kagi_search_fetch", "deferred", {
    parameters: searchParameters(),
    namespace: { name: "mcp__kagi", aliases: ["kagi"] },
  });
}

function catalog(tools: ToolInfo[], active: string[]) {
  const pi = {
    getAllTools: () => tools,
    getActiveTools: () => active,
  } as unknown as ExtensionAPI;
  return toolCatalog(pi);
}

function names(tools: ToolInfo[], active: string[]) {
  return catalog(tools, active).map((target) => target.name);
}

function reach(tools: ToolInfo[], active: string[], name: string) {
  return catalog(tools, active).find((target) => target.name === name)?.reach;
}

test("the routing table: exposure and activeness decide membership and reach", () => {
  const direct = tool("direct", "direct");
  const modelOnly = tool("model-only", "model-only");
  const code = tool("code", "codemode");
  const deferred = tool("deferred", "deferred");
  const hidden = tool("hidden", "hidden");

  assert.equal(reach([direct], ["direct"], "direct"), "direct");
  assert.equal(reach([direct], [], "direct"), undefined);
  assert.equal(reach([modelOnly], ["model-only"], "model-only"), "direct");
  assert.equal(reach([modelOnly], [], "model-only"), undefined);
  assert.equal(reach([code], ["code"], "code"), "direct");
  assert.equal(reach([deferred], ["deferred"], "deferred"), "direct");
  assert.equal(reach([hidden], ["hidden"], "hidden"), undefined);

  assert.equal(reach([code, codemode(true)], ["codemode"], "code"), "indirect");
  assert.equal(reach([deferred, codemode(true)], ["codemode"], "deferred"), "indirect");
  assert.equal(reach([code, toolSearch()], ["tool_search"], "code"), undefined);
  assert.equal(reach([deferred, toolSearch()], ["tool_search"], "deferred"), undefined);
  assert.equal(reach([code, codemode(false)], ["codemode"], "code"), undefined);
});

test("hidden tools never enter the catalog", () => {
  assert.deepEqual(names([tool("hidden", "hidden")], ["hidden"]), []);
});

test("a tool_search-only route is omitted, not catalogued", () => {
  assert.deepEqual(names([kagiSearch(), toolSearch()], ["tool_search"]), ["tool_search"]);
});

test("an active deferred tool is direct", () => {
  const tools = [kagiSearch(), toolSearch()];
  assert.equal(
    reach(tools, ["tool_search", "mcp__kagi__kagi_search_fetch"], "mcp__kagi__kagi_search_fetch"),
    "direct",
  );
});

test("an inactive MCP tool is indirect through an active codemode", () => {
  const targets = catalog([kagiSearch(), codemode(true)], ["codemode"]);
  assert.deepEqual(
    targets.map((target) => ({
      label: target.label,
      name: target.name,
      server: target.server,
      reach: target.reach,
      identifier: target.identifier,
    })),
    [
      {
        label: "kagi:kagi_search_fetch",
        name: "mcp__kagi__kagi_search_fetch",
        server: "kagi",
        reach: "indirect",
        identifier: "mcp__kagi__kagi_search_fetch",
      },
      {
        label: "codemode",
        name: "codemode",
        server: undefined,
        reach: "direct",
        identifier: "codemode",
      },
    ],
  );
});

test("the rendered signature is one line, drops comment lines and carries Promise<unknown>", () => {
  const rendered = toolSignature(
    tool("example", "direct", {
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command" },
          timeout: { type: "number" },
        },
        required: ["command"],
      },
    }),
  );
  assert.equal(
    rendered,
    "example(args: { command: string; timeout?: number; }): Promise<unknown>;",
  );
  assert.ok(!rendered.includes("\n"));
  assert.ok(!rendered.includes("//"));
});

test("the whole signature is capped at 280 characters with an ellipsis", () => {
  const rendered = toolSignature(tool("x".repeat(300), "direct"));
  assert.equal(rendered.length, 280);
  assert.ok(rendered.endsWith("…"));
});

test("a tool keeps its description beside its registered name", () => {
  const read = tool("read", "direct", { description: "Read a file" });
  const pi = {
    getAllTools: () => [read],
    getActiveTools: () => ["read"],
  } as unknown as ExtensionAPI;

  assert.deepEqual(toolCatalog(pi), [
    {
      class: "tool",
      label: "read",
      name: "read",
      reach: "direct",
      identifier: "read",
      signature: "read(args: unknown): Promise<unknown>;",
      description: "Read a file",
    },
  ]);
});
