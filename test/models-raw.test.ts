import { describe, expect, it, vi } from "vitest"
import { fetchRawKiloModels, type KiloRawModel } from "../src/models"

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

describe("fetchRawKiloModels", () => {
  it("returns only tool-capable raw models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: [toolModel, noToolsModel] }),
    })

    const models = await fetchRawKiloModels({
      baseUrl: "https://api.kilo.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(models).toHaveLength(1)
    expect(models[0]).toEqual(toolModel)
  })

  it("401 with token falls back to public endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: [toolModel] }) })

    const models = await fetchRawKiloModels({
      baseUrl: "https://api.kilo.ai",
      token: "tok_abc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(models).toEqual([toolModel])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[1]
    expect(url.endsWith("/api/openrouter/models")).toBe(true)
    expect(init.headers.Authorization).toBeUndefined()
  })

  it("org endpoint when accountId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: [toolModel] }),
    })

    await fetchRawKiloModels({
      baseUrl: "https://api.kilo.ai",
      accountId: "org/1 x",
      token: "tok_abc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://api.kilo.ai/api/organizations/${encodeURIComponent("org/1 x")}/models`,
    )
  })
})
