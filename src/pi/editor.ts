import { CustomEditor, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { paintRow, stripAnsi, type PaintWrap } from "../core/paint.ts";
import type { ColourSpan } from "../core/types.ts";

type Role = Parameters<Theme["fg"]>[0];
type Wrap = PaintWrap;

/** The private slice of pi-tui's Editor a decorator needs. Probed, never assumed. */
type Port = {
  getLines(): string[];
  getPaddingX?(): number;
  render(width: number): string[];
  buildVisualLineMap?(width: number): { logicalLine: number; startCol: number; length: number }[];
  lastWidth?: number;
  scrollOffset?: number;
  renderedVisibleLineCount?: number;
  renderTopBorder(width: number, hidden: number): string;
  renderBottomBorder(width: number, hidden: number): string;
};

const DONE = Symbol.for("pi-mention.decorated");
const ZENTUI_FACTORY = Symbol.for("pi-zentui.editor-factory");
const VIM_EDITOR = Symbol.for("pi-vim-editor");

function isZentuiFactory(factory: unknown): boolean {
  return Boolean((factory as Record<symbol, unknown> | undefined)?.[ZENTUI_FACTORY]);
}

function isZentuiEditor(editor: object): boolean {
  return (editor.constructor?.name ?? "").includes("PolishedEditor");
}

/** zentui's WrappedPolishedEditor forwards the component API but not the layout. */
function innermost(editor: object): object {
  let current: object = editor;
  for (let hop = 0; hop < 4; hop++) {
    if (typeof (current as Port).buildVisualLineMap === "function") return current;
    const base = (current as { base?: unknown }).base;
    if (!base || typeof base !== "object") return current;
    current = base;
  }
  return current;
}

/**
 * True when `row` is the frame `expected`, allowing pi-vim-editor's mode
 * label on a border. Vim replaces a contiguous run of border dashes with its
 * status (`──── NORMAL ────`), so the changed cells in `expected` must all be
 * dashes and the corresponding cells in `row` must be a non-empty label with
 * no dashes. A title inserted into other border content is not the frame.
 */
export function frameRowMatches(
  row: string,
  expected: string,
  width: number,
  allowVimLabel: boolean,
): boolean {
  if (row === expected) return true;
  if (!allowVimLabel) return false;
  const got = stripAnsi(row);
  const want = stripAnsi(expected);
  if (got.length !== width || want.length !== width) return false;
  if (got.charAt(0) !== want.charAt(0)) return false;
  if (got.charAt(got.length - 1) !== want.charAt(want.length - 1)) return false;

  let start = -1;
  let end = -1;
  for (let i = 0; i < width; i++) {
    if (got[i] === want[i]) continue;
    if (start < 0) start = i;
    else if (end !== i - 1) return false;
    end = i;
  }
  if (start < 0) return false;
  for (let i = start; i <= end; i++) {
    if (want[i] !== "\u2500") return false;
    if (got[i] === "\u2500") return false;
  }
  return true;
}

/** True when an SGR prefix actually sets a foreground colour. */
function setsColour(sequence: string): boolean {
  for (const match of sequence.matchAll(/\u001b\[([0-9;]*)m/g)) {
    for (const part of (match[1] ?? "").split(";")) {
      const code = Number(part === "" ? "0" : part);
      if ((code >= 30 && code <= 38) || (code >= 90 && code <= 97)) return true;
    }
  }
  return false;
}

function wrapFor(theme: Theme, role: string): Wrap | undefined {
  let probe: string;
  try {
    probe = theme.fg(role as Role, "\0");
  } catch {
    return undefined;
  }
  const at = probe.indexOf("\0");
  if (at <= 0) return undefined;
  const prefix = probe.slice(0, at);
  if (!setsColour(prefix)) return undefined;
  return { prefix, suffix: probe.slice(at + 1) };
}

function installDecoration(
  editor: object,
  getTheme: () => Theme,
  spansForLines: (lines: string[]) => ColourSpan[][],
): boolean {
  const port = editor as Port;
  const marked = editor as Record<symbol, unknown>;
  if (marked[DONE]) return true;
  if (typeof port.render !== "function" || typeof port.getLines !== "function") return false;
  if (typeof port.buildVisualLineMap !== "function") return false;
  if (
    typeof port.renderTopBorder !== "function" ||
    typeof port.renderBottomBorder !== "function" ||
    !("lastWidth" in port) ||
    !("scrollOffset" in port) ||
    !("renderedVisibleLineCount" in port)
  ) {
    return false;
  }
  Object.defineProperty(editor, DONE, { value: true });

  const render = port.render.bind(editor);
  const top = port.renderTopBorder.bind(editor);
  const bottom = port.renderBottomBorder.bind(editor);
  let topLine = "";
  let bottomLine = "";
  port.renderTopBorder = (width, hidden) => (topLine = top(width, hidden));
  port.renderBottomBorder = (width, hidden) => (bottomLine = bottom(width, hidden));

  const wraps = new WeakMap<Theme, Map<string, Wrap | undefined>>();
  const wrap = (theme: Theme, role: string): Wrap | undefined => {
    let cache = wraps.get(theme);
    if (!cache) wraps.set(theme, (cache = new Map()));
    if (!cache.has(role)) cache.set(role, wrapFor(theme, role));
    return cache.get(role);
  };

  port.render = (width: number): string[] => {
    const lines = render(width);
    const theme = getTheme();
    const layout = port.buildVisualLineMap?.(port.lastWidth ?? width);
    const rows = port.renderedVisibleLineCount ?? 0;
    const scroll = port.scrollOffset ?? 0;
    if (!theme || !layout || rows <= 0 || lines.length < rows + 2) return lines;
    // Refuse to touch anything that is not Pi's own frame: a framer may have
    // rendered the base at another width, or replaced these rows. Vim is the
    // one framer we compose with; it writes its mode label into the bottom
    // border, so only that row may relax to a dash-run label.
    const vim = VIM_EDITOR in port;
    if (
      !frameRowMatches(lines[0] ?? "", topLine, width, false) ||
      !frameRowMatches(lines[rows + 1] ?? "", bottomLine, width, vim)
    ) {
      return lines;
    }

    const perLine = spansForLines(port.getLines());
    if (perLine.every((spans) => spans.length === 0)) return lines;
    const padding = Math.min(port.getPaddingX?.() ?? 0, Math.max(0, Math.floor((width - 1) / 2)));

    const out = [...lines];
    for (let row = 0; row < rows; row++) {
      const segment = layout[scroll + row];
      if (!segment) continue;
      const spans = perLine[segment.logicalLine]?.filter(
        (span) => span.start < segment.startCol + segment.length && span.end > segment.startCol,
      );
      if (!spans || spans.length === 0) continue;
      const line = lines[row + 1];
      if (line === undefined) continue;
      out[row + 1] = paintRow(line, padding, segment, spans, (role) => wrap(theme, role));
    }
    return out;
  };
  return true;
}

/** Wrap the installed editor in place, returning the same editor to pi. */
export function installEditorColours(
  ui: ExtensionUIContext,
  spansForLines: (lines: string[]) => ColourSpan[][],
  bindRender?: (requestRender: () => void) => void,
): void {
  const previous = ui.getEditorComponent();
  let constructing = false;
  let notified = false;
  const notify = () => {
    if (notified) return;
    notified = true;
    ui.notify(
      "pi-mention: this editor doesn't expose its layout, so mention colours are off. " +
        "Load pi-mention before pi-zentui.",
      "info",
    );
  };

  // zentui already owns the frame. Its PolishedEditor calls super.render(),
  // bypassing an instance override, so decoration would silently do nothing.
  if (isZentuiFactory(previous)) {
    notify();
    return;
  }

  ui.setEditorComponent((tui, theme, keybindings) => {
    bindRender?.(() => tui.requestRender());
    // zentui re-installs on settings changes and would otherwise nest its old
    // editor inside this factory. A plain editor is the safe fallback.
    if (constructing) return new CustomEditor(tui, theme, keybindings);
    constructing = true;
    try {
      const editor =
        previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      if (isZentuiEditor(editor)) {
        notify();
        return editor;
      }
      if (!installDecoration(innermost(editor), () => ui.theme, spansForLines)) {
        notify();
      }
      return editor;
    } finally {
      constructing = false;
    }
  });
}
