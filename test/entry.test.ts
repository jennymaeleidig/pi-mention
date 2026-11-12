import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piMention, * as entry from "../src/index.ts";

const ENTRY = new URL("../src/index.ts", import.meta.url).href;

type Handler = (
  event: { type: "session_start"; reason: string },
  ctx: {
    mode: string;
    cwd: string;
    ui: { notify: (message: string, type?: string) => void };
  },
) => void;

interface Harness {
  pi: ExtensionAPI;
  registrations: string[];
  reads: () => number;
  start: (mode?: string, notifications?: Array<{ message: string; type?: string }>) => void;
}

function harness(settings: () => unknown): Harness {
  const registrations: string[] = [];
  const handlers = new Map<string, Handler>();
  let reads = 0;

  const pi = {
    on: (name: string, callback: unknown) => {
      registrations.push(name);
      if (name === "session_start") handlers.set(name, callback as Handler);
      return () => {};
    },
    getSettings: () => {
      reads++;
      return settings();
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    registrations,
    reads: () => reads,
    start: (mode = "rpc", notifications = []) => {
      const handler = handlers.get("session_start");
      assert.ok(handler, "session_start handler is registered");
      handler(
        { type: "session_start", reason: "startup" },
        {
          mode,
          cwd: process.cwd(),
          ui: {
            notify: (message: string, type?: string) =>
              notifications.push({ message, ...(type ? { type } : {}) }),
          },
        },
      );
    },
  };
}

test("the entry exposes only its default factory", () => {
  assert.deepEqual(Object.keys(entry), ["default"]);
});

test("registration defers reading settings and installing seams to session_start", () => {
  const h = harness(() => ({}));

  piMention(h.pi);

  assert.deepEqual(h.registrations, ["session_start"]);
  assert.equal(h.reads(), 0, "getSettings is not touched at registration");

  h.start();
  assert.deepEqual(h.registrations, ["session_start", "input", "context"]);
  assert.equal(h.reads(), 1);

  h.start();
  assert.deepEqual(h.registrations, ["session_start", "input", "context"]);
  assert.equal(h.reads(), 1, "settings are read once per registration");
});

test("session_start warns on every call about a broken piMention", () => {
  const h = harness(() => ({ piMention: "broken" }));
  piMention(h.pi);

  const notifications: Array<{ message: string; type?: string }> = [];

  h.start("rpc", notifications);
  h.start("rpc", notifications);

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
