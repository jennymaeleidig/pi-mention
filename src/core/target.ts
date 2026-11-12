import type { SelectionRecord } from "./selection.ts";
import type { Target } from "./types.ts";

/** The registered name, falling back to the label a user typed. */
export function targetKey(target: Target): string {
  return target.name ?? target.label;
}

/** True when two targets are the same target, not merely the same label. */
export function sameTarget(a: Target, b: Target): boolean {
  return a.class === b.class && targetKey(a) === targetKey(b);
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
