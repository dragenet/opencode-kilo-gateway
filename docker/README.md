# Isolated Docker Test Environment

## Purpose

This directory provides a self-contained Docker-based test environment for the
`opencode-kilo-gateway` plugin. It runs the plugin against a real opencode CLI
and the real Kilo API, with credential storage fully isolated in a
Docker-managed volume — never touching the host's `~/.local/share/opencode/auth.json`
or `~/.config/opencode`.

**Why this exists:** In a previous session, live device-auth testing against
the running plugin overwrote the user's real stored credential on the host
(`~/.local/share/opencode/auth.json`), and separately the opencode config at
`~/.config/opencode` was edited live. This environment eliminates both risks:
the named Docker volume `opencode-test-auth` (which stands in for the host's
credential store) is completely inaccessible from the host filesystem, the
config baked into the image (`docker/opencode-test.jsonc`, standing in for
the host's config directory) is separate from anything under the user's real
`~/.config/opencode`, and both can be wiped clean with `docker compose down -v`.

Key design choices:
- `opencode-ai@1.18.4` is pinned in the Dockerfile to match the host's
  installed CLI version, so plugin behavior is tested against the same version
  the user runs locally.
- The plugin is built from the current repository source on every image build
  (multi-stage Dockerfile), not from a stale prebuilt artifact.
- The test config (`opencode-test.jsonc`) is deliberately minimal — only the
  `kilo` provider model selections — and contains no personal data, agents,
  MCP servers, or other providers.
- The repo is bind-mounted read-only at `/workspace` so the container cannot
  write back to the host repository.

## Build

```bash
docker compose build
```

This builds the plugin from the current source and installs opencode CLI
1.18.4 into the image.

## Usage

### Interactive device-auth login

```bash
docker compose run --rm opencode-test opencode auth login
```

This opens a device-auth flow: the CLI prints a URL and code, the user approves
in their own browser, and the resulting token is stored **only** in the
`opencode-test-auth` Docker volume (not on the host).

### Non-interactive smoke tests

**Both of these require a successful login first** (via `auth login` above, or
`docker compose run --rm opencode-test opencode auth login` non-interactively
if you already have a way to supply credentials). In a fresh, unauthenticated
container, `opencode models kilo` returns `Error: Provider not found: kilo` —
verified during implementation of this environment — not a model list. This
differs from running the same command directly against Kilo's public catalog
via `curl`, which does work unauthenticated; the opencode CLI's own provider
resolution for the `models <id>` command requires the provider to have (or be
able to acquire) a credential first.

```bash
# List available Kilo models (after logging in)
docker compose run --rm opencode-test opencode models kilo

# Run a simple completion through the Kilo provider (after logging in)
docker compose run --rm opencode-test opencode run "say pong" -m kilo/z-ai/glm-5.1
```

### Known open finding: interactive login screen

While building this environment, `opencode auth login` → search `kilo` →
select **Kilo Gateway** went straight to a generic **"Enter your API key"**
prompt in this fresh container, instead of the plugin's own **"Login with
Kilo"** / **"Kilo · Switch organization"** OAuth method-selection screen that
was previously observed working on the host. This was tested extensively
(cache pre-warming, a pre-seeded fake stored credential, `--log-level DEBUG`)
without a conclusive root cause — plugin file discovery and config
registration (`opencode debug config`) both confirm the plugin loads
correctly, so this appears to be specific to the interactive TUI picker
rather than the plugin's `auth`/`provider` hooks themselves. If you hit the
same "Enter your API key" prompt when you try this yourself, that is a known,
not-yet-explained behavior to investigate further (ideally from a real
interactive terminal rather than scripted/automated keystrokes, which is how
it was discovered) — it does not necessarily mean the plugin is broken.

## Teardown

To destroy the test environment and all stored credentials:

```bash
docker compose down -v
```

This removes the container and the `opencode-test-auth` volume (including any
stored auth tokens). Rebuild and re-authenticate to start fresh.

## Maintenance

The `opencode-ai` version in `docker/Dockerfile` is pinned to `1.18.4` to
match the host. If the plugin needs testing against a newer opencode release,
bump the pinned version in the Dockerfile and rebuild.
