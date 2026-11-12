import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register } from "./pi/index.ts";

/**
 * The `pi-mention` extension entry: the default factory pi loads. Registration
 * lives in `src/pi/index.ts`; this module only re-exports that wiring.
 */
export default function piMention(pi: ExtensionAPI): void {
  register(pi);
}
