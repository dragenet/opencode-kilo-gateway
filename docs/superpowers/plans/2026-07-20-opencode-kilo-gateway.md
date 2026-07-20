# opencode-kilo-gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, publishable opencode plugin (`opencode-kilo-gateway`) that replaces the static `kilo` provider with device-auth OAuth login, cross-surface (CLI + TUI) organization selection, and dynamic org-scoped model listing from the Kilo gateway.

**Architecture:** A set of small, pure, independently testable TypeScript modules (`token`, `headers`, `profile`, `models`, `device-auth`, `client`) composed by a thin `loader` and `auth` layer, wired together in `index.ts` as an `@opencode-ai/plugin` `Plugin` export with `auth` and `provider` hooks. No runtime dependencies — only `@opencode-ai/plugin` as a dev/type dependency. Every network call takes an injectable `fetch` implementation so tests run offline with mocked responses.

**Tech Stack:** TypeScript (ES2022, ESM), Vitest for tests, `tsc` for the build, Node/Bun-compatible global `fetch`/`AbortController`.

## Global Constraints

- Package name: `opencode-kilo-gateway`. Repo root: `/Users/ddomagalski/Projects/personal/opencode-kilo-gateway` (git already initialized).
- Provider id must remain **`kilo`** (existing agent configs reference `kilo/z-ai/glm-5.1` etc. and must keep working unchanged).
- **No runtime dependencies.** Only `@opencode-ai/plugin` (types), `typescript`, `vitest`, `@types/node` as devDependencies.
- **No `@clack/prompts` or any custom interactive terminal rendering.** Only opencode's native `prompts` (`type: "select"` / `"text"`) may be used for interactivity — they are the only mechanism that renders correctly in both the CLI and the TUI.
- Kilo gateway base URL default: `https://api.kilo.ai`, overridable via env `KILO_API_URL`.
- Device-auth poll interval: `3000` ms (production default; tests override via injectable options).
- Models fetch timeout: `10000` ms.
- Every module must accept an injectable `fetch` (typed `typeof fetch`) defaulting to the global `fetch`, so tests never hit the network.
- **Field-name correction from `docs/design.md`:** the design doc calls the persisted org field `orgId`. The actual `@opencode-ai/plugin` `CallbackResult` type has a **typed** field for exactly this purpose: `accountId`. This plan uses **`accountId`** everywhere instead of `orgId` to match the real typed API. This is a naming-only correction; behavior is unchanged from the design.
- Every task ends with `npm test` passing and a git commit.

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/.gitkeep` (removed once real files land — see Step 5)

**Interfaces:**
- Produces: an installable, buildable, testable empty TypeScript project. `npm run build` compiles `src/**/*.ts` to `dist/`. `npm test` runs Vitest against `test/**/*.test.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "opencode-kilo-gateway",
  "version": "0.1.0",
  "description": "opencode auth + provider plugin for the Kilo gateway: device-auth login, cross-surface organization selection, and dynamic model listing.",
  "type": "module",
  "license": "MIT",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "1.18.2",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, exit code 0.

- [ ] **Step 5: Create placeholder `src/.gitkeep` and verify empty test run**

