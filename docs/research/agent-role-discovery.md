# Agent-role discovery and dispatch phrasing

Research for [#6](https://github.com/jennymaeleidig/pi-mention/issues/6). Scope: how the installed
`tinysubagent` discovers **agent roles**, whether it exposes that discovery to other extensions, and
what `&role` must expand to so the model calls `subagent` with `agent: "<role>"`.

Pinned sources:

- `tinysubagent` **0.4.5**, checkout `~/.pi/agent/git/github.com/tinypi-extension/tinysubagent`,
  commit `88a6217` (`Update ver`).
- `pi` **1.5.2** (`pi --version`).
- Installed roles: `~/.pi/agent/agents/*.md` (only `general.md`); no project `.pi/agents` in this
  repository.
- Runtime config: `~/.pi/agent/tinysubagent.jsonc` contains
  `{ "classifierModel": "typesafe/jev-latest", "enableProfiles": true }` and **no** `profiles`.

Claims below are checked against source and tests, not against the vault handoff. Corrections to
the handoff are called out in [§7](#7-corrections-to-the-prior-art-handoff).

## Answer in brief

- **Discovery is filesystem-only.** Roles are markdown files in
  `<agentDir>/agents/*.md` (user) and `<cwd>/<CONFIG_DIR_NAME>/agents/*.md` (project). On a name
  clash the project file wins; the result is sorted by role name. There is no ancestor-directory
  walk.
- **Nothing is exposed to extensions.** `tinysubagent` exports no discovery function, emits no
  `pi.events`, and registers only the `subagent` tool and `/subagent-settings`. Mirror the
  filesystem rules with pi's public `getAgentDir`, `CONFIG_DIR_NAME`, `parseFrontmatter`, and
  `stripFrontmatter`.
- **The expansion should name the tool, the exact `tasks` shape, the role, and where the brief
  goes.** The tested phrasing is in [§4](#4-expansion-text); the test used the literal role
  `scout` in place of `<role>`. It must say
  `tasks: [{ "agent": "<role>", "task": "…" }]`; there is no top-level `agent` or `task`.
- **Make the brief self-contained, not verbatim.** A tested "verbatim" variant passed
  `Summarise it in one line.` to the child when `it` referred to earlier conversation. The
  self-contained variant restated the file path and worked.
- **No task → do not dispatch.** Ask the user what to delegate; an empty `task` is rejected by the
  tool.
- **Roles and profiles are separate namespaces.** `&` resolves roles only and must never emit a
  `profile`. A name that exists in both is a role mention; a profile-only name is not a role.
- **The `enableProfiles` warning is unrelated to roles.** It reports that profiles are enabled but
  no named profiles exist, so only `current` is available. It affects the `profile` parameter, not
  the `agent` parameter or role discovery.

## 1. Role discovery

### 1.1 Paths

`src/config/agents.ts`:

```ts
userAgentsDir(agentDir = getAgentDir()) = path.join(agentDir, "agents")
projectAgentsDir(cwd)                 = path.join(cwd, CONFIG_DIR_NAME, "agents")
```

| Scope | Directory | Notes |
| --- | --- | --- |
| user | `$PI_CODING_AGENT_DIR/agents/*.md`, else `~/.pi/agent/agents/*.md` | `getAgentDir()` reads `PI_CODING_AGENT_DIR` and expands `~`. |
| project | `<cwd>/.pi/agents/*.md` | `CONFIG_DIR_NAME` is pi's rebrandable project directory (`.pi` here). **Exactly the cwd**; there is no search up parent directories. |

`discoverAgents(cwd, agentDir = getAgentDir())` is called in two places with different cwds:

- `index.ts`, at registration: `discoverAgents(process.cwd())`, to advertise roles in the tool
  description. This is the process cwd, not necessarily the session cwd.
- `src/pi/tool.ts`, in `execute`: `discoverAgents(cwd, getAgentDir())`, where `cwd` is
  `params.cwd` resolved against `ctx.cwd`. The role the model names is validated against this
  second, authoritative discovery.

For a mention expander, resolve against `ctx.cwd` (the default the tool will use). Do not add a
`cwd` argument to the expansion: a per-call `cwd` can select a different project role set, and the
mention would then name a role the spawner rejects.

### 1.2 Precedence and ordering

For each directory independently:

1. `readdirSync(dir)`, keep names ending in `.md`, `sort()` them by filename.
2. Read and parse each file. Unreadable files and files whose frontmatter throws are skipped (a
   warning is collected, but see §1.4: it is discarded at runtime).
3. Resolve the role name: frontmatter `name` (trimmed) if it is a non-empty string, else the
   filename with `.md` removed.
4. `discoverAgents` folds both lists into a `Map` keyed by resolved name: user first, then project,
   so **project overwrites user on a name clash**. Within one directory, a later filename wins for
   the same resolved name.
5. Return `[...byName.values()].sort((a, b) => a.name.localeCompare(b.name))`, so the advertised
   roster is stable and alphabetical.

Lookup at spawn is exact and case-sensitive:
`context.agents.find((entry) => entry.name === request.agent)`. Mention matching and picker
insertion must preserve case and exact spelling.

### 1.3 Frontmatter and body

Parsing uses pi's own `parseFrontmatter` (the `yaml` package), so the accepted dialect is exactly
pi's skill/prompt dialect.

| Field | Required | Behaviour |
| --- | --- | --- |
| `name` | no | Non-empty string, trimmed. Otherwise the filename without `.md`. This is the `agent` value. |
| `description` | no | String, trimmed. Missing or non-string becomes `""`; the role still loads and is advertised without a description. |
| `tools` | no | Comma/whitespace-separated string **or** YAML array; entries split again on `[,\s]+`, trimmed, empties dropped. Empty result = `undefined` = no restriction. |
| `model` | no | **Ignored.** Roles do not carry model/thinking; profiles do. (pi's example subagent supports `model`; tinysubagent does not.) |

The body is `stripFrontmatter(content).trim()`. Despite the README's "The body is the child's system
prompt", the body is **prepended to the child's task markdown**
(`src/children/task-markdown.ts`: role block, then `Complete your task autonomously.`, then the
brief, then the report contract). It is not a system prompt and should not be inlined into the
orchestrator's prompt by the mention expander; the child loads it itself.

Edge cases that matter when mirroring:

- No `---` block: `parseFrontmatter` returns `{}` and the whole file as body. Role name falls back to
  the filename; it is still a usable role.
- `---` without a closing `---`: pi treats it as no frontmatter, so the role loads under the filename
  and its body includes the leading `---`.
- Malformed YAML: `parseFrontmatter` throws; tinysubagent skips the file. pi-mention must skip it too,
  or the picker will offer a role the spawner does not have.
- A frontmatter scalar/list (e.g. `---\nfoo\n---`): `.name` is undefined, so the filename fallback
  applies. Mirror the same field reads rather than assuming a mapping.

### 1.4 Role warnings are discarded at runtime

`loadAgentsFromDir` collects warnings (missing description, unreadable file, invalid frontmatter),
but both call sites use only `.agents`:

- `index.ts`: `discoverAgents(process.cwd()).agents`
- `src/pi/tool.ts`: `const discovered = discoverAgents(...)`, then `discovered.agents`,
  `discovered.userDir`, `discovered.projectDir`

So the "missing description" warning never reaches the user, and a malformed role simply vanishes
from the roster. Do not depend on tinysubagent diagnostics; parse tolerantly and quietly.

### 1.5 Current inventory

| Location | Roles |
| --- | --- |
| `~/.pi/agent/agents/` | `general` — `description: General-purpose subagent.`, no body |
| `<repo>/.pi/agents/` | none (no `.pi` directory in this checkout) |

`&general` is the only live role here. The five sample roles under
`tinysubagent/sample_agent/` (`planner`, `researcher`, `reviewer`, `scout`, `worker`) are **not
installed**; they are repository examples, not discovery results.

### 1.6 Discovered is not dispatchable

The spawner re-discovers at execute time and can still refuse a role that the picker listed:

- unknown role after a `cwd` override:
  `unknown agent "<name>". Available: \`a\`, \`b\`.`;
- no roles at either root: a failure naming both directories;
- empty `task`: `tasks[0] needs a non-empty "agent" and "task".` (the schema requires `task`, but an
  empty string still fails this check);
- role declares `tools` that expand to include `subagent`: nested delegation is refused;
- profile errors, if a call supplies `profile`.

Expansion is a request, not a guarantee. Mention discovery should list roles exactly as the spawner
would; it should not try to reimplement `tools` expansion to hide "undispatchable" roles in v1.

## 2. Is discovery exposed to extensions?

**No.** Evidence:

- `package.json` declares only `"pi": { "extensions": ["./index.ts"] }`. There is no `main`,
  `exports`, or `types` entry; the package is an extension bundle, not a library.
- `index.ts` registers `/subagent-settings` and the `subagent` tool. It emits no `pi.events`, exposes
  no command that lists roles, and exports no function beyond the default extension entry.
- Roles live only in module-local state inside `src/config/agents.ts`; the tool description is the
  only place they surface.
- `pi.getAllTools()` (`ToolInfo` in pi 1.5.2: `name`, `description`, `parameters`,
  `promptGuidelines`, `exposure`, `sourceInfo`) does expose the `subagent` **description**, from
  which one could scrape `- \`role\` — description` lines. That is a lossy, non-contractual source:
  - the description lists at most `MAX_LISTED_AGENTS = 12` roles and appends
    `- …and N more.`;
  - each description is clipped to `MAX_ADVERTISED_DESCRIPTION = 120` characters;
  - the roster is computed at registration from `process.cwd()` and frozen, so it can differ from
    execute-time discovery after a cwd change or a reload;
  - extension load order means the tool may not exist yet when pi-mention registers;
  - it is prose, not a discovery API, and its wording is asserted by tinysubagent's tests but not
    promised as machine-readable.
- Deep-importing `tinysubagent/src/config/agents.ts` would be an unsupported, path-dependent
  dependency on an extension checkout, not a public API.

**Recommendation: mirror the filesystem rules.** Use pi's public primitives, which are the same ones
tinysubagent uses: `getAgentDir()`, `CONFIG_DIR_NAME`, `parseFrontmatter`, `stripFrontmatter`. That
keeps the YAML dialect, the `PI_CODING_AGENT_DIR` override, and the project directory name in sync
without coupling to tinysubagent internals. The mirror is ~45 lines ([§6](#6-code-sketch)).

## 3. Tool contract the expansion must target

`src/children/contract.ts`:

```ts
interface TaskInput {
  agent: string;      // role name
  task: string;       // self-contained brief
  name?: string;      // label
  profile?: string;   // model/thinking profile
}

interface ToolParams {
  tasks: TaskInput[]; // 1..4 entries
  cwd?: string;
}
```

There is **no top-level `agent`, `task`, `name`, or `profile`**. The handoff's list conflates the
per-task fields with the top-level shape. An expansion that says "call with `agent: "scout"` and
`task: "…"`" relies on the model reshaping it into `tasks: [{ … }]`; the schema usually rescues this
(one tested run did), but the expansion should show the real shape.

`src/present/describe.ts` builds the model-facing text:

- description: `Available roles:` followed by `- \`name\` — description` lines, capped as above;
- `Profiles: …` and the `profile` parameter only when `config.enableProfiles` is true;
- parameter descriptions: `agent` = "Role to run.", `task` = "Self-contained brief for this
  subagent.";
- guidelines: delegate self-contained work, start immediately, end the turn and wait, write a
  complete brief, state the exact output wanted.

The tool is registered only inside herdr (`if (!isInsideHerdr()) return;`). On this machine it is
available; the mention extension should still degrade to literal text if the tool is absent, because
a session outside herdr has no `subagent` tool at all.

## 4. Expansion text

### 4.1 Recommended phrasing (tested)

Inserted where the mention token was; the user's task text follows after a blank line.

```text
[subagent dispatch: role "<role>"]
Call the `subagent` tool now and delegate the rest of this message to the `<role>` role. Call it with `tasks: [{ "agent": "<role>", "task": "<the rest of this message>" }]`, using the text after this line as the `task` brief. Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, but keep the user's intent and wording. Do not do the task yourself.

<task text>
```

Why each part is there:

| Clause | Failure it prevents |
| --- | --- |
| `[subagent dispatch: role "<role>"]` | A visible marker that the message is a dispatch request, not a question to answer. |
| ``Call the `subagent` tool now`` | Names the exact tool; "now" counters "I could just do this myself". |
| `delegate the rest of this message to the <role> role` | Separates role from task and says who does the work. |
| `tasks: [{ "agent": "<role>", "task": "…" }]` | Shows the real argument shape, including the array wrapper. |
| `the text after this line as the task brief` | Locates the user's task inside the expanded message. |
| `Make the brief self-contained…` | The child cannot see the conversation; "verbatim" turns "summarise it" into an unusable brief. |
| `Do not do the task yourself.` | The common failure is the orchestrator answering instead of delegating. |

The tool's own description and guidelines already say "end your turn and wait"; the expansion does
not repeat it. If a later test shows the parent continues working after the call, add
`End your turn after the call and wait for the result.` (untested addition).

### 4.2 No task (tested)

If the mention is the whole message (or is followed only by whitespace), emit:

```text
[subagent dispatch: role "<role>"]
The user selected the `<role>` role but gave no task. Do not call the `subagent` tool. Ask the user what to delegate to `<role>`.
```

Observed behaviour: the model asks what to delegate and makes no tool call. This is the only safe
option. A placeholder brief such as "ask the user what to do" would spawn a child that cannot talk to
the user and would report nothing useful; an empty `task` is rejected by `collectRequests`.

### 4.3 Alternative shaping (tested)

A tag-shaped variant, closer to pi's native `<skill>` block:

```text
<subagent-role name="<role>" />
Everything after this tag is the brief for the `<role>` role. Delegate it by calling the `subagent` tool with `tasks: [{ "agent": "<role>", "task": "<everything after this tag>" }]`. Do not do the work yourself; end your turn after the call.

<task text>
```

A fully rewritten JSON variant, for cases where free-text extraction proves unreliable:

```text
Call the `subagent` tool exactly once with these arguments:
{"tasks":[{"agent":"<role>","task":"<escaped task>"}]}
Do not do the work yourself. End your turn after the call and wait for the result.
```

The JSON variant needs task escaping and cannot represent "no task"; it is a fallback, not the
default.

### 4.4 Test method and results

The point of the test was to compare phrasings, not to certify the model. Setup:

- `pi` 1.5.2, print mode, `--no-extensions -e <fake>` with a fake extension registering a
  `subagent` tool whose description, parameter schema, snippet, and guidelines were copied from
  tinysubagent 0.4.5; `execute` appended its arguments to a log.
- Model `opencode-go/deepseek-v4.1-flash`, thinking off. Built-in tools left enabled, so answering
  directly was possible. Skills, prompt templates, context files, MCP, and sessions disabled.
- A target file `/tmp/role-test/target.md` contained a unique sentence. A run "passed" only if the
  fake tool was called with `agent: "scout"`; reading the file itself was a failure.
- One run per phrasing. This is directional evidence, not a statistical result.

| # | Phrasing | Task | Result |
| --- | --- | --- | --- |
| A | Explicit prefix, "verbatim" | self-contained (`Summarise /tmp/…/target.md in one line.`) | **Pass** — `{"tasks":[{"agent":"scout","task":"Summarise /tmp/role-test/target.md in one line."}]}` |
| B | `<subagent-role>` tag | self-contained | **Pass** — same args |
| C | Exact JSON rewrite | self-contained | **Pass** — same args |
| D | ``Use the `scout` subagent for this task: …`` | self-contained | **Pass** — model added `name` and an absolute `cwd`, rewrote the task; still correct |
| E | Wrong-ish "call with `agent: …` and `task: …`" | self-contained | **Pass** — model normalized to `tasks`, added `cwd` |
| F | Recommended prefix, self-contained clause | context-dependent (`Summarise it in one line.` after mentioning the file earlier in the same message) | **Pass** — child brief restated the absolute path and explained the earlier-context gap |
| G | The "verbatim" prefix | context-dependent | **Fail (semantically)** — dispatched, but the child received `Summarise it in one line.` with no referent |
| N | No-task text | none | **Pass (safe)** — no call; asked what to delegate |
| control | No expansion | self-contained | **Pass (as expected)** — read the file and answered itself, no call |

The control matters: the fake tool was available in every run, but only the expanded runs delegated.
The G failure is the reason the recommended phrasing says "self-contained" instead of "verbatim".

Caveats: one model, one run each, print mode, fake tool, no herdr. A different model may be more or
less literal, and the real tool's description differs only in the live role list. Treat F as the
candidate to re-test in #10's table and in #18's acceptance test.

### 4.5 Where the task goes, and mention boundaries

- **Replace the mention token in place.** The expansion is a prefix; the user's remaining text stays
  as the task, after a blank line. This preserves the user's wording and avoids escaping.
- **The model may rewrite the brief to make it self-contained.** That is desired: the child cannot
  see the conversation. The instruction says to keep intent and wording, adding only needed context.
- **v1 boundary: one role mention at the start of the message.** "The rest of this message" and
  "the text after this line" are only well-defined for a leading mention. If the grammar permits
  mid-sentence mentions (#9), the wording must become "the rest of the user's message after the
  mention" and text before the mention needs an explicit decision. Multiple role mentions in one
  message need a batch decision (one `tasks` entry each, or leave the second literal); not tested
  here. Defer to #9/#10.
- **Unknown role: leave the mention literal.** Per #18, unknown roles stay literal and
  unresolved-coloured. Do not expand a profile-only name into a role. Optionally surface a picker
  diagnostic, but never emit a call.
- **Do not inline the role body.** It can be large, it belongs to the child, and inlining it invites
  the parent to follow the role instructions itself. The picker needs only `name` and
  `description`; expansion needs only `name`.

## 5. Roles vs profiles, and the `enableProfiles` warning

| | Role | Profile |
| --- | --- | --- |
| Definition | markdown file in `agents/*.md` | `profiles.<name>` in `tinysubagent.json(c)`, plus built-in `current` |
| Carries | `name`, `description`, `tools`, body | `model`, `thinking`, optional `harness` |
| Selected by | `tasks[].agent` | `tasks[].profile` (optional) |
| Gated by | nothing | `enableProfiles: true`; without it the `profile` parameter is removed from the schema |
| Namespace | filesystem role names | config profile names; `current` is built in and cannot be redefined |
| Discovery | both roots, project wins | highest-precedence file wins per key; profiles merge by name across scopes |

Boundary rules for `&`:

1. `&name` is a **role** mention. Resolve only against role discovery.
2. A name that exists as both a role and a profile resolves to the role. Never add `profile` to the
   expanded call; selecting a profile is a separate concern and #18 explicitly says "never assume
   profiles".
3. A name that exists **only** as a profile is not a role and must not expand. Leave it literal, or
   show it as unresolved. Do not offer profile names in the `&` picker.
4. The model may still choose a profile on its own, and routing may rewrite it; that is the model's
   call, not the mention's.

The warning in the transcript is exactly:

```text
tinysubagent: enableProfiles is true but no usable profiles were defined in <file>; only "current" is available.
```

Source: `loadConfig` in `src/config/config.ts`, when `enableProfiles === true` and
`Object.keys(profiles).length === 0`. `<file>` is `sources[0]?.file`, the highest-precedence
successfully-read config file (not necessarily the file that set `enableProfiles`; a test asserts
this). It is surfaced once at `session_start` via `registerLifecycle`:
`ctx.ui.notify(configWarnings.join("\n"), "warning")`, only when `ctx.hasUI`.

On this machine the cause is `~/.pi/agent/tinysubagent.jsonc` with `enableProfiles: true` and no
`profiles` object. It has **no effect on role dispatch**:

- roles are discovered and advertised regardless of `enableProfiles`;
- the `agent` parameter is always present; only `profile` is gated;
- a spawn with no `profile` resolves to `current` and works.

It does mean a call that explicitly names a nonexistent profile fails with
`unknown profile "<name>". Available: current.` The mention expansion avoids that by never emitting
`profile`. (With `classifierModel` set, routing is also active; routing may log its own warning if
the classifier returns a name that is not a configured profile, but it still falls back to `current`
and does not block the spawn.)

## 6. Code sketch

### 6.1 Role discovery

Mirrors `src/config/agents.ts` exactly; imports only pi's public surface.

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";

export type RoleSource = "user" | "project";

export interface Role {
  name: string;
  description: string;
  tools?: string[];
  body: string;
  source: RoleSource;
  path: string;
}

export interface RoleDirs {
  user: string;
  project: string;
}

export function roleDirs(cwd: string, agentDir = getAgentDir()): RoleDirs {
  return {
    user: path.join(agentDir, "agents"),
    project: path.join(cwd, CONFIG_DIR_NAME, "agents"),
  };
}

/** tinysubagent's normalization: string or array, split on commas/whitespace. */
function normalizeTools(raw: unknown): string[] | undefined {
  const parts =
    typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : Array.isArray(raw)
        ? raw
            .filter((entry): entry is string => typeof entry === "string")
            .flatMap((entry) => entry.split(/[,\s]+/))
        : [];
  const tools = parts.map((part) => part.trim()).filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

export function loadRolesFromDir(dir: string, source: RoleSource): Role[] {
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort();
  } catch {
    return []; // unreadable directory is empty, not fatal
  }

  const roles: Role[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry);
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseFrontmatter(content).frontmatter ?? {};
    } catch {
      continue; // malformed YAML: tinysubagent skips the file
    }

    const rawName = frontmatter.name;
    const name =
      typeof rawName === "string" && rawName.trim() !== ""
        ? rawName.trim()
        : entry.replace(/\.md$/, "");
    const rawDescription = frontmatter.description;
    const description =
      typeof rawDescription === "string" ? rawDescription.trim() : "";

    roles.push({
      name,
      description,
      tools: normalizeTools(frontmatter.tools),
      body: stripFrontmatter(content).trim(),
      source,
      path: file,
    });
  }
  return roles;
}

/** Project overrides user by name; alphabetical, like tinysubagent's roster. */
export function discoverRoles(cwd: string, agentDir = getAgentDir()): Role[] {
  const dirs = roleDirs(cwd, agentDir);
  const byName = new Map<string, Role>();
  for (const role of loadRolesFromDir(dirs.user, "user")) byName.set(role.name, role);
  for (const role of loadRolesFromDir(dirs.project, "project")) byName.set(role.name, role);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

Test fixtures worth pinning (same cases tinysubagent's `test/config/agents.test.ts` asserts):

- project `reviewer` overrides user `reviewer`; both `user-only` and `project-only` survive;
- filename fallback when `name` is absent;
- missing description → `""`, role present;
- `tools` as string, YAML list, and whitespace/empty normalization;
- malformed YAML file skipped, sibling role still discovered;
- no directories → empty list, no throw;
- final order alphabetical by `name`, not filename;
- no ancestor search: a `.pi/agents` in a parent of `cwd` is invisible.

### 6.2 Pure expansion seam

```ts
export type RoleExpansion =
  | { kind: "dispatch"; prefix: string }
  | { kind: "no-task"; text: string }
  | { kind: "unresolved" };

/**
 * `prefix` replaces the mention token; the caller leaves the rest of the
 * user's message in place, after a blank line. `role.name` is JSON-escaped
 * where it appears inside the argument example.
 */
export function expandRoleMention(role: Role, taskText: string): RoleExpansion {
  const name = role.name;
  const quoted = JSON.stringify(name);

  if (taskText.trim() === "") {
    return {
      kind: "no-task",
      text:
        `[subagent dispatch: role ${quoted}]\n` +
        `The user selected the \`${name}\` role but gave no task. ` +
        `Do not call the \`subagent\` tool. Ask the user what to delegate to \`${name}\`.`,
    };
  }

  return {
    kind: "dispatch",
    prefix:
      `[subagent dispatch: role ${quoted}]\n` +
      `Call the \`subagent\` tool now and delegate the rest of this message to the \`${name}\` role. ` +
      `Call it with \`tasks: [{ "agent": ${quoted}, "task": "<the rest of this message>" }]\`, ` +
      `using the text after this line as the \`task\` brief. ` +
      `Make the brief self-contained: if it refers to earlier conversation, restate what the subagent needs, ` +
      `but keep the user's intent and wording. ` +
      `Do not do the task yourself.\n\n`,
  };
}
```

The adapter must match the mention only when the name resolves; otherwise return
`{ kind: "unresolved" }` and leave the original text untouched. Detection of "no task" happens after
the mention token and any trailing whitespace/punctuation the grammar assigns to the mention (#9).

## 7. Corrections to the prior-art handoff

The vault handoff is directionally right but needs four corrections before it is reused:

1. **Tool arguments.** It says the call takes `agent`, `task`, `name`, `tasks`, `cwd`, `profile`.
   Only `tasks` and `cwd` are top-level; `agent`, `task`, `name`, `profile` are fields of each
   `tasks[]` entry.
2. **Project role lookup.** It says project roles live at `<project>/.pi/agents/*.md`, which is
   right, but pi's *example* subagent (`examples/extensions/subagent/agents.ts`) searches ancestor
   directories and requires `name` + `description`; tinysubagent does neither. Do not use the example
   as the spec.
3. **Body role.** The README (and the handoff's "the body is the child's system prompt") is stale.
   The source prepends the body to the child's task markdown, not its system prompt; roles have no
   system-prompt replacement switch in 0.4.5.
4. **"Verbatim" dispatch.** Passing the user's text verbatim is not safe for context-dependent
   tasks; the tested failure passed `Summarise it in one line.` to the child. Instruct the model to
   make the brief self-contained.

## 8. Open questions for #9 and #10

- Mention grammar: must a role mention start the message? What trailing punctuation belongs to the
  mention? The expansion wording here assumes a leading mention.
- Multiple role mentions in one message: batch (`tasks` with one entry each), first-only, or
  literal? Not tested.
- Unknown-role presentation: leave literal only, or also a picker "no such role" row? #18 already
  says literal + unresolved colour.
- Transcript display: show the user's original `&role task`, or the expanded text? The model-facing
  text is the expanded form; #10 owns the table.
- Whether to append "End your turn after the call and wait for the result." to the expansion. The
  tool's own guidelines already say it; not needed in the tested runs.
- Re-test the recommended phrasing against the real tool (not the fake) and against a second model
  before #18 is marked done.

## 9. Primary sources

- `~/.pi/agent/git/github.com/tinypi-extension/tinysubagent` @ `88a6217` (0.4.5):
  - `src/config/agents.ts` — paths, parsing, precedence, ordering;
  - `src/config/config.ts` — profiles, `enableProfiles`, warning text;
  - `src/config/profiles.ts` — `current`, profile resolution;
  - `src/children/contract.ts` — `ToolParams` / `TaskInput`;
  - `src/children/requests.ts` — validation, label, `cwd` resolution;
  - `src/children/spawn.ts` — unknown-role rejection, nested-delegation rejection;
  - `src/children/task-markdown.ts` — role body placement;
  - `src/present/describe.ts` — advertised roles, caps, parameter schema;
  - `src/pi/tool.ts`, `index.ts` — registration, execute-time discovery;
  - `test/config/agents.test.ts`, `test/config/config.test.ts`, `test/pi/tool.test.ts`;
  - `README.md`, `GLOSSARY.md` (role/profile definitions; README's system-prompt line is stale).
- pi 1.5.2: `dist/config.js` (`getAgentDir`, `CONFIG_DIR_NAME`), `dist/utils/frontmatter.js`
  (`parseFrontmatter`, `stripFrontmatter`), `docs/extensions.md` (`input` event, `ToolInfo`),
  `dist/core/extensions/types.d.ts` (`getAllTools`, `ToolInfo`),
  `examples/extensions/subagent/agents.ts` (contrasting example, not the installed spec).
- Installed role: `~/.pi/agent/agents/general.md`.
- Runtime config: `~/.pi/agent/tinysubagent.jsonc`.
