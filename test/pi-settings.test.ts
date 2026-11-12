import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SETTINGS, defaultSettings } from "../src/core/settings.ts";
import { readSettings, settingsWarning } from "../src/pi/settings.ts";

const piWith = (settings: unknown): ExtensionAPI =>
  ({ getSettings: () => settings }) as unknown as ExtensionAPI;

test("readSettings validates the effective piMention key", () => {
  const { settings, diagnostics } = readSettings(
    piWith({ piMention: { triggers: { skill: "!" }, colors: { tool: "accentBg" } } }),
  );

  assert.equal(settings.triggers.skill, "!");
  assert.equal(settings.colors.tool, DEFAULT_SETTINGS.colors.tool);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.key),
    ["piMention.colors.tool"],
  );
  assert.match(settingsWarning(diagnostics), /^pi-mention settings: /);
});

test("an absent settings object yields defaults without a diagnostic", () => {
  const { settings, diagnostics } = readSettings(piWith({}));
  assert.deepEqual(settings, defaultSettings());
  assert.deepEqual(diagnostics, []);
});

test("an unreadable settings object yields defaults with one diagnostic", () => {
  const throwing = {
    getSettings: () => {
      throw new Error("settings not ready");
    },
  } as unknown as ExtensionAPI;

  for (const pi of [{}, throwing]) {
    const { settings, diagnostics } = readSettings(pi as ExtensionAPI);
    assert.deepEqual(settings, defaultSettings());
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.key, "piMention");
    assert.match(diagnostics[0]?.message ?? "", /could not be read/);
    assert.match(diagnostics[0]?.message ?? "", /defaults/);
  }
});

test("a malformed piMention reaches the caller as one diagnostic", () => {
  const { settings, diagnostics } = readSettings(piWith({ piMention: "nope" }));
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.key, "piMention");
});