Run: `mkdir -p src test && touch src/.gitkeep && npm test`
Expected: Vitest runs with "No test files found" (or passes with 0 tests) — exit code 0 or a clear "no tests" message, not a crash.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold opencode-kilo-gateway project"
```

---

### Task 2: `config.ts` — constants and base-URL resolution

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `PROVIDER_ID: string`, `DEFAULT_KILO_API_URL: string`, `POLL_INTERVAL_MS: number`, `MODELS_FETCH_TIMEOUT_MS: number`, `PACKAGE_VERSION: string`, `resolveApiBase(envUrl?: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
import { describe, expect, it } from "vitest"
import { DEFAULT_KILO_API_URL, resolveApiBase } from "../src/config"

describe("resolveApiBase", () => {
  it("returns the default Kilo API URL when no override is given", () => {
    expect(resolveApiBase(undefined)).toBe(DEFAULT_KILO_API_URL)
  })

  it("returns the default when the override is an empty string", () => {
    expect(resolveApiBase("")).toBe(DEFAULT_KILO_API_URL)
  })

  it("returns the override when provided", () => {
    expect(resolveApiBase("https://custom.kilo.internal")).toBe("https://custom.kilo.internal")
  })

  it("trims whitespace on the override", () => {
    expect(resolveApiBase("  https://custom.kilo.internal  ")).toBe("https://custom.kilo.internal")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/config.ts
export const PROVIDER_ID = "kilo"
export const DEFAULT_KILO_API_URL = "https://api.kilo.ai"
export const POLL_INTERVAL_MS = 3000
export const MODELS_FETCH_TIMEOUT_MS = 10_000
// Keep in sync with package.json "version".
export const PACKAGE_VERSION = "0.1.0"

export const HEADER_ORGANIZATION_ID = "X-KiloCode-OrganizationId"
export const HEADER_EDITOR_NAME = "X-KILOCODE-EDITORNAME"

/**
 * Resolves the Kilo gateway API base URL: an explicit override (e.g. from
 * the `KILO_API_URL` environment variable) takes precedence, falling back
 * to the default public gateway.
 */
export function resolveApiBase(envUrl: string | undefined): string {
  const trimmed = envUrl?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_KILO_API_URL
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- config.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add config constants and base-URL resolution"
```

---

### Task 3: `token.ts` — parse embedded base URL from a Kilo token

**Files:**
- Create: `src/token.ts`
- Test: `test/token.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `ParsedKiloToken { baseUrl?: string; token: string }`, `parseKiloToken(raw: string): ParsedKiloToken`.

- [ ] **Step 1: Write the failing test**

```ts
// test/token.test.ts
import { describe, expect, it } from "vitest"
import { parseKiloToken } from "../src/token"

describe("parseKiloToken", () => {
  it("returns the raw value as the token when there is no embedded URL", () => {
    expect(parseKiloToken("plain-token-123")).toEqual({ token: "plain-token-123" })
  })

  it("extracts a bare host base URL and the token after the colon", () => {
    expect(parseKiloToken("https://custom.kilo.internal:abc123token")).toEqual({
      baseUrl: "https://custom.kilo.internal",
      token: "abc123token",
    })
  })

  it("extracts a base URL with a path and the token after the colon", () => {
    expect(parseKiloToken("https://custom.kilo.internal/api:abc123token")).toEqual({
      baseUrl: "https://custom.kilo.internal/api",
      token: "abc123token",
    })
  })

  it("falls back to treating the whole string as the token when there is no separator", () => {
    expect(parseKiloToken("https://custom.kilo.internal")).toEqual({
      token: "https://custom.kilo.internal",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- token.test.ts`
Expected: FAIL — `Cannot find module '../src/token'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/token.ts
export interface ParsedKiloToken {
  baseUrl?: string
  token: string
}

/**
 * A Kilo access token may embed a base-URL override in the form
 * `https://host[:port][/path]:<token>` (used for self-hosted gateways).
 * This extracts the base URL prefix (if present) and the underlying token.
 *
 * Known limitation: if the base URL itself contains a port AND a path with
 * no further colon, the first colon after the host is used as the
 * separator — a self-hosted URL that combines a custom port with a path
 * segment containing a colon is not supported.
 */
export function parseKiloToken(raw: string): ParsedKiloToken {
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return { token: raw }
  }

  const protocolEnd = raw.indexOf("://") + 3
  const rest = raw.slice(protocolEnd)
  const colonIndex = rest.indexOf(":")
  if (colonIndex === -1) {
    return { token: raw }
  }

  const baseUrl = raw.slice(0, protocolEnd) + rest.slice(0, colonIndex)
  const token = rest.slice(colonIndex + 1)
  if (!token) {
    return { token: raw }
  }

  return { baseUrl, token }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- token.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/token.ts test/token.test.ts
git commit -m "feat: parse embedded base URL from Kilo tokens"
```

---

### Task 4: `headers.ts` — request header construction

**Files:**
- Create: `src/headers.ts`
- Test: `test/headers.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `HeaderOptions { accountId?: string; version: string }`, `buildKiloHeaders(options: HeaderOptions): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/headers.test.ts
import { describe, expect, it } from "vitest"
import { buildKiloHeaders } from "../src/headers"

describe("buildKiloHeaders", () => {
  it("includes the base attribution and content-type headers", () => {
    const headers = buildKiloHeaders({ version: "0.1.0" })
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["HTTP-Referer"]).toBe("https://kilo.ai/")
    expect(headers["X-Title"]).toBe("Kilo Code")
    expect(headers["User-Agent"]).toBe("opencode-kilo-gateway/0.1.0")
    expect(headers["X-KILOCODE-EDITORNAME"]).toBe("opencode-kilo-gateway/0.1.0")
  })

  it("omits the organization header when no accountId is given", () => {
    const headers = buildKiloHeaders({ version: "0.1.0" })
    expect(headers["X-KiloCode-OrganizationId"]).toBeUndefined()
  })

  it("includes the organization header when an accountId is given", () => {
    const headers = buildKiloHeaders({ version: "0.1.0", accountId: "org_123" })
    expect(headers["X-KiloCode-OrganizationId"]).toBe("org_123")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- headers.test.ts`
Expected: FAIL — `Cannot find module '../src/headers'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/headers.ts
export interface HeaderOptions {
  accountId?: string
  version: string
}

/**
 * Builds the standard set of headers Kilo's gateway expects: attribution
 * headers, the client User-Agent/editor name, and (when an organization is
 * selected) the organization-scoping header.
 */
export function buildKiloHeaders({ accountId, version }: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `opencode-kilo-gateway/${version}`,
    "HTTP-Referer": "https://kilo.ai/",
    "X-Title": "Kilo Code",
    "X-KILOCODE-EDITORNAME": `opencode-kilo-gateway/${version}`,
  }

  if (accountId) {
    headers["X-KiloCode-OrganizationId"] = accountId
  }

  return headers
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- headers.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/headers.ts test/headers.test.ts
git commit -m "feat: build Kilo request headers"
```

---

### Task 5: `profile.ts` — fetch profile, default org, select options

**Files:**
- Create: `src/profile.ts`
- Test: `test/profile.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `KiloOrganization { id, name, role }`, `KiloProfile { email, name?, organizations?, selectedOrganizationId?, hasPersonalAccount? }`, `SelectOption { label, value, hint? }`, `fetchProfile(baseUrl, token, fetchImpl?): Promise<KiloProfile>`, `defaultOrganizationId(profile): string | undefined`, `organizationSelectOptions(profile): SelectOption[]`.

- [ ] **Step 1: Write the failing test**

```ts
// test/profile.test.ts
import { describe, expect, it, vi } from "vitest"
import { defaultOrganizationId, fetchProfile, organizationSelectOptions, type KiloProfile } from "../src/profile"

describe("fetchProfile", () => {
  it("maps the raw profile response and sends a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        user: { email: "dev@example.com", name: "Dev" },
        organizations: [{ id: "org_1", name: "Acme", role: "member" }],
        selectedOrganizationId: "org_1",
        hasPersonalAccount: true,
      }),
    })

    const profile = await fetchProfile("https://api.kilo.ai", "tok_abc", fetchImpl as unknown as typeof fetch)

    expect(profile).toEqual({
      email: "dev@example.com",
      name: "Dev",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      selectedOrganizationId: "org_1",
      hasPersonalAccount: true,
    })
    expect(fetchImpl).toHaveBeenCalledWith("https://api.kilo.ai/api/profile", {
      headers: { Authorization: "Bearer tok_abc", "Content-Type": "application/json" },
    })
  })

  it("throws a clear error on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({}) })
    await expect(
      fetchProfile("https://api.kilo.ai", "bad-token", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Invalid or expired Kilo token")
  })
})

describe("defaultOrganizationId", () => {
  it("prefers selectedOrganizationId when it is a known organization", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      selectedOrganizationId: "org_1",
      hasPersonalAccount: true,
    }
    expect(defaultOrganizationId(profile)).toBe("org_1")
  })

  it("falls back to the first organization when there is no personal account", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
      hasPersonalAccount: false,
    }
    expect(defaultOrganizationId(profile)).toBe("org_1")
  })

  it("returns undefined (personal account) when there is no usable organization", () => {
    const profile: KiloProfile = { email: "a@b.com", organizations: [], hasPersonalAccount: true }
    expect(defaultOrganizationId(profile)).toBeUndefined()
  })
})

