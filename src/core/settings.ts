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

function isColour(value: unknown): value is string {
  return typeof value === "string" && FOREGROUND_ROLES.has(value);
}

type TriggerClass = Exclude<TriggerSpec["class"], "path">;
const TRIGGER_CLASSES: readonly TriggerClass[] = ["skill", "tool", "role"];
const NAME_KEYS = ["skills", "tools", "roles"] as const;
const COLOUR_KEYS = ["skill", "tool", "role", "path", "url", "unresolved", "excluded"] as const;

/** One leaf field: its default, validator and fallback wording. */
interface LeafSpec<T> {
  property: string;
  key: string;
  schema?: TSchema;
  validate?: (value: unknown) => boolean;
  defaultValue: T;
  requirement: string;
  used: string;
}

function leaf<T>(
  property: string,
  key: string,
  defaultValue: T,
  schema: TSchema,
  requirement: string,
  used: string,
): LeafSpec<T> {
  return { property, key, defaultValue, schema, requirement, used };
}

function checkedLeaf<T>(
  property: string,
  key: string,
  defaultValue: T,
  validate: (value: unknown) => boolean,
  requirement: string,
  used: string,
): LeafSpec<T> {
  return { property, key, defaultValue, validate, requirement, used };
}

/** A table that mirrors `Settings`, leaf for leaf. */
type LeafSpecsFor<T> = T extends readonly unknown[]
  ? LeafSpec<T>
  : T extends object
    ? { [K in keyof T]: LeafSpecsFor<T[K]> }
    : LeafSpec<T>;

/**
 * The single source for every settings leaf: its default, validation and
 * fallback wording. `DEFAULT_SETTINGS` is derived from this table, so adding a
 * key means adding one leaf here.
 */
const FIELDS = {
  triggers: {
    skill: checkedLeaf(
      "skill",
      "triggers.skill",
      "$",
      isTrigger,
      'must be one character other than whitespace, "/", "@", "\\" or "`"',
      JSON.stringify("$"),
    ),
    tool: checkedLeaf(
      "tool",
      "triggers.tool",
      "%",
      isTrigger,
      'must be one character other than whitespace, "/", "@", "\\" or "`"',
      JSON.stringify("%"),
    ),
    role: checkedLeaf(
      "role",
      "triggers.role",
      "&",
      isTrigger,
      'must be one character other than whitespace, "/", "@", "\\" or "`"',
      JSON.stringify("&"),
    ),
  },
  completionSuffix: leaf(
    "completionSuffix",
    "completionSuffix",
    " ",
    STRING,
    "must be a string",
    JSON.stringify(" "),
  ),
  hideSlashSkills: leaf(
    "hideSlashSkills",
    "hideSlashSkills",
    true,
    BOOLEAN,
    "must be a boolean",
    String(true),
  ),
  ranking: {
    strategy: leaf(
      "strategy",
      "ranking.strategy",
      "frecency",
      STRATEGY,
      "must be one of frecency, recent, frequent, alphabetical or sourceOrder",
      JSON.stringify("frecency"),
    ),
    pinned: {
      skills: leaf(
        "skills",
        "ranking.pinned.skills",
        [] as readonly string[],
        STRING_ARRAY,
        "must be an array of strings",
        "an empty list",
      ),
      tools: leaf(
        "tools",
        "ranking.pinned.tools",
        [] as readonly string[],
        STRING_ARRAY,
        "must be an array of strings",
        "an empty list",
      ),
      roles: leaf(
        "roles",
        "ranking.pinned.roles",
        [] as readonly string[],
        STRING_ARRAY,
        "must be an array of strings",
        "an empty list",
      ),
    },
    projectSkillsFirst: leaf(
      "projectSkillsFirst",
      "ranking.projectSkillsFirst",
      false,
      BOOLEAN,
      "must be a boolean",
      String(false),
    ),
  },
  exclude: {
    skills: leaf(
      "skills",
      "exclude.skills",
      [] as readonly string[],
      STRING_ARRAY,
      "must be an array of strings",
      "an empty list",
    ),
    tools: leaf(
      "tools",
      "exclude.tools",
      [] as readonly string[],
      STRING_ARRAY,
      "must be an array of strings",
      "an empty list",
    ),
    roles: leaf(
      "roles",
      "exclude.roles",
      [] as readonly string[],
      STRING_ARRAY,
      "must be an array of strings",
      "an empty list",
    ),
  },
  colors: {
    skill: checkedLeaf(
      "skill",
      "colors.skill",
      "syntaxNumber",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("syntaxNumber"),
    ),
    tool: checkedLeaf(
      "tool",
      "colors.tool",
      "accent",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("accent"),
    ),
    role: checkedLeaf(
      "role",
      "colors.role",
      "success",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("success"),
    ),
    path: checkedLeaf(
      "path",
      "colors.path",
      "mdLinkUrl",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("mdLinkUrl"),
    ),
    url: checkedLeaf(
      "url",
      "colors.url",
      "mdLink",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("mdLink"),
    ),
    unresolved: checkedLeaf(
      "unresolved",
      "colors.unresolved",
      "warning",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("warning"),
    ),
    excluded: checkedLeaf(
      "excluded",
      "colors.excluded",
      "dim",
      isColour,
      "must be a pi foreground theme-token name",
      JSON.stringify("dim"),
    ),
  },
  url: {
    sourceExtensions: leaf(
      "sourceExtensions",
      "url.sourceExtensions",
      [
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
      ] as readonly string[],
      STRING_ARRAY,
      "must be an array of strings",
      "the default extension list",
    ),
  },
} satisfies LeafSpecsFor<Settings>;

