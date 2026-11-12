import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/** A cached path-existence probe. The first sighting of a label does one stat. */
export function pathCatalog(cwd: string): { has(label: string): boolean } {
  const cache = new Map<string, boolean>();
  return {
    has(label: string): boolean {
      const cached = cache.get(label);
      if (cached !== undefined) return cached;
      let path = label;
      if (path === "~") path = homedir();
      else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
      else if (!isAbsolute(path)) path = resolve(cwd, path);
      const exists = existsSync(path);
      cache.set(label, exists);
      return exists;
    },
  };
}