describe("organizationSelectOptions", () => {
  it("includes a personal-account option plus one entry per organization", () => {
    const profile: KiloProfile = {
      email: "a@b.com",
      organizations: [
        { id: "org_1", name: "Acme", role: "admin" },
        { id: "org_2", name: "Widgets Inc", role: "member" },
      ],
    }
    expect(organizationSelectOptions(profile)).toEqual([
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "admin" },
      { label: "Widgets Inc", value: "org_2", hint: "member" },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- profile.test.ts`
Expected: FAIL — `Cannot find module '../src/profile'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/profile.ts
export interface KiloOrganization {
  id: string
  name: string
  role: string
}

export interface KiloProfile {
  email: string
  name?: string
  organizations?: KiloOrganization[]
  selectedOrganizationId?: string
  hasPersonalAccount?: boolean
}

export interface SelectOption {
  label: string
  value: string
  hint?: string
}

interface RawProfileResponse {
  user: { email: string; name?: string }
  organizations?: KiloOrganization[]
  selectedOrganizationId?: string | null
  hasPersonalAccount?: boolean
}

/** Fetches the authenticated user's Kilo profile, including organizations. */
export async function fetchProfile(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KiloProfile> {
  const res = await fetchImpl(`${baseUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })

  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid or expired Kilo token")
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch Kilo profile: HTTP ${res.status}`)
  }

  const body = (await res.json()) as RawProfileResponse
  const profile: KiloProfile = { email: body.user.email }
  if (body.user.name !== undefined) profile.name = body.user.name
  if (body.organizations !== undefined) profile.organizations = body.organizations
  if (body.selectedOrganizationId) profile.selectedOrganizationId = body.selectedOrganizationId
  if (body.hasPersonalAccount !== undefined) profile.hasPersonalAccount = body.hasPersonalAccount
  return profile
}

/**
 * Determines the organization to select by default after login: the
 * server's `selectedOrganizationId` if it names a real organization,
 * otherwise the first organization when there is no personal account,
 * otherwise `undefined` (meaning: use the personal account).
 */
export function defaultOrganizationId(profile: KiloProfile): string | undefined {
  const orgs = profile.organizations ?? []

  if (profile.selectedOrganizationId && orgs.some((org) => org.id === profile.selectedOrganizationId)) {
    return profile.selectedOrganizationId
  }
  if (profile.hasPersonalAccount === false && orgs.length > 0) {
    return orgs[0]!.id
  }
  return undefined
}

/**
 * Builds the native `select` prompt options for the "Switch organization"
 * auth method: a "Personal account" entry plus one entry per organization.
 */
export function organizationSelectOptions(profile: KiloProfile): SelectOption[] {
  const orgs = profile.organizations ?? []
  const options: SelectOption[] = [{ label: "Personal account", value: "" }]
  for (const org of orgs) {
    options.push({ label: org.name, value: org.id, hint: org.role })
  }
  return options
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- profile.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/profile.ts test/profile.test.ts
git commit -m "feat: fetch Kilo profile and derive organization selection"
```

---

### Task 6: `models.ts` — fetch, filter, and map the dynamic model list

**Files:**
- Create: `src/models.ts`
- Test: `test/models.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `KiloRawModel`, `OpencodeModel`, `parseApiPrice(value?: string): number`, `supportsTools(model: KiloRawModel): boolean`, `mapKiloModel(model: KiloRawModel): OpencodeModel`, `FetchModelsOptions { baseUrl, accountId?, token?, fetchImpl?, timeoutMs? }`, `fetchKiloModels(options: FetchModelsOptions): Promise<Record<string, OpencodeModel>>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/models.test.ts
import { describe, expect, it, vi } from "vitest"
import { fetchKiloModels, mapKiloModel, parseApiPrice, supportsTools, type KiloRawModel } from "../src/models"

const toolModel: KiloRawModel = {
  id: "z-ai/glm-5.1",
  name: "GLM 5.1",
  context_length: 160_000,
  max_completion_tokens: 8_192,
  pricing: { prompt: "0.000003", completion: "0.000015" },
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  supported_parameters: ["tools", "temperature", "reasoning"],
}

const noToolsModel: KiloRawModel = {
  id: "some/no-tools-model",
  name: "No Tools Model",
  context_length: 32_000,
  pricing: { prompt: "0.000001", completion: "0.000002" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["temperature"],
}

describe("parseApiPrice", () => {
  it("converts a $/token string price to $/M tokens", () => {
    expect(parseApiPrice("0.000003")).toBeCloseTo(3)
  })

  it("returns 0 for missing or invalid prices", () => {
    expect(parseApiPrice(undefined)).toBe(0)
    expect(parseApiPrice("not-a-number")).toBe(0)
  })
})

describe("supportsTools", () => {
  it("returns true only when supported_parameters includes tools", () => {
    expect(supportsTools(toolModel)).toBe(true)
    expect(supportsTools(noToolsModel)).toBe(false)
  })
})

describe("mapKiloModel", () => {
  it("maps a raw Kilo model to an opencode model", () => {
    const model = mapKiloModel(toolModel)
    expect(model.id).toBe("z-ai/glm-5.1")
    expect(model.name).toBe("GLM 5.1")
    expect(model.status).toBe("active")
    expect(model.limit).toEqual({ context: 160_000, output: 8_192 })
    expect(model.cost.input).toBeCloseTo(3)
    expect(model.cost.output).toBeCloseTo(15)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  })
})

describe("fetchKiloModels", () => {
  it("fetches the org-scoped endpoint and drops models without tools support", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: [toolModel, noToolsModel] }),
    })

    const models = await fetchKiloModels({
      baseUrl: "https://api.kilo.ai",
      accountId: "org_1",
      token: "tok_abc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(Object.keys(models)).toEqual(["z-ai/glm-5.1"])
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/organizations/org_1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    )
  })

  it("falls back to the public endpoint on 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: [toolModel] }) })

    const models = await fetchKiloModels({
      baseUrl: "https://api.kilo.ai",
      accountId: "org_1",
      token: "tok_abc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(Object.keys(models)).toEqual(["z-ai/glm-5.1"])
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.kilo.ai/api/openrouter/models",
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) }),
    )
  })

  it("uses the public endpoint when there is no organization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: [toolModel] }) })
    await fetchKiloModels({ baseUrl: "https://api.kilo.ai", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/openrouter/models",
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- models.test.ts`
Expected: FAIL — `Cannot find module '../src/models'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/models.ts
export interface KiloModelPricing {
  prompt: string
  completion: string
  input_cache_read?: string
  input_cache_write?: string
}

export interface KiloModelArchitecture {
  input_modalities: string[]
  output_modalities: string[]
  tokenizer?: string
}

export interface KiloRawModel {
  id: string
  name: string
  description?: string
  context_length: number
  max_completion_tokens?: number | null
  pricing: KiloModelPricing
  architecture: KiloModelArchitecture
  top_provider?: { max_completion_tokens?: number | null }
  supported_parameters?: string[]
}

export interface OpencodeModelCost {
  input: number
  output: number
  cache: { read: number; write: number }
}

export interface OpencodeModelLimit {
  context: number
  output?: number
}

export interface OpencodeModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
  output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
  interleaved: boolean
}

export interface OpencodeModel {
  id: string
  name: string
  status: "active"
  capabilities: OpencodeModelCapabilities
  cost: OpencodeModelCost
  limit: OpencodeModelLimit
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
}

/** Converts a Kilo `$/token` price string into `$` per million tokens. */
export function parseApiPrice(value: string | undefined): number {
  if (!value) return 0
  const price = Number.parseFloat(value)
  if (Number.isNaN(price)) return 0
  return price * 1_000_000
}

/** Kilo requires tool-calling support; models without it are unusable. */
export function supportsTools(model: KiloRawModel): boolean {
  return (model.supported_parameters ?? []).includes("tools")
}

/** Maps a raw Kilo/OpenRouter-shaped model into an opencode `Model`. */
export function mapKiloModel(model: KiloRawModel): OpencodeModel {
  const inputModalities = model.architecture?.input_modalities ?? []
  const outputModalities = model.architecture?.output_modalities ?? []
  const supportedParameters = model.supported_parameters ?? []
  const hasImage = inputModalities.includes("image")

  return {
    id: model.id,
    name: model.name ?? model.id,
    status: "active",
    capabilities: {
      temperature: supportedParameters.includes("temperature"),
      reasoning: supportedParameters.includes("reasoning"),
      attachment: hasImage,
      toolcall: true,
      input: {
        text: inputModalities.length === 0 || inputModalities.includes("text"),
        audio: inputModalities.includes("audio"),
        image: hasImage,
        video: inputModalities.includes("video"),
        pdf: inputModalities.includes("file"),
      },
      output: {
        text: outputModalities.length === 0 || outputModalities.includes("text"),
        audio: outputModalities.includes("audio"),
        image: outputModalities.includes("image"),
        video: outputModalities.includes("video"),
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: parseApiPrice(model.pricing?.prompt),
      output: parseApiPrice(model.pricing?.completion),
      cache: {
        read: parseApiPrice(model.pricing?.input_cache_read),
        write: parseApiPrice(model.pricing?.input_cache_write),
      },
    },
    limit: {
      context: model.context_length,
      ...(resolveOutputLimit(model) !== undefined ? { output: resolveOutputLimit(model) } : {}),
    },
    options: {},
    headers: {},
    release_date: "",
  }
}

function resolveOutputLimit(model: KiloRawModel): number | undefined {
  if (typeof model.max_completion_tokens === "number") return model.max_completion_tokens
  if (typeof model.top_provider?.max_completion_tokens === "number") return model.top_provider.max_completion_tokens
  return undefined
}

export interface FetchModelsOptions {
  baseUrl: string
  accountId?: string
  token?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function modelsEndpoint(baseUrl: string, accountId?: string): string {
  return accountId
    ? `${baseUrl}/api/organizations/${encodeURIComponent(accountId)}/models`
    : `${baseUrl}/api/openrouter/models`
}

/**
 * Fetches the dynamic Kilo model list, org-scoped when an organization is
 * selected. Falls back to the public (unauthenticated) list on a 401, and
 * drops any model that does not support tool-calling.
 */
export async function fetchKiloModels(options: FetchModelsOptions): Promise<Record<string, OpencodeModel>> {
  const { baseUrl, accountId, token, fetchImpl = fetch, timeoutMs = 10_000 } = options
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(modelsEndpoint(baseUrl, accountId), { headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401 && (accountId || token)) {
    return fetchKiloModels({ baseUrl, fetchImpl, timeoutMs })
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch Kilo models: HTTP ${res.status}`)
  }

  const body = (await res.json()) as { data: KiloRawModel[] }
  const result: Record<string, OpencodeModel> = {}
  for (const raw of body.data) {
    if (!supportsTools(raw)) continue
    result[raw.id] = mapKiloModel(raw)
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- models.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/models.ts test/models.test.ts
git commit -m "feat: fetch and map dynamic Kilo models"
```

---

### Task 7: `device-auth.ts` — device authorization grant flow

**Files:**
- Create: `src/device-auth.ts`
- Test: `test/device-auth.test.ts`

**Interfaces:**
- Consumes: `POLL_INTERVAL_MS` from `src/config.ts`.
- Produces: `DeviceAuthInit { code, verificationUrl, expiresIn }`, `DeviceAuthPollResult { status: "pending"|"approved"|"denied"|"expired"; token?; userEmail? }`, `initiateDeviceAuth(baseUrl, fetchImpl?): Promise<DeviceAuthInit>`, `pollDeviceAuthOnce(baseUrl, code, fetchImpl?): Promise<DeviceAuthPollResult>`, `WaitForDeviceAuthOptions { pollIntervalMs?; sleep?: (ms:number) => Promise<void> }`, `waitForDeviceAuthApproval(baseUrl, init, fetchImpl?, options?): Promise<DeviceAuthPollResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/device-auth.test.ts
import { describe, expect, it, vi } from "vitest"
import { initiateDeviceAuth, pollDeviceAuthOnce, waitForDeviceAuthApproval } from "../src/device-auth"

describe("initiateDeviceAuth", () => {
  it("returns the device auth init payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
    })
    const result = await initiateDeviceAuth("https://api.kilo.ai", fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 })
    expect(fetchImpl).toHaveBeenCalledWith("https://api.kilo.ai/api/device-auth/codes", { method: "POST" })
  })

  it("throws a clear error on 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 429, ok: false, json: async () => ({}) })
    await expect(
      initiateDeviceAuth("https://api.kilo.ai", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Too many pending authorization requests")
  })
})

describe("pollDeviceAuthOnce", () => {
  it("maps 202 to pending", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "pending",
    })
  })

  it("maps 403 to denied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 403, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "denied",
    })
  })

  it("maps 410 to expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 410, ok: false, json: async () => ({}) })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "expired",
    })
  })

  it("maps a 200 approved response to the token payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: "approved", token: "tok_123", userEmail: "a@b.com" }),
    })
    expect(await pollDeviceAuthOnce("https://api.kilo.ai", "ABCD", fetchImpl as unknown as typeof fetch)).toEqual({
      status: "approved",
      token: "tok_123",
      userEmail: "a@b.com",
    })
  })
})

