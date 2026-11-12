import {
  Array as TypeArray,
  Boolean as TypeBoolean,
  Literal,
  String as TypeString,
  Union,
  type TSchema,
} from "typebox";
import { Check } from "typebox/value";
import type { ColourSettings, Diagnostic, Settings, TriggerSpec } from "./types.ts";

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
const RESERVED_TRIGGERS: ReadonlySet<string> = new Set(["/", "@", "\\", "`"]);

/**
 * A trigger is one BMP code point that the parser can see as a single code
 * unit. Astral characters and lone surrogates are rejected because the scanner
 * walks UTF-16 code units.
 */
function isTrigger(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 1) return false;
  const code = value.codePointAt(0);
  if (code === undefined || code > 0xffff) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  if (/\s/u.test(value)) return false;
  return !RESERVED_TRIGGERS.has(value);
}

/** The foreground theme tokens pi 1.5.2 accepts. Core cannot import pi. */
export const FOREGROUND_ROLES: ReadonlySet<string> = new Set([
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "scrollbarTrack",
  "scrollbarThumb",
  "searchMatchText",
  "userMessageText",
  "customMessageText",
  "customMessageLabel",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
]);

type TriggerClass = Exclude<TriggerSpec["class"], "path">;
const TRIGGER_CLASSES: readonly TriggerClass[] = ["skill", "tool", "role"];
const NAME_KEYS = ["skills", "tools", "roles"] as const;
const COLOUR_KEYS = ["skill", "tool", "role", "path", "url", "unresolved", "excluded"] as const;

type NameLists = Settings["exclude"];

function fallbackDiagnostic(key: string, requirement: string, used: string): Diagnostic {
  return {
    key,
    message: `${key} ${requirement}; using ${used}.`,
  };
}

interface LeafSpec<T> {
  property: string;
  key: string;
  schema: TSchema;
  fallback: () => T;
  requirement: string;
  used: string;
}

function leaf<T>(
  property: string,
  key: string,
  schema: TSchema,
  fallback: () => T,
  requirement: string,
  used: string,
): LeafSpec<T> {
  return { property, key, schema, fallback, requirement, used };
}

function readSpec<T>(raw: RawObject, spec: LeafSpec<T>, diagnostics: Diagnostic[]): T {
  return readLeaf(
    raw,
    spec.property,
    spec.key,
    spec.schema,
    spec.fallback(),
    spec.requirement,
    spec.used,
    diagnostics,
  );
}

const TOP_FIELDS = {
  completionSuffix: leaf(
    "completionSuffix",
    "completionSuffix",
    STRING,
    () => DEFAULT_SETTINGS.completionSuffix,
    "must be a string",
    JSON.stringify(DEFAULT_SETTINGS.completionSuffix),
  ),
  hideSlashSkills: leaf(
    "hideSlashSkills",
    "hideSlashSkills",
    BOOLEAN,
    () => DEFAULT_SETTINGS.hideSlashSkills,
    "must be a boolean",
    String(DEFAULT_SETTINGS.hideSlashSkills),
  ),
};

const RANKING_FIELDS = {
  strategy: leaf(
    "strategy",
    "ranking.strategy",
    STRATEGY,
    () => DEFAULT_SETTINGS.ranking.strategy,
    "must be one of frecency, recent, frequent, alphabetical or sourceOrder",
    JSON.stringify(DEFAULT_SETTINGS.ranking.strategy),
  ),
  projectSkillsFirst: leaf(
    "projectSkillsFirst",
    "ranking.projectSkillsFirst",
    BOOLEAN,
    () => DEFAULT_SETTINGS.ranking.projectSkillsFirst,
    "must be a boolean",
    String(DEFAULT_SETTINGS.ranking.projectSkillsFirst),
  ),
};

const URL_FIELDS = {
  sourceExtensions: leaf(
    "sourceExtensions",
    "url.sourceExtensions",
    STRING_ARRAY,
    () => DEFAULT_SETTINGS.url.sourceExtensions,
    "must be an array of strings",
    "the default extension list",
  ),
};

const NAME_FIELDS = {
  skills: {
    schema: STRING_ARRAY,
    requirement: "must be an array of strings",
    used: "an empty list",
  },
  tools: {
    schema: STRING_ARRAY,
    requirement: "must be an array of strings",
    used: "an empty list",
  },
  roles: {
    schema: STRING_ARRAY,
    requirement: "must be an array of strings",
    used: "an empty list",
  },
} as const;

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
  for (const name of NAME_KEYS) {
    const spec = NAME_FIELDS[name];
    result[name] = readLeaf(
      raw,
      name,
      `${key}.${name}`,
      spec.schema,
      fallbackValue[name],
      spec.requirement,
      spec.used,
      diagnostics,
    );
  }
  return result;
}

function readColours(raw: RawObject, diagnostics: Diagnostic[]): ColourSettings {
  const result = { ...DEFAULT_SETTINGS.colors };
  for (const key of COLOUR_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && FOREGROUND_ROLES.has(value)) {
      result[key] = value;
      continue;
    }
    if (value !== undefined) {
      diagnostics.push(
        fallbackDiagnostic(
          `piMention.colors.${key}`,
          "must be a pi foreground theme-token name",
          JSON.stringify(DEFAULT_SETTINGS.colors[key]),
        ),
      );
    }
  }
  return result;
}

function readTriggers(raw: RawObject, diagnostics: Diagnostic[]): Settings["triggers"] {
  const group = readGroup(raw, "triggers", "triggers", diagnostics);
  const triggers = { ...DEFAULT_SETTINGS.triggers };
  const customs: Partial<Record<TriggerClass, string>> = {};

  for (const name of TRIGGER_CLASSES) {
    const value = group[name];
    if (value === undefined) continue;
    if (isTrigger(value)) {
      customs[name] = value;
    } else {
      diagnostics.push(
        fallbackDiagnostic(
          `piMention.triggers.${name}`,
          'must be one character other than whitespace, "/", "@", "\\" or "`"',
          JSON.stringify(triggers[name]),
        ),
      );
    }
  }

  // Start from the three defaults. Accept a custom value only when it is valid
  // and does not collide with any class's effective trigger, including the
  // default of a class that has no override. A collision falls back to this
  // class's own default, which is still free at that point.
  for (const name of TRIGGER_CLASSES) {
    const value = customs[name];
    if (value === undefined) continue;

    const collides = TRIGGER_CLASSES.some((other) => other !== name && triggers[other] === value);
    if (collides) {
      diagnostics.push(
        fallbackDiagnostic(
          `piMention.triggers.${name}`,
          `must differ from another token class (got ${JSON.stringify(value)})`,
          JSON.stringify(triggers[name]),
        ),
      );
      continue;
    }
    triggers[name] = value;
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
    completionSuffix: readSpec(raw, TOP_FIELDS.completionSuffix, diagnostics),
    hideSlashSkills: readSpec(raw, TOP_FIELDS.hideSlashSkills, diagnostics),
    ranking: {
      strategy: readSpec(ranking, RANKING_FIELDS.strategy, diagnostics),
      pinned: readNameLists(pinned, "ranking.pinned", defaults.ranking.pinned, diagnostics),
      projectSkillsFirst: readSpec(ranking, RANKING_FIELDS.projectSkillsFirst, diagnostics),
    },
    exclude: readNameLists(exclude, "exclude", defaults.exclude, diagnostics),
    colors: readColours(colors, diagnostics),
    url: {
      sourceExtensions: readSpec(url, URL_FIELDS.sourceExtensions, diagnostics),
    },
  };

  return { settings, diagnostics };
}
