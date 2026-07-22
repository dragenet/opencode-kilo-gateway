# Isolated Docker Test Environment

## Purpose

This directory provides a self-contained Docker-based test environment for the
`opencode-kilo-gateway` plugin. It runs the plugin against a real opencode CLI
and the real Kilo API, with credential storage fully isolated in a
Docker-managed volume — never touching the host's `~/.local/share/opencode/auth.json`
or `~/.config/opencode`.

**Why this exists:** In a previous session, live device-auth testing against
the running plugin overwrote the user's real stored credential on the host.
This environment eliminates that risk: the named Docker volume
`opencode-test-auth` is completely inaccessible from the host filesystem and
can be wiped clean with `docker compose down -v`.

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

```bash
# List available Kilo models
docker compose run --rm opencode-test opencode models kilo

# Run a simple completion through the Kilo provider
docker compose run --rm opencode-test opencode run "say pong" -m kilo/z-ai/glm-5.1
```

These do not require credentials for the `models` command (public catalog).
The `run` command requires a successful device-auth login first.

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
