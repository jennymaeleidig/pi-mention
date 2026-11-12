import { parse, type TriggerSpec } from "./grammar.ts";
import type { PickerClass, SelectionRecord } from "./selection.ts";
import { historyRecord } from "./target.ts";
import type { Settings, Target } from "./types.ts";

/** One trigger token ending at the cursor, with its query and full prefix. */
export interface PickerToken {
  class: PickerClass;
  trigger: string;
  /** The label typed after the trigger, possibly empty. */
  query: string;
  /** The full text from the trigger to the cursor. */
  prefix: string;
  /** The code-unit offset of the trigger in the text before the cursor. */
  start: number;
}

function isPickerClass(value: string): value is PickerClass {
  return value === "skill" || value === "tool" || value === "role";
}

/**
 * Find the trigger token that ends at the cursor.
 *
 * Parsing the draft keeps picker triggering aligned with the grammar: boundaries,
 * escapes, code fences and the tool chain all behave exactly as they do when the
 * message is resolved. A bare trigger is not a mention, so it is probed with one
 * sentinel label character before the same parser runs.
 */
export function findPickerToken(
  textBeforeCursor: string,
  specs: readonly TriggerSpec[],
): PickerToken | undefined {
  if (textBeforeCursor.length === 0) return undefined;

  const ending = parse(textBeforeCursor, specs).mentions.find(
    (mention) => isPickerClass(mention.class) && mention.span.end === textBeforeCursor.length,
  );
  if (ending && isPickerClass(ending.class)) {
    return {
      class: ending.class,
      trigger: ending.trigger,
      query: ending.label,
      prefix: textBeforeCursor.slice(ending.span.start),
      start: ending.span.start,
    };
  }

  const probe = `${textBeforeCursor}a`;
  const bare = parse(probe, specs).mentions.find(
    (mention) =>
      isPickerClass(mention.class) &&
      mention.label === "a" &&
      mention.span.end === probe.length &&
      mention.span.start === textBeforeCursor.length - mention.trigger.length,
  );
  if (bare && isPickerClass(bare.class)) {
    return {
      class: bare.class,
      trigger: bare.trigger,
      query: "",
      prefix: bare.trigger,
      start: bare.span.start,
    };
  }

  return undefined;
}

export interface RankingOptions {
  strategy: Settings["ranking"]["strategy"];
  pinned: readonly string[];
  projectFirst: boolean;
  history: Readonly<Record<string, SelectionRecord>>;
  now: number;
}

interface IndexedTarget {
  target: Target;
  index: number;
}

const DAY_MS = 86_400_000;

function recency(target: Target, history: Readonly<Record<string, SelectionRecord>>): number {
  return historyRecord(target, history)?.lastSelectedAt ?? 0;
}

function frequency(target: Target, history: Readonly<Record<string, SelectionRecord>>): number {
  return historyRecord(target, history)?.count ?? 0;
}

function frecency(
  target: Target,
  history: Readonly<Record<string, SelectionRecord>>,
  now: number,
): number {
  const record = historyRecord(target, history);
  if (!record || record.count <= 0) return 0;
  const ageDays = Math.max(0, now - record.lastSelectedAt) / DAY_MS;
  return record.count / (1 + ageDays / 30);
}

function compare(a: IndexedTarget, b: IndexedTarget, options: RankingOptions): number {
  const bySource = a.index - b.index;
  switch (options.strategy) {
    case "sourceOrder":
      return bySource;
    case "alphabetical": {
      const byLabel = a.target.label.localeCompare(b.target.label, undefined, {
        sensitivity: "base",
      });
      return byLabel || bySource;
    }
    case "recent": {
      const byRecent = recency(b.target, options.history) - recency(a.target, options.history);
      return byRecent || bySource;
    }
    case "frequent": {
      const byCount = frequency(b.target, options.history) - frequency(a.target, options.history);
      const byRecent = recency(b.target, options.history) - recency(a.target, options.history);
      return byCount || byRecent || bySource;
    }
    case "frecency": {
      const byScore =
        frecency(b.target, options.history, options.now) -
        frecency(a.target, options.history, options.now);
      const byRecent = recency(b.target, options.history) - recency(a.target, options.history);
      return byScore || byRecent || bySource;
    }
  }
}

function sortByStrategy(entries: IndexedTarget[], options: RankingOptions): IndexedTarget[] {
  return entries.sort((a, b) => compare(a, b, options));
}

type PinnedOrder = ReadonlyMap<string, number>;

function pinnedOrderMap(pinned: readonly string[]): PinnedOrder {
  const order = new Map<string, number>();
  for (const name of pinned) {
    if (!order.has(name)) order.set(name, order.size);
  }
  return order;
}

function pinnedRank(target: Target, order: PinnedOrder): number | undefined {
  return (
    order.get(target.label) ?? (target.name === undefined ? undefined : order.get(target.name))
  );
}

interface PinnedPartition {
  pinned: Array<{ entry: IndexedTarget; rank: number }>;
  rest: IndexedTarget[];
}

function partitionPinned(targets: readonly Target[], pinned: readonly string[]): PinnedPartition {
  const order = pinnedOrderMap(pinned);
  const pinnedEntries: Array<{ entry: IndexedTarget; rank: number }> = [];
  const rest: IndexedTarget[] = [];

  targets.forEach((target, index) => {
    const rank = pinnedRank(target, order);
    if (rank === undefined) rest.push({ target, index });
    else pinnedEntries.push({ entry: { target, index }, rank });
  });

  return { pinned: pinnedEntries, rest };
}

function projectFirstTier(entries: IndexedTarget[]): IndexedTarget[] {
  const project = entries.filter((entry) => entry.target.scope === "project");
  const other = entries.filter((entry) => entry.target.scope !== "project");
  return [...project, ...other];
}

/**
 * Rank the catalog for an empty query: pinned entries first, then the configured
 * strategy, with source order as the final tie-break. Project skills form their
 * own tier after pinned entries so `alphabetical` cannot erase project-first.
 */
export function rankTargets(targets: readonly Target[], options: RankingOptions): Target[] {
  const { pinned, rest } = partitionPinned(targets, options.pinned);
  pinned.sort((a, b) => a.rank - b.rank || a.entry.index - b.entry.index);

  let ordered: IndexedTarget[];
  if (options.projectFirst) {
    const project = rest.filter((entry) => entry.target.scope === "project");
    const other = rest.filter((entry) => entry.target.scope !== "project");
    ordered = [...sortByStrategy(project, options), ...sortByStrategy(other, options)];
  } else {
    ordered = sortByStrategy(rest, options);
  }

  return [...pinned.map(({ entry }) => entry), ...ordered].map((entry) => entry.target);
}

/**
 * Arrange fuzzy matches: a stable partition with pinned entries first, then a
 * stable project-first tier where the provider asks for one. Fuzzy relevance
 * survives inside each tier.
 */
export function orderMatches(
  targets: readonly Target[],
  options: Pick<RankingOptions, "pinned" | "projectFirst">,
): Target[] {
  const { pinned, rest } = partitionPinned(targets, options.pinned);
  const ordered = options.projectFirst ? projectFirstTier(rest) : rest;
  return [...pinned.map(({ entry }) => entry), ...ordered].map((entry) => entry.target);
}
