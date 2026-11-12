import { readFile } from "node:fs/promises";
import {
  stripFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expandSkill, firstResolvedSkill, skillBlockBounds } from "../core/skill-expand.ts";
import { parse, triggerSpecs } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Settings, SkillSource } from "../core/types.ts";
import type { SkillEntry } from "./catalogs/skills.ts";
import type { SessionCatalogs } from "./session-catalogs.ts";

async function readSkill(entry: SkillEntry): Promise<SkillSource | undefined> {
  try {
    const raw = await readFile(entry.location, "utf8");
    return {
      name: entry.target.label,
      location: entry.location,
      baseDir: entry.baseDir,
      body: stripFrontmatter(raw),
    };
  } catch {
    return undefined;
  }
}

function notifyFailure(ctx: ExtensionContext, name: string): void {
  if (!ctx.hasUI) return;
  try {
    ctx.ui.notify(`Could not expand $${name}`, "warning");
  } catch {
    // A notification failure must never block the prompt.
  }
}

/**
 * Register the `$skill` input seam.
 *
 * Skills come from the live command list at send time. The adapter asks the
 * session catalogs for the live entry behind a resolved target, reads the
 * SKILL.md and strips its frontmatter; the pure expander builds the canonical
 * block. Unresolved, excluded, later, missing or unrepresentable skills stay
 * literal, an existing native block is left untouched, and the handler never
 * throws into pi's input pipeline.
 */
export function installSkillInput(
  pi: ExtensionAPI,
  settings: Settings,
  session: SessionCatalogs,
): void {
  pi.on("input", async (event, ctx) => {
    const trigger = settings.triggers.skill;
    if (!event.text.includes(trigger)) return { action: "continue" };
    // Pi owns slash commands and prompt templates, and expands /skill: after
    // the input event. Leave their arguments untouched.
    if (event.text.trimStart().startsWith("/")) return { action: "continue" };
    // A restored message already carries a native block; never build a second
    // one or rewrite the block or its prose.
    if (skillBlockBounds(event.text)) return { action: "continue" };

    const { mentions } = parse(event.text, triggerSpecs(settings));
    const skills = mentions.filter((mention) => mention.class === "skill");
    if (skills.length === 0) return { action: "continue" };

    const resolved = resolve(skills, session.catalogs, settings);
    const selected = firstResolvedSkill(resolved)?.target;
    const entry = selected ? session.skillEntry(selected) : undefined;
    const source = entry ? await readSkill(entry) : undefined;

    const expanded = expandSkill(event.text, resolved, {
      skillSource: () => source,
    });
    if (!expanded.skillBlock) {
      if (expanded.skillFailure) notifyFailure(ctx, expanded.skillFailure.name);
      return { action: "continue" };
    }

    return { action: "transform", text: expanded.text };
  });
}
