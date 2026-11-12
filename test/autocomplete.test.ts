import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { createMentionAutocomplete, type AutocompleteOptions } from "../src/pi/autocomplete.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { PickerClass, SelectionRecord } from "../src/core/selection.ts";
import type { Catalogs, Target } from "../src/core/types.ts";

type CatalogView = Pick<Catalogs, "skills" | "tools" | "roles">;

const catalogs: CatalogView = {
  skills: [
    { class: "skill", label: "tdd", name: "skill:tdd", description: "Test-driven development" },
    {
      class: "skill",
      label: "code-review",
      name: "skill:code-review",
      description: "Review a branch",
    },
    { class: "skill", label: "alpha", name: "skill:alpha" },
  ],
  tools: [
    { class: "tool", label: "bash", name: "bash", description: "Run a shell command" },
    {
      class: "tool",
      label: "kagi:kagi_search_fetch",
      name: "mcp__kagi__kagi_search_fetch",
      description: "Search the web",
    },
  ],
  roles: [{ class: "role", label: "general", description: "General-purpose agent" }],
};

const signal = new AbortController().signal;

function fakeHistory() {
  const values: Record<PickerClass, Record<string, SelectionRecord>> = {
    skill: {},
    tool: {},
    role: {},
  };
  const recorded: Array<{ class: PickerClass; label: string; now: number }> = [];
  return {
    recorded,
    history: {
      get: (className: PickerClass) => values[className],
      record: (className: PickerClass, label: string, now = 0) => {
        recorded.push({ class: className, label, now });
        const previous = values[className][label];
        values[className][label] = {
          count: (previous?.count ?? 0) + 1,
          lastSelectedAt: now,
        };
      },
    },
  };
}