describe("waitForDeviceAuthApproval", () => {
  it("polls until approved", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 202, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 202, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ status: "approved", token: "tok_123" }) })

    const result = await waitForDeviceAuthApproval(
      "https://api.kilo.ai",
      { code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 },
      fetchImpl as unknown as typeof fetch,
      { pollIntervalMs: 0, sleep: async () => {} },
    )

    expect(result).toEqual({ status: "approved", token: "tok_123" })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("gives up as expired after exhausting attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) })

    const result = await waitForDeviceAuthApproval(
      "https://api.kilo.ai",
      { code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 0.003 },
      fetchImpl as unknown as typeof fetch,
      { pollIntervalMs: 1, sleep: async () => {} },
    )

    expect(result).toEqual({ status: "expired" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- device-auth.test.ts`
Expected: FAIL — `Cannot find module '../src/device-auth'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/device-auth.ts
import { POLL_INTERVAL_MS } from "./config"

export interface DeviceAuthInit {
  code: string
  verificationUrl: string
  expiresIn: number
}

export interface DeviceAuthPollResult {
  status: "pending" | "approved" | "denied" | "expired"
  token?: string
  userEmail?: string
}

/** Starts a Kilo device-authorization grant: `POST /api/device-auth/codes`. */
export async function initiateDeviceAuth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<DeviceAuthInit> {
  const res = await fetchImpl(`${baseUrl}/api/device-auth/codes`, { method: "POST" })
  if (res.status === 429) {
    throw new Error("Too many pending authorization requests. Please wait and try again.")
  }
  if (!res.ok) {
    throw new Error(`Failed to initiate device auth: HTTP ${res.status}`)
  }
  return (await res.json()) as DeviceAuthInit
}

interface RawPollResponse {
  status: string
  token?: string
  userEmail?: string
}

/** Performs a single poll of `GET /api/device-auth/codes/{code}`. */
export async function pollDeviceAuthOnce(
  baseUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceAuthPollResult> {
  const res = await fetchImpl(`${baseUrl}/api/device-auth/codes/${encodeURIComponent(code)}`)

  if (res.status === 202) return { status: "pending" }
  if (res.status === 403) return { status: "denied" }
  if (res.status === 410) return { status: "expired" }
  if (!res.ok) {
    throw new Error(`Device auth poll failed: HTTP ${res.status}`)
  }

  const body = (await res.json()) as RawPollResponse
  if (body.status === "approved" && body.token) {
    const result: DeviceAuthPollResult = { status: "approved", token: body.token }
    if (body.userEmail !== undefined) result.userEmail = body.userEmail
    return result
  }
  return { status: "pending" }
}

export interface WaitForDeviceAuthOptions {
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Polls `pollDeviceAuthOnce` on an interval until the user approves/denies
 * the device code, it expires, or the code's `expiresIn` window elapses.
 */
export async function waitForDeviceAuthApproval(
  baseUrl: string,
  init: DeviceAuthInit,
  fetchImpl: typeof fetch = fetch,
  options: WaitForDeviceAuthOptions = {},
): Promise<DeviceAuthPollResult> {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const sleep = options.sleep ?? defaultSleep
  const maxAttempts = Math.max(1, Math.ceil((init.expiresIn * 1000) / Math.max(pollIntervalMs, 1)))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await pollDeviceAuthOnce(baseUrl, init.code, fetchImpl)
    if (result.status !== "pending") return result
    await sleep(pollIntervalMs)
  }
  return { status: "expired" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- device-auth.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/device-auth.ts test/device-auth.test.ts
git commit -m "feat: implement Kilo device-authorization grant flow"
```

---

### Task 8: `client.ts` — read the stored credential (SDK-or-fallback)

**Files:**
- Create: `src/client.ts`
- Test: `test/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StoredOAuthAuth { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }`, `getStoredAuth(client: unknown, providerId: string): Promise<StoredOAuthAuth | { type: "api"; key: string } | undefined>`.

**Context:** The exact opencode SDK client method name for reading a stored credential outside of the plugin's own `loader` callback (`getAuth()`) is not confirmed by the design research. Rather than guess a possibly-wrong method name, this module tries an SDK accessor **if present** (duck-typed, so it adapts to whatever the installed `@opencode-ai/plugin`/SDK version calls it) and otherwise falls back to reading `~/.local/share/opencode/auth.json` directly — the same file opencode itself writes for plugin credentials (confirmed location from design research §3.1).

- [ ] **Step 1: Write the failing test**

```ts
// test/client.test.ts
import { describe, expect, it, vi, afterEach } from "vitest"

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}))

import { readFile } from "node:fs/promises"
import { getStoredAuth } from "../src/client"

afterEach(() => {
  vi.clearAllMocks()
})

describe("getStoredAuth", () => {
  it("uses the SDK client accessor when available", async () => {
    const client = {
      auth: {
        get: vi.fn().mockResolvedValue({ data: { type: "oauth", access: "tok", refresh: "tok", expires: 1, accountId: "org_1" } }),
      },
    }

    const result = await getStoredAuth(client, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1, accountId: "org_1" })
    expect(client.auth.get).toHaveBeenCalledWith({ path: { id: "kilo" } })
    expect(readFile).not.toHaveBeenCalled()
  })

  it("falls back to reading auth.json when the client has no accessor", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ kilo: { type: "oauth", access: "tok", refresh: "tok", expires: 1 } }),
    )

    const result = await getStoredAuth({}, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1 })
  })

  it("falls back to reading auth.json when the SDK accessor throws", async () => {
    const client = { auth: { get: vi.fn().mockRejectedValue(new Error("not found")) } }
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ kilo: { type: "oauth", access: "tok", refresh: "tok", expires: 1 } }))

    const result = await getStoredAuth(client, "kilo")

    expect(result).toEqual({ type: "oauth", access: "tok", refresh: "tok", expires: 1 })
  })

  it("returns undefined when neither source has a credential", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"))
    const result = await getStoredAuth({}, "kilo")
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client.test.ts`
Expected: FAIL — `Cannot find module '../src/client'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/client.ts
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface StoredOAuthAuth {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
}

export interface StoredApiAuth {
  type: "api"
  key: string
}

export type StoredAuth = StoredOAuthAuth | StoredApiAuth | undefined

const AUTH_JSON_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")

interface SdkClientWithAuthAccessor {
  auth?: {
    get?: (args: { path: { id: string } }) => Promise<{ data?: StoredAuth }>
  }
}

/**
 * Reads the currently stored credential for a provider.
 *
 * Tries the opencode SDK client's auth accessor first (duck-typed, since
 * the exact generated method name can vary by opencode version), and falls
 * back to reading `auth.json` directly — the same file opencode writes to
 * for plugin credentials.
 */
export async function getStoredAuth(client: unknown, providerId: string): Promise<StoredAuth> {
  const accessor = (client as SdkClientWithAuthAccessor | undefined)?.auth?.get
  if (typeof accessor === "function") {
    try {
      const result = await accessor({ path: { id: providerId } })
      if (result?.data) return result.data
    } catch {
      // Fall through to the file-based fallback below.
    }
  }

  try {
    const raw = await readFile(AUTH_JSON_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Record<string, StoredAuth>
    return parsed[providerId]
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts test/client.test.ts
git commit -m "feat: read stored Kilo credential via SDK or auth.json fallback"
```

---

### Task 9: `loader.ts` — request-time credential loader

**Files:**
- Create: `src/loader.ts`
- Test: `test/loader.test.ts`

**Interfaces:**
- Consumes: `resolveApiBase` from `src/config.ts`, `buildKiloHeaders` from `src/headers.ts`, `parseKiloToken` from `src/token.ts`, `StoredAuth`/`StoredOAuthAuth` from `src/client.ts`.
- Produces: `LoaderResult { baseURL: string; apiKey: string; headers: Record<string,string> }`, `buildLoaderResult(auth: StoredAuth, version: string, envApiUrl?: string): LoaderResult | Record<string, never>`, `createLoader(version: string): (getAuth: () => Promise<StoredAuth>) => Promise<LoaderResult | Record<string, never>>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/loader.test.ts
import { describe, expect, it } from "vitest"
import { buildLoaderResult, createLoader } from "../src/loader"

describe("buildLoaderResult", () => {
  it("returns an empty object when there is no oauth credential", () => {
    expect(buildLoaderResult(undefined, "0.1.0")).toEqual({})
    expect(buildLoaderResult({ type: "api", key: "k" }, "0.1.0")).toEqual({})
  })

  it("scopes the base URL to the public endpoint when there is no accountId", () => {
    const result = buildLoaderResult({ type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 }, "0.1.0")
    expect(result).toEqual({
      baseURL: "https://api.kilo.ai/api/openrouter",
      apiKey: "tok_abc",
      headers: expect.objectContaining({ "User-Agent": "opencode-kilo-gateway/0.1.0" }),
    })
  })

  it("scopes the base URL to the organization endpoint when accountId is set", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1, accountId: "org_1" },
      "0.1.0",
    )
    expect(result.baseURL).toBe("https://api.kilo.ai/api/organizations/org_1")
    expect(result.headers?.["X-KiloCode-OrganizationId"]).toBe("org_1")
  })

  it("honors an embedded base URL in the token over the env override", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "https://custom.kilo.internal:tok_abc", refresh: "tok_abc", expires: 1 },
      "0.1.0",
      "https://env-override.example.com",
    )
    expect(result.baseURL).toBe("https://custom.kilo.internal/api/openrouter")
    expect(result.apiKey).toBe("tok_abc")
  })

  it("honors the env override when there is no embedded URL", () => {
    const result = buildLoaderResult(
      { type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 },
      "0.1.0",
      "https://env-override.example.com",
    )
    expect(result.baseURL).toBe("https://env-override.example.com/api/openrouter")
  })
})

