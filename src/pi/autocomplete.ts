import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { isLabel, isToolLabel, scanMentionEnd, type TriggerSpec } from "../core/grammar.ts";
import { findPickerToken, orderMatches, rankTargets } from "../core/picker.ts";
import { isExcluded } from "../core/resolve.ts";
import type { PickerClass, SelectionHistory } from "../core/selection.ts";
import type { Catalogs, Settings, Target } from "../core/types.ts";
import { SKILL_COMMAND_PREFIX } from "./catalogs/skills.ts";
import { createSelectionStore } from "./history.ts";

const TERMINATOR = /^[\s,;:!?)\]}]/u;

type CatalogView = Pick<Catalogs, "skills" | "tools" | "roles">;

/** One picker source: the class, its trigger, label predicate and completion suffix. */
interface MentionProvider {
  class: PickerClass;
  trigger: string;
  accepts(label: string): boolean;
  suffix: string;
  pinned: readonly string[];
  projectFirst: boolean;
  catalog(catalogs: CatalogView): readonly Target[];
}

function providersFor(settings: Settings): MentionProvider[] {
  return [
    {
      class: "skill",
      trigger: settings.triggers.skill,
      accepts: isLabel,
      suffix: settings.completionSuffix,
      pinned: settings.ranking.pinned.skills,
      projectFirst: settings.ranking.projectSkillsFirst,
      catalog: (catalogs) => catalogs.skills,
    },
    {
      class: "tool",
      trigger: settings.triggers.tool,
      accepts: isToolLabel,
      suffix: settings.completionSuffix,
      pinned: settings.ranking.pinned.tools,
      projectFirst: false,
      catalog: (catalogs) => catalogs.tools,
    },
    {
      class: "role",
      trigger: settings.triggers.role,
      accepts: isLabel,
      suffix: settings.completionSuffix,
      pinned: settings.ranking.pinned.roles,
      projectFirst: false,
      catalog: (catalogs) => catalogs.roles,
    },
  ];
}

function textBeforeCursor(lines: string[], cursorLine: number, cursorCol: number): string {
  const current = (lines[cursorLine] ?? "").slice(0, cursorCol);
  if (cursorLine === 0) return current;
  return `${lines.slice(0, cursorLine).join("\n")}\n${current}`;
}

function filterSlashSkills(
  suggestions: AutocompleteSuggestions | null,
  hide: boolean,
): AutocompleteSuggestions | null {
  if (!suggestions || !hide || !suggestions.prefix.startsWith("/")) return suggestions;
  const items = suggestions.items.filter((item) => !item.value.startsWith(SKILL_COMMAND_PREFIX));
  if (items.length === 0) return null;
  return { ...suggestions, items };
}

function completionSuffix(after: string, suffix: string): string {
  if (!suffix) return "";
  return TERMINATOR.test(after) ? "" : suffix;
}

export interface AutocompleteOptions {
  settings: Settings;
  catalogs: () => CatalogView;
  history: SelectionHistory;
  now?: () => number;
}

/**
 * Wrap pi's current provider with the `$`, `%` and `&` pickers.
 *
 * Everything else — including pi core's `@` file picker and `/` commands — is
 * delegated unchanged. Items carry the short label as their value, so accepting
 * one inserts `$tdd`, not the internal `skill:tdd`.
 */
export function createMentionAutocomplete(
  current: AutocompleteProvider,
  options: AutocompleteOptions,
): AutocompleteProvider {
  const providers = providersFor(options.settings);
  const specs: TriggerSpec[] = providers.map((provider) => ({
    class: provider.class,
    trigger: provider.trigger,
  }));
  const chosen = new WeakMap<AutocompleteItem, { provider: MentionProvider; target: Target }>();
  const delegate = async (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    call: { signal: AbortSignal; force?: boolean },
  ) =>
    filterSlashSkills(
      await current.getSuggestions(lines, cursorLine, cursorCol, call),
      options.settings.hideSlashSkills,
    );

  return {
    triggerCharacters: [
      ...new Set([...(current.triggerCharacters ?? []), ...providers.map((p) => p.trigger)]),
    ],
    async getSuggestions(lines, cursorLine, cursorCol, call) {
      const before = textBeforeCursor(lines, cursorLine, cursorCol);
      const token = findPickerToken(before, specs);
      if (!token) return delegate(lines, cursorLine, cursorCol, call);
      if (call.signal.aborted) return null;

      const provider = providers.find((candidate) => candidate.class === token.class);
      if (!provider) return delegate(lines, cursorLine, cursorCol, call);

      const targets = provider
        .catalog(options.catalogs())
        .filter((target) => provider.accepts(target.label))
        .filter((target) => !isExcluded(target, options.settings));
      const ranking = { pinned: provider.pinned, projectFirst: provider.projectFirst };
      const ranked = token.query
        ? orderMatches(
            fuzzyFilter([...targets], token.query, (target) => target.label),
            ranking,
          )
        : rankTargets(targets, {
            ...ranking,
            strategy: options.settings.ranking.strategy,
            history: options.history.get(provider.class),
            now: options.now?.() ?? Date.now(),
          });
      if (ranked.length === 0) return null;

      const items = ranked.map((target) => {
        const item: AutocompleteItem = {
          value: `${provider.trigger}${target.label}`,
          label: target.label,
          ...(target.description ? { description: target.description } : {}),
        };
        chosen.set(item, { provider, target });
        return item;
      });
      return { items, prefix: token.prefix };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const picked = chosen.get(item);
      const provider =
        picked?.provider ??
        providers.find(
          (candidate) => candidate.trigger.length > 0 && prefix.startsWith(candidate.trigger),
        );
      const line = lines[cursorLine] ?? "";
      const start = cursorCol - prefix.length;
      if (!provider || start < 0 || line.slice(start, cursorCol) !== prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

      const end = Math.max(cursorCol, scanMentionEnd(line, start, provider.class));
      const after = line.slice(end);
      const suffix = completionSuffix(after, provider.suffix);
      const replacement = `${item.value}${suffix}`;
      const next = [...lines];
      next[cursorLine] = `${line.slice(0, start)}${replacement}${after}`;

      const now = options.now?.() ?? Date.now();
      if (picked) {
        options.history.record(provider.class, picked.target.name ?? picked.target.label, now);
      } else {
        const label = item.value.startsWith(provider.trigger)
          ? item.value.slice(provider.trigger.length)
          : undefined;
        if (label !== undefined && provider.accepts(label)) {
          options.history.record(provider.class, label, now);
        }
      }

      return {
        lines: next,
        cursorLine,
        cursorCol: start + replacement.length,
      };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const before = textBeforeCursor(lines, cursorLine, cursorCol);
      if (findPickerToken(before, specs)) return false;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

/** Register the picker wrapper on the interactive UI. */
export function installAutocomplete(
  ui: ExtensionUIContext,
  settings: Settings,
  catalogs: () => CatalogView,
  history: SelectionHistory = createSelectionStore(),
): void {
  ui.addAutocompleteProvider((current) =>
    createMentionAutocomplete(current, { settings, catalogs, history }),
  );
}
