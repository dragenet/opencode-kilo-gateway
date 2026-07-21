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
