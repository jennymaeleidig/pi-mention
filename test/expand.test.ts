import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { buildSkillBlock, expand, firstResolvedSkill } from "../src/core/expand.ts";
import { parse, triggerSpecs } from "../src/core/grammar.ts";
import { resolve } from "../src/core/resolve.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Catalogs, Settings, SkillSource } from "../src/core/types.ts";

const paths = new Set<string>();
const catalogs: Catalogs = {
  skills: [
    { class: "skill", label: "tdd", name: "skill:tdd" },
    { class: "skill", label: "code-review", name: "skill:code-review" },
    { class: "skill", label: "other", name: "skill:other" },
  ],
  tools: [],
  roles: [],
  paths: { has: (label) => paths.has(label) },
};

const sources = new Map<string, SkillSource>([
  [
    "tdd",
    {
      name: "tdd",
      location: "/abs/tdd/SKILL.md",
      baseDir: "/abs/tdd",
      body: "# TDD\n\nWrite tests.\n",
    },
  ],
  [
    "code-review",
    {
      name: "code-review",
      location: "/abs/review/SKILL.md",
      baseDir: "/abs/review",
      body: "Review carefully.",
    },
  ],
  [
    "other",
    {
      name: "other",
      location: "/abs/other/SKILL.md",
      baseDir: "/abs/other",
      body: "Other.",
    },
  ],
]);

function expanded(
  text: string,
  settings: Settings = defaultSettings(),
  overrides?: typeof sources,
) {
  const { mentions } = parse(text, triggerSpecs(settings));
  const resolved = resolve(
    mentions.filter((mention) => mention.class === "skill"),
    catalogs,
    settings,
  );
  const lookup = overrides ?? sources;
  return expand(text, resolved, {
    skillSource: (target) => lookup.get(target.label),
  });
}

const block = (name: string, body: string, baseDir = `/abs/${name}`) =>
  `<skill name="${name}" location="${baseDir}/SKILL.md">\n` +
  `References are relative to ${baseDir}.\n\n${body}\n</skill>`;

const TDD = block("tdd", "# TDD\n\nWrite tests.");

test("the canonical block is byte-exact and parses as Pi's native skill entry", () => {
  const built = buildSkillBlock(sources.get("tdd")!);
  assert.equal(built, TDD);

  assert.deepEqual(parseSkillBlock(built ?? ""), {
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    content: "References are relative to /abs/tdd.\n\n# TDD\n\nWrite tests.",
    userMessage: undefined,
  });
  assert.deepEqual(parseSkillBlock(`${built}\n\nplease review this`), {
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    content: "References are relative to /abs/tdd.\n\n# TDD\n\nWrite tests.",
    userMessage: "please review this",
  });
});

test("prose before or after a skill moves after the block", () => {
  assert.equal(expanded("$tdd please review this").text, `${TDD}\n\nplease review this`);
  assert.equal(expanded("please $tdd this").text, `${TDD}\n\nplease this`);
});

test("a skill on its own stands alone, and only the first skill mention expands", () => {
  assert.equal(expanded("$tdd").text, TDD);
  assert.equal(expanded("$tdd $other").text, `${TDD}\n\n$other`);
  assert.equal(expanded("$nope $tdd").text, "$nope $tdd");
  assert.equal(expanded("$nope $tdd").skillBlock, undefined);
  assert.equal(expanded("$nope").text, "$nope");
  assert.equal(expanded("$nope").skillBlock, undefined);
});

test("code stays literal and the input seam keeps every escape for the transcript", () => {
  assert.deepEqual(expanded("```\n$tdd\n```").text, "```\n$tdd\n```");
  assert.equal(expanded("`$tdd`").skillBlock, undefined);
  assert.equal(expanded("\\$tdd").text, "\\$tdd");
  assert.equal(expanded("\\$tdd").skillBlock, undefined);
  assert.equal(expanded("$tdd \\$PATH").text, `${TDD}\n\n\\$PATH`);

  const escapedBody = new Map(sources);
  escapedBody.set("tdd", { ...sources.get("tdd")!, body: "Keep \\$PATH literally." });
  assert.equal(
    expanded("$tdd do it", defaultSettings(), escapedBody).text,
    block("tdd", "Keep \\$PATH literally.") + "\n\ndo it",
  );
});

test("CRLF is normalised and the body is trimmed", () => {
  const source = {
    name: "tdd",
    location: "/abs/tdd/SKILL.md",
    baseDir: "/abs/tdd",
    body: "\r\n\r\n# TDD\r\n\r\nWrite tests.\r\n\r\n",
  };
  assert.equal(buildSkillBlock(source), TDD);
});

test("a quote in the name or path, or a closing tag line in the body, aborts the block", () => {
  const quoteName = { ...sources.get("tdd")!, name: 'td"d' };
  const quotePath = { ...sources.get("tdd")!, location: '/abs/td"d/SKILL.md' };
  const closingTag = { ...sources.get("tdd")!, body: "before\n</skill>\nafter" };

  for (const source of [quoteName, quotePath, closingTag]) {
    assert.equal(buildSkillBlock(source), undefined);
    const override = new Map(sources);
    override.set("tdd", source);
    const result = expanded("please $tdd this", defaultSettings(), override);
    assert.equal(result.skillBlock, undefined);
    assert.equal(result.text, "please $tdd this");
    assert.equal(result.skillFailure?.name, "tdd");
  }
});

test("a missing body lookup leaves the mention literal and reports the failure", () => {
  const { mentions } = parse("please $tdd this", triggerSpecs(defaultSettings()));
  const resolved = resolve(
    mentions.filter((mention) => mention.class === "skill"),
    catalogs,
    defaultSettings(),
  );
  const missing = expand("please $tdd this", resolved, {
    skillSource: () => undefined,
  });
  assert.equal(missing.skillBlock, undefined);
  assert.equal(missing.text, "please $tdd this");
  assert.equal(missing.skillFailure?.name, "tdd");
});

test("firstResolvedSkill uses the first skill mention only", () => {
  const { mentions } = parse("$tdd $nope $other", triggerSpecs(defaultSettings()));
  const resolved = resolve(
    mentions.filter((mention) => mention.class === "skill"),
    catalogs,
    defaultSettings(),
  );
  assert.equal(firstResolvedSkill(resolved)?.target?.label, "tdd");

  const later = parse("$nope $tdd", triggerSpecs(defaultSettings()));
  const laterResolved = resolve(
    later.mentions.filter((mention) => mention.class === "skill"),
    catalogs,
    defaultSettings(),
  );
  assert.equal(laterResolved[1]?.status, "resolved");
  assert.equal(firstResolvedSkill(laterResolved), undefined);
});
