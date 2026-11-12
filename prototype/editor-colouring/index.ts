/**
 * PROTOTYPE — throwaway editor-colouring probe.
 *
 * Not the final colour layer. It hard-codes a tiny catalog and a rough token
 * detector so the insertion-only ANSI approach can be judged in the real
 * prompt editor under stock pi, pi-vim-editor and pi-zentui.
 *
 * Run it with `pi --no-extensions -e prototype/editor-colouring/index.ts`.
 * See README.md for the full matrix.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CustomEditor,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";

type Role = Parameters<Theme["fg"]>[0];
type Wrap = { prefix: string; suffix: string };
type Span = { start: number; end: number; role: Role };

type Palette = {
  skill: Role;
  path: Role;
  tool: Role;
  role: Role;
  url: Role;
  unresolved: Role;
};

const PALETTES: Record<string, Palette> = {
  a: {
    skill: "mdHeading",
    path: "mdLinkUrl",
    tool: "accent",
    role: "syntaxKeyword",
    url: "mdLink",
    unresolved: "warning",
  },
  b: {
    skill: "syntaxFunction",
    path: "mdLink",
    tool: "success",
    role: "syntaxKeyword",
    url: "mdLinkUrl",
    unresolved: "error",
  },
  c: {
    skill: "syntaxNumber",
    path: "mdLinkUrl",
    tool: "accent",
    role: "success",
    url: "mdLink",
    unresolved: "warning",
  },
};

const initialPalette = process.env.MENTION_PROTO_PALETTE;
let paletteName = initialPalette && initialPalette in PALETTES ? initialPalette : "a";

const CATALOG = {
  skills: [
    "code-review",
    "codebase-design",
    "context7-docs",
    "diagnosing-bugs",
    "domain-modeling",
    "grilling",
    "herdr",
    "pr",
    "prototype",
    "research",
    "tdd",
    "wayfinder",
    "wizard",
    "writing-for-agents",
  ],
  tools: [
    "bash",
    "codemode",
    "edit",
    "read",
    "subagent",
    "webfetch",
    "write",
  ],
  roles: ["explore", "general", "review"],
};

const DEMO = [
  "$wayfinder %read &general @docs/mention-grammar.md https://example.com",
  "$unknown %nope &ghost @docs/nope.md",
  "`$tdd %edit` and @\"prototype/editor-colouring/sample path.md\"",
  "wide 😀 @docs/architecture.md, trailing https://pi.dev/docs.",
  "```text",
  "$not-a-skill %not-a-tool @not-a-path",
  "```",
  "a deliberately long line to wrap: $code-review %subagent &general @docs/expansion-contract.md https://example.com/a/very/long/url/that/keeps/going",
].join("\n");

const ESC = "\u001b";
const DONE = Symbol.for("pi-mention.proto.decorated");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length of the escape (or APC/OSC string) at `i`, or 0 for text. */
function escapeAt(text: string, i: number): number {
  if (text[i] !== ESC) return 0;
  const next = text[i + 1];
  if (next === undefined) return 1;
  if (next === "[") {
    for (let j = i + 2; j < text.length; j++) {
      const code = text.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) return j + 1 - i;
    }
    return text.length - i;
  }
  if (next === "]" || next === "_" || next === "P" || next === "^") {
    const bel = text.indexOf("\u0007", i + 2);
    const st = text.indexOf(`${ESC}\\`, i + 2);
    if (bel < 0 && st < 0) return text.length - i;
    if (bel >= 0 && (st < 0 || bel < st)) return bel + 1 - i;
    return st + 2 - i;
  }
  return 2;
}

