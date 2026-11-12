import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register } from "./pi/index.ts";

/**
 * The `pi-mention` extension entry. The scaffold registers nothing; the input,
 * context, editor, autocomplete and catalog wiring land in later tickets.
 */
export default function piMention(pi: ExtensionAPI): void {
  register(pi);
}