describe("createLoader", () => {
  it("wraps buildLoaderResult around an async getAuth", async () => {
    const loader = createLoader("0.1.0")
    const result = await loader(async () => ({ type: "oauth", access: "tok_abc", refresh: "tok_abc", expires: 1 }))
    expect(result.baseURL).toBe("https://api.kilo.ai/api/openrouter")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loader.test.ts`
Expected: FAIL — `Cannot find module '../src/loader'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/loader.ts
import type { StoredAuth } from "./client"
import { resolveApiBase } from "./config"
import { buildKiloHeaders } from "./headers"
import { parseKiloToken } from "./token"

export interface LoaderResult {
  baseURL: string
  apiKey: string
  headers: Record<string, string>
}

/**
 * Builds the provider options opencode/the AI SDK need to talk to Kilo:
 * the org-scoped (or public) base URL, the bearer token, and headers.
 * Returns `{}` when there is no usable OAuth credential yet.
 */
export function buildLoaderResult(
  auth: StoredAuth,
  version: string,
  envApiUrl?: string,
): LoaderResult | Record<string, never> {
  if (!auth || auth.type !== "oauth" || !auth.access) return {}

  const { baseUrl: embeddedBaseUrl, token } = parseKiloToken(auth.access)
  const apiBase = embeddedBaseUrl ?? resolveApiBase(envApiUrl)
  const baseURL = auth.accountId
    ? `${apiBase}/api/organizations/${encodeURIComponent(auth.accountId)}`
    : `${apiBase}/api/openrouter`

  return {
    baseURL,
    apiKey: token,
    headers: buildKiloHeaders({ ...(auth.accountId ? { accountId: auth.accountId } : {}), version }),
  }
}

/** Creates the opencode auth-plugin `loader` function for the Kilo provider. */
export function createLoader(version: string) {
  return async (getAuth: () => Promise<StoredAuth>): Promise<LoaderResult | Record<string, never>> => {
    const auth = await getAuth()
    return buildLoaderResult(auth, version, process.env.KILO_API_URL)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loader.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/loader.ts test/loader.test.ts
git commit -m "feat: build the Kilo credential loader"
```

---

### Task 10: `auth.ts` — login and switch-organization auth methods

**Files:**
- Create: `src/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `initiateDeviceAuth`, `waitForDeviceAuthApproval`, `WaitForDeviceAuthOptions`, `DeviceAuthInit` from `src/device-auth.ts`; `fetchProfile`, `defaultOrganizationId`, `SelectOption` from `src/profile.ts`.
- Produces: `buildLoginMethod(apiBase, fetchImpl?, waitOptions?)`, `buildSwitchOrgMethod(apiBase, options, existingToken, existingExpires)` — both returning the `auth.methods[]` entry shape (`{ type: "oauth", label, prompts?, authorize(inputs?) }`) described in `docs/design.md` §3.1.

- [ ] **Step 1: Write the failing test**

```ts
// test/auth.test.ts
import { describe, expect, it, vi } from "vitest"
import { buildLoginMethod, buildSwitchOrgMethod } from "../src/auth"

describe("buildLoginMethod", () => {
  it("runs the device flow, resolves the default org, and returns a success callback", async () => {
    const fetchImpl = vi
      .fn()
      // POST /api/device-auth/codes
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
      })
      // GET /api/device-auth/codes/ABCD -> approved
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ status: "approved", token: "tok_abc" }),
      })
      // GET /api/profile
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          user: { email: "dev@example.com" },
          organizations: [{ id: "org_1", name: "Acme", role: "member" }],
          selectedOrganizationId: "org_1",
          hasPersonalAccount: true,
        }),
      })

    const method = buildLoginMethod("https://api.kilo.ai", fetchImpl as unknown as typeof fetch, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })

    expect(method.type).toBe("oauth")
    expect(method.label).toBe("Login with Kilo")

    const authorization = await method.authorize()
    expect(authorization.url).toBe("https://kilo.ai/device")
    expect(authorization.method).toBe("auto")

    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({
      type: "success",
      provider: "kilo",
      refresh: "tok_abc",
      access: "tok_abc",
      expires: expect.any(Number),
      accountId: "org_1",
    })
  })

  it("returns a failed callback when the device code is denied", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ code: "ABCD", verificationUrl: "https://kilo.ai/device", expiresIn: 600 }),
      })
      .mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({}) })

    const method = buildLoginMethod("https://api.kilo.ai", fetchImpl as unknown as typeof fetch, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const authorization = await method.authorize()
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({ type: "failed" })
  })
})

describe("buildSwitchOrgMethod", () => {
  it("returns undefined when there is no existing token", () => {
    const method = buildSwitchOrgMethod(
      "https://api.kilo.ai",
      [{ label: "Personal account", value: "" }],
      undefined,
      undefined,
    )
    expect(method).toBeUndefined()
  })

  it("returns undefined when there is only the personal-account option", () => {
    const method = buildSwitchOrgMethod(
      "https://api.kilo.ai",
      [{ label: "Personal account", value: "" }],
      "tok_abc",
      Date.now() + 1000,
    )
    expect(method).toBeUndefined()
  })

  it("exposes a native select prompt and reuses the existing token on authorize", async () => {
    const options = [
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "member" },
    ]
    const method = buildSwitchOrgMethod("https://api.kilo.ai", options, "tok_abc", 1234)
    expect(method).toBeDefined()
    expect(method?.label).toBe("Kilo · Switch organization")
    expect(method?.prompts).toEqual([
      { type: "select", key: "accountId", message: "Select organization", options },
    ])

    const authorization = await method!.authorize({ accountId: "org_1" })
    expect(authorization.method).toBe("auto")
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect(result).toEqual({
      type: "success",
      provider: "kilo",
      refresh: "tok_abc",
      access: "tok_abc",
      expires: 1234,
      accountId: "org_1",
    })
  })

  it("treats the empty personal-account value as no accountId", async () => {
    const options = [
      { label: "Personal account", value: "" },
      { label: "Acme", value: "org_1", hint: "member" },
    ]
    const method = buildSwitchOrgMethod("https://api.kilo.ai", options, "tok_abc", 1234)
    const authorization = await method!.authorize({ accountId: "" })
    const result = await (authorization as { callback: () => Promise<unknown> }).callback()
    expect((result as { accountId?: string }).accountId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- auth.test.ts`
Expected: FAIL — `Cannot find module '../src/auth'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/auth.ts
import { initiateDeviceAuth, waitForDeviceAuthApproval, type WaitForDeviceAuthOptions } from "./device-auth"
import { defaultOrganizationId, fetchProfile, type SelectOption } from "./profile"

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

interface AuthorizeSuccess {
  type: "success"
  provider: "kilo"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

interface AuthorizeFailed {
  type: "failed"
}

type CallbackResult = AuthorizeSuccess | AuthorizeFailed

interface OAuthAuthorization {
  url: string
  instructions: string
  method: "auto"
  callback(): Promise<CallbackResult>
}

export interface OAuthMethod {
  type: "oauth"
  label: string
  prompts?: Array<{ type: "select"; key: string; message: string; options: SelectOption[] }>
  authorize(inputs?: Record<string, string>): Promise<OAuthAuthorization>
}

/**
 * Builds the primary "Login with Kilo" auth method: runs the device
 * authorization grant, then resolves and stores the default organization
 * from the user's profile.
 */
export function buildLoginMethod(
  apiBase: string,
  fetchImpl: typeof fetch = fetch,
  waitOptions: WaitForDeviceAuthOptions = {},
): OAuthMethod {
  return {
    type: "oauth",
    label: "Login with Kilo",
    async authorize() {
      const init = await initiateDeviceAuth(apiBase, fetchImpl)
      return {
        url: init.verificationUrl,
        instructions: `Approve this device in your browser. Code: ${init.code}`,
        method: "auto",
        async callback(): Promise<CallbackResult> {
          const poll = await waitForDeviceAuthApproval(apiBase, init, fetchImpl, waitOptions)
          if (poll.status !== "approved" || !poll.token) {
            return { type: "failed" }
          }

          let accountId: string | undefined
          try {
            const profile = await fetchProfile(apiBase, poll.token, fetchImpl)
            accountId = defaultOrganizationId(profile)
          } catch {
            accountId = undefined
          }

          return {
            type: "success",
            provider: "kilo",
            refresh: poll.token,
            access: poll.token,
            expires: Date.now() + ONE_YEAR_MS,
            ...(accountId ? { accountId } : {}),
          }
        },
      }
    },
  }
}

/**
 * Builds the "Switch organization" auth method: a native `select` prompt
 * (populated at plugin-load time with the user's organizations) that, on
 * selection, reuses the existing token — no browser flow — and persists
 * the newly chosen `accountId`.
 *
 * Returns `undefined` when there is no existing token to reuse, or when
 * there is nothing to choose between (personal account only).
 */
export function buildSwitchOrgMethod(
  apiBase: string,
  options: SelectOption[],
  existingToken: string | undefined,
  existingExpires: number | undefined,
): OAuthMethod | undefined {
  if (!existingToken || options.length <= 1) return undefined

  return {
    type: "oauth",
    label: "Kilo · Switch organization",
    prompts: [{ type: "select", key: "accountId", message: "Select organization", options }],
    async authorize(inputs: Record<string, string> = {}) {
      const chosenAccountId = inputs.accountId || undefined
      return {
        url: apiBase,
        instructions: "Switching Kilo organization...",
        method: "auto",
        async callback(): Promise<CallbackResult> {
          return {
            type: "success",
            provider: "kilo",
            refresh: existingToken,
            access: existingToken,
            expires: existingExpires ?? Date.now() + ONE_YEAR_MS,
            ...(chosenAccountId ? { accountId: chosenAccountId } : {}),
          }
        },
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- auth.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat: add Kilo login and switch-organization auth methods"
```

---

### Task 11: `index.ts` — wire the plugin together

**Files:**
- Create: `src/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_ID`, `PACKAGE_VERSION`, `resolveApiBase` (`src/config.ts`); `buildLoginMethod`, `buildSwitchOrgMethod` (`src/auth.ts`); `createLoader` (`src/loader.ts`); `fetchKiloModels` (`src/models.ts`); `fetchProfile`, `organizationSelectOptions` (`src/profile.ts`); `getStoredAuth` (`src/client.ts`).
- Produces: `export const KiloGateway: Plugin` — an `@opencode-ai/plugin` `Plugin` exposing `auth` (provider `"kilo"`, `methods`, `loader`) and `provider` (`id: "kilo"`, `models`) hooks.

- [ ] **Step 1: Write the failing test**

```ts
// test/index.test.ts
import { describe, expect, it, vi } from "vitest"

vi.mock("../src/client", () => ({ getStoredAuth: vi.fn() }))
vi.mock("../src/profile", async () => {
  const actual = await vi.importActual<typeof import("../src/profile")>("../src/profile")
  return { ...actual, fetchProfile: vi.fn() }
})
vi.mock("../src/models", async () => {
  const actual = await vi.importActual<typeof import("../src/models")>("../src/models")
  return { ...actual, fetchKiloModels: vi.fn() }
})

import { getStoredAuth } from "../src/client"
import { fetchProfile } from "../src/profile"
import { fetchKiloModels } from "../src/models"
import { KiloGateway } from "../src/index"

describe("KiloGateway", () => {
  it("registers only the login method when there is no stored credential", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)

    const hooks = await KiloGateway({ client: {} } as never)

    expect(hooks.auth?.provider).toBe("kilo")
    expect(hooks.auth?.methods).toHaveLength(1)
    expect(hooks.auth?.methods[0]?.label).toBe("Login with Kilo")
    expect(hooks.provider?.id).toBe("kilo")
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it("adds the switch-organization method when a token with multiple orgs is stored", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue({
      type: "oauth",
      access: "tok_abc",
      refresh: "tok_abc",
      expires: 999,
    })
    vi.mocked(fetchProfile).mockResolvedValue({
      email: "dev@example.com",
      organizations: [{ id: "org_1", name: "Acme", role: "member" }],
    })

    const hooks = await KiloGateway({ client: {} } as never)

    expect(hooks.auth?.methods).toHaveLength(2)
    expect(hooks.auth?.methods[1]?.label).toBe("Kilo · Switch organization")
  })

  it("delegates models() to fetchKiloModels with the auth's token and accountId", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {
      auth: { type: "oauth", access: "tok_xyz", refresh: "tok_xyz", expires: 1, accountId: "org_2" },
    } as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok_xyz", accountId: "org_2" }),
    )
  })

  it("fetches the public model list when there is no auth in context", async () => {
    vi.mocked(getStoredAuth).mockResolvedValue(undefined)
    vi.mocked(fetchKiloModels).mockResolvedValue({})

    const hooks = await KiloGateway({ client: {} } as never)
    await hooks.provider?.models?.({} as never, {} as never)

    expect(fetchKiloModels).toHaveBeenCalledWith(
      expect.objectContaining({ token: undefined, accountId: undefined }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- index.test.ts`
Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { buildLoginMethod, buildSwitchOrgMethod, type OAuthMethod } from "./auth"
import { getStoredAuth } from "./client"
import { PACKAGE_VERSION, PROVIDER_ID, resolveApiBase } from "./config"
import { createLoader } from "./loader"
import { fetchKiloModels } from "./models"
import { fetchProfile, organizationSelectOptions } from "./profile"

/**
 * The Kilo gateway opencode plugin: device-auth login, cross-surface
 * organization selection, and dynamic org-scoped model listing for the
 * `kilo` provider.
 */
export const KiloGateway: Plugin = async (input) => {
  const apiBase = resolveApiBase(process.env.KILO_API_URL)

  const methods: OAuthMethod[] = [buildLoginMethod(apiBase)]

  const stored = await getStoredAuth((input as { client?: unknown }).client, PROVIDER_ID)
  if (stored?.type === "oauth" && stored.access) {
    try {
      const profile = await fetchProfile(apiBase, stored.access)
      const options = organizationSelectOptions(profile)
      const switchMethod = buildSwitchOrgMethod(apiBase, options, stored.access, stored.expires)
      if (switchMethod) methods.push(switchMethod)
    } catch {
      // Profile fetch failed (e.g. expired/invalid token) — only the
      // primary login method is offered; logging in again will refresh it.
    }
  }

  return {
    auth: {
      provider: PROVIDER_ID,
      methods,
      loader: createLoader(PACKAGE_VERSION),
    },
    provider: {
      id: PROVIDER_ID,
      async models(_provider, ctx) {
        const auth = (ctx as { auth?: { type?: string; access?: string; accountId?: string } }).auth
        const token = auth?.type === "oauth" ? auth.access : undefined
        const accountId = auth?.type === "oauth" ? auth.accountId : undefined
        return fetchKiloModels({ baseUrl: apiBase, accountId, token })
      },
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- index.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files (config, token, headers, profile, models, device-auth, client, loader, auth, index) pass, 0 failures.

- [ ] **Step 6: Build the project**

Run: `npm run build`
Expected: exit code 0, `dist/index.js` and `dist/index.d.ts` are created with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: wire the Kilo gateway plugin (auth + dynamic models)"
```

---

### Task 12: README, local dev linking, and manual verification checklist

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Interfaces:**
- Produces: documented install/dev/publish instructions and a manual test checklist (no new code interfaces — this task documents and locally wires up what Tasks 1–11 built).

- [ ] **Step 1: Write `README.md`**

```markdown
# opencode-kilo-gateway

An [opencode](https://opencode.ai) plugin that replaces the static `kilo` provider with:

- **Device-authorization OAuth login** to the Kilo gateway (`https://api.kilo.ai`), matching
  the Kilo CLI's own login flow — no static API key required.
- **Cross-surface organization selection**: your default organization is selected
  automatically at first login; switch to a different one later via the native
  **"Kilo · Switch organization"** login method, which works identically in the CLI
  (`opencode auth login`) and the TUI (`/connect`).
- **Dynamic, organization-scoped model listing**, fetched live from the Kilo gateway instead
  of a static model list.

See [`docs/design.md`](docs/design.md) for the full design rationale and
[`docs/superpowers/plans/2026-07-20-opencode-kilo-gateway.md`](docs/superpowers/plans/2026-07-20-opencode-kilo-gateway.md)
for the implementation plan.

## Install

Build the plugin, then either:

**Local development** — symlink (or reference by path) into opencode's plugin directory:

```bash
npm install
npm run build
ln -s "$(pwd)" ~/.config/opencode/plugins/opencode-kilo-gateway
```

**Published package** — add to your opencode config's plugin list:

```jsonc
{
  "plugin": ["opencode-kilo-gateway"]
}
```

## Configuration

- `KILO_API_URL` (optional) — override the Kilo gateway base URL. Defaults to
  `https://api.kilo.ai`.

If you were previously using a static `kilo` provider with a manually configured
organization header, remove it — this plugin supplies the organization automatically:

```jsonc
// Remove this once opencode-kilo-gateway is installed:
"provider": {
  "kilo": { "options": { "headers": { "X-KiloCode-OrganizationId": "..." } } }
}
```

Your existing `kilo/<vendor>/<model>` references (e.g. `kilo/z-ai/glm-5.1`) keep working
unchanged — the plugin owns the same `kilo` provider id.

## Manual verification checklist

1. `opencode auth login` → select **Kilo** → **Login with Kilo** → approve the device code
   shown in your browser → confirm login succeeds and a default organization is selected.
2. In the opencode TUI, run `/connect` → select **Kilo** → confirm the same device flow
   completes and the model picker is populated.
3. Run the **Kilo · Switch organization** method (via `opencode auth login` and via
   `/connect`) → confirm the organization changes and the model list updates accordingly.
4. Start a chat using a `kilo/...` model → confirm the request succeeds through the
   org-scoped base URL with the correct headers (inspect via `KILO_API_URL` pointed at a
   local proxy/logger if needed).
5. If you have a token with an embedded base-URL prefix (self-hosted gateway), confirm it
   overrides the default/`KILO_API_URL` base.

## Development

```bash
npm install
npm test        # run the unit test suite
npm run build   # compile TypeScript to dist/
```

## License

MIT
```

- [ ] **Step 2: Write `LICENSE`**

```
MIT License

Copyright (c) 2026 ddomagalski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Symlink the plugin into opencode's global plugin directory for local testing**

Run: `ln -sf "$(pwd)" ~/.config/opencode/plugins/opencode-kilo-gateway`
Expected: symlink created, `ls -la ~/.config/opencode/plugins/` shows `opencode-kilo-gateway -> /Users/ddomagalski/Projects/personal/opencode-kilo-gateway`.

- [ ] **Step 4: Run the manual verification checklist**

Follow the 5 steps in the README's "Manual verification checklist" section against a real
Kilo account. Record any deviations (e.g. if org-scoped chat completions fail — see
`docs/design.md` §9.1 — switch `buildLoaderResult` in `src/loader.ts` to use the
`/api/openrouter` base plus the `X-KiloCode-OrganizationId` header instead of the
`/api/organizations/{id}` base, and add a regression test in `test/loader.test.ts` for that
behavior).

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README, license, and local dev setup"
```

---

### Task 13: Integrate into the personal opencode configuration

**Files:**
- Modify (in the separate `~/.config/opencode` repo, accessed only via that path):
  `opencode.local.jsonc`
  `opencode.local.work.example.jsonc`

**Interfaces:**
- Consumes: the built, locally-linked `opencode-kilo-gateway` plugin from Task 12.
- Produces: opencode configuration that loads the plugin and no longer relies on the static
  `X-KiloCode-OrganizationId` header / `secrets/kilo.org`.

**Context:** This task edits a different, already-existing repo (the user's live opencode
dotfiles). Treat it as a distinct, explicitly-reviewed step — do not combine it with Tasks
1–12's commits.

- [ ] **Step 1: Read the current provider block**

Read `~/.config/opencode/opencode.local.jsonc` and confirm it still contains:

```jsonc
"provider": {
  "kilo": { "options": { "headers": { "X-KiloCode-OrganizationId": "{file:secrets/kilo.org}" } } }
}
```

- [ ] **Step 2: Add the plugin and remove the static org header**

Edit `~/.config/opencode/opencode.local.jsonc`: add `"opencode-kilo-gateway"` (or, during
local development, the path `"file:~/.config/opencode/plugins/opencode-kilo-gateway"` if the
config's plugin loader in use requires an explicit local reference — confirm against the
installed opencode version's plugin-array syntax) to the top-level `"plugin"` array, and
remove the `"provider": { "kilo": { ... } }` block entirely:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-kilo-gateway"],
  "model": "kilo/z-ai/glm-5.1",
  "small_model": "kilo/minimax/minimax-m3",
  "agent": {
    // ... unchanged ...
  }
}
```

Apply the equivalent edit to `opencode.local.work.example.jsonc` (the template file other
machines are set up from).

- [ ] **Step 3: Verify opencode loads the plugin**

Run: `opencode auth login` (in a fresh terminal) and confirm **Kilo** appears with a
**"Login with Kilo"** method (and, once logged in, **"Kilo · Switch organization"**).

- [ ] **Step 4: Remove the now-unused `secrets/kilo.org` reference if nothing else depends on it**

Check for other references: search `~/.config/opencode` for `secrets/kilo.org` (excluding
this plan). If nothing else uses it, delete `secrets/kilo.org` and note the removal in a
commit message.

- [ ] **Step 5: Commit (in the `~/.config/opencode` repo)**

```bash
git add opencode.local.jsonc opencode.local.work.example.jsonc
git commit -m "feat: switch kilo provider to opencode-kilo-gateway plugin"
```

---

## Post-plan risks to watch (carried over from `docs/design.md` §9)

1. **Org-scoped chat endpoint** (§9.1): if `.../api/organizations/{orgId}` does not serve
   `/chat/completions`, adjust `src/loader.ts` per Task 12 Step 4's note.
2. **Bundled SDK / `api.npm`** (§9.2): confirm which openrouter-compatible AI SDK opencode's
   built-in `kilo` provider uses; this plugin does not set `api.npm` explicitly and relies on
   opencode's existing provider definition for `kilo`. If models fail to route, add an
   explicit `api.npm`/`api.url` per model in `src/models.ts`'s `mapKiloModel`.
3. **Provider visibility** (§9.3): confirm `kilo` (with opencode's built-in
   `autoload: false`) still appears in `/connect` and `opencode auth login` once this
   plugin's `auth`/`provider` hooks register — no `provider` config block should be required.
