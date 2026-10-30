import { describe, expect, it } from "vitest"
import { creditsMessage, parseKiloCreditsError, renderCreditsError } from "../../src/v2/credits"

/** Captured verbatim from a live gateway 402 (model `z-ai/glm-5.2`, balance already overdrawn). */
const creditsBody = {
  error: {
    title: "Paid Model - Credits Required",
    message: "Add credits to continue, or switch to a free model",
    balance: -0.155322,
    buyCreditsUrl: "https://app.kilo.ai/profile",
  },
  error_type: "usage_limit_exceeded",
}

function jsonResponse(body: unknown, status = 402, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

describe("parseKiloCreditsError", () => {
  it("recognises the gateway's paid-model credits error", () => {
    expect(parseKiloCreditsError(creditsBody)).toEqual({
      balance: -0.155322,
      buyCreditsUrl: "https://app.kilo.ai/profile",
    })
  })

  it("ignores 402 bodies that mean something else", () => {
    expect(
      parseKiloCreditsError({
        error: { message: "This request requires more credits, or fewer max_tokens" },
        error_type: "insufficient_credits",
      }),
    ).toBeUndefined()
  })

  it("falls back to the default top-up URL when the gateway omits one", () => {
    const details = parseKiloCreditsError({
      error: { title: "Paid Model - Credits Required" },
      error_type: "usage_limit_exceeded",
    })
    expect(details).toEqual({ buyCreditsUrl: "https://app.kilo.ai/profile" })
  })

  it("ignores non-object and empty bodies", () => {
    expect(parseKiloCreditsError(undefined)).toBeUndefined()
    expect(parseKiloCreditsError("Add credits to continue")).toBeUndefined()
    expect(parseKiloCreditsError({})).toBeUndefined()
  })
})

describe("creditsMessage", () => {
  const details = { balance: -0.155322, buyCreditsUrl: "https://app.kilo.ai/profile" }

  it("names the model, the balance, the top-up URL and a free alternative", () => {
    const message = creditsMessage("z-ai/glm-5.2", details)
    expect(message).toContain('"z-ai/glm-5.2"')
    expect(message).toContain("balance -0.155322")
    expect(message).toContain("https://app.kilo.ai/profile")
    expect(message).toContain("kilo-auto/free")
  })

  it("omits the balance when the gateway reports none", () => {
    const message = creditsMessage("z-ai/glm-5.2", { buyCreditsUrl: "https://app.kilo.ai/profile" })
    expect(message).not.toContain("balance")
    expect(message).toContain('"z-ai/glm-5.2"')
  })

  it("stays grammatical without a model id", () => {
    expect(creditsMessage(undefined, details)).toContain("Kilo credits required for this model")
  })
})

describe("renderCreditsError", () => {
  it("rewrites the message, keeping the status and the body shape", async () => {
    const event = { model: { id: "z-ai/glm-5.2" }, response: jsonResponse(creditsBody) }

    await renderCreditsError(event)

    expect(event.response.status).toBe(402)
    const body = (await event.response.json()) as typeof creditsBody
    expect(body.error.message).toContain('"z-ai/glm-5.2"')
    expect(body.error.message).toContain("balance -0.155322")
    expect(body.error.message).toContain("https://app.kilo.ai/profile")
    expect(body.error.title).toBe("Paid Model - Credits Required")
    expect(body.error_type).toBe("usage_limit_exceeded")
  })

  it("drops body-encoding headers so the rewritten body is not mis-decoded", async () => {
    const event = {
      model: { id: "z-ai/glm-5.2" },
      response: jsonResponse(creditsBody, 402, { "content-encoding": "gzip", "content-length": "123" }),
    }

    await renderCreditsError(event)

    expect(event.response.headers.get("content-encoding")).toBeNull()
    expect(event.response.headers.get("content-length")).toBeNull()
    expect(event.response.headers.get("content-type")).toBe("application/json")
  })

  it("leaves successful responses untouched", async () => {
    const response = jsonResponse({ ok: true }, 200)
    const event = { model: { id: "z-ai/glm-5.2" }, response }

    await renderCreditsError(event)

    expect(event.response).toBe(response)
  })

  it("leaves 402s from other causes untouched", async () => {
    const response = jsonResponse({ error: { message: "requires more credits" }, error_type: "insufficient_credits" })
    const event = { model: { id: "z-ai/glm-5.2" }, response }

    await renderCreditsError(event)

    expect(event.response).toBe(response)
  })

  it("leaves a non-JSON body untouched", async () => {
    const response = new Response("upstream timeout", { status: 402 })
    const event = { model: { id: "z-ai/glm-5.2" }, response }

    await renderCreditsError(event)

    expect(event.response).toBe(response)
  })

  it("still rewrites when the hook payload carries no model", async () => {
    const event = { response: jsonResponse(creditsBody) }

    await renderCreditsError(event)

    const body = (await event.response.json()) as typeof creditsBody
    expect(body.error.message).toContain("this model")
  })
})
