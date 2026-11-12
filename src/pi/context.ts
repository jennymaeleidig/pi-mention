import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  expandTools,
  toolBlockEntries,
  toolBlockText,
  unescapeExpandedText,
} from "../core/expand.ts";
import { parse, triggerSpecs } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Catalogs, Settings, Target } from "../core/types.ts";
import { toolCatalog } from "./catalogs/tools.ts";

interface ExpandedText {
  text: string;
  entries: Target[];
}

/**
 * Register the context seam for `%tool` expansion and model-facing escapes.
 *
 * The live tool catalog is read on every context event, synchronously, so a
 * server that connected between requests can resolve its tools. Only resolved
 * mentions change: each becomes its registered name inline and one tool block
 * follows the prose. The persisted transcript is untouched, the leading native
 * skill block stays opaque, and nothing is activated or declared. `&role`
 * expansion belongs to its own ticket; escapes still lose their backslash here
 * for the model only.
 */
export function installContextExpansion(pi: ExtensionAPI, settings: Settings): void {
  pi.on("context", (event) => {
    let changed = false;
    let catalogs: Catalogs | undefined;

    const liveCatalogs = (): Catalogs =>
      (catalogs ??= {
        skills: [],
        tools: toolCatalog(pi),
        roles: [],
        paths: { has: () => false },
      });

    const expandText = (text: string): ExpandedText => {
      if (!text.includes(settings.triggers.tool)) {
        return { text: unescapeExpandedText(text, settings), entries: [] };
      }

      const live = liveCatalogs();
      const { mentions } = parse(text, triggerSpecs(settings));
      const tools = mentions.filter((mention) => mention.class === "tool");
      if (tools.length === 0) {
        return { text: unescapeExpandedText(text, settings), entries: [] };
      }

      const resolved = resolve(tools, live, settings);
      const entries = toolBlockEntries(text, resolved, live);
      const expanded = expandTools(text, resolved, live, settings, { appendBlock: false });
      return { text: unescapeExpandedText(expanded.text, settings), entries };
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
      const seen = new Set<string>();
      const content = message.content.map((part) => {
        if (part.type !== "text") return part;
        const { text, entries } = expandText(part.text);
        for (const target of entries) {
          const key = target.name ?? target.label;
          if (seen.has(key)) continue;
          seen.add(key);
          allEntries.push(target);
        }
        if (text === part.text) return part;
        messageChanged = true;
        return { ...part, text };
      });

      if (allEntries.length > 0) {
        const lastText = content.findLastIndex((part) => part.type === "text");
        const part = content[lastText];
        if (part?.type === "text") {
          content[lastText] = { ...part, text: `${part.text}\n\n${toolBlockText(allEntries)}` };
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
