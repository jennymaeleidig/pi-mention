import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { toolCatalog } from "../src/pi/catalogs/tools.ts";

type Exposure = ToolInfo["exposure"];

function tool(name: string, exposure: Exposure): ToolInfo {
  return {
    name,
    description: name,
    parameters: {},
    exposure,
    sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" },
  } as ToolInfo;
}

function catalog(tools: ToolInfo[], active: string[]) {
  const pi = {
    getAllTools: () => tools,
    getActiveTools: () => active,
  } as unknown as ExtensionAPI;
  return toolCatalog(pi).map((target) => target.name);
}

test("hidden tools never enter the catalog", () => {
  assert.deepEqual(catalog([tool("hidden", "hidden")], ["hidden"]), []);
});

test("direct and model-only tools enter only while active", () => {
  const tools = [tool("read", "direct"), tool("model", "model-only")];
  assert.deepEqual(catalog(tools, ["read", "model"]), ["read", "model"]);
  assert.deepEqual(catalog(tools, []), []);
});

test("codemode and deferred tools enter through an active codemode", () => {
  const tools = [tool("mcp__kagi__search", "deferred"), tool("script", "codemode")];
  assert.deepEqual(catalog(tools, ["codemode"]), ["mcp__kagi__search", "script"]);
});

test("a tool_search-only route is omitted, not catalogued", () => {
  assert.deepEqual(catalog([tool("mcp__kagi__search", "deferred")], ["tool_search"]), []);
});

test("an active deferred tool is direct", () => {
  assert.deepEqual(
    catalog([tool("mcp__kagi__search", "deferred")], ["tool_search", "mcp__kagi__search"]),
    ["mcp__kagi__search"],
  );
});
