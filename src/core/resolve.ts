import { isPunctuationOnly } from "./grammar.ts";
import type { Catalogs, Mention, ResolvedMention, Settings, Target } from "./types.ts";

function entriesFor(mention: Mention, catalogs: Catalogs): readonly Target[] {
  switch (mention.class) {
    case "skill":
      return catalogs.skills;
    case "tool":
      return catalogs.tools;
    case "role":
      return catalogs.roles;
    default:
      return [];
  }
}

function exclusionsFor(target: Target, settings: Settings): readonly string[] {
  switch (target.class) {
    case "skill":
      return settings.exclude.skills;
    case "tool":
      return settings.exclude.tools;
    case "role":
      return settings.exclude.roles;
    default:
      return [];
  }
}

/** True when configuration removed this target from its catalog. */
export function isExcluded(target: Target, settings: Settings): boolean {
  const exclusions = exclusionsFor(target, settings);
  if (exclusions.includes(target.label)) return true;
  return target.class === "tool" && target.name !== undefined && exclusions.includes(target.name);
}

function longestEntry(label: string, entries: readonly Target[]): Target | undefined {
  let best: Target | undefined;
  for (const entry of entries) {
    if (!label.startsWith(entry.label)) continue;
    if (!isPunctuationOnly(label.slice(entry.label.length))) continue;
    if (!best || entry.label.length > best.label.length) best = entry;
  }
  return best;
}

function longestPath(
  label: string,
  paths: Catalogs["paths"],
): { label: string; target: Target } | undefined {
  if (paths.has(label)) {
    return { label, target: { class: "path", label } };
  }
  for (let end = label.length - 1; end > 0; end--) {
    const prefix = label.slice(0, end);
    if (!isPunctuationOnly(label.slice(end))) continue;
    if (paths.has(prefix)) {
      return { label: prefix, target: { class: "path", label: prefix } };
    }
  }
  return undefined;
}

function resolvedMention(
  mention: Mention,
  target: Target,
  status: ResolvedMention["status"],
  label: string,
): ResolvedMention {
  const end = mention.quoted
    ? mention.span.end
    : mention.span.start + mention.trigger.length + label.length;
  return {
    mention: { ...mention, label, span: { start: mention.span.start, end } },
    status,
    target,
  };
}

function resolveOne(mention: Mention, catalogs: Catalogs, settings: Settings): ResolvedMention {
  if (mention.class === "url") {
    return {
      mention,
      status: "resolved",
      target: { class: "url", label: mention.label },
    };
  }

  if (mention.class === "path") {
    const hit = longestPath(mention.label, catalogs.paths);
    if (!hit) return { mention, status: "unresolved" };
    return resolvedMention(mention, hit.target, "resolved", hit.label);
  }

  if (mention.class === "tool" && mention.label.endsWith(":")) {
    return { mention, status: "unresolved" };
  }

  const entry = longestEntry(mention.label, entriesFor(mention, catalogs));
  if (!entry) return { mention, status: "unresolved" };

  const excluded = isExcluded(entry, settings);
  return resolvedMention(mention, entry, excluded ? "excluded" : "resolved", entry.label);
}

/** Resolve labels against the live catalogs. Pure: all I/O is behind `paths`. */
export function resolve(
  mentions: readonly Mention[],
  catalogs: Catalogs,
  settings: Settings,
): ResolvedMention[] {
  let skillSeen = false;
  return mentions.map((mention) => {
    if (mention.class !== "skill") return resolveOne(mention, catalogs, settings);
    if (skillSeen) return { mention, status: "unresolved" };
    const resolved = resolveOne(mention, catalogs, settings);
    if (resolved.status !== "unresolved") skillSeen = true;
    return resolved;
  });
}
