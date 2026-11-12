import { colourSpans } from "../core/colors.ts";
import { isPunctuationOnly, parse, triggerSpecs } from "../core/grammar.ts";
import { resolve } from "../core/resolve.ts";
import type { Catalogs, ColourSpan, Mention, Settings } from "../core/types.ts";
import { detectUrls } from "./catalogs/urls.ts";

/** Ask the adapter to start any stat that `resolve` would otherwise miss. */
function probePaths(mentions: readonly Mention[], catalogs: Catalogs): void {
  for (const mention of mentions) {
    if (mention.class !== "path") continue;
    // Mirror `longestPath`: the full label, then every prefix whose remainder
    // is punctuation only.
    catalogs.paths.probe?.(mention.label);
    for (let end = mention.label.length - 1; end > 0; end--) {
      if (!isPunctuationOnly(mention.label.slice(end))) continue;
      catalogs.paths.probe?.(mention.label.slice(0, end));
    }
  }
}

/** Colour one logical text and project the spans onto its lines. */
export function colourLines(text: string, catalogs: Catalogs, settings: Settings): ColourSpan[][] {
  const { mentions, codeRanges } = parse(text, triggerSpecs(settings));
  probePaths(mentions, catalogs);
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
  let lastToolsVersion = -1;
  let last: ColourSpan[][] = [];
  return (lines) => {
    const text = lines.join("\n");
    const version = catalogs.paths.version ?? 0;
    const toolsVersion = catalogs.toolsVersion ?? 0;
    if (text === lastText && version === lastVersion && toolsVersion === lastToolsVersion) {
      return last;
    }
    lastText = text;
    lastVersion = version;
    lastToolsVersion = toolsVersion;
    last = colourLines(text, catalogs, settings);
    return last;
  };
}
