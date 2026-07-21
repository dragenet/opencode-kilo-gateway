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