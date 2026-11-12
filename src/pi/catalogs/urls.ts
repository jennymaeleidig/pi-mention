import { createRequire } from "node:module";
import { LinkifyIt } from "linkify-it";
import type { Mention, Range, UrlSettings } from "../../core/types.ts";

const require = createRequire(import.meta.url);
const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false }).tlds(
  require("tlds") as string[],
);

function overlaps(range: Range, ranges: readonly Range[]): boolean {
  return ranges.some((other) => range.start < other.end && range.end > other.start);
}

function hostOf(raw: string): string {
  return (raw.split("/")[0] ?? "").toLowerCase();
}

/** Detect URLs, dropping any that touch code or an already-parsed mention. */
export function detectUrls(
  text: string,
  masked: readonly Range[],
  settings: UrlSettings,
): Mention[] {
  const extensions = settings.sourceExtensions.map((extension) => extension.toLowerCase());
  const out: Mention[] = [];
  for (const match of linkify.match(text) ?? []) {
    const span = { start: match.index, end: match.lastIndex };
    if (overlaps(span, masked)) continue;
    if (match.schema === "") {
      const host = hostOf(match.raw);
      if (extensions.some((extension) => host.endsWith(extension))) continue;
    }
    out.push({
      class: "url",
      trigger: "",
      label: match.raw,
      span,
    });
  }
  return out;
}
