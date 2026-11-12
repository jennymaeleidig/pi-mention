import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAutocomplete } from "./autocomplete.ts";
import { installContextExpansion } from "./context.ts";
import { spansForLinesFactory } from "./colours.ts";
import { installEditorColours } from "./editor.ts";
import { installSkillInput } from "./input.ts";
import { createSessionCatalogs, type SessionCatalogs } from "./session-catalogs.ts";
import { readSettings, settingsWarning, type LoadedSettings } from "./settings.ts";

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
  let session: SessionCatalogs | undefined;
  let requestRender: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    loaded ??= readSettings(pi);
    const { settings, diagnostics } = loaded;
    const current = (session ??= createSessionCatalogs(pi, settings, { cwd: ctx.cwd }));

    if (!seamsInstalled) {
      seamsInstalled = true;
      installSkillInput(pi, settings, current);
      installContextExpansion(pi, settings, current.catalogs);
    }

    if (diagnostics.length > 0) {
      ctx.ui.notify(settingsWarning(diagnostics), "warning");
    }

    if (ctx.mode !== "tui" || uiInstalled) return;
    uiInstalled = true;

    // A server that connects or a tool that becomes active changes the live
    // catalog; bump the revision so the colour memo recomputes the same text.
    const toolsChanged = (): void => {
      current.markToolsChanged();
      requestRender?.();
    };
    pi.on("mcp_servers_change", toolsChanged);
    pi.on("tool_execution_end", toolsChanged);

    installAutocomplete(ctx.ui, settings, () => current.catalogs);
    installEditorColours(ctx.ui, spansForLinesFactory(current.catalogs, settings), (bind) => {
      requestRender = bind;
      current.setOnPathChange(bind);
    });
  });
}
