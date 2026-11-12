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
  const touched: string[] = [];
  const events: unknown[] = [];
  const pi = new Proxy(
    {},
    {
      get: (_target, key) => {
        touched.push(String(key));
        return (...args: unknown[]) => {
          events.push(args[0]);
        };
      },
    },
  ) as unknown as ExtensionAPI;

  piMention(pi);

  assert.deepEqual(touched, ["on"]);
  assert.deepEqual(events, ["session_start"]);
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
