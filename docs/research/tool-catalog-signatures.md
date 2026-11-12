# Live tool catalog and signature rendering (pi 1.5.2)

Research for [#7](https://github.com/jennymaeleidig/pi-mention/issues/7).

This note pins down what pi 1.5.2 actually exposes about tools to an extension, how
exposure and the active set combine into reachability, how MCP tool names and namespaces
are built, and what `renderToolSignature` really renders. The prior `pi-mention-tool` spec
is treated as a hypothesis. Several of its claims survive; the routing table does not.

## Recommendation

1. Build the catalog on every `context` event, from `pi.getAllTools()` and
   `pi.getActiveTools()`, synchronously. There is no cache to invalidate; a per-request
   read is cheap and is the only way to see a server that connected between requests.
2. Membership is not a function of exposure alone. `hidden` is out; `direct` and
   `model-only` are in only while active; `codemode` and `deferred` are in only while
   some active reaching tool (`codemode` or `tool_search`) can reach them. Reach is
   `direct` when the target itself is active, otherwise the reaching tool's route.
3. `model-only` is not "unreachable": an active `model-only` tool is declared to the
   model and can be called directly. `codemode` and `tool_search` are themselves
   `model-only`. The prior table's "model-only is out" is wrong.
4. Never reconstruct a registered name for a call. Use `ToolInfo.name`. `%server:tool`
   labels can only be derived from the sanitized registered name and are therefore
   lossy; the raw MCP tool name is not exposed at all.
5. Render signatures with `@earendil-works/pi-codemode@1.5.2/declarations`, not the
   package root. The subpath imports only `declarations.js` and `identifier.js`, so no
   WebAssembly is loaded. Cast `ToolInfo.parameters`: it is TypeBox's empty `TSchema`,
   not `CodemodeJsonSchema`.
6. Accept `Promise<unknown>`: `getAllTools()` does not expose `outputSchema`, so an
   extension cannot render the output half of pi's codemode declaration.
7. Decide the `tool_search`-only case explicitly. A `deferred`-configured MCP server
   activates `tool_search`, not `codemode`; "always say reach it in a codemode script"
   is false there. Either omit those tools from the catalog or accept a search step that
   activates them for the next call.

## Pinned sources

| Short name | Package / location |
| --- | --- |
| `PI` | `@earendil-works/pi-coding-agent@1.5.2`, installed under the pnpm store |
| `MCP` | `@earendil-works/pi-mcp@1.5.2`, sibling install of `PI` |
| `CM` | `@earendil-works/pi-codemode@1.5.2`, sibling install of `PI` |
| `TB` | `typebox@1.3.27`, dependency of `PI` |
| `SPEC` | `…/Vault/ideas/tech/config/pi/extensions/pi-mention/pi-mention-tool/spec.md` |

Line numbers are from those installed builds. They are evidence, not a stable API;
re-check when pi is upgraded. I also ran small probes against the installed builds:
a signature-rendering probe, a module-resolution probe for WebAssembly, a `tsc` check of
the type edges, and `createMcpToolName` examples. Those are in [§9](#9-probes).

## 1. The live tool API

### 1.1 `getActiveTools(): string[]`

`PI dist/core/extensions/types.d.ts:1326-1327`:

```ts
/** Get the names of the active tools, which are the tools declared to the model. */
getActiveTools(): string[];
```

It is implemented as `this.agent.state.tools.map((t) => t.name)` (`PI
dist/core/agent-session.js:1146-1147`), so it is the session's active loadout, in order,
not a separately-maintained set. (One edge case where active ≠ declared is below.)

Two consequences:

- It is a snapshot. `setActiveTools`, `tool_search`, and a newly registered `direct`
  tool change it. Re-read it per request.
- It is the *active* set, not quite "everything the model can see". A tool can be active
  while another tool's `prepareLoadout` hides its declaration from requests
  (`types.d.ts:464-468`; `docs/extensions.md:2770`). `getActiveTools()` still returns
  its name. There is no API that reports `hiddenDeclarations`, so a catalog cannot tell
  this case apart. Treat it as a known, rare caveat.

`getCallableToolNames()` (`agent-session.js:1149-1151`) is **not** on `ExtensionAPI`.
An extension cannot ask "what is callable through `ctx.executeTool()`"; it must derive
that from exposure and the active set, as below.

### 1.2 `getAllTools(): ToolInfo[]`

`types.d.ts:1328-1329`:

```ts
/** Get all configured tools with parameter schema, prompt guidelines, exposure, and source metadata. */
getAllTools(): ToolInfo[];
```

`ToolInfo` is exactly (`types.d.ts:1621-1627`):

```ts
/** Tool info with name, description, parameter schema, prompt guidelines, and source metadata. */
export type ToolInfo = Pick<
  ToolDefinition,
  "name" | "description" | "parameters" | "promptGuidelines" | "reachesTools"
> & {
  exposure: ToolExposure;
  namespace?: ToolNamespace;
  annotations?: ToolAnnotations;
  sourceInfo: SourceInfo;
};
```

`ToolExposure` is `"direct" | "model-only" | "codemode" | "deferred" | "hidden"`
(`types.d.ts:415`). `ToolNamespace` is `{ name; aliases?; description?; instructions? }`
(`types.d.ts:430-446`). `SourceInfo` is `{ path; source; scope; origin; baseDir?;
changelogPath? }` (`PI dist/core/source-info.d.ts:4-11`).

The implementation (`agent-session.js:1156-1168`) maps over the live
`_toolDefinitions` map and returns fresh objects, but the nested `parameters`,
`namespace`, and `annotations` values are the live definitions' objects. Do not mutate
them. A typical MCP entry (fields elided) is:

```ts
{
  name: "mcp__kagi__kagi_search_fetch",
  description: "Search the web …",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  exposure: "deferred",
  namespace: { name: "mcp__kagi", aliases: ["kagi"] },
  sourceInfo: { path: "builtin:mcp", source: "builtin", scope: "temporary", origin: "top-level" },
}
```

`promptGuidelines`, `reachesTools`, and `annotations` are absent when unset.

What `ToolInfo` does **not** carry, although `ToolDefinition` does:

- `outputSchema` (`types.d.ts:492-496`). MCP tools set one
  (`PI dist/extensions/mcp/tools.js:198`), but `getAllTools()` drops it.
- `label` (`types.d.ts:476-477`). MCP sets it to `"<server>/<tool>"` with the *raw*
  tool name (`mcp/tools.js:191-194`), but `getAllTools()` drops it.
- `promptSnippet`, `defaultActive`, `prepareLoadout`.
- The model-facing description after another tool's `prepareLoadout` override. The
  catalog sees `definition.description`, the original.

`getToolDefinition(name)` exists on `AgentSession` (`agent-session.js:1169-1171`) but is
**not** on `ExtensionAPI`. Neither is `getCallableToolNames()`. `getAllTools()` is the
whole public surface for tool metadata.

`getAllTools()` returns every configured tool, including `hidden` ones, subject to
`--tools` / `--exclude-tools` filtering (`agent-session.js:1197-1203`, `2966-3022`).
Tools removed by those filters are absent, not hidden.

### 1.3 Descriptions and parameter schemas

- `description` is a required `string`. For MCP it is
  `tool.description?.trim() || title || "MCP tool <tool> from server <server>"`
  (`mcp/tools.js:195`).
- `parameters` is a TypeBox `TSchema` (`types.d.ts:484-485`), which is a JSON Schema at
  runtime (the MCP builder says so explicitly: `mcp/tools.js:196-197`). In `typebox@1.3.27`,
  `TSchema` is an empty interface (`TB build/type/types/schema.d.mts:1`), so TypeScript
  knows nothing about its fields. That matters for the renderer ([§4.2](#42-the-renderer-api)).
- `promptGuidelines` is optional (`string[]`).
- `annotations` are MCP-style hints, not callability.
- There is no output schema, no separate "input schema" name, and no raw MCP tool name.

### 1.4 Exposure: declared vs callable

`types.d.ts:400-415` defines the terms, and explicitly says "callable" means callable
from other tools through `ctx.executeTool()`, as `codemode` does:

| exposure | activates on registration | declared while active | callable via `ctx.executeTool()` | model may call when declared |
| --- | --- | --- | --- | --- |
| `direct` | yes (unless `defaultActive: false`) | yes | only while active | yes |
| `model-only` | yes (unless `defaultActive: false`) | yes | **never** | yes |
| `codemode` | no | yes, if explicitly activated | always | yes |
| `deferred` | no | yes, if explicitly activated or loaded by `tool_search` | always | yes |
| `hidden` | no | no | no | no |

Evidence:

- `_isDeclarable` returns true only for `direct` and `model-only`
  (`agent-session.js:3050-3054`), which controls activation-on-registration, not the
  loadout.
- `_applyToolLoadout` keeps any requested tool whose exposure is not `hidden`
  (`agent-session.js:1238-1245`), so active `codemode` and `deferred` tools are declared
  too.
- `_getCallableTools` is `codemode || deferred || (direct && active)`
  (`agent-session.js:1218-1227`). `model-only` is deliberately absent.
- The model-issued tool list is `agent.state.tools` (`agent-session.js:495-500`,
  `608-613`), the same list `getActiveTools()` reports.

The important correction: "never callable" for `model-only` means never callable *by
another tool*. The model itself calls it normally. `codemode` and `tool_search` are both
registered with `exposure: "model-only"` (`PI dist/extensions/codemode/tool.js:311`,
`PI dist/extensions/tool-search/tool.js:248`) and are obviously callable by the model.

## 2. Reachability and the corrected routing table

### 2.1 The two indirect mechanisms

There is no third mechanism. Both are ordinary model-only tools that must be active:

- **`codemode`** is active, the model calls it, and the script calls
  `tools.<id>(...)`. The sandbox's callable set is `_getCallableTools()`: active `direct`
  tools plus every registered `codemode` or `deferred` tool (`agent-session.js:1218-1227`).
  It cannot call `model-only` tools. A script can use `tools.mcp__server__tool(...)` or
  `tools["mcp__server__tool"](...)`.
- **`tool_search`** is active, the model calls it, and it BM25-ranks **inactive** tools
  with `codemode` or `deferred` exposure, then calls `setActiveTools` to add the matches
  (`PI dist/extensions/tool-search/tool.js:215-232`, `243-267`). The result text says
  they are available "from your next call"; the tool is declared from then on and can be
  called directly. This is an activation recorded in the transcript.

The MCP extension activates the reaching tools the server *config* asks for at
`session_start`, before the servers connect (`PI dist/extensions/mcp/index.js:390-429`,
`972-1011`):

- any enabled server with `exposure: "codemode"` (or a `toolExposure` entry of
  `codemode`) ⇒ activate `codemode`, unless `autoEnableCodemode` is false;
- any enabled server with `exposure: "deferred"` (or a `toolExposure` entry of
  `deferred`) ⇒ activate `tool_search`;
- if neither ends up active, MCP warns once that the tools "cannot be called".

Both checks require an active tool of that name with a `reachesTools` function
(`index.js:403-408`); another extension may replace `codemode` or `tool_search`, and the
replacement must declare `reachesTools` to be used. `getAllTools()` exposes
`reachesTools`, so a catalog can apply the same test.

There is no guarantee that both are active. A `deferred`-configured server normally has
`tool_search` but **not** `codemode`; `autoEnableCodemode: false` can leave `codemode`
off even for a `codemode`-configured server. That is the hole in the prior design.

### 2.2 Corrected routing table

`declared` means the model sees the tool in this request; `callable` means callable from
a codemode script via `ctx.executeTool()`.

| exposure | active | declared | callable | in catalog | route |
| --- | --- | --- | --- | --- | --- |
| `direct` | yes | yes | yes | yes | direct |
| `direct` | no | no | no | no | — |
| `model-only` | yes | yes | no | yes | direct |
| `model-only` | no | no | no | no | — |
| `codemode` | yes | yes | yes | yes | direct |
| `codemode` | no | no | yes | only if a reacher is active | `codemode` or `tool_search` |
| `deferred` | yes | yes | yes | yes | direct |
| `deferred` | no | no | yes | only if a reacher is active | `codemode` or `tool_search` |
| `hidden` | any | no | no | no | — |

"Reacher" is an active tool named `codemode` or `tool_search` with `reachesTools`. If
`codemode` is active, prefer it: it needs no activation. If only `tool_search` is active,
the route is a search step, which activates the target for the next call.

A tool in the configured exclusion list is out whatever the table says. A tool absent
from `getAllTools()` (for example filtered by `--exclude-tools`) is out too.

### 2.3 Catalog rule

In order:

1. `hidden` ⇒ out.
2. Active ⇒ in, reach `direct`. (This covers active `codemode`/`deferred` loaded by
   `tool_search` or explicitly activated; they are declared.)
3. Inactive `direct` or `model-only` ⇒ out.
4. Inactive `codemode` or `deferred`:
   - if `codemode` is active and has `reachesTools` ⇒ `codemode`;
   - else if `tool_search` is active and has `reachesTools` ⇒ `tool_search`;
   - else ⇒ out.
5. Exclusion list removes anything at any point.

This is what the code sketch in [§6](#6-code-sketch) implements.

### 2.4 Block wording

- `direct`: "call it directly". The registered name is what the model calls.
- `codemode`: "not declared to you. Reach it inside a codemode script:
  `await tools.<identifier>(...)`." The identifier is `toCodemodeIdentifier(name)`, not
  necessarily the registered name (see [§3.4](#34-labels-and-the-chain-grammar)).
- `tool_search`: "not declared to you. Call `tool_search({ query: "<name>" })`, then call
  it on the next call." This is the only route when only `tool_search` is active, but it
  makes the model activate the tool. If the "a mention never activates" rule is
  absolute, omit these tools from the catalog instead; a mention then stays literal even
  though the tool is nominally reachable by search.

Never say "not declared" for an active tool. That was the prior table's error for
`codemode`/`deferred` with `active = either`.

### 2.5 What the prior table got right

- `direct` + active in, `direct` + inactive out.
- `hidden` out.
- `codemode` and `deferred` are the only indirect exposures, and MCP's configured
  `codemode` becomes `deferred` in the metadata ([§3.1](#31-the-mcp-name-algorithm)).
- Membership is decided per tool, not per server.

## 3. Registered names, namespaces, labels

### 3.1 The MCP name algorithm

`MCP dist/naming.js:15-28` is the whole algorithm:

```ts
const MAX_TOOL_NAME_LENGTH = 64;

export function createMcpToolName(server, tool, isTaken = () => false) {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
  if (name.length <= MAX_TOOL_NAME_LENGTH && !isTaken(name))
    return name;
  const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

export function mcpNamespace(server) {
  return `mcp__${server.replace(/-/g, "_")}`;
}
```

Exact consequences:

- The prefix is `mcp__`, the separator is `__`, and the whole string is sanitized:
  every character outside `[A-Za-z0-9_]` becomes `_`. This includes the server and the
  tool, so `dev-radius/search-code` becomes `mcp__dev_radius__search_code`.
- The 64-character limit is checked **after** sanitization.
- If the name is too long, or `isTaken(name)` is true, the result is
  `sanitized.slice(0, 55) + "_" + first8(sha256(`${server}\0${tool}`))`. The hash's
  input is the raw (pre-sanitization) server and tool, NUL-separated; the suffix is
  eight lowercase hex characters. A name longer than 55 is cut to 55 before the hash, so
  the result is at most 64 characters. A name that merely collides and is at most 55
  characters keeps its whole sanitized form plus `_` and the hash, so it can be shorter
  than 64.
- Collision detection in `PI dist/extensions/mcp/index.js:295-310`:
  `plain` is every tool's sanitized name for the server's current list. A candidate is
  taken if a different owner already has it, if it is already in this server's `current`
  set, or if the same sanitized name occurs more than once in `plain`. The duplicate
  check means **both** colliding tools get the hash, so which one keeps the plain name
  does not depend on list order.
- Withdrawn tools are not unregistered (tools cannot be unregistered); they are
  re-registered with `exposure: "hidden"` (`index.js:340-346`). Their names remain
  reserved in `toolOwners`.

Examples from the probe:

| server | tool | namespace | registered name |
| --- | --- | --- | --- |
| `kagi` | `kagi_search_fetch` | `mcp__kagi` | `mcp__kagi__kagi_search_fetch` |
| `dev-radius` | `search-code` | `mcp__dev_radius` | `mcp__dev_radius__search_code` |
| `kagi` | 80 × `x` | `mcp__kagi` | `mcp__kagi__xxxx…xxxx_d7c05098` (64 chars) |
| `kagi` | `a-b` and `a_b` (collision) | `mcp__kagi` | `mcp__kagi__a_b_222e3813`, `mcp__kagi__a_b_18b30a9c` |

The catalog must **use `ToolInfo.name`**. Recomputing the name is only for fixtures and
tests; it couples the package to `pi-mcp`'s naming and the 64-character cap.

### 3.2 Namespace and alias fields

MCP builds one namespace per server (`index.js:288-294`):

```ts
const namespace = {
  name: mcpNamespace(server),        // mcp__<server with - → _>
  aliases: [server],                 // the configured server name, raw
  ...(description ? { description } : {}),
  ...(connection.instructions ? { instructions } : {}),
};
```

So for server `kagi`, `namespace.name` is `mcp__kagi` and `namespace.aliases[0]` is
`kagi`. For `dev-radius`, `namespace.name` is `mcp__dev_radius` and
`namespace.aliases[0]` is `dev-radius`.

MCP server names are validated to `[A-Za-z0-9_-]+`
(`MCP dist/config.js:18-27`; extension registrations call the same validator,
`PI dist/core/extensions/loader.js:385-400`). For MCP, the namespace suffix is therefore
exactly the sanitized server: the only replacement is `-` → `_`. That makes
`namespace.name + "__"` a safe prefix for splitting a *registered MCP name* **when
the hashed branch's 55-character truncation did not cut the server segment**. The branch
keeps only the first 55 characters, so a long server name (or a collision on a server
name longer than about 48 characters) can lose part of its own prefix; in that case fall
back to the whole registered name. This is not a general rule for non-MCP namespaces,
whose names/aliases are arbitrary; use the alias (or the name without an actual `mcp__`
prefix) there and match defensively.

Non-MCP tools may have a namespace too; it is arbitrary. MCP resource tools
(`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) have **no**
namespace (`PI dist/extensions/mcp/resources.js:193-231`) because they reach every
server. A `%` label for them has no server segment.

`namespace.aliases[0]` is always present for built-in MCP tools, but not guaranteed for
other extensions. If absent, strip an `mcp__` prefix from `namespace.name` only if it is
actually there; do not assume it.

### 3.3 The raw tool name is not exposed

`createMcpToolDefinition` sets `label: "<server>/<tool>"` with the raw tool name
(`mcp/tools.js:191-194`), but `ToolInfo` does not include `label`. It also does not
include the raw name anywhere else. The only tool string an extension sees is the
sanitized, possibly truncated and hashed registered name.

So `%kagi:kagi_search_fetch` can be built by stripping `mcp__kagi__` from the registered
name, but:

- `search-code` becomes `search_code`, not `search-code`;
- `read file` becomes `read_file`;
- a long name becomes a 55-character prefix plus `_d7c05098`; a short colliding name
  keeps its whole short form plus the hash (neither is the raw name).
- if the 55-character truncation in the hashed branch cut the server segment,
  `namespace.name` is no longer a prefix; use the whole registered name as the label.

This is a real drift from the prior spec, which says the registered name "is never
parsed" while also promising `%server:tool` labels with the raw tool label. There is no
public way to have both. Pick one:

- derive the local label by stripping `mcp__${sanitize(server)}__` and accept the
  sanitized/truncated leaf (recommended; it is what the picker and the model's call name
  already show);
- use the full registered name as the leaf (`%kagi:mcp__kagi__kagi_search_fetch`), which
  is unambiguous but long; or
- do not use a server segment for tools whose local label does not survive cleanly.

### 3.4 Labels and the chain grammar

Registered names and catalog labels are different strings:

- The registered name is what the inline replacement and the block use; the model calls
  it, and codemode scripts use `tools.<toCodemodeIdentifier(name)>` or
  `tools["<name>"]`.
- The label is what autocomplete inserts and what the picker shows. For MCP it is
  `serverAlias:localLabel`; for unnamespaced tools it is the registered name.
- `toCodemodeIdentifier` (`CM dist/identifier.js:5-12`) differs from the MCP sanitizer:
  it allows `$` and treats the first character specially (`[A-Za-z_$]`, then
  `[A-Za-z0-9_$]`), and an empty name becomes `_`. MCP names are already
  `[A-Za-z0-9_]`, so the identifier equals the registered name; a non-MCP `my-tool`
  becomes `my_tool` in scripts.

MCP server names are restricted to `[A-Za-z0-9_-]+`, so an MCP alias cannot contain `:`,
whitespace, or other punctuation. Non-MCP namespace aliases are arbitrary strings and
can; if the chain grammar uses `:` as a separator, those need an escape or a label
scheme that avoids raw aliases. This is a picker/label concern, not a reason to parse
registered names.

## 4. Signature rendering

### 4.1 Package, version, import

- Package: `@earendil-works/pi-codemode@1.5.2`.
- pi depends on it exactly: `PI package.json` has
  `"@earendil-works/pi-codemode": "1.5.2"`. Pin the same exact version.
- Import path: `@earendil-works/pi-codemode/declarations`. The package's export map
  exposes `./declarations` with `types: ./dist/declarations.d.ts` and
  `import: ./dist/declarations.js` (`CM package.json`).
- Do not import the package root for this. The root re-exports the runtime/sandbox
  modules and `loadQuickJSWasm` (`CM dist/index.js:1-16`); the subpath is the pure
  string code.

The subpath's module graph is exactly:

```
dist/declarations.js  →  dist/identifier.js
```

`declarations.js` has no other runtime import; `types.js` is type-only. A loader probe
that imported `renderToolSignature` resolved only those two files and zero `.wasm` or
`quickjs-wasi` modules. `quickjs-wasi@3.6.2` is installed as `pi-codemode`'s only
dependency, but it is not reached by this subpath. Use the subpath and no WebAssembly
loads.

### 4.2 The renderer API

`CM dist/declarations.d.ts`:

```ts
export function renderToolSignature(
  tool: Pick<CodemodeTool, "name" | "inputSchema" | "outputSchema">,
  options?: { inputMaxChars?: number },
): string;
```

`CodemodeTool.inputSchema` and `outputSchema` are `CodemodeJsonSchema`:

```ts
export type CodemodeJsonSchema = { [key: string]: unknown } | boolean;
```

`ToolInfo.parameters` is `TSchema`, which in `typebox@1.3.27` is an empty interface, and
it is **not** assignable to `CodemodeJsonSchema`. This fails:

```ts
renderToolSignature({ name: tool.name, inputSchema: tool.parameters });
// error TS2322: Type 'TSchema' is not assignable to type 'CodemodeJsonSchema | undefined'.
```

Cast it:

```ts
renderToolSignature({
  name: tool.name,
  inputSchema: tool.parameters as Record<string, unknown>,
});
```

The `Record<string, unknown>` cast is enough; a `CodemodeJsonSchema` cast also works.
Do not use `as any`.

### 4.3 What the renderer emits

`CM dist/declarations.js:64-69`:

```ts
const input = tool.inputSchema === undefined
  ? "unknown"
  : schemaToType(tool.inputSchema, {
      maxChars: options.inputMaxChars ?? DEFAULT_INPUT_SCHEMA_MAX_CHARS,
    });
return `${toCodemodeIdentifier(tool.name)}(args: ${input}): Promise<${renderToolOutputType(tool.outputSchema)}>;`;
```

- The name is the codemode identifier, not necessarily the registered name.
- `inputSchema` missing ⇒ `args: unknown`.
- An object schema with no properties and no `additionalProperties` ⇒
  `{ [key: string]: unknown; }`; with `additionalProperties: false` ⇒ `{}`.
- Object properties are sorted alphabetically (`declarations.js:296`), required
  properties have no `?`, optional ones do.
- A property with a description or constraint tags makes the object multi-line, with
  `//` comments and `@integer @minimum … @default …` tags (`declarations.js:311-330`).
  Otherwise the object is one line.
- Missing `outputSchema` ⇒ `Promise<unknown>`; `{ type: "string" }` ⇒
  `Promise<string>`; object output is sorted like input.

Probe output:

```text
mcp__kagi__kagi_search_fetch(args: { limit?: number; query: string; }): Promise<unknown>;
bash(args: {
  // Shell command
  command: string;
  timeout?: number;
}): Promise<{ exit_code: number; output: string; }>;
noargs(args: { [key: string]: unknown; }): Promise<unknown>;
empty(args: unknown): Promise<unknown>;
tiny(args: unknown): Promise<string>;   // probe supplied outputSchema: { type: "string" }
```

The multi-line `bash` case had an output schema only because the probe supplied one.
`ToolInfo` cannot.

`renderToolSample` (`declarations.d.ts`) prepends the description and wraps the
declaration in `declare const tools: { … };`. The mention block does not need it.

### 4.4 Truncation and post-processing

`inputMaxChars` bounds the **input type** only, not the whole signature:

- Default 16000 (`CM declarations.js:6`).
- `schemaToType` first renders with constraint tags; if too long, it renders again
  without tags; if still too long, it returns `unknown`
  (`declarations.js:116-123`).
- The output type is rendered with `schemaToType`'s default 16000 and is not affected by
  `inputMaxChars`.

The prior spec's plan to pass `inputMaxChars: 240`, join lines, drop `//` comment lines,
collapse whitespace, and cap at 280 is package-side post-processing. It is implementable,
but note:

- Dropping every `//` line also drops the constraint tags the renderer deliberately adds
  (`@integer`, `@minimum`, `@default`) and all property descriptions. The 240-character
  tag pass is then largely wasted. If constraints matter, keep the multi-line form or
  convert tags to an inline form the block can carry.
- A hard character cap can cut in the middle of braces or a type. It is prompt text, so
  this is cosmetic, but do not present it as a valid declaration.
- `renderToolSignature` has no whole-string cap; the 280 cap is yours.

### 4.5 The output half is not available

pi's own codemode declaration uses the full `ToolDefinition`, including `outputSchema`,
and falls back to `{ type: "string" }` (`TEXT_OUTPUT_SCHEMA`) for tools without one
(`PI dist/extensions/codemode/tool.js:73-80, 35`). That is why a pi codemode declaration
for `bash` can say `Promise<string>` or a structured object.

`ToolInfo` has no `outputSchema`. An extension using `getAllTools()` can therefore only
render `Promise<unknown>`. The mention dialect is the same syntax and input rendering,
but not the same output type as the declaration the model sees inside codemode. Do not
promise parity, and do not copy the prior spec's `bash(...): Promise<{ output; exit_code }>`
example: it cannot be produced from public metadata.

If output types are required, the only public route is a tool that orchestrates others
and receives `ToolLoadout.registered` (`AgentTool[]`) in `prepareLoadout`
(`types.d.ts:448-455`), which a plain mention extension is not. Do not reach into
`AgentSession.getToolDefinition` or private internals.

## 5. Mid-session server connections

### 5.1 Lifecycle

1. On `session_start`, MCP reads config and `registeredServers()`, then calls
   `ensureDiscoveryActive(ctx)` **before** connecting (`mcp/index.js:972-990`). This
   activates `codemode` and/or `tool_search` from the configured exposures, so the first
   prompt does not need to wait for non-direct tools.
2. It starts every enabled server in the background (`index.js:999-1010`). A connection's
   `onTools` callback calls `registerTools(connection)` when the server's tool list is
   available (`index.js:463-472`).
3. `registerTools` builds the namespace, assigns names, and calls
   `pi.registerTool(definition)` for each tool (`index.js:286-338`).
   `registerTool` calls `runtime.refreshTools()` (`PI dist/core/extensions/loader.js:237-247`),
   which synchronously rebuilds `_toolDefinitions`, `_toolRegistry`, and the active set
   (`agent-session.js:2966-3048`).
4. New `direct` and `model-only` tools are activated on registration unless
   `defaultActive: false`; new `deferred` tools are not (`agent-session.js:3039-3044`,
   `3050-3057`). MCP's configured `codemode` becomes `deferred` at definition time
   (`mcp/tools.js:20-26`, `199`), so MCP tools never register as `codemode`.
5. The first prompt waits up to 10 seconds only for servers that have `direct` tools
   (`mcp/index.js:40`, `1012-1033`; `docs/mcp.md:100`). Other servers are waited for
   when a codemode script names them, when `tool_search` runs, or when a resource tool
   runs (`mcp/index.js:1045-1050`).

### 5.2 What a catalog sees

- `getAllTools()` sees a server's tools as soon as `registerTools` runs, because
  `_toolDefinitions` is replaced synchronously. No `/reload` is needed
  (`docs/extensions.md:1586`).
- `getActiveTools()` gains the server's `direct`/`model-only` tools at the same moment;
  its `deferred` tools stay inactive.
- A tool that existed before but is no longer offered is re-registered `hidden`
  (`index.js:340-346`), so it leaves the catalog immediately. If the server offers it
  again, it is registered with its configured exposure again.
- Disabling a server re-registers all its tools `hidden` (`index.js:349-357`). Changing
  exposure re-registers the tools and removes tools that are no longer `direct` from the
  active set (`index.js:650-666`).
- A failed or `needs-auth` connection registers no tools; nothing to mention until it
  connects.
- An extension that calls `pi.registerMcpServer()` mid-session triggers
  `mcp_servers_change`, which re-reads registered servers, connects them, and re-runs
  `ensureDiscoveryActive` (`index.js:1079-1095`). The same rules apply: new tools appear
  in `getAllTools()` once registered, and a reaching tool may be activated then.

### 5.3 Timing consequences for `%`

- A mention in the **first** prompt can stay literal if it targets a non-`direct` server
  that has not connected yet. `codemode`/`tool_search` are already active, but the tools
  are not registered, so `getAllTools()` does not contain them.
- On the next `context` event after the server registers its tools, the same mention
  resolves. No restart is needed, but "immediately" means "as soon as the server
  connects", not "before it connects".
- There is no public API to wait for pending MCP connections from an extension. Do not
  block the `context` handler. If a first-message mention must work, the best available
  signal is the `mcp_servers` system-prompt section or a retry on the next request; the
  mention design should accept first-message literals.
- Read `getAllTools()` and `getActiveTools()` in the same synchronous turn. The context
  handler is async; an `await` between the two calls could let a server register tools
  and invalidate the snapshot.

## 6. Code sketch

The sketch compiles against `PI` 1.5.2 and `CM` 1.5.2 with `strict: true` (no errors;
the `tsc` probe is in [§9](#9-probes)). It implements the table in [§2.2](#22-corrected-routing-table).

```ts
import type { ToolInfo, ToolNamespace } from "@earendil-works/pi-coding-agent";
import { renderToolSignature, toCodemodeIdentifier } from "@earendil-works/pi-codemode/declarations";

export type Reach =
  | { kind: "direct" }
  | { kind: "codemode" }
  | { kind: "tool_search" };

export interface Target {
  name: string;          // registered name: what the model calls
  label: string;         // what autocomplete inserts / the picker shows
  server?: string;       // namespace alias, for display
  description: string;
  signature: string;     // input only; Promise<unknown>
  reach: Reach;
  exposure: ToolInfo["exposure"];
  active: boolean;
}

const SANITIZE = /[^A-Za-z0-9_]/g;

function serverLabel(ns: ToolNamespace | undefined): string | undefined {
  if (!ns) return undefined;
  return ns.aliases?.[0] ?? (ns.name.startsWith("mcp__") ? ns.name.slice(5) : ns.name);
}

function localLabel(tool: ToolInfo, server: string | undefined): string {
  if (!server) return tool.name;
  const prefix = `mcp__${server.replace(SANITIZE, "_")}__`;
  return tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name;
}

function activeReacher(tools: readonly ToolInfo[], active: Set<string>, name: string): boolean {
  return tools.some(
    (tool) => tool.name === name && active.has(name) && typeof tool.reachesTools === "function",
  );
}

function signatureOf(tool: ToolInfo): string {
  const rendered = renderToolSignature(
    {
      name: tool.name,
      // ToolInfo.parameters is typebox's empty TSchema, not CodemodeJsonSchema.
      inputSchema: tool.parameters as Record<string, unknown>,
    },
    { inputMaxChars: 240 },
  );
  const flat = rendered
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= 280 ? flat : `${flat.slice(0, 279)}…`;
}

export function buildCatalog(
  tools: readonly ToolInfo[],
  activeNames: readonly string[],
  excluded: readonly string[] = [],
): Target[] {
  const active = new Set(activeNames);
  const skip = new Set(excluded);
  const codemode = activeReacher(tools, active, "codemode");
  const toolSearch = activeReacher(tools, active, "tool_search");
  const targets: Target[] = [];

  for (const tool of tools) {
    if (skip.has(tool.name) || tool.exposure === "hidden") continue;

    let reach: Reach | undefined;
    if (active.has(tool.name)) {
      reach = { kind: "direct" };
    } else if (tool.exposure === "direct" || tool.exposure === "model-only") {
      continue;
    } else if (codemode) {
      reach = { kind: "codemode" };
    } else if (toolSearch) {
      reach = { kind: "tool_search" };
    } else {
      continue; // registered, but no active route in this session
    }

    const server = serverLabel(tool.namespace);
    targets.push({
      name: tool.name,
      label: server ? `${server}:${localLabel(tool, server)}` : tool.name,
      ...(server ? { server } : {}),
      description: tool.description,
      signature: signatureOf(tool),
      reach,
      exposure: tool.exposure,
      active: active.has(tool.name),
    });
  }
  return targets;
}

export function blockLine(target: Target): string {
  const call = `tools.${toCodemodeIdentifier(target.name)}`;
  const instruction =
    target.reach.kind === "direct"
      ? "call it directly"
      : target.reach.kind === "codemode"
        ? `not declared to you. Reach it inside a codemode script: \`await ${call}(...)\``
        : `not declared to you. Load it with \`tool_search({ query: ${JSON.stringify(target.name)} })\` and call it on the next call`;
  return `- \`${target.name}\`${target.server ? ` (${target.server})` : ""} — ${instruction}. Signature: ${target.signature}`;
}
```

The `tool_search` branch is the design choice from [§2.4](#24-block-wording). If the
package refuses it, delete that branch and drop those tools from the catalog instead.

## 7. Drift from the prior spec

`SPEC` is the prior `pi-mention-tool` spec. "Prior" is its claim; "verified" is what
1.5.2 does.

### 7.1 Changes that affect the design

| # | Prior claim | Verified at 1.5.2 | Consequence |
| --- | --- | --- | --- |
| D1 | `model-only` and `hidden` are both out. | `hidden` is out. An **active** `model-only` tool is declared and directly callable by the model; only tool-to-tool calls are forbidden. `codemode` and `tool_search` are `model-only`. | Keep active `model-only` in the catalog with direct reach; otherwise `%codemode`/`%tool_search` and interactive tools stay literal. |
| D2 | Reach is a function of exposure alone. | Reach depends on activeness and on which reaching tool is active. | `Target` needs a route union (`direct`/`codemode`/`tool_search`), not `direct` / `indirect`. |
| D3 | `deferred`/`codemode` "either active" → indirect; block says "reach it inside a codemode script". | Active `deferred`/`codemode` tools are declared and directly callable; inactive ones need an active reacher. | Say "call it directly" when active; choose the route when inactive. |
| D4 | Every `deferred`/`codemode` tool is in the catalog. | If no `codemode`/`tool_search` tool is active (or the only one lacks `reachesTools`), indirect tools cannot be called at all. | Those tools must be out; a mention would be a lie. MCP warns in this state. |
| D5 | The block never suggests `tool_search`, and never requires a search step. | A `deferred`-configured server normally activates `tool_search` and leaves `codemode` off (it is off by default). | For that common configuration, "not declared; use codemode" is impossible. Either omit those tools or accept a `tool_search` step that activates them. |
| D6 | The signature carries the target's arguments and a resolved output type; the example is `bash(...): Promise<{ output; exit_code }>`. | `getAllTools()` exposes `parameters` but not `outputSchema`; the renderer can only produce `Promise<unknown>`. | Drop output types from the dialect, or accept a private/non-public source. |
| D7 | The renderer takes tool metadata directly. | `ToolInfo.parameters: TSchema` is not assignable to `CodemodeJsonSchema`; `tsc` gives TS2322. | Cast `parameters` to `Record<string, unknown>` at the seam. |
| D8 | `%kagi:kagi_search_fetch` has a server label and a tool label, and the registered name is "never parsed". | The raw MCP tool name is not exposed; only the sanitized (possibly truncated+hashed) registered name. The two claims are incompatible. | Derive a lossy local label by stripping the sanitized server prefix, or use the registered name as the leaf. |
| D9 | The registered name (`mcp__<server>__<tool>`) proves a tool is namespaced. | MCP resource tools (`list_mcp_resources`, etc.) have no namespace and no `mcp__` name. Non-MCP tools can have a namespace without one. | Use `ToolInfo.namespace`, not the name prefix, to detect grouping. |
| D10 | `deferred` includes every tool of a `codemode` server. | MCP maps configured `codemode` to `deferred` per tool, but `toolExposure` can make individual tools `direct` or `hidden`. | Exposure is per tool; do not assume a server-wide exposure. |

### 7.2 Changes to details and wording

| # | Prior claim | Verified at 1.5.2 |
| --- | --- | --- |
| D11 | `namespace.name` fallback is "`mcp__` prefix removed". | For MCP, server names are `[A-Za-z0-9_-]+`, so `mcpNamespace`'s only change is `-` → `_` and `namespace.name + "__"` is a safe prefix for the registered name **unless the 55-character truncation in the hashed branch cut the server segment**. Use `aliases[0]` (raw server name) for display; fall back to the whole registered name on a truncation. For non-MCP namespaces, use the alias or strip `mcp__` only if present; do not assume the prefix. |
| D12 | A name over 64 characters or colliding gets a `sha256(server\0tool)` suffix. | True, but the suffix is the first **8 hex** characters, the base is truncated to **55** and joined with `_`, and the 64 limit is checked after sanitization. Collisions are detected over sanitized names; both colliding tools get the hash. |
| D13 | `direct` + inactive is out. | True: not declared and not callable through `executeTool`. |
| D14 | `hidden` is out. | True; a withdrawn tool is re-registered hidden, and a disabled server hides all its tools. |
| D15 | `codemode` and `deferred` are indistinguishable for MCP. | True at `ToolInfo` level: MCP's `codemode` becomes `deferred` (`toToolExposure`). The configured exposure is not exposed. |
| D16 | Non-MCP `codemode` is the same as `deferred`. | Same reach, different listing: a non-MCP `codemode` tool is listed in the codemode description; `deferred` is not (`types.d.ts:407-409`). The mention does not use the listing, but the rationale is not exact. |
| D17 | The signature dialect is `name(args: { … }): Promise<…>;` with object properties sorted and multi-line output. | True syntax and sorting. Multi-line only when a property has a description or constraint tags; otherwise one line. `args: unknown` when the input schema is missing; `{ [key: string]: unknown; }` for an empty object schema. |
| D18 | The renderer is passed `inputMaxChars: 240`, so its two-pass truncation applies. | True for the input type: tags dropped, then `unknown`. `inputMaxChars` does not bound the output type or the whole signature; output uses the default 16000. |
| D19 | The package then joins lines, drops `//` lines, collapses whitespace, caps at 280. | Not renderer behavior; package-side. Dropping `//` lines also drops `@integer`/`@minimum`/`@default` tags and property descriptions, making the 240-character tag pass moot. |
| D20 | The renderer is the package pi uses, so the mention and declaration are the same dialect. | True for import and input syntax; pi's own declaration also uses `outputSchema` and `TEXT_OUTPUT_SCHEMA` (`Promise<string>` fallback), which the mention cannot access. Same syntax, not identical result type. |
| D21 | The package is pinned to pi's exact `pi-codemode` version. | True: `PI package.json` depends on `@earendil-works/pi-codemode: "1.5.2"` exactly. |
| D22 | No WebAssembly is loaded; `./declarations` imports only `./identifier`. | True; the loader probe resolved only `declarations.js` and `identifier.js`, no `quickjs-wasi` or `.wasm`. `quickjs-wasi@3.6.2` remains an install dependency, not a runtime load. |
| D23 | `namespace.name` is `mcp__kagi`, not `kagi`. | True. The alias is `kagi`. |
| D24 | The server label comes from `aliases[0]` when present. | True for built-in MCP, which always sets `aliases: [server]`. Not guaranteed for other extensions; fall back to `namespace.name` without assuming `mcp__`. |
| D25 | Characters invalid in a JavaScript identifier become `_` in the sandbox's `tools` key. | True for `toCodemodeIdentifier`, with two details: `$` is allowed, and the first character must be `[A-Za-z_$]`; an empty name becomes `_`. MCP names are already valid, so their identifier equals the registered name. |
| D26 | The mention block's call name is the registered name, and the example calls it "directly". | For a non-MCP `my-tool`, the codemode call key is `my_tool`, not `my-tool`. Use `toCodemodeIdentifier(name)` in the incantation; the block's backticked name can stay the registered name. |
| D27 | A tool that is out stays literal. | True; exclusion and unresolved names produce no target. |
| D28 | A server that connects mid-session becomes mentionable without a restart. | True after it registers its tools. A mention in the first prompt can be literal if a non-`direct` server has not connected; the first prompt waits only for `direct` servers, up to 10 s. |
| D29 | The catalog is resolved on every request. | True: `context` fires before each LLM call (`docs/extensions.md:815-827`). Re-read both APIs in the same synchronous turn. |
| D30 | `tool_search` loads by `setActiveTools`, changing the next call's declarations. | True (`tool-search/tool.js:225-232`); loaded tools stay declared on the branch. This is why it is not a free route, and why D5 matters. |
| D31 | A mention adds no declaration and cannot force a provider checkpoint. | True for the mention itself. A server connecting with `direct` tools, or the model calling `tool_search`, can still change declarations independently. |
| D32 | `getActiveTools()` is the set declared to the model. | Mostly; a tool can be active while another tool's `prepareLoadout` hides its declaration (`types.d.ts:464-468`, `docs/extensions.md:2770`). No API exposes that state. Treat as a caveat. |
| D33 | The catalog sees the model-facing description. | `getAllTools()` returns the original `definition.description`, not a `prepareLoadout` override. For a picker this is usually what you want; do not claim it is what the model sees. |

### 7.3 Not verified here

The prior spec's mention-engine claims (provider returns a navigable server node and a
selectable tool leaf; registration order; trigger uniqueness) are outside this ticket.
This note covers only the tool metadata and signature surface.

## 8. Open decisions

1. **`model-only`.** Recommended: include active `model-only` tools, because the model
   can call them and because `codemode`/`tool_search` are `model-only`. If the product
   wants to hide orchestration tools, make it an explicit exclusion (by name or by
   `sourceInfo`/`promptSnippet`), not a claim that they are unreachable.
2. **`tool_search`-only sessions.** Choose one:
   - omit inactive indirect tools when only `tool_search` is active; a mention stays
     literal, and the "no activation" promise holds;
   - include them with a two-step `tool_search` instruction; the model activates them,
     which changes the next declaration but is otherwise correct;
   - never activate `codemode` yourself (that would violate the mention's own rule).
3. **Labels.** Choose between a lossy `%server:sanitized-local` label and a full
   registered name. The raw MCP tool name is not available; do not design around it.
4. **Output types.** Accept `Promise<unknown>`, or add a separate producer using
   `prepareLoadout`/`ToolLoadout.registered` if output types are essential. Do not reach
   into `AgentSession`.
5. **Signature post-processing.** Decide whether to keep the renderer's `//` comments and
   `@` tags. Dropping them makes a cheap one-liner but loses the constraints the renderer
   exists to show.
6. **Hidden declarations.** A `prepareLoadout` can hide the declaration of an active
   tool. No public API reports it; accept the caveat or avoid claiming precise
   declaration state in the block.

## 9. Probes

All probes ran against the installed 1.5.2 tree.

### 9.1 Renderer signature, sorting, multi-line, truncation

```sh
cd <PI>
node --input-type=module -e '
import { renderToolSignature } from "@earendil-works/pi-codemode/declarations";
console.log(renderToolSignature({ name: "mcp__kagi__kagi_search_fetch",
  inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } }));
console.log(renderToolSignature({ name: "bash",
  inputSchema: { type: "object", properties: { command: { type: "string", description: "Shell command" }, timeout: { type: "number" } }, required: ["command"] },
  outputSchema: { type: "object", properties: { output: { type: "string" }, exit_code: { type: "number" } }, required: ["output", "exit_code"] } }));
console.log(renderToolSignature({ name: "noargs", inputSchema: { type: "object", properties: {}, required: [] } }));
console.log(renderToolSignature({ name: "empty" }));
console.log(renderToolSignature({ name: "tiny", inputSchema: { type: "object", properties: { a: { type: "string", description: "x".repeat(300) } } }, outputSchema: { type: "string" } }, { inputMaxChars: 10 }));
'
```

Output is quoted in [§4.3](#43-what-the-renderer-emits); the last line is
`tiny(args: unknown): Promise<string>;`.

### 9.2 No WebAssembly on the `./declarations` import

A Node loader logged every resolved non-`node:` module. Importing
`renderToolSignature` resolved only:

```
@earendil-works/pi-codemode/dist/declarations.js
@earendil-works/pi-codemode/dist/identifier.js
```

Zero `quickjs-wasi` or `.wasm` resolutions. The loader log is the evidence; the static
import graph agrees.

### 9.3 TypeScript assignability

A `strict` project importing `ToolInfo` and `renderToolSignature` failed only on the
uncast form:

```
error TS2322: Type 'TSchema' is not assignable to type 'CodemodeJsonSchema | undefined'.
```

`inputSchema: tool.parameters as Record<string, unknown>` compiled. The full sketch in
[§6](#6-code-sketch) compiled with `strict: true`.

### 9.4 `createMcpToolName` examples

```sh
cd <PI>
node --input-type=module -e '
import { createMcpToolName, mcpNamespace } from "@earendil-works/pi-mcp";
for (const [s, t] of [["kagi", "kagi_search_fetch"], ["dev-radius", "search-code"],
  ["kagi", "x".repeat(80)], ["kagi", "a-b"], ["kagi", "a_b"]])
  console.log(JSON.stringify({ s, t, ns: mcpNamespace(s), name: createMcpToolName(s, t), len: createMcpToolName(s, t).length }));
'
```

The table in [§3.1](#31-the-mcp-name-algorithm) is that output. The `a-b`/`a_b` collision
was also probed with `isTaken: () => true` to show both get hashes.

## 10. Source index

| Topic | Location |
| --- | --- |
| `ToolExposure`, `ToolNamespace`, `ToolInfo`, `ToolDefinition` | `PI dist/core/extensions/types.d.ts:400-415`, `430-446`, `473-518`, `1621-1627` |
| Extension API (`getActiveTools`, `getAllTools`, `setActiveTools`) | `PI dist/core/extensions/types.d.ts:1326-1336` |
| `getActiveTools`, `getAllTools` implementation | `PI dist/core/agent-session.js:1146-1168` |
| Declared/callable loadout, exposure, hidden declarations | `PI dist/core/agent-session.js:1215-1285`, `3050-3057` |
| Tool registry refresh | `PI dist/core/agent-session.js:2966-3048`; `PI dist/core/extensions/loader.js:237-247` |
| Context event fires before each LLM call | `PI docs/extensions.md:815-827` |
| Exposure docs | `PI docs/extensions.md:2760-2778` |
| MCP tool registration, names, namespace, withdraw | `PI dist/extensions/mcp/index.js:286-357`, `390-429`, `972-1011` |
| MCP name/namespace algorithm | `MCP dist/naming.js:15-28` |
| `codemode`→`deferred` mapping, MCP definition | `PI dist/extensions/mcp/tools.js:20-26`, `187-217` |
| MCP resource tools (no namespace) | `PI dist/extensions/mcp/resources.js:193-231` |
| MCP startup wait (10 s) | `PI dist/extensions/mcp/index.js:40`, `1012-1033` |
| MCP docs (exposure, background connect, tool changes) | `PI docs/mcp.md:100`, `191-228` |
| `tool_search` search/load | `PI dist/extensions/tool-search/tool.js:215-267` |
| `codemode` callable set / loadout | `PI dist/extensions/codemode/tool.js:73-85`, `258-290`, `311` |
| Renderer and schema conversion | `CM dist/declarations.js:64-69`, `116-123`, `293-331`; `CM dist/declarations.d.ts` |
| Codemode identifier | `CM dist/identifier.js:5-12` |
| Codemode package exports / version | `CM package.json` |
| TypeBox `TSchema` | `TB build/type/types/schema.d.mts:1` |
| `SourceInfo` | `PI dist/core/source-info.d.ts:4-11` |
| Changelog: codemode description no longer lists MCP tools | `PI CHANGELOG.md:622`, `637` |
