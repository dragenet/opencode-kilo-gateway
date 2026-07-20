# opencode-kilo-gateway — Design

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-20
**Type:** opencode auth + provider plugin (standalone, npm-publishable git repo)

---

## 1. Purpose

A standalone opencode plugin that replaces the current static `kilo` provider setup with a
first-class integration that mimics the Kilo CLI:

1. **Device-authorization OAuth login** to the Kilo gateway (no static API key).
2. **Cross-surface organization selection** that works identically in the CLI
   (`opencode auth login`) and the TUI (`/connect`).
3. **Dynamic model listing** fetched from the Kilo gateway API (org-scoped), replacing
   opencode's built-in static model list for `kilo`.

The plugin owns the existing provider id **`kilo`**, so all current agent/model references
(`kilo/z-ai/glm-5.1`, `kilo/deepseek/deepseek-v4-pro`, `kilo/minimax/minimax-m3`, …) keep
working unchanged.

**Reference implementations** (studied, not depended on): the `@kilocode/kilo-gateway`
package inside the Kilo CLI opencode fork, and the published `opencode-kilo-auth` plugin.
We build our own code, staying behavior-compatible with Kilo's real endpoints.

---

## 2. Goals / Non-goals

### Goals
- Reproduce Kilo's device-auth login flow inside opencode's `auth` plugin API.
- Auto-select the default organization at first login; allow switching later via a native
  picker that renders correctly in **both** CLI and TUI.
- List only the models the selected organization exposes (org-scoped endpoint).
- Inject the correct auth/attribution/org headers on every request.
- Zero new runtime dependencies (only `@opencode-ai/plugin` for types).

