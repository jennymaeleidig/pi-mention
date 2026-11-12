import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  renderToolSignature,
  toCodemodeIdentifier,
} from "@earendil-works/pi-codemode/declarations";
import type { Target } from "../../core/types.ts";

const SANITIZE = /[^A-Za-z0-9_]/g;
const SIGNATURE_MAX_CHARS = 280;

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

/**
 * An active reacher that can call other tools. `codemode` is the only route a
 * mention may name: `tool_search` would activate the target, which a mention
 * must never do.
 */
function hasCodemodeReacher(tools: readonly ToolInfo[], active: ReadonlySet<string>): boolean {
  return tools.some(
    (tool) =>
      tool.name === "codemode" && active.has(tool.name) && typeof tool.reachesTools === "function",
  );
}

/**
 * Render one signature for the tool block. The declaration renderer bounds the
 * input type; the block then flattens it, drops `//` comment lines, and caps
 * the whole line. There is no output schema on `ToolInfo`, so the output is
 * always `Promise<unknown>`.
 */
export function toolSignature(tool: ToolInfo): string {
  const rendered = renderToolSignature(
    {
      name: tool.name,
      // ToolInfo.parameters is typebox's empty TSchema, not CodemodeJsonSchema.
      inputSchema: tool.parameters as Record<string, unknown>,
    },
    { inputMaxChars: 240 },
  );
  const flat = rendered
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return flat.length <= SIGNATURE_MAX_CHARS ? flat : `${flat.slice(0, SIGNATURE_MAX_CHARS - 1)}…`;
}

/** The color, picker and expansion catalogs share this reachability table. */
export function toolCatalog(pi: ExtensionAPI): Target[] {
  try {
    const tools = pi.getAllTools();
    const active = new Set(pi.getActiveTools());
    const codemode = hasCodemodeReacher(tools, active);
    const byLabel = new Map<string, Target>();

    for (const tool of tools) {
      if (tool.exposure === "hidden") continue;

      let reach: Target["reach"];
      if (active.has(tool.name)) {
        // Active direct, model-only, codemode and deferred tools are all declared.
        reach = "direct";
      } else if (tool.exposure === "codemode" || tool.exposure === "deferred") {
        // The tool_search route activates the target, so a mention never takes it.
        if (!codemode) continue;
        reach = "indirect";
      } else {
        continue;
      }

      const server = serverOf(tool);
      const target: Target = {
        class: "tool",
        label: labelOf(tool),
        name: tool.name,
        reach,
        identifier: toCodemodeIdentifier(tool.name),
        signature: toolSignature(tool),
      };
      if (server) target.server = server;
      if (tool.description) target.description = tool.description;
      byLabel.set(target.label, target);
    }
    return [...byLabel.values()];
  } catch {
    return [];
  }
}
