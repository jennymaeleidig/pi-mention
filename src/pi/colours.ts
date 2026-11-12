import { mentionDocument } from "../core/document.ts";
import type { Catalogs, ColourSpan, Settings } from "../core/types.ts";
import { detectUrls } from "./catalogs/urls.ts";

/** The state a colour render reads. A new Catalog set or settings refreshes the memo. */
export interface ColourSource {
  catalogs: Catalogs;
  settings: Settings;
}

/** A per-text memo, so a render that did not change the source or text does no work. */
export function spansForLinesFactory(
  source: () => ColourSource,
): (lines: string[]) => ColourSpan[][] {
  let lastText: string | undefined;
  let lastVersion = -1;
  let lastToolsVersion = -1;
  let lastSettings: Settings | undefined;
  let lastCatalogs: Catalogs | undefined;
  let last: ColourSpan[][] = [];
  return (lines) => {
    const { catalogs, settings } = source();
    const text = lines.join("\n");
    const version = catalogs.paths.version ?? 0;
    const toolsVersion = catalogs.toolsVersion ?? 0;
    if (
      text === lastText &&
      version === lastVersion &&
      toolsVersion === lastToolsVersion &&
      settings === lastSettings &&
      catalogs === lastCatalogs
    ) {
      return last;
    }
    lastText = text;
    lastVersion = version;
    lastToolsVersion = toolsVersion;
    lastSettings = settings;
    lastCatalogs = catalogs;
    last = mentionDocument(text, catalogs, settings, { detectUrls }).lines;
    return last;
  };
}
