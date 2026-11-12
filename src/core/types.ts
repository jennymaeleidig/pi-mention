/** The kind of target a mention names. */
export type TokenClass = "skill" | "path" | "tool" | "role" | "url";

/** A half-open range in code units, matching JavaScript string offsets. */
export interface Range {
  start: number;
  end: number;
}

/** One typed mention, before resolution. */
export interface Mention {
  class: TokenClass;
  trigger: string;
  label: string;
  span: Range;
  quoted?: boolean;
}

/** The trigger character that opens a token class. */
export interface TriggerSpec {
  class: "skill" | "path" | "tool" | "role";
  trigger: string;
}

/** A target as the live catalog knows it. */
export interface Target {
  class: TokenClass;
  /** The short label a user types. */
  label: string;
  /** The registered or canonical name, when it differs from the label. */
  name?: string;
  /** Human description, when the catalog has one. */
  description?: string;
  /** Where the target came from, when the catalog knows: pi's source scope. */
  scope?: "user" | "project" | "temporary";
}

export type Resolution = "resolved" | "unresolved" | "excluded";

/** A mention paired with the target it resolves to, if any. */
export interface ResolvedMention {
  mention: Mention;
  status: Resolution;
  target?: Target;
}

/** A range to paint with one theme foreground role. */
export interface ColourSpan extends Range {
  role: string;
}

/** Plain-data catalogs built by the pi adapters. */
export interface Catalogs {
  skills: readonly Target[];
  tools: readonly Target[];
  roles: readonly Target[];
  /** Path existence is the one catalog that needs the filesystem. */
  paths: { has(label: string): boolean; readonly version?: number };
}

/** Colour roles are theme foreground tokens, not ANSI strings. */
export interface ColourSettings {
  skill: string;
  path: string;
  tool: string;
  role: string;
  url: string;
  unresolved: string;
  excluded: string;
}

export interface UrlSettings {
  sourceExtensions: readonly string[];
}

/** One settings problem: the key that fell back and a user-facing message. */
export interface Diagnostic {
  key: string;
  message: string;
}

export interface Settings {
  triggers: { skill: string; tool: string; role: string };
  completionSuffix: string;
  hideSlashSkills: boolean;
  ranking: {
    strategy: "frecency" | "recent" | "frequent" | "alphabetical" | "sourceOrder";
    pinned: { skills: readonly string[]; tools: readonly string[]; roles: readonly string[] };
    projectSkillsFirst: boolean;
  };
  exclude: { skills: readonly string[]; tools: readonly string[]; roles: readonly string[] };
  colors: ColourSettings;
  url: UrlSettings;
}
