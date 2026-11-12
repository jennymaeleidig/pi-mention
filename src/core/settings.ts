import {
  Array as TypeArray,
  Boolean as TypeBoolean,
  Literal,
  String as TypeString,
  Union,
  type TSchema,
} from "typebox";
import { Check } from "typebox/schema";
import type { ColourSettings, Diagnostic, Settings } from "./types.ts";

/** Palette C from the accepted prototype. */
export const DEFAULT_SETTINGS: Settings = {
  triggers: { skill: "$", tool: "%", role: "&" },
  completionSuffix: " ",
  hideSlashSkills: true,
  ranking: {
    strategy: "frecency",
    pinned: { skills: [], tools: [], roles: [] },
    projectSkillsFirst: false,
  },
  exclude: { skills: [], tools: [], roles: [] },
  colors: {
    skill: "syntaxNumber",
    tool: "accent",
    role: "success",
    path: "mdLinkUrl",
    url: "mdLink",
    unresolved: "warning",
    excluded: "dim",
  },
  url: {
    sourceExtensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".md",
      ".py",
      ".sh",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".rs",
      ".go",
      ".css",
      ".html",
    ],
  },
};

/** A mutable copy, so callers cannot accidentally edit the defaults. */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STRING = TypeString();
const BOOLEAN = TypeBoolean();
const STRING_ARRAY = TypeArray(TypeString());
const STRATEGY = Union([
  Literal("frecency"),
  Literal("recent"),
  Literal("frequent"),
  Literal("alphabetical"),
  Literal("sourceOrder"),
]);
const TRIGGER = TypeString({ minLength: 1, maxLength: 1, pattern: /^[^\s/@]$/u });
const COLOUR_ROLE = TypeString({ minLength: 1, pattern: /^(?!.*Bg$).*$/u });

const TRIGGER_CLASSES = ["skill", "tool", "role"] as const;
type TriggerClass = (typeof TRIGGER_CLASSES)[number];
const NAME_CATEGORIES = ["skills", "tools", "roles"] as const;
const COLOUR_KEYS = ["skill", "tool", "role", "path", "url", "unresolved", "excluded"] as const;

type NameLists = Settings["exclude"];

/** Fallbacks when a default trigger is already claimed; never whitespace or "/". */
const TRIGGER_POOL = ["$", "%", "&", "!", "?", "^", "~"] as const;

function fallbackDiagnostic(key: string, requirement: string, used: string): Diagnostic {
  return {
    key,
    message: `${key} ${requirement}; using ${used}.`,
  };
}

/** A nested settings object; a non-object falls back to that whole section. */
function readGroup(
  raw: RawObject,
  property: string,
  key: string,
  diagnostics: Diagnostic[],
): RawObject {
  const value = raw[property];
  if (value === undefined) return {};
  if (!isObject(value)) {
    diagnostics.push(
      fallbackDiagnostic(`piMention.${key}`, "must be an object", "the defaults for this section"),
    );
    return {};
  }
  return value;
}

function readLeaf<T>(
  raw: RawObject,
  property: string,
  key: string,
  schema: TSchema,
  fallbackValue: T,
  requirement: string,
  used: string,
  diagnostics: Diagnostic[],
): T {
  const value = raw[property];
  if (Check(schema, value)) {
    return (Array.isArray(value) ? [...value] : value) as T;
  }
  if (value !== undefined) {
    diagnostics.push(fallbackDiagnostic(`piMention.${key}`, requirement, used));
  }
  return (Array.isArray(fallbackValue) ? [...fallbackValue] : fallbackValue) as T;
}

function readNameLists(
  raw: RawObject,
  key: string,
  fallbackValue: NameLists,
  diagnostics: Diagnostic[],
): NameLists {
  const result: NameLists = { ...fallbackValue };
  for (const category of NAME_CATEGORIES) {
    result[category] = readLeaf(
      raw,
      category,
      `${key}.${category}`,
      STRING_ARRAY,
      fallbackValue[category],
      "must be an array of strings",
      "an empty list",
      diagnostics,
    );
  }
  return result;
}

function readColours(raw: RawObject, diagnostics: Diagnostic[]): ColourSettings {
  const result = { ...DEFAULT_SETTINGS.colors };
  for (const key of COLOUR_KEYS) {
    result[key] = readLeaf(
      raw,
      key,
      `colors.${key}`,
      COLOUR_ROLE,
      DEFAULT_SETTINGS.colors[key],
      "must be a theme foreground role string, not a *Bg role",
      JSON.stringify(DEFAULT_SETTINGS.colors[key]),
      diagnostics,
    );
  }
  return result;
}

