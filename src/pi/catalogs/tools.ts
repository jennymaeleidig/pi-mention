import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { CatalogEntry } from "../../core/types.ts";

const SANITIZE = /[^A-Za-z0-9_]/g;

function serverOf(tool: ToolInfo): string | undefined {
  const namespace = tool.namespace;
  if (!namespace) return undefined;
  const alias = namespace.aliases?.[0];
  if (alias) return alias;
  return namespace.name.startsWith("mcp__") ? namespace.name.slice(5) : namespace.name;
}

function labelOf(tool: ToolInfo): string {
  const server = serverOf(tool);
  if (!server) return tool.name;
  const prefix = `mcp__${server.replace(SANITIZE, "_")}__`;
  return tool.name.startsWith(prefix) ? `${server}:${tool.name.slice(prefix.length)}` : tool.name;
}

function reachable(tool: ToolInfo, active: ReadonlySet<string>): boolean {
  switch (tool.exposure) {
    case "hidden":
      return false;
    case "direct":
    case "model-only":
      return active.has(tool.name);
    case "codemode":
      return active.has("codemode");
    case "deferred":
      return active.has("tool_search");
  }
}

/** The color catalog uses the same reachability rules as the expansion catalog. */
export function toolCatalog(pi: ExtensionAPI): CatalogEntry[] {
  try {
    const active = new Set(pi.getActiveTools());
    const byLabel = new Map<string, CatalogEntry>();
    for (const tool of pi.getAllTools()) {
      if (!reachable(tool, active)) continue;
      const label = labelOf(tool);
      byLabel.set(label, { label, target: { class: "tool", label, name: tool.name } });
    }
    return [...byLabel.values()];
  } catch {
    return [];
  }
}
