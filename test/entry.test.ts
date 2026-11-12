import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piMention from "../src/index.ts";

test("the extension entry is inert", () => {
  const touched: string[] = [];
  const pi = new Proxy(
    {},
    {
      get: (_target, key) => {
        touched.push(String(key));
        return () => {};
      },
    },
  ) as unknown as ExtensionAPI;

  piMention(pi);

  assert.deepEqual(touched, [], "the scaffold must not touch the extension API");
});
