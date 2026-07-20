export const PROVIDER_ID = "kilo"
export const DEFAULT_KILO_API_URL = "https://api.kilo.ai"
export const POLL_INTERVAL_MS = 3_000
export const MODELS_FETCH_TIMEOUT_MS = 10_000
export const PACKAGE_VERSION = "0.1.0"
export const HEADER_ORGANIZATION_ID = "X-KiloCode-OrganizationId"
export const HEADER_EDITOR_NAME = "X-KILOCODE-EDITORNAME"

export function resolveApiBase(envUrl?: string): string {
  const trimmed = envUrl?.trim()
  return trimmed ? trimmed : DEFAULT_KILO_API_URL
}