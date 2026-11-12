import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Target } from "../../core/types.ts";

export const SKILL_COMMAND_PREFIX = "skill:";

/** Skills are pi's `skill:<name>` commands; the label is the part after the prefix. */
export function skillCatalog(pi: ExtensionAPI): Target[] {
  try {
    return pi
      .getCommands()
      .filter(
        (command) => command.source === "skill" && command.name.startsWith(SKILL_COMMAND_PREFIX),
      )
      .map((command) => {
        const label = command.name.slice(SKILL_COMMAND_PREFIX.length);
        const target: Target = { class: "skill", label, name: command.name };
        if (command.description) target.description = command.description;
        if (command.sourceInfo?.scope) target.scope = command.sourceInfo.scope;
        return target;
      });
  } catch {
    return [];
  }
}
