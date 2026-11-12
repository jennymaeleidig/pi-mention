import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAutocomplete } from "./autocomplete.ts";
import { installContextEscapes } from "./context.ts";
import { pathCatalog } from "./catalogs/paths.ts";
import { roleCatalog } from "./catalogs/roles.ts";
import { skillCatalog } from "./catalogs/skills.ts";
import { toolCatalog } from "./catalogs/tools.ts";
import { spansForLinesFactory } from "./colours.ts";
import { installEditorColours } from "./editor.ts";
import { installSkillInput } from "./input.ts";
import { readSettings, settingsWarning, type LoadedSettings } from "./settings.ts";

/**
 * Register the extension's pi surface. This is the one place that talks to
 * `ExtensionAPI`; the colour layer itself is pure.
 *
 * pi 1.5.2 has no settings-change event. `pi.getSettings()` is read once when
 * the extension is registered; a `/reload` that rebinds the extension (or a
 * process restart) re-reads the settings.
 */
export function register(pi: ExtensionAPI): void {
  const loaded: LoadedSettings = readSettings(pi);
  let installed = false;

  installSkillInput(pi, loaded.settings);
  installContextEscapes(pi, loaded.settings);

  pi.on("session_start", (_event, ctx) => {
    if (loaded.diagnostics.length > 0) {
      ctx.ui.notify(settingsWarning(loaded.diagnostics), "warning");
    }

    if (ctx.mode !== "tui" || installed) return;
    installed = true;

    const { settings } = loaded;
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
