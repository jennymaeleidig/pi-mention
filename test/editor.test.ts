import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { installEditorColours } from "../src/pi/editor.ts";
import type { ColourSpan } from "../src/core/types.ts";

const WIDTH = 20;
const BORDER = "\u2500".repeat(WIDTH);
const COLOR = "\u001b[32m";
const RESET = "\u001b[39m";

const theme = {
  fg: (_role: string, text: string) => `${COLOR}${text}${RESET}`,
} as unknown as Theme;

class FakeEditor {
  lastWidth = WIDTH;
  scrollOffset = 0;
  renderedVisibleLineCount: number;
  private readonly lines: string[];
  private readonly tampered: boolean;

  constructor(lines: string[], tampered = false) {
    this.lines = lines;
    this.tampered = tampered;
    this.renderedVisibleLineCount = lines.length;
  }

  getLines(): string[] {
    return this.lines;
  }

  getPaddingX(): number {
    return 0;
  }

  buildVisualLineMap(): { logicalLine: number; startCol: number; length: number }[] {
    return this.lines.map((_line, logicalLine) => ({
      logicalLine,
      startCol: 0,
      length: WIDTH,
    }));
  }

  renderTopBorder(width: number, _hidden = 0): string {
    return "\u2500".repeat(width);
  }

  renderBottomBorder(width: number, _hidden = 0): string {
    return "\u2500".repeat(width);
  }

  render(width: number): string[] {
    const top = this.renderTopBorder(width, 0);
    const bottom = this.renderBottomBorder(width, 0);
    const rows = this.lines.map((line) => line.padEnd(width));
    return [this.tampered ? "=".repeat(width) : top, ...rows, bottom];
  }
}

function install(editor: object, spans: ColourSpan[][]) {
  let installed: ((tui: unknown, theme: Theme, keybindings: unknown) => object) | undefined;
  const notifications: string[] = [];
  const previous = () => editor;
  const ui = {
    getEditorComponent: () => previous,
    setEditorComponent: (factory: (tui: unknown, theme: Theme, keybindings: unknown) => object) => {
      installed = factory;
    },
    theme,
    notify: (message: string) => notifications.push(message),
  } as unknown as ExtensionUIContext;

  installEditorColours(ui, () => spans);
  assert.ok(installed);
  const result = installed({ requestRender: () => {} }, theme, {}) as {
    render(width: number): string[];
  };
  return { result, notifications };
}

test("the installed editor paints mention spans inside Pi's frame", () => {
  const editor = new FakeEditor(["$tdd"]);
  const { result, notifications } = install(editor, [[{ start: 0, end: 4, role: "syntaxNumber" }]]);

  assert.deepEqual(result.render(WIDTH), [
    BORDER,
    `${COLOR}$tdd${RESET}${" ".repeat(WIDTH - 4)}`,
    BORDER,
  ]);
  assert.deepEqual(notifications, []);
});

test("a tampered frame passes through unpainted", () => {
  const editor = new FakeEditor(["$tdd"], true);
  const { result } = install(editor, [[{ start: 0, end: 4, role: "syntaxNumber" }]]);

  assert.deepEqual(result.render(WIDTH), ["=".repeat(WIDTH), "$tdd".padEnd(WIDTH), BORDER]);
});

test("an editor without layout support is left alone and notified once", () => {
  const editor = {
    getLines: () => ["$tdd"],
    render: () => [BORDER, "$tdd".padEnd(WIDTH), BORDER],
  };
  let installed: ((tui: unknown, theme: Theme, keybindings: unknown) => object) | undefined;
  const notifications: string[] = [];
  const ui = {
    getEditorComponent: () => () => editor,
    setEditorComponent: (factory: (tui: unknown, theme: Theme, keybindings: unknown) => object) => {
      installed = factory;
    },
    theme,
    notify: (message: string) => notifications.push(message),
  } as unknown as ExtensionUIContext;

  installEditorColours(ui, () => [[{ start: 0, end: 4, role: "syntaxNumber" }]]);
  assert.ok(installed);
  const result = installed({ requestRender: () => {} }, theme, {}) as {
    render(width: number): string[];
  };

  assert.equal(result, editor);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0] ?? "", /doesn't expose its layout/);
});