function readTriggers(raw: RawObject, diagnostics: Diagnostic[]): Settings["triggers"] {
  const group = readGroup(raw, "triggers", "triggers", diagnostics);
  const values: Partial<Record<TriggerClass, string>> = {};
  const problems = new Map<TriggerClass, string>();

  for (const name of TRIGGER_CLASSES) {
    const value = group[name];
    if (value === undefined) continue;
    if (Check(TRIGGER, value)) values[name] = value as string;
    else problems.set(name, 'must be a single character other than whitespace, "/" or "@"');
  }

  // A valid override beats a default; a duplicate among overrides falls back in
  // canonical order, so a later typo cannot displace an accepted trigger.
  const accepted = new Set<string>();
  for (const name of TRIGGER_CLASSES) {
    const value = values[name];
    if (value === undefined) continue;
    if (accepted.has(value)) {
      delete values[name];
      problems.set(name, `must differ from another token class (got ${JSON.stringify(value)})`);
    } else {
      accepted.add(value);
    }
  }

  const triggers = { ...DEFAULT_SETTINGS.triggers };
  for (const name of TRIGGER_CLASSES) {
    const custom = values[name];
    if (custom !== undefined) {
      triggers[name] = custom;
      continue;
    }
    const problem = problems.get(name);
    if (problem === undefined) continue;

    const preferred = DEFAULT_SETTINGS.triggers[name];
    const chosen = accepted.has(preferred)
      ? (TRIGGER_POOL.find((candidate) => !accepted.has(candidate)) ?? preferred)
      : preferred;
    triggers[name] = chosen;
    accepted.add(chosen);
    diagnostics.push(
      fallbackDiagnostic(`piMention.triggers.${name}`, problem, JSON.stringify(chosen)),
    );
  }

  return triggers;
}

/**
 * Validate the effective `piMention` object.
 *
 * Every missing field takes its code default. One invalid leaf falls back on
 * its own with one diagnostic; a malformed parent object falls back to that
 * section's defaults with one diagnostic. Unknown keys are ignored. The path
 * trigger is absent by design: pi core owns `@`.
 */
export function loadSettings(raw: unknown): { settings: Settings; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (raw === undefined) {
    return { settings: defaultSettings(), diagnostics };
  }
  if (!isObject(raw)) {
    diagnostics.push(fallbackDiagnostic("piMention", "must be an object", "all defaults"));
    return { settings: defaultSettings(), diagnostics };
  }

  const ranking = readGroup(raw, "ranking", "ranking", diagnostics);
  const pinned = readGroup(ranking, "pinned", "ranking.pinned", diagnostics);
  const exclude = readGroup(raw, "exclude", "exclude", diagnostics);
  const colors = readGroup(raw, "colors", "colors", diagnostics);
  const url = readGroup(raw, "url", "url", diagnostics);

  const defaults = DEFAULT_SETTINGS;
  const settings: Settings = {
    triggers: readTriggers(raw, diagnostics),
    completionSuffix: readLeaf(
      raw,
      "completionSuffix",
      "completionSuffix",
      STRING,
      defaults.completionSuffix,
      "must be a string",
      JSON.stringify(defaults.completionSuffix),
      diagnostics,
    ),
    hideSlashSkills: readLeaf(
      raw,
      "hideSlashSkills",
      "hideSlashSkills",
      BOOLEAN,
      defaults.hideSlashSkills,
      "must be a boolean",
      String(defaults.hideSlashSkills),
      diagnostics,
    ),
    ranking: {
      strategy: readLeaf(
        ranking,
        "strategy",
        "ranking.strategy",
        STRATEGY,
        defaults.ranking.strategy,
        "must be one of frecency, recent, frequent, alphabetical or sourceOrder",
        JSON.stringify(defaults.ranking.strategy),
        diagnostics,
      ),
      pinned: readNameLists(pinned, "ranking.pinned", defaults.ranking.pinned, diagnostics),
      projectSkillsFirst: readLeaf(
        ranking,
        "projectSkillsFirst",
        "ranking.projectSkillsFirst",
        BOOLEAN,
        defaults.ranking.projectSkillsFirst,
        "must be a boolean",
        String(defaults.ranking.projectSkillsFirst),
        diagnostics,
      ),
    },
    exclude: readNameLists(exclude, "exclude", defaults.exclude, diagnostics),
    colors: readColours(colors, diagnostics),
    url: {
      sourceExtensions: readLeaf(
        url,
        "sourceExtensions",
        "url.sourceExtensions",
        STRING_ARRAY,
        defaults.url.sourceExtensions,
        "must be an array of strings",
        "the default extension list",
        diagnostics,
      ),
    },
  };

  return { settings, diagnostics };
}