function fakeCurrent(overrides: Partial<AutocompleteProvider> = {}): AutocompleteProvider {
  return {
    triggerCharacters: ["@"],
    async getSuggestions(): Promise<AutocompleteSuggestions | null> {
      return null;
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
    ...overrides,
  };
}

function picker(options: Partial<AutocompleteOptions> = {}) {
  const store = fakeHistory();
  const provider = createMentionAutocomplete(fakeCurrent(), {
    settings: options.settings ?? defaultSettings(),
    catalogs: options.catalogs ?? (() => catalogs),
    history: options.history ?? store.history,
    now: options.now ?? (() => 0),
  });
  return { provider, store };
}

async function suggest(
  provider: AutocompleteProvider,
  lines: string[],
  cursorCol = (lines[0] ?? "").length,
) {
  return provider.getSuggestions(lines, 0, cursorCol, { signal });
}

const values = (suggestions: AutocompleteSuggestions | null) =>
  suggestions?.items.map((item) => item.value);

test("each trigger opens its own class with the short label as the value", async () => {
  const { provider } = picker();
  assert.deepEqual(provider.triggerCharacters, ["@", "$", "%", "&"]);

  const skills = await suggest(provider, ["$"]);
  assert.equal(skills?.prefix, "$");
  assert.deepEqual(values(skills), ["$tdd", "$code-review", "$alpha"]);
  assert.equal(skills?.items[0]?.label, "tdd");
  assert.equal(skills?.items[0]?.description, "Test-driven development");

  const tools = await suggest(provider, ["%"]);
  assert.deepEqual(values(tools), ["%bash", "%kagi:kagi_search_fetch"]);
  assert.equal(tools?.items[1]?.description, "Search the web");

  const roles = await suggest(provider, ["&"]);
  assert.deepEqual(values(roles), ["&general"]);
  assert.equal(roles?.items[0]?.description, "General-purpose agent");
});

test("typing narrows by case-insensitive fuzzy label matching", async () => {
  const { provider } = picker();
  assert.deepEqual(values(await suggest(provider, ["$co"])), ["$code-review"]);
  assert.deepEqual(values(await suggest(provider, ["$CR"])), ["$code-review"]);
  assert.deepEqual(values(await suggest(provider, ["%kagi:"])), ["%kagi:kagi_search_fetch"]);
  assert.equal(await suggest(provider, ["$zzz"]), null);
});

test("Tab and Enter share applyCompletion, which inserts the short label", async () => {
  const { provider, store } = picker();
  const skills = await suggest(provider, ["$co"]);
  const item = skills?.items[0];
  assert.ok(item);

  const result = provider.applyCompletion(["$co"], 0, 3, item, "$co");
  assert.deepEqual(result.lines, ["$code-review "]);
  assert.equal(result.cursorCol, 13);
  assert.deepEqual(store.recorded, [{ class: "skill", label: "skill:code-review", now: 0 }]);

  const tools = await suggest(provider, ["%kagi:"]);
  const tool = tools?.items[0];
  assert.ok(tool);
  const inserted = provider.applyCompletion(["%kagi:"], 0, 6, tool, "%kagi:");
  assert.deepEqual(inserted.lines, ["%kagi:kagi_search_fetch "]);
  assert.equal(inserted.lines[0]?.includes("mcp__kagi__"), false);
});

test("completion replaces the whole token when the cursor sits inside it", async () => {
  const { provider } = picker();
  const suggestions = await suggest(provider, ["$alp"]);
  const item = suggestions?.items[0];
  assert.ok(item);

  const result = provider.applyCompletion(["$alph rest"], 0, 4, item, "$alp");
  assert.deepEqual(result.lines, ["$alpha rest"]);
  assert.equal(result.cursorCol, 6);
});

test("applyCompletion does not add a second space before existing prose", async () => {
  const { provider } = picker();
  const suggestions = await suggest(provider, ["$td"]);
  const item = suggestions?.items[0];
  assert.ok(item);
  const result = provider.applyCompletion(["$td rest"], 0, 3, item, "$td");
  assert.deepEqual(result.lines, ["$tdd rest"]);
});

test("a following terminator suppresses the completion suffix", async () => {
  const { provider } = picker();

  const tool = (await suggest(provider, ["%bas"]))?.items[0];
  assert.ok(tool);
  const afterComma = provider.applyCompletion(["%bas, please"], 0, 4, tool, "%bas");
  assert.deepEqual(afterComma.lines, ["%bash, please"]);

  const skill = (await suggest(provider, ["$td"]))?.items[0];
  assert.ok(skill);
  const afterQuestion = provider.applyCompletion(["$td?"], 0, 3, skill, "$td");
  assert.deepEqual(afterQuestion.lines, ["$tdd?"]);
});

test("pinned targets stay first for a non-empty fuzzy query", async () => {
  const settings = defaultSettings();
  settings.ranking.pinned.skills = ["zeta"];
  const pinnedCatalogs: CatalogView = {
    skills: [
      { class: "skill", label: "xalpha", name: "skill:xalpha" },
      { class: "skill", label: "alpha", name: "skill:alpha" },
      { class: "skill", label: "zeta", name: "skill:zeta" },
    ],
    tools: [],
    roles: [],
  };
  const { provider } = picker({ settings, catalogs: () => pinnedCatalogs });

  assert.deepEqual(values(await suggest(provider, ["$a"])), ["$zeta", "$alpha", "$xalpha"]);
});

test("pi core still owns @, / and forced file completion", async () => {
  const fileItem: AutocompleteItem = { value: "@src/file.ts", label: "file.ts" };
  const fileSuggestions: AutocompleteSuggestions = { items: [fileItem], prefix: "@src" };
  const calls: unknown[] = [];
  const current = fakeCurrent({
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      calls.push({ lines, cursorLine, cursorCol, options });
      return fileSuggestions;
    },
    shouldTriggerFileCompletion: () => true,
  });
  const { provider } = picker();
  const wrapped = createMentionAutocomplete(current, {
    settings: defaultSettings(),
    catalogs: () => catalogs,
    history: fakeHistory().history,
  });

  assert.equal(await suggest(wrapped, ["@src"]), fileSuggestions);
  assert.equal(calls.length, 1);
  assert.equal(wrapped.shouldTriggerFileCompletion?.(["@src"], 0, 4), true);
  assert.equal(wrapped.shouldTriggerFileCompletion?.(["$td"], 0, 3), false);

  const applied = wrapped.applyCompletion(["@src"], 0, 4, fileItem, "@src");
  assert.deepEqual(applied.lines, ["@src"]);
});

test("slash autocomplete hides skill commands by default and can keep them", async () => {
  const slash: AutocompleteSuggestions = {
    items: [
      { value: "skill:tdd", label: "tdd" },
      { value: "review", label: "review" },
    ],
    prefix: "/",
  };
  const current = fakeCurrent({
    async getSuggestions() {
      return slash;
    },
  });
  const store = fakeHistory();
  const hidden = createMentionAutocomplete(current, {
    settings: defaultSettings(),
    catalogs: () => catalogs,
    history: store.history,
  });
  assert.deepEqual(values(await suggest(hidden, ["/"])), ["review"]);

  const visibleSettings = defaultSettings();
  visibleSettings.hideSlashSkills = false;
  const visible = createMentionAutocomplete(current, {
    settings: visibleSettings,
    catalogs: () => catalogs,
    history: store.history,
  });
  assert.deepEqual(values(await suggest(visible, ["/"])), ["skill:tdd", "review"]);

  const onlySkills = fakeCurrent({
    async getSuggestions() {
      return { items: [{ value: "skill:tdd", label: "tdd" }], prefix: "/" };
    },
  });
  const none = createMentionAutocomplete(onlySkills, {
    settings: defaultSettings(),
    catalogs: () => catalogs,
    history: store.history,
  });
  assert.equal(await suggest(none, ["/"]), null);
});
