import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillCatalog } from "../src/pi/catalogs/skills.ts";

test("skills come from pi's skill commands and keep their short label", () => {
  const pi = {
    getCommands: () => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: "/skills/tdd/SKILL.md" } },
      {
        name: "skill:code-review",
        source: "skill",
        sourceInfo: { path: "/skills/review/SKILL.md" },
      },
      { name: "review", source: "extension", sourceInfo: { path: "/ext/review.ts" } },
    ],
  } as unknown as ExtensionAPI;

  assert.deepEqual(skillCatalog(pi), [
    { class: "skill", label: "tdd", name: "skill:tdd" },
    { class: "skill", label: "code-review", name: "skill:code-review" },
  ]);
});

test("a broken command list yields an empty catalog", () => {
  const pi = {
    getCommands: () => {
      throw new Error("not ready");
    },
  } as unknown as ExtensionAPI;
  assert.deepEqual(skillCatalog(pi), []);
});
