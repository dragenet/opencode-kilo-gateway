FROM node:22-slim AS builder
WORKDIR /plugin
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm ci && npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode-ai@1.18.4
RUN mkdir -p /root/.config/opencode/plugins
# The built plugin's dist/index.js uses extensionless relative imports to its
# compiled sibling modules (./auth, ./client, ./config, ./loader, ./models,
# ./profile, ./token, ./headers). opencode's plugin auto-discovery only globs
# top-level *.js files directly inside plugins/, so those sibling files can't
# simply be copied in flatly (they'd each be treated as separate, broken
# plugins) or dropped (the imports would fail to resolve and the whole plugin
# would silently fail to load). Instead, copy the entire dist/ directory to a
# stable location that preserves its internal relative structure, then
# symlink the entry point into plugins/ — mirroring exactly how a real local
# install works (`ln -sf .../dist/index.js ~/.config/opencode/plugins/...`),
# where Node/Bun's module resolution follows the symlink to its real
# containing directory and finds the sibling modules there.
COPY --from=builder /plugin/dist /opt/opencode-kilo-gateway/dist
RUN ln -s /opt/opencode-kilo-gateway/dist/index.js /root/.config/opencode/plugins/opencode-kilo-gateway.js
COPY docker/opencode-test.jsonc /root/.config/opencode/opencode.jsonc
WORKDIR /workspace
ENTRYPOINT ["opencode"]
