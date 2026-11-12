import assert from "node:assert/strict";
import { test } from "node:test";
import { spansForLinesFactory } from "../src/pi/colours.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Target } from "../src/core/types.ts";

const base: Catalogs = {
  skills: [{ class: "skill", label: "wayfinder" }],
  tools: [{ class: "tool", label: "read", name: "read" }],
  roles: [{ class: "role", label: "general" }],
  paths: { has: () => false, probe: () => {} },
};
const settings = defaultSettings();

test("the colour memo recomputes the same text when a tool appears", () => {
  const tools: Target[] = [];
  let toolsVersion = 0;
  const live: Catalogs = {
    ...base,
    get tools() {
      return tools;
    },
    get toolsVersion() {
      return toolsVersion;
    },
  };
  const spansForLines = spansForLinesFactory(live, settings);

  assert.deepEqual(spansForLines(["%late"])[0], [{ start: 0, end: 5, role: "warning" }]);

  tools.push({ class: "tool", label: "late", name: "late" });
  toolsVersion++;

  assert.deepEqual(spansForLines(["%late"])[0], [{ start: 0, end: 5, role: "accent" }]);
});

test("the colour memo recomputes the same text when a path probe lands", () => {
  let exists = false;
  let version = 0;
  const live: Catalogs = {
    ...base,
    paths: {
      has: () => exists,
      probe: () => {},
      get version() {
        return version;
      },
    },
  };
  const spansForLines = spansForLinesFactory(live, settings);

  assert.deepEqual(spansForLines(["@exists.ts"])[0], [{ start: 0, end: 10, role: "warning" }]);

  exists = true;
  version++;

  assert.deepEqual(spansForLines(["@exists.ts"])[0], [{ start: 0, end: 10, role: "mdLinkUrl" }]);
});

test("the memo returns the same result for unchanged text and versions", () => {
  const spansForLines = spansForLinesFactory(base, settings);
  const first = spansForLines(["$wayfinder"]);
  assert.equal(spansForLines(["$wayfinder"]), first);
});
