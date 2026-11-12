import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { unescapeExpandedText } from "../core/expand.ts";
import type { Settings } from "../core/types.ts";

/**
 * Register the context seam's escape handling.
 *
 * Skills rewrite the persisted message at input, so their block body must stay
 * opaque. Every other user-message escape loses its backslash only for the
 * model; the transcript keeps what was typed. Tool and role expansion land in
 * their own tickets on this same seam.
 */
export function installContextEscapes(pi: ExtensionAPI, settings: Settings): void {
  pi.on("context", (event) => {
    let changed = false;
    const messages = event.messages.map((message) => {
      if (message.role !== "user") return message;

      if (typeof message.content === "string") {
        const text = unescapeExpandedText(message.content, settings);
        if (text === message.content) return message;
        changed = true;
        return { ...message, content: text };
      }

      let messageChanged = false;
      const content = message.content.map((part) => {
        if (part.type !== "text") return part;
        const text = unescapeExpandedText(part.text, settings);
        if (text === part.text) return part;
        messageChanged = true;
        return { ...part, text };
      });
      if (!messageChanged) return message;
      changed = true;
      return { ...message, content };
    });

    return changed ? { messages } : undefined;
  });
}
