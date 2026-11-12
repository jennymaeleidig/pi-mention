import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathCatalog } from "../src/pi/catalogs/paths.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a new path is probed without blocking and re-renders when it lands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mention-paths-"));
  try {
    writeFileSync(join(dir, "exists.ts"), "");
    const catalog = pathCatalog(dir);
    let changes = 0;
    catalog.setOnChange(() => changes++);

    assert.equal(catalog.has("exists.ts"), false, "the first sighting is unresolved");
    for (let i = 0; i < 100 && catalog.has("exists.ts") === false; i++) await sleep(5);
    assert.equal(catalog.has("exists.ts"), true);
    assert.equal(changes > 0, true);

    assert.equal(catalog.has("missing.ts"), false);
    await sleep(20);
    assert.equal(catalog.has("missing.ts"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
