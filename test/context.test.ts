import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { installContextEscapes } from "../src/pi/context.ts";
import { defaultSettings } from "../src/core/settings.ts";

type Handler = (event: ContextEvent) => ContextEventResult | undefined;

function setup() {
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, callback: Handler) => {
      if (name === "context") handler = callback;
      return () => {};
    },
  } as unknown as ExtensionAPI;

  installContextEscapes(pi, defaultSettings());

  return (messages: ContextEvent["messages"]) => {
    assert.ok(handler);
    return handler({ type: "context", messages });
  };
}

const user = (content: string) => ({ role: "user" as const, content, timestamp: 0 });

const contents = (messages: ContextEvent["messages"] | undefined) =>
  messages?.map((message) => ("content" in message ? message.content : undefined));

test("escaped triggers lose only the backslash in the model-facing message", () => {
  const run = setup();
  const result = run([user("please \\$PATH and \\%bash and \\&general")]);
  assert.deepEqual(contents(result?.messages), ["please $PATH and %bash and &general"]);
});

test("code is inert on the context seam too", () => {
  const run = setup();
  assert.equal(run([user("`\\$PATH`")]), undefined);
  assert.equal(run([user("```\n\\$PATH\n```")]), undefined);
});

test("a native skill block stays opaque while its prose is unescaped", () => {
  const run = setup();
  const block =
    '<skill name="tdd" location="/abs/tdd/SKILL.md">\n' +
    "References are relative to /abs/tdd.\n\nKeep \\$PATH in the body.\n</skill>";
  const result = run([user(`${block}\n\nplease \\$PATH`)]);
  assert.deepEqual(contents(result?.messages), [`${block}\n\nplease $PATH`]);
});

test("only user text parts change and a no-op returns no result", () => {
  const run = setup();
  assert.equal(run([user("nothing to unescape")]), undefined);
  assert.equal(
    run([
      { role: "assistant", content: [{ type: "text", text: "\\$PATH" }] },
    ] as ContextEvent["messages"]),
    undefined,
  );

  const result = run([
    {
      ...user(""),
      content: [
        { type: "text", text: "\\$PATH" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    },
  ] as ContextEvent["messages"]);
  const first = result?.messages?.[0];
  const content = first && "content" in first ? first.content : undefined;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], { type: "text", text: "$PATH" });
  assert.deepEqual(content[1], { type: "image", data: "abc", mimeType: "image/png" });
});