/** True when an SGR prefix actually sets a foreground colour. */
function setsColour(sequence: string): boolean {
  for (const match of sequence.matchAll(/\u001b\[([0-9;]*)m/g)) {
    for (const part of match[1].split(";")) {
      const code = Number(part === "" ? "0" : part);
      if ((code >= 30 && code <= 38) || (code >= 90 && code <= 97)) return true;
    }
  }
  return false;
}

/**
 * Wrap the grapheme runs of a row that logical spans cover, copying every
 * escape byte verbatim. The cursor cell is just another grapheme.
 */
function paintRow(
  row: string,
  padding: number,
  seg: { startCol: number; length: number },
  spans: readonly Span[],
  wrap: (role: Role) => Wrap | undefined,
): string {
  if (spans.length === 0 || row.length === 0) return row;
  const lo = seg.startCol;
  const hi = lo + seg.length;
  const start = Math.min(padding, row.length);
  let out = row.slice(0, start);
  let i = start;
  let logical = lo;
  let open: (Wrap & { end: number }) | null = null;
  const close = () => {
    if (open) out += open.suffix;
    open = null;
  };

  while (i < row.length) {
    const esc = escapeAt(row, i);
    if (esc > 0) {
      out += row.slice(i, i + esc);
      if (open) out += open.suffix + open.prefix;
      i += esc;
      continue;
    }
    if (logical >= hi) {
      close();
      out += row.slice(i);
      break;
    }
    let next = row.indexOf(ESC, i);
    if (next < 0) next = row.length;
    for (const { segment } of segmenter.segment(row.slice(i, next))) {
      if (logical >= hi) {
        close();
        out += segment;
        continue;
      }
      if (open && logical >= open.end) close();
      const span = spans.find(
        (s) => logical < s.end && logical + segment.length > s.start,
      );
      if (span && !open) {
        const w = wrap(span.role);
        if (w) {
          out += w.prefix;
          open = { ...w, end: span.end };
        }
      }
      out += segment;
      logical += segment.length;
    }
    i = next;
  }
  close();
  return out;
}

function installDecoration(
  editor: object,
  getTheme: () => Theme | undefined,
  spansForLines: (lines: string[]) => Span[][],
): boolean {
  const ed = editor as Port;
  const marked = editor as Record<symbol, unknown>;
  if (marked[DONE]) return true;
  if (typeof ed.render !== "function" || typeof ed.getLines !== "function") {
    return false;
  }
  if (
    typeof ed.renderTopBorder !== "function" ||
    typeof ed.renderBottomBorder !== "function"
  ) {
    return false;
  }
  Object.defineProperty(editor, DONE, { value: true });

  const render = ed.render.bind(editor);
  const top = ed.renderTopBorder.bind(editor);
  const bottom = ed.renderBottomBorder.bind(editor);
  let topLine = "";
  let bottomLine = "";
  ed.renderTopBorder = (w, h) => (topLine = top(w, h));
  ed.renderBottomBorder = (w, h) => (bottomLine = bottom(w, h));

  const wraps = new WeakMap<Theme, Map<Role, Wrap | null>>();
  const wrapFor = (theme: Theme, role: Role): Wrap | undefined => {
    let map = wraps.get(theme);
    if (!map) wraps.set(theme, (map = new Map()));
    if (!map.has(role)) {
      let value: Wrap | null = null;
      try {
        const probe = theme.fg(role, "\0");
        const at = probe.indexOf("\0");
        const prefix = at > 0 ? probe.slice(0, at) : "";
        if (at > 0 && setsColour(prefix)) {
          value = { prefix, suffix: probe.slice(at + 1) };
        }
      } catch {
        // Unknown token, or a background token: fg() throws.
      }
      map.set(role, value);
    }
    return map.get(role) ?? undefined;
  };

  ed.render = (width: number): string[] => {
    const lines = render(width);
    const theme = getTheme();
    const layout = ed.buildVisualLineMap?.(ed.lastWidth ?? width);
    const rows = ed.renderedVisibleLineCount ?? 0;
    const scroll = ed.scrollOffset ?? 0;
    if (!theme || !layout || rows <= 0 || lines.length < rows + 2) return lines;
    if (lines[0] !== topLine || lines[rows + 1] !== bottomLine) return lines;

    const text = ed.getLines();
    const perLine = spansForLines(text);
    if (perLine.every((spans) => spans.length === 0)) return lines;
    const padding = Math.min(
      ed.getPaddingX?.() ?? 0,
      Math.max(0, Math.floor((width - 1) / 2)),
    );

    const out = [...lines];
    for (let r = 0; r < rows; r++) {
      const seg = layout[scroll + r];
      if (!seg) continue;
      const spans = perLine[seg.logicalLine].filter(
        (s) => s.start < seg.startCol + seg.length && s.end > seg.startCol,
      );
      if (spans.length === 0) continue;
      out[r + 1] = paintRow(lines[r + 1], padding, seg, spans, (role) =>
        wrapFor(theme, role),
      );
    }
    return out;
  };
  return true;
}

type Port = {
  getLines(): string[];
  getPaddingX?(): number;
  render(width: number): string[];
  buildVisualLineMap?(
    width: number,
  ): { logicalLine: number; startCol: number; length: number }[];
  lastWidth?: number;
  scrollOffset?: number;
  renderedVisibleLineCount?: number;
  renderTopBorder(width: number, hidden: number): string;
  renderBottomBorder(width: number, hidden: number): string;
};

/** zentui's WrappedPolishedEditor forwards the component API but not the layout. */
function innermost(editor: object): object {
  let current: object = editor;
  for (let hop = 0; hop < 4; hop++) {
    if (typeof (current as Port).buildVisualLineMap === "function") {
      return current;
    }
    const base = (current as { base?: unknown }).base;
    if (!base || typeof base !== "object") return current;
    current = base;
  }
  return current;
}

const BOUNDARY = /[\s([{<'"`]/;
const STOP = /[\s,;:!?)\]}<>"'`]/;
const URL_START = /^https?:\/\//;
const URL_STOP = /[\s<>"'`]/;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Mark fenced and inline code so tokens inside are inert. */
function inertLines(lines: string[]): boolean[][] {
  const inert = lines.map((line) => new Array<boolean>(line.length).fill(false));
  let fence = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^\s*(```|~~~)/.test(line)) {
      inert[n].fill(true);
      fence = !fence;
      continue;
    }
    if (fence) {
      inert[n].fill(true);
      continue;
    }
    let i = 0;
    while (i < line.length) {
      if (line[i] !== "`") {
        i++;
        continue;
      }
      let run = 1;
      while (line[i + run] === "`") run++;
      const close = line.indexOf("`".repeat(run), i + run);
      const end = close < 0 ? line.length : close + run;
      inert[n].fill(true, i, end);
      i = end;
    }
  }
  return inert;
}

function existsPath(label: string): boolean {
  try {
    return existsSync(resolve(process.cwd(), label));
  } catch {
    return false;
  }
}

/** Longest catalog entry that is the whole label, or a prefix before punctuation. */
function longestPrefix(
  label: string,
  entries: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const entry of entries) {
    if (!label.startsWith(entry)) continue;
    const rest = label.slice(entry.length);
    if (rest.length > 0 && !/^[.,;:!?)\]}]+$/.test(rest)) continue;
    if (!best || entry.length > best.length) best = entry;
  }
  return best;
}

