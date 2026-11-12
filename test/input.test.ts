import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseSkillBlock,
  type ExtensionAPI,
  type ExtensionContext,
  type InputEvent,
  type InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { installSkillInput } from "../src/pi/input.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Settings } from "../src/core/types.ts";

type Handler = (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>;

interface Command {
  name: string;
  source: "skill";
  sourceInfo: { path: string; scope?: "user" | "project"; baseDir?: string };
}

function setup(commands: () => Command[], settings: Settings = defaultSettings()) {
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, callback: Handler) => {
      if (name === "input") handler = callback;
      return () => {};
    },
    getCommands: commands,
  } as unknown as ExtensionAPI;

  installSkillInput(pi, settings);

  return async (
    text: string,
    options: { mode?: string; hasUI?: boolean } = {},
  ): Promise<{ result: InputEventResult; notifications: string[] }> => {
    assert.ok(handler);
    const notifications: string[] = [];
    const ctx = {
      mode: options.mode ?? "tui",
      hasUI: options.hasUI ?? false,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionContext;
    const result = await handler({ type: "input", text, source: "interactive" }, ctx);
    return { result, notifications };
  };
}

async function withSkill(body: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-mention-input-"));
  const file = join(dir, "SKILL.md");
  await writeFile(file, body);
  return { dir, file };
}

test("a sent skill mention becomes Pi's native block with the prose hoisted", async () => {
  const { dir, file } = await withSkill("---\nname: tdd\n---\n# TDD\n\nWrite tests.\n");
  try {
    const run = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);
    const { result } = await run("please $tdd review this");

    assert.equal(result.action, "transform");
    if (result.action !== "transform") return;
    assert.deepEqual(parseSkillBlock(result.text), {
      name: "tdd",
      location: file,
      content: `References are relative to ${dir}.\n\n# TDD\n\nWrite tests.`,
      userMessage: "please review this",
    });
    assert.equal(result.text.endsWith("\n"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("later skills, unknown skills, and code stay literal", async () => {
  const { dir, file } = await withSkill("Body.");
  try {
    const run = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
      { name: "skill:other", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);

    const later = await run("$tdd $other");
    assert.equal(later.result.action, "transform");
    if (later.result.action === "transform") {
      assert.equal(parseSkillBlock(later.result.text)?.userMessage, "$other");
    }

    assert.deepEqual((await run("$nope")).result, { action: "continue" });
    assert.deepEqual((await run("$nope $tdd")).result, { action: "continue" });
    assert.deepEqual((await run("```\n$tdd\n```")).result, { action: "continue" });
    assert.deepEqual((await run("`$tdd`")).result, { action: "continue" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pi owns /skill: and a message without the trigger passes straight through", async () => {
  const { dir, file } = await withSkill("Body.");
  try {
    const run = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);
    assert.deepEqual((await run("/skill:tdd $other")).result, { action: "continue" });
    assert.deepEqual((await run("no mentions here")).result, { action: "continue" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("project skills win when project-first is configured", async () => {
  const user = await withSkill("User body.");
  const project = await withSkill("Project body.");
  try {
    const commands = () => [
      {
        name: "skill:tdd",
        source: "skill" as const,
        sourceInfo: { path: user.file, scope: "user" as const },
      },
      {
        name: "skill:tdd",
        source: "skill" as const,
        sourceInfo: { path: project.file, scope: "project" as const },
      },
    ];
    const settings = defaultSettings();
    settings.ranking.projectSkillsFirst = true;
    const selected = await setup(commands, settings)("$tdd");
    assert.equal(selected.result.action, "transform");
    if (selected.result.action === "transform") {
      const parsed = parseSkillBlock(selected.result.text);
      assert.equal(parsed?.location, project.file);
      assert.match(parsed?.content ?? "", /Project body/);
    }

    const userFirst = await setup(commands)("$tdd");
    assert.equal(userFirst.result.action, "transform");
    if (userFirst.result.action === "transform") {
      assert.equal(parseSkillBlock(userFirst.result.text)?.location, user.file);
    }
  } finally {
    await rm(user.dir, { recursive: true, force: true });
    await rm(project.dir, { recursive: true, force: true });
  }
});

test("an unreadable skill or an unrepresentable body stays literal and notifies once", async () => {
  const missing = join(tmpdir(), `pi-mention-missing-${process.pid}.md`);
  const runMissing = setup(() => [
    { name: "skill:tdd", source: "skill", sourceInfo: { path: missing } },
  ]);
  const absent = await runMissing("$tdd", { hasUI: true });
  assert.deepEqual(absent.result, { action: "continue" });
  assert.equal(absent.notifications.length, 1);
  assert.match(absent.notifications[0] ?? "", /Could not expand \$tdd/);
  assert.deepEqual((await runMissing("$tdd", { hasUI: false })).notifications, []);

  const { dir, file } = await withSkill("before\n</skill>\nafter");
  try {
    const runUnsafe = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);
    const unsafe = await runUnsafe("$tdd", { hasUI: true });
    assert.deepEqual(unsafe.result, { action: "continue" });
    assert.equal(unsafe.notifications.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("print, JSON and RPC modes transform without crashing", async () => {
  const { dir, file } = await withSkill("Body.");
  try {
    const run = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);
    for (const mode of ["print", "json", "rpc"]) {
      const { result } = await run("$tdd", { mode, hasUI: mode === "rpc" });
      assert.equal(result.action, "transform", mode);
      if (result.action === "transform") {
        assert.equal(parseSkillBlock(result.text)?.name, "tdd");
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an existing native skill block stays untouched, even with a trigger in its body", async () => {
  const { dir, file } = await withSkill("Body.");
  try {
    const run = setup(() => [
      { name: "skill:tdd", source: "skill", sourceInfo: { path: file, baseDir: dir } },
    ]);
    const restored =
      '<skill name="old" location="/abs/old/SKILL.md">\n' +
      "References are relative to /abs/old.\n\nKeep $other literally.\n</skill>\n\nplease \\$PATH";

    assert.deepEqual((await run(restored)).result, { action: "continue" });
    assert.deepEqual((await run(`  ${restored}`)).result, { action: "continue" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the configured skill trigger works and escaped triggers survive the block", async () => {
  const { dir, file } = await withSkill("Body.");
  try {
    const commands = () => [
      { name: "skill:tdd", source: "skill" as const, sourceInfo: { path: file, baseDir: dir } },
    ];
    const escaped = await setup(commands)("$tdd please \\$PATH");
    assert.equal(escaped.result.action, "transform");
    if (escaped.result.action === "transform") {
      assert.equal(parseSkillBlock(escaped.result.text)?.userMessage, "please \\$PATH");
    }

    const settings = defaultSettings();
    settings.triggers.skill = "!";
    const configured = setup(commands, settings);
    assert.equal((await configured("!tdd")).result.action, "transform");
    assert.deepEqual((await configured("$tdd")).result, { action: "continue" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
