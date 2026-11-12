import type { SelectionRecord } from "./selection.ts";
import type { Target } from "./types.ts";

/** The registered name, falling back to the label a user typed. */
export function targetKey(target: Target): string {
  return target.name ?? target.label;
}

/**
 * True when two catalog entries denote the same target: same class and
 * registered name. A Catalog has one entry per registered name, so source-scope
 * copies never coexist.
 */
export function sameTarget(a: Target, b: Target): boolean {
  return a.class === b.class && targetKey(a) === targetKey(b);
}

/** The live catalog entry for a target, when the catalog still has it. */
export function liveTarget(target: Target, targets: readonly Target[]): Target | undefined {
  return targets.find(
    (candidate) => candidate.label === target.label && sameTarget(candidate, target),
  );
}

/**
 * The selection-history record for a target.
 *
 * The registered name is the canonical key; the label stays a fallback so a
 * record written before a rename still ranks the target.
 */
export function historyRecord(
  target: Target,
  history: Readonly<Record<string, SelectionRecord>>,
): SelectionRecord | undefined {
  const byName = target.name === undefined ? undefined : history[target.name];
  return byName ?? history[target.label];
}
