import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expandContextMessages } from "../core/context-expand.ts";
import type { Catalogs, Settings } from "../core/types.ts";

/**
 * Register the context seam for `%tool` and `&role` expansion and
 * model-facing escapes.
 *
 * The session catalogs supply the live tool catalog and the cached role
 * catalog. The core module owns per-part expansion, the leading-role rule, the
 * one tool block after the last text part, unescaping and change detection.
 * The persisted transcript is untouched, and nothing is activated or declared.
 */
export function installContextExpansion(
  pi: ExtensionAPI,
  settings: Settings,
  catalogs: Catalogs,
): void {
  pi.on("context", (event) => {
    const messages = expandContextMessages(event.messages, catalogs, settings);
    return messages ? { messages } : undefined;
  });
}
