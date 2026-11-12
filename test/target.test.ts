import assert from "node:assert/strict";
import { test } from "node:test";
import { historyRecord, sameTarget, targetKey } from "../src/core/target.ts";
import type { Target } from "../src/core/types.ts";

const skill = (label: string, name?: string): Target => ({
  class: "skill",
  label,
  ...(name === undefined ? {} : { name }),
});

test("targetKey prefers the registered name when there is one", () => {
  assert.equal(targetKey(skill("tdd", "skill:tdd")), "skill:tdd");
  assert.equal(targetKey(skill("tdd")), "tdd");
});

test("sameTarget compares class and registered name, not label alone", () => {
  const command = skill("tdd", "skill:tdd");
  const alias = skill("testing", "skill:tdd");
  assert.equal(sameTarget(command, alias), true);
  assert.equal(sameTarget(command, skill("tdd", "skill:other")), false);
  assert.equal(sameTarget(command, { class: "role", label: "tdd", name: "skill:tdd" }), false);
});

test("historyRecord reads the registered name first and falls back to the label", () => {
  const history = {
    "skill:tdd": { count: 4, lastSelectedAt: 4000 },
    tdd: { count: 1, lastSelectedAt: 1000 },
  };
  assert.deepEqual(historyRecord(skill("tdd", "skill:tdd"), history), history["skill:tdd"]);
  assert.deepEqual(historyRecord(skill("tdd", "skill:missing"), history), history.tdd);
  assert.equal(historyRecord(skill("nope"), history), undefined);
});
