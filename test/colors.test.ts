import assert from "node:assert/strict";
import { test } from "node:test";
import { colourSpans } from "../src/core/colors.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { ResolvedMention } from "../src/core/types.ts";

const settings = defaultSettings();

const resolved = (
  roleClass: ResolvedMention["mention"]["class"],
  status: ResolvedMention["status"],
) =>
  ({
    mention: { class: roleClass, trigger: "", label: "x", span: { start: 0, end: 1 } },
    status,
    ...(status === "resolved" ? { target: { class: roleClass, label: "x" } } : {}),
  }) as ResolvedMention;

test("palette C maps every class to its theme role", () => {
  const spans = colourSpans(
    "x",
    [
      resolved("skill", "resolved"),
      resolved("path", "resolved"),
      resolved("tool", "resolved"),
      resolved("role", "resolved"),
      resolved("url", "resolved"),
    ],
    settings,
  );
  assert.deepEqual(
    spans.map((span) => span.role),
    ["syntaxNumber", "mdLinkUrl", "accent", "success", "mdLink"],
  );
});

test("unresolved and excluded have distinct roles", () => {
  const spans = colourSpans(
    "x",
    [resolved("skill", "unresolved"), resolved("tool", "excluded")],
    settings,
  );
  assert.deepEqual(
    spans.map((span) => span.role),
    ["warning", "dim"],
  );
});

test("colour spans keep the resolved mention ranges", () => {
  const spans = colourSpans(
    "abcd",
    [
      {
        mention: { class: "skill", trigger: "$", label: "tdd", span: { start: 0, end: 4 } },
        status: "resolved",
        target: { class: "skill", label: "tdd" },
      },
    ],
    settings,
  );
  assert.deepEqual(spans, [{ start: 0, end: 4, role: "syntaxNumber" }]);
});

test("spans outside the text are dropped", () => {
  const spans = colourSpans(
    "abc",
    [
      {
        mention: { class: "skill", trigger: "$", label: "x", span: { start: -1, end: 2 } },
        status: "resolved",
        target: { class: "skill", label: "x" },
      },
      {
        mention: { class: "tool", trigger: "%", label: "y", span: { start: 2, end: 9 } },
        status: "resolved",
        target: { class: "tool", label: "y" },
      },
      {
        mention: { class: "role", trigger: "&", label: "z", span: { start: 1, end: 1 } },
        status: "resolved",
        target: { class: "role", label: "z" },
      },
    ],
    settings,
  );
  assert.deepEqual(spans, []);
});
