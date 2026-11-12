import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Target } from "../../core/types.ts";

export const SKILL_COMMAND_PREFIX = "skill:";

/** One live skill command and the file the input seam must read. */
export interface SkillEntry {
  target: Target;
  /** The absolute path to the SKILL.md file. */
  location: string;
  /** The directory the block's relative references resolve against. */
  baseDir: string;
}

/** Skills are pi's `skill:<name>` commands; the label is the part after the prefix. */
export function skillEntries(pi: ExtensionAPI): SkillEntry[] {
  try {
    const entries: SkillEntry[] = [];
    for (const command of pi.getCommands()) {
      if (command.source !== "skill" || !command.name.startsWith(SKILL_COMMAND_PREFIX)) continue;
      const location = command.sourceInfo?.path;
      if (typeof location !== "string" || location.length === 0) continue;

      const label = command.name.slice(SKILL_COMMAND_PREFIX.length);
      const target: Target = { class: "skill", label, name: command.name };
      if (command.description) target.description = command.description;
      if (command.sourceInfo.scope) target.scope = command.sourceInfo.scope;

      entries.push({
        target,
        location,
        baseDir: command.sourceInfo.baseDir || dirname(location),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

/** Stable project-first partition, preserving pi's source order inside each tier. */
export function orderSkillEntries(
  entries: readonly SkillEntry[],
  projectFirst: boolean,
): SkillEntry[] {
  if (!projectFirst) return [...entries];
  return [
    ...entries.filter((entry) => entry.target.scope === "project"),
    ...entries.filter((entry) => entry.target.scope !== "project"),
  ];
}

/**
 * The live, project-ordered skill list with one entry per label. The first
 * command for a label wins, so project-first configuration selects the project
 * copy when both scopes define the same skill.
 */
export function liveSkillEntries(pi: ExtensionAPI, projectFirst = false): SkillEntry[] {
  const seen = new Set<string>();
  return orderSkillEntries(skillEntries(pi), projectFirst).filter((entry) => {
    if (seen.has(entry.target.label)) return false;
    seen.add(entry.target.label);
    return true;
  });
}

/** The colour and picker catalog; expansion uses `liveSkillEntries` directly. */
export function skillCatalog(pi: ExtensionAPI): Target[] {
  return skillEntries(pi).map((entry) => entry.target);
}
