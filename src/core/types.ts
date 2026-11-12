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

/** A skill body and its location, loaded and frontmatter-stripped by the pi adapter. */
export interface SkillSource {
  /** The skill's short label, used in the block's `name` attribute. */
  name: string;
  /** Absolute path to the SKILL.md file. */
  location: string;
  /** Directory that relative references in the body resolve against. */
  baseDir: string;
  /** SKILL.md content with frontmatter already stripped. */
  body: string;
}

/** Adapter-supplied inputs that the pure expander cannot read itself. */
export interface ExpandOptions {
  /**
   * The source for a resolved skill. Expansion itself performs no I/O; a
   * missing source aborts the block and leaves the mention literal.
   */
  skillSource?: (target: Target) => SkillSource | undefined;
}

/** A resolved skill that could not become a block. */
export interface SkillFailure {
  /** The skill label, for the adapter's one user-facing notice. */
  name: string;
}

/** A message after expansion at one seam. */
export interface ExpandedMessage {
  text: string;
  /** Present only when a native skill block was built at the input seam. */
  skillBlock?: string;
  /** Present when a resolved skill could not become a block. */
  skillFailure?: SkillFailure;
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
