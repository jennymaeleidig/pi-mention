import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register the extension's pi surface. Inert until the feature tickets add
 * their handlers; this is the one place that talks to `ExtensionAPI`.
 */
export function register(_pi: ExtensionAPI): void {}
