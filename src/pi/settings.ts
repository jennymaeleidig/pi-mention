import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultSettings } from "../core/settings.ts";
import type { ColourSettings, Settings, UrlSettings } from "../core/types.ts";

interface RawMentionSettings {
  colors?: Partial<ColourSettings>;
  url?: Partial<UrlSettings>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read the colour-relevant part of `piMention`.
 *
 * Full validation, diagnostics, exclusions and trigger overrides land in #19;
 * this seam already accepts the effective object so the colour layer never
 * hard-codes a user's palette.
 */
export function readSettings(pi: ExtensionAPI): Settings {
  const settings = defaultSettings();
  let raw: unknown;
  try {
    raw = (pi.getSettings() as { piMention?: unknown }).piMention;
  } catch {
    return settings;
  }
  if (!isObject(raw)) return settings;

  const mention = raw as RawMentionSettings;
  if (isObject(mention.colors)) {
    for (const key of Object.keys(settings.colors) as Array<keyof ColourSettings>) {
      const value = mention.colors[key];
      if (typeof value === "string") settings.colors[key] = value;
    }
  }
  if (isObject(mention.url) && Array.isArray(mention.url.sourceExtensions)) {
    const extensions = mention.url.sourceExtensions.filter(
      (value): value is string => typeof value === "string",
    );
    settings.url.sourceExtensions = extensions;
  }
  return settings;
}
