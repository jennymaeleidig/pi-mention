import { readFile } from "node:fs/promises";
import {
  stripFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expand, firstResolvedSkill, skillBlockBounds } from "../core/expand.ts";
import { parse, triggerSpecs } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Catalogs, Settings, SkillSource, Target } from "../core/types.ts";
import { liveSkillEntries, type SkillEntry } from "./catalogs/skills.ts";

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

function sameTarget(a: Target, b: Target): boolean {
  return a.label === b.label && a.name === b.name;
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
 * Skills come from the live command list at send time. The adapter reads the
 * SKILL.md and strips its frontmatter; the pure expander builds the canonical
 * block. Unresolved, excluded, later, missing or unrepresentable skills stay
 * literal, an existing native block is left untouched, and the handler never
 * throws into pi's input pipeline.
 */
export function installSkillInput(pi: ExtensionAPI, settings: Settings): void {
  pi.on("input", async (event, ctx) => {
    const trigger = settings.triggers.skill;
    if (!event.text.includes(trigger)) return { action: "continue" };
    // Pi owns slash commands and prompt templates, and expands /skill: after
    // the input event. Leave their arguments untouched.
    if (event.text.trimStart().startsWith("/")) return { action: "continue" };
    // A restored message already carries a native block; never build a second
    // one or rewrite the block or its prose.
    if (skillBlockBounds(event.text)) return { action: "continue" };

    const entries = liveSkillEntries(pi, settings.ranking.projectSkillsFirst);
    if (entries.length === 0) return { action: "continue" };

    const { mentions } = parse(event.text, triggerSpecs(settings));
    const skills = mentions.filter((mention) => mention.class === "skill");
    if (skills.length === 0) return { action: "continue" };

    const catalogs: Catalogs = {
      skills: entries.map((entry) => entry.target),
      tools: [],
      roles: [],
      paths: { has: () => false },
    };
    const resolved = resolve(skills, catalogs, settings);
    const selected = firstResolvedSkill(resolved)?.target;
    const entry = selected
      ? entries.find((candidate) => sameTarget(candidate.target, selected))
      : undefined;
    const source = entry ? await readSkill(entry) : undefined;

    const expanded = expand(event.text, resolved, settings, {
      skillSource: (target) => (selected && sameTarget(target, selected) ? source : undefined),
    });
    if (!expanded.skillBlock) {
      if (expanded.skillFailure) notifyFailure(ctx, expanded.skillFailure.name);
      return { action: "continue" };
    }

    return { action: "transform", text: expanded.text };
  });
}
