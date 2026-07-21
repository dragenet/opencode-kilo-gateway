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
    const model = mapKiloModel(toolModel, "https://api.kilo.ai/api/openrouter")
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
    expect(model.providerID).toBe("kilo")
    expect(model.api).toEqual({
      id: "z-ai/glm-5.1",
      url: "https://api.kilo.ai/api/openrouter",
      npm: "@ai-sdk/openai-compatible",
    })
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
    expect(models["z-ai/glm-5.1"].api.url).toBe("https://api.kilo.ai/api/organizations/org_1")
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
    const models = await fetchKiloModels({
      baseUrl: "https://api.kilo.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/openrouter/models",
      expect.anything(),
    )
    expect(models["z-ai/glm-5.1"].api.url).toBe("https://api.kilo.ai/api/openrouter")
  })
})