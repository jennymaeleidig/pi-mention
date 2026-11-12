import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAutocomplete } from "./autocomplete.ts";
import { installContextExpansion } from "./context.ts";
import { pathCatalog } from "./catalogs/paths.ts";
import { roleCatalog } from "./catalogs/roles.ts";
import { skillCatalog } from "./catalogs/skills.ts";
import { toolCatalog } from "./catalogs/tools.ts";
import { spansForLinesFactory } from "./colours.ts";
import { installEditorColours } from "./editor.ts";
import { installSkillInput } from "./input.ts";
import { readSettings, settingsWarning, type LoadedSettings } from "./settings.ts";
import type { Catalogs } from "../core/types.ts";

/**
 * Register the extension's pi surface. This is the one place that talks to
 * `ExtensionAPI`; the colour layer itself is pure.
 *
 * pi 1.5.2's `pi.getSettings()` throws before the session is bound, so settings
 * are read at the first `session_start`, not at registration. That is also when
 * the input and context seams are installed, so they receive the effective
 * settings. The TUI-only editor and autocomplete are installed once as well.
 * pi 1.5.2 has no settings-change event; a `/reload` that rebinds the extension,
 * or a process restart, re-reads the settings.
 */
export function register(pi: ExtensionAPI): void {
  let loaded: LoadedSettings | undefined;
  let seamsInstalled = false;
  let uiInstalled = false;

  pi.on("session_start", (_event, ctx) => {
    loaded ??= readSettings(pi);
    const { settings, diagnostics } = loaded;

    if (!seamsInstalled) {
      seamsInstalled = true;
      installSkillInput(pi, settings);
      installContextExpansion(pi, settings, { cwd: ctx.cwd });
    }

    if (diagnostics.length > 0) {
      ctx.ui.notify(settingsWarning(diagnostics), "warning");
    }

    if (ctx.mode !== "tui" || uiInstalled) return;
    uiInstalled = true;

    const paths = pathCatalog(ctx.cwd);
    const catalogs: Catalogs = {
      skills: skillCatalog(pi),
      // Read live, so a tool or server that appears mid-session reaches the
      // picker and colours without waiting for a session restart.
      get tools() {
        return toolCatalog(pi);
      },
      roles: roleCatalog(ctx.cwd),
      paths,
    };
    installAutocomplete(ctx.ui, settings, () => catalogs);
    installEditorColours(ctx.ui, spansForLinesFactory(catalogs, settings), (requestRender) =>
      paths.setOnChange(requestRender),
    );
  });
}
