import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { liveSkillEntries, skillCatalog, skillEntries } from "../src/pi/catalogs/skills.ts";

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
      {
        name: "skill:deploy",
        source: "skill",
        description: "Deploy the project",
        sourceInfo: { path: "/project/skills/deploy/SKILL.md", scope: "project" },
      },
    ],
  } as unknown as ExtensionAPI;

  assert.deepEqual(skillCatalog(pi), [
    { class: "skill", label: "tdd", name: "skill:tdd" },
    { class: "skill", label: "code-review", name: "skill:code-review" },
    {
      class: "skill",
      label: "deploy",
      name: "skill:deploy",
      description: "Deploy the project",
      scope: "project",
    },
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

test("skill entries carry the SKILL.md location and base directory", () => {
  const pi = {
    getCommands: () => [
      {
        name: "skill:tdd",
        source: "skill",
        sourceInfo: { path: "/skills/tdd/SKILL.md", baseDir: "/skills/tdd", scope: "user" },
      },
      {
        name: "skill:deploy",
        source: "skill",
        sourceInfo: { path: "/project/skills/deploy/SKILL.md", scope: "project" },
      },
      { name: "skill:broken", source: "skill", sourceInfo: {} },
    ],
  } as unknown as ExtensionAPI;

  assert.deepEqual(skillEntries(pi), [
    {
      target: { class: "skill", label: "tdd", name: "skill:tdd", scope: "user" },
      location: "/skills/tdd/SKILL.md",
      baseDir: "/skills/tdd",
    },
    {
      target: { class: "skill", label: "deploy", name: "skill:deploy", scope: "project" },
      location: "/project/skills/deploy/SKILL.md",
      baseDir: "/project/skills/deploy",
    },
  ]);
});

test("project-first ordering is stable and picks the project copy of a label", () => {
  const pi = {
    getCommands: () => [
      {
        name: "skill:tdd",
        source: "skill",
        sourceInfo: { path: "/user/tdd/SKILL.md", scope: "user" },
      },
      {
        name: "skill:tdd",
        source: "skill",
        sourceInfo: { path: "/project/tdd/SKILL.md", scope: "project" },
      },
      {
        name: "skill:review",
        source: "skill",
        sourceInfo: { path: "/user/review/SKILL.md", scope: "user" },
      },
    ],
  } as unknown as ExtensionAPI;

  assert.deepEqual(
    liveSkillEntries(pi, false).map((entry) => entry.location),
    ["/user/tdd/SKILL.md", "/user/review/SKILL.md"],
  );
  assert.deepEqual(
    liveSkillEntries(pi, true).map((entry) => entry.location),
    ["/project/tdd/SKILL.md", "/user/review/SKILL.md"],
  );
});
