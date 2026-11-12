import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings } from "../core/settings.ts";
import type { Diagnostic, Settings } from "../core/types.ts";

export interface LoadedSettings {
  settings: Settings;
  diagnostics: Diagnostic[];
}

/**
 * Read the effective `piMention` object from pi's merged settings.
 *
 * `pi.getSettings()` already merges `~/.pi/agent/settings.json` with the
 * project's `.pi/settings.json`. The pure `loadSettings` seam owns validation,
 * per-key defaults and diagnostics.
 */
export function readSettings(pi: ExtensionAPI): LoadedSettings {
  let raw: unknown;
  try {
    raw = (pi.getSettings() as { piMention?: unknown }).piMention;
  } catch {
    return loadSettings(undefined);
  }
  return loadSettings(raw);
}

/** One warning line for the diagnostics that session_start shows once. */
export function settingsWarning(diagnostics: readonly Diagnostic[]): string {
  return `pi-mention settings: ${diagnostics.map((diagnostic) => diagnostic.message).join(" ")}`;
}
