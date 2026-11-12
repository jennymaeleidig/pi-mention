import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSkillBlock, expandRoles } from "../src/core/expand.ts";
import { parse, triggerSpecs } from "../src/core/grammar.ts";
import { resolve } from "../src/core/resolve.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Settings } from "../src/core/types.ts";
import { dispatch, noTask } from "./fixtures/role-text.ts";

const catalogs: Catalogs = {
  skills: [],
  tools: [],
  roles: [
    { class: "role", label: "general", name: "general", description: "General-purpose subagent." },
    { class: "role", label: "review", name: "review", description: "Review work." },
  ],
  paths: { has: () => false, probe: () => {} },
};

function expanded(
  text: string,
  settings: Settings = defaultSettings(),
  roleCatalogs: Catalogs = catalogs,
) {
  const { mentions } = parse(text, triggerSpecs(settings));
  const resolved = resolve(
    mentions.filter((mention) => mention.class === "role"),
    roleCatalogs,
    settings,
  );
  return expandRoles(text, resolved, roleCatalogs);
}

const skillBlock = buildSkillBlock({
  name: "tdd",
  location: "/abs/tdd/SKILL.md",
  baseDir: "/abs/tdd",
  body: "# TDD",
})!;

test("a leading role with a task becomes the dispatch instruction", () => {
  assert.deepEqual(expanded("&general summarise this"), {
    text: dispatch("general", "summarise this"),
  });
  assert.equal(
    expanded("  &general summarise this").text,
    dispatch("general", "summarise this").replace(/^/, "  "),
  );
});

test("a leading role with no task asks instead of emitting a malformed call", () => {
  assert.deepEqual(expanded("&general"), { text: noTask("general") });
  assert.deepEqual(expanded("&general   "), { text: noTask("general") });
  for (const punctuation of [",", ".", "!", ";", ",.;:!?)]}"]) {
    assert.deepEqual(expanded(`&general${punctuation}`), { text: noTask("general") });
  }
});

test("punctuation after a leading role is stripped from a real task", () => {
  assert.deepEqual(expanded("&general, do it"), {
    text: dispatch("general", "do it"),
  });
  assert.deepEqual(expanded("&general:  do it"), {
    text: dispatch("general", "do it"),
  });
});

test("only the first non-whitespace role mention expands", () => {
  assert.deepEqual(expanded("please &general summarise this"), {
    text: "please &general summarise this",
  });
  assert.deepEqual(expanded("%read &general summarise this"), {
    text: "%read &general summarise this",
  });
  assert.deepEqual(expanded("&general x &general y"), {
    text: dispatch("general", "x &general y"),
  });
});

test("unknown, excluded and escaped roles stay literal", () => {
  assert.deepEqual(expanded("&nope summarise this"), { text: "&nope summarise this" });

  const excluded = defaultSettings();
  excluded.exclude.roles = ["general"];
  assert.deepEqual(expanded("&general summarise this", excluded), {
    text: "&general summarise this",
  });
  assert.deepEqual(expanded("\\&general summarise this"), {
    text: "\\&general summarise this",
  });
});

test("a leading role after the native skill block expands and the block stays opaque", () => {
  assert.deepEqual(expanded(`${skillBlock}\n\n&general do it`), {
    text: `${skillBlock}\n\n${dispatch("general", "do it")}`,
  });
  assert.deepEqual(expanded(`${skillBlock}\n\nplease &general do it`), {
    text: `${skillBlock}\n\nplease &general do it`,
  });

  const opaque = buildSkillBlock({
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    baseDir: "/abs/tdd",
    body: "&general do not expand me",
  })!;
  assert.deepEqual(expanded(opaque), { text: opaque });
});

test("an unterminated skill block has no prose start", () => {
  const open = skillBlock.slice(0, skillBlock.indexOf("\n\n"));
  assert.deepEqual(expanded(`${open}\n\n&general do it`), {
    text: `${open}\n\n&general do it`,
  });
});

test("code mentions and prose without a leading role are unchanged", () => {
  assert.deepEqual(expanded("```\n&general do it\n```"), {
    text: "```\n&general do it\n```",
  });
  assert.deepEqual(expanded("`&general` do it"), { text: "`&general` do it" });
  assert.deepEqual(expanded("plain prose"), { text: "plain prose" });
});
