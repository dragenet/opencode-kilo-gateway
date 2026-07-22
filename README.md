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

**Local development** — opencode only auto-discovers individual `.js`/`.ts` files
placed directly inside `~/.config/opencode/plugins/` (not a symlinked package
directory), so symlink the built entry point itself:

```bash
npm install
npm run build
ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugins/opencode-kilo-gateway.js
```

**Published package** — add to your opencode config's plugin list:

```jsonc
{
  "plugin": ["@dragenetlabs/opencode-kilo-gateway"]
}
```

## Configuration

- `KILO_API_URL` (optional) — override the Kilo gateway base URL. Defaults to
  `https://api.kilo.ai`.

If you were previously using a static `kilo` provider with a manually configured
organization header, remove it — this plugin supplies the organization automatically:

```jsonc
// Remove this once @dragenetlabs/opencode-kilo-gateway is installed:
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
   shared `/api/openrouter` base with the `X-KiloCode-OrganizationId` header set when an
   organization is selected (inspect via `KILO_API_URL` pointed at a local proxy/logger if
   needed).
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