### Non-goals
- No PKCE / authorization-code browser flow (Kilo's CLI gateway uses device auth).
- No client-side NDA blocklist for `:discounted` / `anthropic|openai` passthrough models —
  org-scoping is the source of truth (decided: rely on org's enabled list).
- No reuse of opencode's built-in `experimental.console.*` org switcher (not plugin-accessible).
- No changes to unrelated providers or agent model assignments.

---

## 3. Key reverse-engineered facts

### 3.1 opencode auth plugin API (`@opencode-ai/plugin` 1.18.2)

- A plugin is `async (input) => Hooks`. `input` provides `{ client, project, directory,
  worktree, $ }`. `client` is the opencode SDK client.
- **`auth` hook**: `{ provider: string, loader?, methods: Method[] }`.
  - `Method` (oauth): `{ type: "oauth", label, prompts?, authorize(inputs?) }` where
    `authorize` returns `{ url, instructions } & ({ method: "auto"; callback() } |
    { method: "code"; callback(code) })`.
  - `callback()` returns `{ type: "success", provider?, refresh, access, expires,
    accountId?, ...extraFields } | { type: "failed" }`. **Extra fields are persisted** into
    the stored credential and are readable later via `getAuth()`.
  - `prompts` are `type: "text" | "select"` with optional `when`/`condition` gating.
    **`select` options are STATIC** — serialized when the plugin factory runs
    (`GET /provider/auth`). There is **no** post-`authorize` prompt stage.
  - `loader(getAuth, provider) => Record<string, any>` — the returned object is merged into
    the provider's runtime options (`baseURL`, `apiKey`, `headers`, `fetch`) and handed to
    the underlying AI SDK provider.
- **`provider` hook** (dynamic models): `{ id: string, models(provider, ctx) =>
  Record<modelID, Model> }`. `ctx.auth` gives the stored credential so the list can be
  fetched authenticated.
- Credentials are stored by opencode in `~/.local/share/opencode/auth.json` (mode `0600`).
  The plugin never writes this file directly for initial login; opencode writes it from the
  `callback()` result. Runtime rewrites use `client.auth.set(...)`.

### 3.2 Cross-surface execution model (critical constraint)

| | CLI `opencode auth login` | TUI `/connect` |
|---|---|---|
| Where `authorize()` / `callback()` run | in-process | **server process over HTTP (no TTY)** |
| Plugin rendering its own clack/readline/stdout | reaches terminal but collides with opencode's active clack session (fragile) | **does nothing / corrupts server output** |
| Native `prompts` (`select`/`text`) | ✅ `Prompt.select/text` | ✅ `DialogSelect/DialogPrompt` |

**Conclusion:** never render our own interactive UI inside `authorize()`/`callback()`.
All interactive selection must use opencode's **native** `prompts`, whose options are
computed at **plugin-load time**. This is why we do not use `@clack/prompts`.

### 3.3 Kilo gateway endpoints

Base URL: **`https://api.kilo.ai`**, overridable via env **`KILO_API_URL`**. A token may
embed a base-URL prefix of the form `https://host[:port][/path]:<token>`; when present it
overrides the default base.

- **Device auth init:** `POST /api/device-auth/codes` (no body) →
  `{ code, verificationUrl, expiresIn }`. `429` → too many pending requests.
- **Poll:** `GET /api/device-auth/codes/{code}` every **3000 ms** (max attempts =
  `ceil(expiresIn*1000 / 3000)`). Status by HTTP code: `202` pending, `403` denied,
  `410` expired, `200` → body `{ status: "approved", token, userEmail }`.
- **Token:** long-lived (~1 year). Stored as **both** `access` and `refresh`; there is no
  refresh endpoint. `expires = now + ~1yr`.
- **Profile:** `GET /api/profile` (Bearer) → `{ user: { email, name },
  organizations: [{ id, name, role }], selectedOrganizationId, hasPersonalAccount }`.
  `401/403` → invalid token.
- **Default org selection:** `selectedOrganizationId` if it exists in `organizations`;
  else if `hasPersonalAccount === false` → `organizations[0].id`; else `undefined`
  (Personal account).
- **Models:** `GET {base}/models` where `{base}` is
  `…/api/organizations/{orgId}` when an org is selected, else `…/api/openrouter`.
  Response is OpenRouter-compatible: `{ data: [ { id, name, description, context_length,
  max_completion_tokens, pricing: { prompt, completion, input_cache_read,
  input_cache_write }, architecture: { input_modalities, output_modalities, tokenizer },
  top_provider, supported_parameters, opencode?: { family, prompt, variants,
  ai_sdk_provider } } ] }`. On `401` the org/authed request falls back to the public
  unauthenticated `…/api/openrouter/models`. Pricing is `$/token` → multiply by 1e6 for
  `$/M tokens`.
- **Chat/completions:** OpenRouter/OpenAI-compatible; served under the same base. The
  reference `opencode-kilo-auth` loader sets `baseURL` to the org-scoped
  `…/api/organizations/{orgId}` and lets the AI SDK append `/chat/completions`.
  *(Implementation note: confirm empirically that org-scoped chat works; fall back to
  `…/api/openrouter` base + `X-KiloCode-OrganizationId` header if not.)*

### 3.4 Request headers

- `Authorization: Bearer <token>`
- `X-KiloCode-OrganizationId: <orgId>` — only when an org is selected
- `X-KILOCODE-EDITORNAME: opencode-kilo-gateway[/<version>]`
- `HTTP-Referer: https://kilo.ai/`
- `X-Title: Kilo Code`
- `User-Agent: opencode-kilo-gateway/<version>`
- `Content-Type: application/json`

Only models whose `supported_parameters` include `"tools"` are kept (Kilo requires
tool-calling).

---

## 4. Behavior design

### 4.1 Login (device auth) — first time

1. User runs `opencode auth login` → picks **Kilo** → picks the **"Login with Kilo"**
   method (or is auto-selected if it's the only method at that moment); or in the TUI runs
   `/connect` → picks **Kilo**.
2. `authorize()` calls `POST /api/device-auth/codes`, returns
   `{ url: verificationUrl, instructions: "Approve device code <code> in your browser",
   method: "auto" }`. On the server host it may also attempt to open the browser.
3. `callback()` polls `GET /api/device-auth/codes/{code}` every 3 s until `approved`,
   yielding `token`.
4. `callback()` fetches `GET /api/profile`, computes the **default org** (§3.3), and returns
   `{ type: "success", provider: "kilo", access: token, refresh: token,
   expires: now + 1yr, orgId: <defaultOrgId | undefined> }`.
5. opencode persists the credential (including `orgId`) and re-bootstraps; the model list is
   fetched for the selected org.
6. **Multi-org hint (optional):** if the profile shows >1 org, emit a non-blocking toast/log:
   *"Auto-selected organization ‹Name›. Use the 'Switch organization' login method to
   change."*

### 4.2 Organization switch — the cross-surface picker

A **second auth method** `"Kilo · Switch organization"`:

- Its `prompts` contains one `select` (`key: "orgId"`) whose options are **computed at
  plugin-load time**: the factory reads the stored token via the SDK and, if present, calls
  `GET /api/profile`, mapping orgs to `{ label: name, value: id }` plus a
  `{ label: "Personal account", value: "" }` entry. If no token/orgs, the method is omitted.
- opencode renders this natively — `Prompt.select` (CLI) / `DialogSelect` (TUI).
- `authorize(inputs)` performs **no browser flow**. It reuses the existing token and returns
  `{ type: "success", provider: "kilo", access: <token>, refresh: <token>,
  expires: <existing>, orgId: inputs.orgId || undefined }`.
- opencode re-bootstraps → the factory re-runs → the model list re-fetches for the new org.
- **Caveat:** the org option list only refreshes when the plugin is re-instantiated
  (login/re-bootstrap or restart), not live. Acceptable.

### 4.3 Request-time credential loader

`loader(getAuth)`:

1. `auth = await getAuth()`. If not `oauth`, return `{}` (provider unusable until login).
2. Resolve `baseURL`: token-embedded prefix (§3.3) → else `KILO_API_URL` → else
   `https://api.kilo.ai`. If `auth.orgId`, scope to `…/api/organizations/{orgId}`; else
   `…/api/openrouter`.
3. Return `{ baseURL, apiKey: auth.access, headers: buildHeaders(auth.orgId) }`.
   opencode/the AI SDK adds `Authorization: Bearer <apiKey>`; `headers` supplies the org +
   attribution headers.

### 4.4 Dynamic models

`provider.models(provider, ctx)`:

1. Read token + `orgId` from `ctx.auth` (if `oauth`).
2. `GET {orgBase|publicBase}/models`; on `401`, retry public `…/api/openrouter/models`
   unauthenticated. 10 s timeout.
3. Filter to models with `"tools"` in `supported_parameters`.
4. Map each to an opencode `Model`: id, name, `limit.context` from `context_length`,
   `limit.output` from `max_completion_tokens`/`top_provider`, `cost` from pricing×1e6,
   `capabilities` from `architecture`/`supported_parameters` (reasoning, attachment/image
   from modalities, toolcall true), `api.npm` set to the openrouter-compatible SDK opencode
   already bundles for `kilo`.
5. Return `Record<"z-ai/glm-5.1" | …, Model>`. opencode prefixes provider id → `kilo/…`.

If there is no token, `models` returns the public list (so the picker isn't empty
pre-login), or an empty map — decided during implementation based on the public endpoint's
availability.

---

## 5. Architecture / module layout

Standalone repo, TypeScript, focused single-purpose modules:

```
opencode-kilo-gateway/
├── package.json          # name "opencode-kilo-gateway", type: module, exports → dist
├── tsconfig.json
├── README.md
├── LICENSE
├── .gitignore
├── docs/
│   └── design.md         # this document
├── src/
│   ├── index.ts          # plugin factory: assembles auth + provider hooks; load-time profile fetch
│   ├── config.ts         # constants, KILO_API_URL resolution, header names, version
│   ├── token.ts          # parseKiloUrlFromToken(): extract embedded base-URL prefix
│   ├── device-auth.ts    # initiateDeviceAuth(), pollDeviceAuth(), openBrowser()
│   ├── profile.ts        # fetchProfile(), defaultOrganizationId(), orgSelectOptions()
│   ├── models.ts         # fetchModels(): fetch + tools filter + pricing + Model mapping
│   ├── headers.ts        # buildHeaders(orgId, version)
│   ├── auth.ts           # loginMethod + switchOrgMethod builders
│   └── loader.ts         # credential loader (baseURL/apiKey/headers)
└── test/
    ├── token.test.ts
    ├── profile.test.ts   # defaultOrganizationId, orgSelectOptions
    ├── models.test.ts    # filtering, pricing, mapping
    ├── headers.test.ts
    └── device-auth.test.ts # poll status mapping (mocked fetch)
```

Module boundaries: each `src/*` file has one responsibility, pure where possible (mockable
`fetch`), so `index.ts` is thin orchestration.

**Entry export:** `export const KiloGateway: Plugin = async (input) => ({ auth, provider })`.

---

## 6. Packaging & distribution

- **package.json**: `name: "opencode-kilo-gateway"`, `type: "module"`, `version`,
  `exports`/`main` → built `dist/index.js` + types; `devDependencies`:
  `@opencode-ai/plugin`, `typescript`, `vitest` (or `bun test`), `@types/node`. **No runtime
  dependencies.**
- **Build**: `tsc` (or `tsup`) → `dist/`. Publishable to npm.
- **Local development**: symlink/point the repo into `~/.config/opencode/plugins/`
  (or reference a local path) so it loads directly; opencode/Bun can run TS.
- **Consumption after publish**: add `"opencode-kilo-gateway"` to the `"plugin"` array in
  opencode config; Bun installs it at startup.

---

## 7. Integration with the user's opencode config (follow-up, applied carefully)

In `~/.config/opencode` (accessed via `.config` path only):

1. Add the plugin (local path during dev, then `"opencode-kilo-gateway"` after publish) to
   the `"plugin"` array.
2. **Remove** the now-redundant static block
   `provider.kilo.options.headers.X-KiloCode-OrganizationId` and the `secrets/kilo.org`
   dependency from `opencode.local.jsonc` and `opencode.local.work.example.jsonc` — org id is
   now supplied by login/selection.
3. Existing `model` / `small_model` / per-agent `kilo/...` references remain unchanged.

These edits touch the user's live config and are done as a distinct, reviewed step.

---

## 8. Testing strategy

- **Unit (pure functions, mocked `fetch`):** `parseKiloUrlFromToken`,
  `defaultOrganizationId`, `orgSelectOptions`, model filtering/pricing/mapping, header
  building, device-auth poll status mapping.
- **Manual / integration (live gateway, checklist in README):**
  1. `opencode auth login` → Kilo → device flow completes; default org auto-selected.
  2. TUI `/connect` → Kilo → device flow completes (server-side), model picker populated.
  3. "Switch organization" method in both CLI and TUI changes org; model list changes.
  4. A chat request succeeds through the org-scoped base URL with correct headers.
  5. Token-embedded base-URL prefix override works.

---

## 9. Risks & open items (to confirm during implementation)

1. **Org-scoped chat endpoint**: confirm chat/completions works against
   `…/api/organizations/{orgId}`; if not, use `…/api/openrouter` base + org header.
2. **Bundled SDK / `api.npm`**: confirm which openrouter-compatible AI SDK opencode ships for
   the built-in `kilo` provider and reuse it (avoid adding a dependency).
3. **Provider visibility**: confirm the built-in `kilo` provider (`autoload:false`) appears in
   `/connect` and CLI once our `auth`/`provider` hooks register; no `provider` config block
   should be required.
4. **Load-time profile fetch cost**: one `GET /api/profile` at startup to populate the switch
   list; cache per process; skip when no token.
5. **Multi-org hint delivery**: choose a TUI-safe channel (toast via SDK client / structured
   log) that also degrades gracefully in the CLI.

---

## 10. Decisions log (from brainstorming)

- Build our own plugin, using `@kilocode/kilo-gateway` (Kilo CLI fork) as reference. (A/C)
- Org selection: auto-select default at first login + native "Switch organization" picker in
  both CLI and TUI. (C, adapted for cross-surface constraint)
- Gateway base URL: `https://api.kilo.ai`, `KILO_API_URL` override. (A)
- Model filtering: rely on org-scoping (+ Kilo's `tools` requirement); no client NDA
  blocklist. (A)
- Provider identity: reuse `kilo`; remove static org header + `secrets/kilo.org`; switch to
  device-auth login. (A)
- Packaging: standalone git repo, opencode plugin per docs; **no `@clack/prompts`** (native
  prompts are cross-surface; clack is not). Zero runtime deps.
- Repo name: `opencode-kilo-gateway`. Folder: current pwd, renamed accordingly.
