import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PickerClass, SelectionHistory, SelectionRecord } from "../core/selection.ts";

type History = Record<PickerClass, Record<string, SelectionRecord>>;

const VERSION = 1;
const MAX_ENTRIES = 1000;

/** The documented frecency store, alongside pi's other extension state. */
export function selectionStatePath(agentDir = getAgentDir()): string {
  return join(agentDir, "state", "pi-mention-selections.json");
}

function emptyHistory(): History {
  return { skill: {}, tool: {}, role: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadRecord(value: unknown): SelectionRecord | undefined {
  if (!isRecord(value)) return undefined;
  const count = value.count;
  const lastSelectedAt = value.lastSelectedAt;
  if (
    typeof count !== "number" ||
    !Number.isFinite(count) ||
    count < 0 ||
    typeof lastSelectedAt !== "number" ||
    !Number.isFinite(lastSelectedAt) ||
    lastSelectedAt < 0
  ) {
    return undefined;
  }
  return { count, lastSelectedAt };
}

function load(file: string): History {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // A missing or malformed file is a fresh start, not an error.
    return emptyHistory();
  }
  if (!isRecord(raw) || raw.version !== VERSION) return emptyHistory();

  const history = emptyHistory();
  for (const className of ["skill", "tool", "role"] as const) {
    const records = raw[`${className}s`];
    if (!isRecord(records)) continue;
    for (const [label, value] of Object.entries(records)) {
      const record = loadRecord(value);
      if (record) history[className][label] = record;
    }
  }
  return history;
}

function prune(records: Record<string, SelectionRecord>): void {
  const entries = Object.entries(records);
  if (entries.length <= MAX_ENTRIES) return;
  entries
    .sort(([, a], [, b]) => b.lastSelectedAt - a.lastSelectedAt)
    .slice(MAX_ENTRIES)
    .forEach(([label]) => delete records[label]);
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

/**
 * Selection history for the picker.
 *
 * Path: `~/.pi/agent/state/pi-mention-selections.json`.
 * Shape: `{ "version": 1, "skills": {}, "tools": {}, "roles": {} }`.
 * A missing or malformed file starts empty; there is no migration from the old
 * `pi-mention-skill-selections.json` store. Writes are serialized and atomic.
 */
export function createSelectionStore(file = selectionStatePath()): SelectionHistory {
  const history = load(file);
  let queued: Promise<void> = Promise.resolve();

  const persist = (): void => {
    const data = `${JSON.stringify(
      { version: VERSION, skills: history.skill, tools: history.tool, roles: history.role },
      null,
      2,
    )}\n`;
    queued = queued
      .then(() => writeAtomic(file, data))
      .catch(() => {
        // A failed write leaves the in-memory history usable for this session.
      });
  };

  return {
    get(className: PickerClass): Readonly<Record<string, SelectionRecord>> {
      return history[className];
    },
    record(className: PickerClass, targetKey: string, now = Date.now()): void {
      const previous = history[className][targetKey];
      history[className][targetKey] = {
        count: (previous?.count ?? 0) + 1,
        lastSelectedAt: now,
      };
      prune(history[className]);
      persist();
    },
  };
}
