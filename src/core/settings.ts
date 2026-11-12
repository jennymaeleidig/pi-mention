import type { Settings } from "./types.ts";

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