function spansForLines(lines: string[]): Span[][] {
  const inert = inertLines(lines);
  const palette = PALETTES[paletteName];
  return lines.map((line, n) => {
    const spans: Span[] = [];
    let i = 0;
    while (i < line.length) {
      if (inert[n][i]) {
        i++;
        continue;
      }
      const before = i === 0 ? "" : line[i - 1];

      if (URL_START.test(line.slice(i)) && (i === 0 || BOUNDARY.test(before))) {
        let end = i;
        while (end < line.length && !URL_STOP.test(line[end])) end++;
        const raw = line.slice(i, end).replace(TRAILING, "");
        if (raw.length > "https://".length) {
          spans.push({ start: i, end: i + raw.length, role: palette.url });
          i += raw.length;
          continue;
        }
      }

      const trigger = line[i];
      if (
        (trigger === "$" || trigger === "%" || trigger === "&" || trigger === "@") &&
        (i === 0 || BOUNDARY.test(before))
      ) {
        const quoted = trigger === "@" && line[i + 1] === '"';
        const labelStart = i + (quoted ? 2 : 1);
        let end = labelStart;
        if (quoted) {
          const close = line.indexOf('"', labelStart);
          end = close < 0 ? line.length : close;
        } else {
          while (end < line.length && !STOP.test(line[end])) end++;
        }
        const label = line.slice(labelStart, end);
        if (label.length > 0) {
          const rawEnd = quoted ? Math.min(end + 1, line.length) : end;
          let role: Role;
          let matchEnd = rawEnd;
          if (trigger === "@") {
            role = existsPath(label) ? palette.path : palette.unresolved;
          } else {
            const entries =
              trigger === "$"
                ? CATALOG.skills
                : trigger === "%"
                  ? CATALOG.tools
                  : CATALOG.roles;
            const hit = longestPrefix(label, entries);
            if (hit) {
              role =
                trigger === "$"
                  ? palette.skill
                  : trigger === "%"
                    ? palette.tool
                    : palette.role;
              matchEnd = labelStart + hit.length;
            } else {
              role = palette.unresolved;
            }
          }
          spans.push({ start: i, end: matchEnd, role });
          i = Math.max(rawEnd, i + 1);
          continue;
        }
      }
      i++;
    }
    return spans;
  });
}

function legend(): string {
  const p = PALETTES[paletteName];
  return [
    `palette ${paletteName.toUpperCase()} — $skill=${p.skill}`,
    `@path=${p.path}`,
    `%tool=${p.tool}`,
    `&role=${p.role}`,
    `url=${p.url}`,
    `unresolved=${p.unresolved}`,
    "type /mention-proto-palette to switch, /mention-proto-demo to reset",
  ].join(" · ");
}

export default function proto(pi: ExtensionAPI): void {
  let installed = false;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || installed) return;
    installed = true;

    const previous = ctx.ui.getEditorComponent();
    let constructing = false;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      if (constructing) return new CustomEditor(tui, theme, keybindings);
      constructing = true;
      try {
        const editor =
          previous?.(tui, theme, keybindings) ??
          new CustomEditor(tui, theme, keybindings);
        if (!installDecoration(innermost(editor), () => ctx.ui.theme, spansForLines)) {
          ctx.ui.notify(
            "mention proto: this editor exposes no layout; colours are off. Load the proto before pi-zentui.",
            "warning",
          );
        }
        return editor;
      } finally {
        constructing = false;
      }
    });

    if (ctx.ui.getEditorText().trim() === "") ctx.ui.setEditorText(DEMO);
    ctx.ui.notify(legend(), "info");
  });

  pi.registerCommand("mention-proto-palette", {
    description: "PROTOTYPE: switch the mention colour palette",
    handler: async (_args, ctx) => {
      const names = Object.keys(PALETTES);
      paletteName = names[(names.indexOf(paletteName) + 1) % names.length];
      ctx.ui.notify(legend(), "info");
    },
  });

  pi.registerCommand("mention-proto-demo", {
    description: "PROTOTYPE: reset the demo prompt",
    handler: async (_args, ctx) => {
      ctx.ui.setEditorText(DEMO);
      ctx.ui.notify(legend(), "info");
    },
  });
}
