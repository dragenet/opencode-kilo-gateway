---
"@dragenetlabs/opencode-kilo-gateway": patch
---

v2: publish the resolved credential before the profile/models fetches finish. A cold-started server (e.g. `opencode --standalone`) issued its first model request while the catalog was still loading, so the request went out without `X-KiloCode-OrganizationId` and the gateway billed the personal account — failing with "credits required" even though the organization had credits.
