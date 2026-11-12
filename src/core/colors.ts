import type { ColourSettings, ColourSpan, ResolvedMention, Settings } from "./types.ts";

function roleFor(resolved: ResolvedMention, colors: ColourSettings): string {
  if (resolved.status === "unresolved") return colors.unresolved;
  if (resolved.status === "excluded") return colors.excluded;
  switch (resolved.mention.class) {
    case "skill":
      return colors.skill;
    case "path":
      return colors.path;
    case "tool":
      return colors.tool;
    case "role":
      return colors.role;
    case "url":
      return colors.url;
  }
}

/** Map resolved mentions to paintable spans. Pure. */
export function colourSpans(
  _text: string,
  resolved: readonly ResolvedMention[],
  settings: Settings,
): ColourSpan[] {
  return resolved
    .map((mention) => ({
      start: mention.mention.span.start,
      end: mention.mention.span.end,
      role: roleFor(mention, settings.colors),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