function isLeafSpec(value: unknown): value is LeafSpec<unknown> {
  return isObject(value) && "defaultValue" in value;
}

function cloneDefault<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

/** Build the defaults object from the one field table. */
function defaultsFrom(node: RawObject): unknown {
  const out: RawObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = isLeafSpec(value)
      ? cloneDefault(value.defaultValue)
      : defaultsFrom(value as RawObject);
  }
  return out;
}

/** Palette C from the accepted prototype. */
export const DEFAULT_SETTINGS: Settings = defaultsFrom(FIELDS as unknown as RawObject) as Settings;

/** A mutable copy, so callers cannot accidentally edit the defaults. */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

function fallbackDiagnostic(key: string, requirement: string, used: string): Diagnostic {
  return {
    key,
    message: `${key} ${requirement}; using ${used}.`,
  };
}

function readSpec<T>(raw: RawObject, spec: LeafSpec<T>, diagnostics: Diagnostic[]): T {
  const value = raw[spec.property];
  const valid = spec.validate
    ? spec.validate(value)
    : spec.schema
      ? Check(spec.schema, value)
      : false;
  if (valid) return cloneDefault(value) as T;
  if (value !== undefined) {
    diagnostics.push(fallbackDiagnostic(`piMention.${spec.key}`, spec.requirement, spec.used));
  }
  return cloneDefault(spec.defaultValue);
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

type NameLists = Settings["exclude"];
type NameGroup = { [K in keyof NameLists]: LeafSpec<NameLists[K]> };

function readNameLists(raw: RawObject, group: NameGroup, diagnostics: Diagnostic[]): NameLists {
  const result = {} as NameLists;
  for (const name of NAME_KEYS) {
    result[name] = readSpec(raw, group[name], diagnostics);
  }
  return result;
}

function readColours(raw: RawObject, diagnostics: Diagnostic[]): ColourSettings {
  const result = { ...DEFAULT_SETTINGS.colors };
  for (const key of COLOUR_KEYS) {
    result[key] = readSpec(raw, FIELDS.colors[key], diagnostics);
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
    const spec = FIELDS.triggers[name];
    if (spec.validate?.(value)) {
      customs[name] = value as string;
    } else {
      diagnostics.push(fallbackDiagnostic(`piMention.${spec.key}`, spec.requirement, spec.used));
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
 * The field table supplies every leaf's default, validation and fallback
 * wording; every missing field takes its table default. One invalid leaf falls
 * back on its own with one diagnostic; a malformed parent object falls back to
 * that section's defaults with one diagnostic. Unknown keys are ignored. The
 * path trigger is absent by design: pi core owns `@`.
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

  const settings: Settings = {
    triggers: readTriggers(raw, diagnostics),
    completionSuffix: readSpec(raw, FIELDS.completionSuffix, diagnostics),
    hideSlashSkills: readSpec(raw, FIELDS.hideSlashSkills, diagnostics),
    ranking: {
      strategy: readSpec(ranking, FIELDS.ranking.strategy, diagnostics),
      pinned: readNameLists(pinned, FIELDS.ranking.pinned, diagnostics),
      projectSkillsFirst: readSpec(ranking, FIELDS.ranking.projectSkillsFirst, diagnostics),
    },
    exclude: readNameLists(exclude, FIELDS.exclude, diagnostics),
    colors: readColours(colors, diagnostics),
    url: {
      sourceExtensions: readSpec(url, FIELDS.url.sourceExtensions, diagnostics),
    },
  };

  return { settings, diagnostics };
}
