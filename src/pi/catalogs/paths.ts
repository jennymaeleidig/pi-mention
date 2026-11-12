import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface PathCatalog {
  /** Cached answer. A miss starts an async stat and returns false until it lands. */
  has(label: string): boolean;
  /** Bumped whenever a background stat changes the cache. */
  readonly version: number;
  setOnChange(callback: (() => void) | undefined): void;
}

function expand(cwd: string, label: string): string {
  if (label === "~") return homedir();
  if (label.startsWith("~/")) return resolve(homedir(), label.slice(2));
  return isAbsolute(label) ? label : resolve(cwd, label);
}

/**
 * Path existence without blocking the render path. A new label is reported
 * unresolved for one frame while `stat` runs in the background; the callback
 * asks the TUI to render again when the answer arrives.
 */
export function pathCatalog(cwd: string): PathCatalog {
  const cache = new Map<string, boolean>();
  const pending = new Set<string>();
  let version = 0;
  let onChange: (() => void) | undefined;

  const probe = (label: string): void => {
    pending.add(label);
    void stat(expand(cwd, label))
      .then(
        () => cache.set(label, true),
        () => cache.set(label, false),
      )
      .finally(() => {
        pending.delete(label);
        version++;
        onChange?.();
      });
  };

  return {
    has(label: string): boolean {
      const cached = cache.get(label);
      if (cached !== undefined) return cached;
      if (!pending.has(label)) probe(label);
      return false;
    },
    get version(): number {
      return version;
    },
    setOnChange(callback: (() => void) | undefined): void {
      onChange = callback;
    },
  };
}
