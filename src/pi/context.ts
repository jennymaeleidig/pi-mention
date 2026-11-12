import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  dedupeToolTargets,
  expandRoles,
  expandTools,
  proseStart,
  toolBlockEntries,
  toolBlockText,
  unescapeExpandedText,
} from "../core/expand.ts";
import { parse, triggerSpecs } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Catalogs, Settings, Target } from "../core/types.ts";

interface ExpandedText {
  text: string;
  entries: Target[];
}

/** True when the text has prose after any leading native skill block. */
function hasProseAfterSkillBlock(text: string): boolean {
  const start = proseStart(text);
  return start !== undefined && text.slice(start).trim() !== "";
}

/**
 * Register the context seam for `%tool` and `&role` expansion and
 * model-facing escapes.
 *
 * The live tool catalog and cached role catalog arrive from the session
 * catalogs. Tool mentions expand inline first; then the leading role mention,
 * after any native skill block, becomes the dispatch prefix. The persisted
 * transcript is untouched, and nothing is activated or declared. Escapes lose
 * their backslash for the model only.
 */
export function installContextExpansion(
  pi: ExtensionAPI,
  settings: Settings,
  catalogs: Catalogs,
): void {
  pi.on("context", (event) => {
    let changed = false;

    const expandText = (text: string, allowRole = true): ExpandedText => {
      const hasToolTrigger = text.includes(settings.triggers.tool);
      const hasRoleTrigger = text.includes(settings.triggers.role);
      if (!hasToolTrigger && !hasRoleTrigger) {
        return { text: unescapeExpandedText(text, settings), entries: [] };
      }

      const { mentions } = parse(text, triggerSpecs(settings));
      const expandable = mentions.filter(
        (mention) => mention.class === "tool" || mention.class === "role",
      );
      if (expandable.length === 0) {
        return { text: unescapeExpandedText(text, settings), entries: [] };
      }

      const resolved = resolve(expandable, catalogs, settings);
      let expandedText = text;
      let entries: Target[] = [];
      if (resolved.some((mention) => mention.mention.class === "tool")) {
        entries = toolBlockEntries(text, resolved, catalogs);
        expandedText = expandTools(text, resolved, catalogs, { appendBlock: false }).text;
      }

      if (allowRole) {
        expandedText = expandRoles(expandedText, resolved, catalogs).text;
      }
      return { text: unescapeExpandedText(expandedText, settings), entries };
    };

    const messages = event.messages.map((message) => {
      if (message.role !== "user") return message;

      if (typeof message.content === "string") {
        const { text, entries } = expandText(message.content);
        const next = entries.length === 0 ? text : `${text}\n\n${toolBlockText(entries)}`;
        if (next === message.content) return message;
        changed = true;
        return { ...message, content: next };
      }

      let messageChanged = false;
      const allEntries: Target[] = [];
      let proseSeen = false;
      const content = message.content.map((part) => {
        if (part.type !== "text") return part;
        const allowRole = !proseSeen;
        if (hasProseAfterSkillBlock(part.text)) proseSeen = true;
        const { text, entries } = expandText(part.text, allowRole);
        allEntries.push(...entries);
        if (text === part.text) return part;
        messageChanged = true;
        return { ...part, text };
      });

      const entries = dedupeToolTargets(allEntries);
      if (entries.length > 0) {
        const lastText = content.findLastIndex((part) => part.type === "text");
        const part = content[lastText];
        if (part?.type === "text") {
          content[lastText] = { ...part, text: `${part.text}\n\n${toolBlockText(entries)}` };
          messageChanged = true;
        }
      }

      if (!messageChanged) return message;
      changed = true;
      return { ...message, content };
    });

    return changed ? { messages } : undefined;
  });
}
