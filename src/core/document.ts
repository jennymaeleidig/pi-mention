import { colourSpans } from "./colors.ts";
import { parse, triggerSpecs } from "./grammar.ts";
import { pathCandidates, resolve } from "./resolve.ts";
import type { Catalogs, ColourSpan, Mention, Range, Settings, UrlSettings } from "./types.ts";

/** Detect the URL mentions a colour pass should paint. The adapter owns linkify. */
export type UrlDetector = (
  text: string,
  masked: readonly Range[],
  settings: UrlSettings,
) => Mention[];

export interface MentionDocument {
  /** Every paintable span in the whole text, in document order. */
  spans: ColourSpan[];
  /** The same spans projected onto each line, in line order. */
  lines: ColourSpan[][];
}

/** Ask the path catalog to start every stat that `resolve` would otherwise miss. */
function probePaths(mentions: readonly Mention[], catalogs: Catalogs): void {
  for (const mention of mentions) {
    if (mention.class !== "path") continue;
    for (const candidate of pathCandidates(mention.label)) {
      catalogs.paths.probe(candidate);
    }
  }
}

/**
 * Compose the colour result for one logical text.
 *
 * Parsing, path probing, resolution, URL detection, span validation and line
 * projection live here as one sequence. The URL detector is an input, so linkify
 * and tlds stay behind the pi adapter while the composition stays testable in
 * core.
 */
export function mentionDocument(
  text: string,
  catalogs: Catalogs,
  settings: Settings,
  options: { detectUrls: UrlDetector },
): MentionDocument {
  const { mentions, codeRanges } = parse(text, triggerSpecs(settings));
  probePaths(mentions, catalogs);
  const resolved = resolve(mentions, catalogs, settings);
  const urls = options.detectUrls(
    text,
    [...codeRanges, ...mentions.map((mention) => mention.span)],
    settings.url,
  );
  const urlResolved = resolve(urls, catalogs, settings);
  const spans = colourSpans(text, [...resolved, ...urlResolved], settings);

  const lines: ColourSpan[][] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const start = lineStart;
    const end = start + line.length;
    lineStart = end + 1;
    lines.push(
      spans
        .filter((span) => span.start < end && span.end > start)
        .map((span) => ({
          start: Math.max(span.start, start) - start,
          end: Math.min(span.end, end) - start,
          role: span.role,
        })),
    );
  }

  return { spans, lines };
}
