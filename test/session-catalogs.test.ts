import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { defaultSettings } from "../src/core/settings.ts";
import type { Settings } from "../src/core/types.ts";
import { createSessionCatalogs } from "../src/pi/session-catalogs.ts";

interface Command {
  name: string;
  source: "skill";
  sourceInfo: {
    path?: string;
    baseDir?: string;
    scope?: "user" | "project" | "temporary";
  };
}

function tool(name: string): ToolInfo {
  return {
    name,
    description: name,
    parameters: {},
    exposure: "direct",
    sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" },
  } as ToolInfo;
}

function harness(commands: () => Command[], tools: () => ToolInfo[] = () => [tool("read")]) {
  return {
    on: () => () => {},
    getCommands: commands,
    getAllTools: tools,
    getActiveTools: () => tools().map((candidate) => candidate.name),
  } as unknown as ExtensionAPI;
}

function tempRoot(): { root: string; cwd: string; agentDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-mention-session-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "user");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return {
    root,
    cwd,
    agentDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeRole(agentDir: string, name: string): void {
  const dir = join(agentDir, "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

const command = (label: string, scope: "user" | "project", dir: string): Command => ({
  name: `skill:${label}`,
  source: "skill",
  sourceInfo: { path: join(dir, "SKILL.md"), baseDir: dir, scope },
});

test("one construction supplies the four live Catalogs", () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    writeRole(agentDir, "general");
    let commands: Command[] = [command("tdd", "user", "/user/tdd")];
    let tools: ToolInfo[] = [tool("read")];
    const session = createSessionCatalogs(
      harness(
        () => commands,
        () => tools,
      ),
      defaultSettings(),
      { cwd, agentDir },
    );

    assert.deepEqual(
      session.catalogs.skills.map((target) => target.label),
      ["tdd"],
    );
    commands = [
      command("tdd", "user", "/user/tdd"),
      command("review", "project", "/project/review"),
    ];
    assert.deepEqual(
      session.catalogs.skills.map((target) => target.label),
      ["tdd", "review"],
      "skills are read live",
    );

    assert.deepEqual(
      session.catalogs.tools.map((target) => target.label),
      ["read"],
    );
    tools = [tool("read"), tool("bash")];
    assert.deepEqual(
      session.catalogs.tools.map((target) => target.label),
      ["read", "bash"],
      "tools are read live",
    );

    assert.deepEqual(
      session.catalogs.roles.map((target) => target.label),
      ["general"],
    );
  } finally {
    cleanup();
  }
});

test("skillEntry follows project-first and matches the registered name", () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    const settings: Settings = defaultSettings();
    settings.ranking.projectSkillsFirst = true;
    const commands: Command[] = [
      command("tdd", "user", "/user/tdd"),
      command("tdd", "project", "/project/tdd"),
    ];
    const session = createSessionCatalogs(
      harness(() => commands),
      settings,
      { cwd, agentDir },
    );

    const [target] = session.catalogs.skills;
    assert.ok(target);
    const entry = session.skillEntry(target);
    assert.equal(entry?.location, "/project/tdd/SKILL.md");
    assert.equal(entry?.baseDir, "/project/tdd");
  } finally {
    cleanup();
  }
});

test("a pathless skill stays in the catalog and has no entry", () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    const commands: Command[] = [
      { name: "skill:inline", source: "skill", sourceInfo: { scope: "user" } },
      command("tdd", "user", "/user/tdd"),
    ];
    const session = createSessionCatalogs(
      harness(() => commands),
      defaultSettings(),
      {
        cwd,
        agentDir,
      },
    );

    assert.deepEqual(
      session.catalogs.skills.map((target) => target.label),
      ["inline", "tdd"],
    );
    const inline = session.catalogs.skills.find((target) => target.label === "inline");
    assert.ok(inline);
    assert.equal(session.skillEntry(inline), undefined);
  } finally {
    cleanup();
  }
});

test("markToolsChanged bumps the revision without rebuilding the Catalog", () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    const session = createSessionCatalogs(
      harness(() => []),
      defaultSettings(),
      { cwd, agentDir },
    );
    assert.equal(session.catalogs.toolsVersion, 0);
    session.markToolsChanged();
    assert.equal(session.catalogs.toolsVersion, 1);
  } finally {
    cleanup();
  }
});

test("setOnPathChange receives the callback that a landing probe triggers", async () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    writeFileSync(join(cwd, "exists.ts"), "");
    const session = createSessionCatalogs(
      harness(() => []),
      defaultSettings(),
      { cwd, agentDir },
    );
    let changes = 0;
    session.setOnPathChange(() => changes++);

    assert.equal(session.catalogs.paths.has("exists.ts"), false);
    session.catalogs.paths.probe("exists.ts");
    for (let i = 0; i < 100 && changes === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(changes, 1);
    assert.equal(session.catalogs.paths.has("exists.ts"), true);
  } finally {
    cleanup();
  }
});

test("a broken command list yields empty skills rather than throwing", () => {
  const { cwd, agentDir, cleanup } = tempRoot();
  try {
    const pi = {
      on: () => () => {},
      getCommands: () => {
        throw new Error("no commands");
      },
    } as unknown as ExtensionAPI;
    const session = createSessionCatalogs(pi, defaultSettings(), { cwd, agentDir });
    assert.deepEqual(session.catalogs.skills, []);
    assert.equal(session.skillEntry({ class: "skill", label: "tdd" }), undefined);
  } finally {
    cleanup();
  }
});
