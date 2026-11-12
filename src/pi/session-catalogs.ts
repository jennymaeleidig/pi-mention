import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sameTarget } from "../core/target.ts";
import type { Catalogs, Settings, Target } from "../core/types.ts";
import { pathCatalog, type PathCatalog } from "./catalogs/paths.ts";
import { roleCatalog } from "./catalogs/roles.ts";
import { isSkillEntry, liveSkillCommands, type SkillEntry } from "./catalogs/skills.ts";
import { toolCatalog } from "./catalogs/tools.ts";

export interface SessionCatalogsOptions {
  /** Session working directory. */
  cwd: string;
  /** Test seam: isolates role discovery from the user's real agent directory. */
  agentDir?: string;
}

/** The one set of live Catalogs one extension instance reads. */
export interface SessionCatalogs {
  /** The plain-data catalogs the core seams consume. */
  catalogs: Catalogs;
  /** The live skill entry behind a resolved skill target, when it is readable. */
  skillEntry(target: Target): SkillEntry | undefined;
  /** Bump the tool revision after a server or tool change. */
  markToolsChanged(): void;
  /** Bind the callback that asks the TUI to render after a path probe lands. */
  setOnPathChange(callback: (() => void) | undefined): void;
}

/**
 * Build the four live Catalogs once for one extension instance.
 *
 * Skills and tools are read through live getters, so a target that appears
 * mid-session reaches the picker, the colour layer and expansion without a
 * restart. Roles are read once from the user and project agent directories.
 * Paths are the one filesystem-backed Catalog: `has` is a pure cache read and
 * `probe` is the explicit I/O edge the colour layer calls.
 */
export function createSessionCatalogs(
  pi: ExtensionAPI,
  settings: Settings,
  options: SessionCatalogsOptions,
): SessionCatalogs {
  const paths: PathCatalog = pathCatalog(options.cwd);
  let toolRevision = 0;

  const catalogs: Catalogs = {
    get skills() {
      return liveSkillCommands(pi, settings.ranking.projectSkillsFirst).map(
        (command) => command.target,
      );
    },
    get tools() {
      return toolCatalog(pi);
    },
    get toolsVersion() {
      return toolRevision;
    },
    roles: roleCatalog(options.cwd, options.agentDir),
    paths,
  };

  return {
    catalogs,
    skillEntry(target: Target): SkillEntry | undefined {
      return liveSkillCommands(pi, settings.ranking.projectSkillsFirst).find(
        (command): command is SkillEntry =>
          isSkillEntry(command) && sameTarget(command.target, target),
      );
    },
    markToolsChanged(): void {
      toolRevision++;
    },
    setOnPathChange(callback: (() => void) | undefined): void {
      paths.setOnChange(callback);
    },
  };
}
