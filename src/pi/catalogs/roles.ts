import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Target } from "../../core/types.ts";

function readRoles(dir: string, into: Map<string, Target>): void {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch {
    return;
  }

  for (const filename of names) {
    try {
      const content = readFileSync(join(dir, filename), "utf8");
      const { frontmatter } = parseFrontmatter(content);
      const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim()
          ? frontmatter.name.trim()
          : filename.slice(0, -3);
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      into.set(name, { class: "role", label: name, name, description });
    } catch {
      // tinysubagent skips malformed roles too; a mention must not offer one.
    }
  }
}

/** Mirror tinysubagent: user roles first, project roles overwrite, sorted by name. */
export function roleCatalog(cwd: string, agentDir = getAgentDir()): Target[] {
  const byName = new Map<string, Target>();
  readRoles(join(agentDir, "agents"), byName);
  readRoles(join(cwd, CONFIG_DIR_NAME, "agents"), byName);
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}
