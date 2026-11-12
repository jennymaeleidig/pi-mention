import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createSelectionStore, selectionStatePath } from "../src/pi/history.ts";

function tempFile(root: string): string {
  return join(root, "state", "pi-mention-selections.json");
}

async function waitForStore(file: string, expected: unknown): Promise<void> {
  let last: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      last = readFileSync(file, "utf8");
      if (isDeepStrictEqual(JSON.parse(last), expected)) return;
    } catch {
      // The first queued write has not landed yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`selection store never reached its final shape at ${file}: ${last}`);
}

test("the documented store path sits under pi's agent state directory", () => {
  assert.equal(
    selectionStatePath("/home/me/.pi/agent"),
    "/home/me/.pi/agent/state/pi-mention-selections.json",
  );
});

test("a missing file is a fresh start and record writes the documented shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-mention-history-"));
  try {
    const file = tempFile(root);
    const store = createSelectionStore(file);
    assert.deepEqual(store.get("skill"), {});
    assert.deepEqual(store.get("tool"), {});
    assert.deepEqual(store.get("role"), {});

    store.record("skill", "tdd", 1000);
    store.record("skill", "tdd", 2000);
    store.record("tool", "bash", 3000);

    await waitForStore(file, {
      version: 1,
      skills: { tdd: { count: 2, lastSelectedAt: 2000 } },
      tools: { bash: { count: 1, lastSelectedAt: 3000 } },
      roles: {},
    });

    const reopened = createSelectionStore(file);
    assert.deepEqual(reopened.get("skill"), { tdd: { count: 2, lastSelectedAt: 2000 } });
    assert.deepEqual(reopened.get("tool"), { bash: { count: 1, lastSelectedAt: 3000 } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed or old store starts empty rather than throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-mention-history-"));
  try {
    const file = tempFile(root);
    const store = createSelectionStore(file);
    assert.deepEqual(store.get("skill"), {});
    mkdirSync(join(root, "state"), { recursive: true });

    writeFileSync(file, "{not json");
    assert.deepEqual(createSelectionStore(file).get("skill"), {});

    writeFileSync(file, JSON.stringify({ version: 2, skills: { tdd: { count: 3 } } }));
    assert.deepEqual(createSelectionStore(file).get("skill"), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
