import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAutocomplete } from "./autocomplete.ts";
import { pathCatalog } from "./catalogs/paths.ts";
import { roleCatalog } from "./catalogs/roles.ts";
import { skillCatalog } from "./catalogs/skills.ts";
import { toolCatalog } from "./catalogs/tools.ts";
import { spansForLinesFactory } from "./colours.ts";
import { installEditorColours } from "./editor.ts";
import { readSettings } from "./settings.ts";

/**
 * Register the extension's pi surface. This is the one place that talks to
 * `ExtensionAPI`; the colour layer itself is pure.
 */
export function register(pi: ExtensionAPI): void {
  let installed = false;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || installed) return;
    installed = true;

    const settings = readSettings(pi);
    const paths = pathCatalog(ctx.cwd);
    const catalogs = {
      skills: skillCatalog(pi),
      tools: toolCatalog(pi),
      roles: roleCatalog(ctx.cwd),
      paths,
    };
    installAutocomplete(ctx.ui, settings, () => catalogs);
    installEditorColours(ctx.ui, spansForLinesFactory(catalogs, settings), (requestRender) =>
      paths.setOnChange(requestRender),
    );
  });
}
