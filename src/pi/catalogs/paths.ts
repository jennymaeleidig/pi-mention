import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

interface CacheEntry {
  exists: boolean;
  checkedAt: number;
}

/** How long a stat answer stays fresh before an adapter probes it again. */
const DEFAULT_TTL_MS = 1000;

export interface PathCatalogOptions {
  /** Test seam: how long a cached answer stays fresh. */
  ttlMs?: number;
}

export interface PathCatalog {
  /** Pure cache read: no stat and no mutation. An unknown label is false. */
  has(label: string): boolean;
  /**
   * Start a background stat when the label is unknown or its answer is older
   * than the TTL. Pending probes are deduped; a landing answer bumps `version`
   * and calls the change callback.
   */
  probe(label: string): void;
  /** Bumped whenever a background stat writes the cache. */
  readonly version: number;
  setOnChange(callback: (() => void) | undefined): void;
}

function expand(cwd: string, label: string): string {
  if (label === "~") return homedir();
  if (label.startsWith("~/")) return resolve(homedir(), label.slice(2));
  return isAbsolute(label) ? label : resolve(cwd, label);
}

/**
 * Path existence without blocking the render path. `has` is a pure cache read;
 * `probe` opts the caller into I/O. A new label is reported unresolved for one
 * frame while `stat` runs in the background; the callback asks the TUI to
 * render again when the answer arrives.
 */
export function pathCatalog(cwd: string, options: PathCatalogOptions = {}): PathCatalog {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const pending = new Set<string>();
  let version = 0;
  let onChange: (() => void) | undefined;

  return {
    has(label: string): boolean {
      return cache.get(label)?.exists ?? false;
    },
    probe(label: string): void {
      if (pending.has(label)) return;
      const cached = cache.get(label);
      if (cached && Date.now() - cached.checkedAt < ttlMs) return;

      pending.add(label);
      void stat(expand(cwd, label))
        .then(
          () => cache.set(label, { exists: true, checkedAt: Date.now() }),
          () => cache.set(label, { exists: false, checkedAt: Date.now() }),
        )
        .finally(() => {
          pending.delete(label);
          version++;
          onChange?.();
        });
    },
    get version(): number {
      return version;
    },
    setOnChange(callback: (() => void) | undefined): void {
      onChange = callback;
    },
  };
}
