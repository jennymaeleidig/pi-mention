import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { roleCatalog } from "../src/pi/catalogs/roles.ts";

function writeRole(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

test("roles mirror tinysubagent: project wins, filename falls back, malformed skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-mention-roles-"));
  try {
    const userRoot = join(root, "user");
    const project = join(root, "project");
    writeRole(
      join(userRoot, "agents"),
      "general.md",
      "---\nname: general\ndescription: User general\n---\n",
    );
    writeRole(join(userRoot, "agents"), "helper.md", "No frontmatter here.\n");
    writeRole(
      join(project, ".pi", "agents"),
      "general.md",
      "---\nname: general\ndescription: Project general\n---\n",
    );
    writeRole(
      join(project, ".pi", "agents"),
      "review.md",
      "---\nname: review\ndescription: Review work\n---\n",
    );
    writeRole(join(project, ".pi", "agents"), "bad.md", "---\n: [\n---\n");

    assert.deepEqual(roleCatalog(project, userRoot), [
      { class: "role", label: "general", name: "general", description: "Project general" },
      { class: "role", label: "helper", name: "helper", description: "" },
      { class: "role", label: "review", name: "review", description: "Review work" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
