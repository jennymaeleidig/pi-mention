import { colourSpans } from "../core/colors.ts";
import { parse, type TriggerSpec } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Catalogs, ColourSpan, Settings } from "../core/types.ts";
import { detectUrls } from "./catalogs/urls.ts";

function specsFor(settings: Settings): TriggerSpec[] {
  return [
    { class: "skill", trigger: settings.triggers.skill },
    { class: "path", trigger: "@" },
    { class: "tool", trigger: settings.triggers.tool },
    { class: "role", trigger: settings.triggers.role },
  ];
}

/** Colour one logical text and project the spans onto its lines. */
export function colourLines(text: string, catalogs: Catalogs, settings: Settings): ColourSpan[][] {
  const { mentions, codeRanges } = parse(text, specsFor(settings));
  const resolved = resolve(mentions, catalogs, settings);
  const urls = detectUrls(
    text,
    [...codeRanges, ...mentions.map((mention) => mention.span)],
    settings.url,
  );
  const urlResolved = resolve(urls, catalogs, settings);
  const spans = colourSpans(text, [...resolved, ...urlResolved], settings);

  const lines = text.split("\n");
  let lineStart = 0;
  return lines.map((line) => {
    const start = lineStart;
    const end = start + line.length;
    lineStart = end + 1;
    return spans
      .filter((span) => span.start < end && span.end > start)
      .map((span) => ({
        start: Math.max(span.start, start) - start,
        end: Math.min(span.end, end) - start,
        role: span.role,
      }));
  });
}

/** A per-text memo, so a render that did not change the text does no work. */
export function spansForLinesFactory(
  catalogs: Catalogs,
  settings: Settings,
): (lines: string[]) => ColourSpan[][] {
  let lastText: string | undefined;
  let lastVersion = -1;
  let last: ColourSpan[][] = [];
  return (lines) => {
    const text = lines.join("\n");
    const version = catalogs.paths.version ?? 0;
    if (text === lastText && version === lastVersion) return last;
    lastText = text;
    lastVersion = version;
    last = colourLines(text, catalogs, settings);
    return last;
  };
}
