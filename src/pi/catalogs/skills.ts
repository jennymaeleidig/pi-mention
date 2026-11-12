import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Target } from "../../core/types.ts";

const SKILL_PREFIX = "skill:";

/** Skills are pi's `skill:<name>` commands; the label is the part after the prefix. */
export function skillCatalog(pi: ExtensionAPI): Target[] {
  try {
    return pi
      .getCommands()
      .filter((command) => command.source === "skill" && command.name.startsWith(SKILL_PREFIX))
      .map((command) => {
        const label = command.name.slice(SKILL_PREFIX.length);
        return { class: "skill", label, name: command.name };
      });
  } catch {
    return [];
  }
}
