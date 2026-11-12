import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathCandidates } from "../src/core/resolve.ts";
import { pathCatalog } from "../src/pi/catalogs/paths.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await sleep(5);
  assert.equal(predicate(), true, "the probe landed");
}

test("has is a pure cache read and probe starts the stat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mention-paths-"));
  try {
    writeFileSync(join(dir, "exists.ts"), "");
    const catalog = pathCatalog(dir);
    let changes = 0;
    catalog.setOnChange(() => changes++);

    assert.equal(catalog.has("exists.ts"), false, "an unprobed label is unresolved");
    await sleep(20);
    assert.equal(catalog.has("exists.ts"), false, "has never starts I/O");
    assert.equal(catalog.version, 0);

    catalog.probe("exists.ts");
    await waitFor(() => catalog.has("exists.ts"));
    assert.equal(catalog.version, 1);
    assert.equal(changes, 1);

    catalog.probe("missing.ts");
    await waitFor(() => catalog.version === 2);
    assert.equal(catalog.has("missing.ts"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cached miss becomes a hit after the file appears and the TTL passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mention-paths-"));
  try {
    const catalog = pathCatalog(dir, { ttlMs: 100 });

    catalog.probe("later.ts");
    await waitFor(() => catalog.version === 1);
    assert.equal(catalog.has("later.ts"), false);

    writeFileSync(join(dir, "later.ts"), "");
    catalog.probe("later.ts");
    await sleep(10);
    assert.equal(catalog.version, 1, "a fresh miss is not probed again");
    assert.equal(catalog.has("later.ts"), false);

    await sleep(120);
    catalog.probe("later.ts");
    await waitFor(() => catalog.has("later.ts"));
    assert.equal(catalog.version, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the catalog resolves the shared path candidate order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mention-paths-"));
  try {
    writeFileSync(join(dir, "exists.ts"), "");
    const catalog = pathCatalog(dir);

    for (const candidate of pathCandidates("exists.ts,")) catalog.probe(candidate);

    await waitFor(() => catalog.has("exists.ts"));
    assert.equal(catalog.has("exists.ts"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
