import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piMention, * as entry from "../src/index.ts";

const ENTRY = new URL("../src/index.ts", import.meta.url).href;

test("the entry exposes only its default factory", () => {
  assert.deepEqual(Object.keys(entry), ["default"]);
});

test("the extension registers only its session_start handler", () => {
  const registrations: string[] = [];
  const pi = {
    on: (name: string) => {
      registrations.push(name);
    },
    getSettings: () => ({}),
  } as unknown as ExtensionAPI;

  piMention(pi);

  assert.deepEqual(registrations, ["session_start"]);
});

test("session_start warns on every call about a broken piMention", () => {
  type Handler = (
    event: unknown,
    ctx: { mode: string; ui: { notify: (message: string, type?: string) => void } },
  ) => void;
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, callback: unknown) => {
      if (name === "session_start") handler = callback as Handler;
    },
    getSettings: () => ({ piMention: "broken" }),
  } as unknown as ExtensionAPI;

  piMention(pi);

  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    mode: "rpc",
    ui: {
      notify: (message: string, type?: string) =>
        notifications.push({ message, ...(type ? { type } : {}) }),
    },
  };

  handler?.({ type: "session_start", reason: "startup" }, ctx);
  handler?.({ type: "session_start", reason: "reload" }, ctx);

  assert.equal(notifications.length, 2);
  for (const notification of notifications) {
    assert.equal(notification.type, "warning");
    assert.match(notification.message, /piMention must be an object/);
  }
});

test("loading the entry writes nothing", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(ENTRY)});`],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
