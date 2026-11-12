import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Target } from "../../core/types.ts";

export const SKILL_COMMAND_PREFIX = "skill:";

/** One live skill command; `location` is absent when pi reports no file. */
export interface SkillCommand {
  target: Target;
  /** The absolute path to the SKILL.md file, when pi reports one. */
  location?: string;
  /** The directory the block's relative references resolve against. */
  baseDir?: string;
}

/** One expandable skill command: the target and the file the input seam reads. */
export interface SkillEntry extends SkillCommand {
  location: string;
  baseDir: string;
}

function targetFor(command: {
  name: string;
  description?: string;
  sourceInfo?: { scope?: Target["scope"] };
}): Target {
  const label = command.name.slice(SKILL_COMMAND_PREFIX.length);
  const target: Target = { class: "skill", label, name: command.name };
  if (command.description) target.description = command.description;
  if (command.sourceInfo?.scope) target.scope = command.sourceInfo.scope;
  return target;
}

/** Skills are pi's `skill:<name>` commands, with or without a reported file. */
export function skillCommands(pi: ExtensionAPI): SkillCommand[] {
  try {
    const commands: SkillCommand[] = [];
    for (const command of pi.getCommands()) {
      if (command.source !== "skill" || !command.name.startsWith(SKILL_COMMAND_PREFIX)) continue;

      const target = targetFor(command);
      const location = command.sourceInfo?.path;
      if (typeof location === "string" && location.length > 0) {
        commands.push({
          target,
          location,
          baseDir: command.sourceInfo?.baseDir || dirname(location),
        });
      } else {
        commands.push({ target });
      }
    }
    return commands;
  } catch {
    return [];
  }
}

/** The same commands narrowed to the ones expansion can read. */
export function skillEntries(pi: ExtensionAPI): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const command of skillCommands(pi)) {
    if (command.location === undefined) continue;
    entries.push({
      target: command.target,
      location: command.location,
      baseDir: command.baseDir ?? dirname(command.location),
    });
  }
  return entries;
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

/**
 * The colour and picker catalog. A pathless skill still appears; only expansion
 * needs a readable SKILL.md location.
 */
export function skillCatalog(pi: ExtensionAPI): Target[] {
  return skillCommands(pi).map((command) => command.target);
}
