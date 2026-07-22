FROM node:22-slim AS builder
WORKDIR /plugin
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm ci && npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode-ai@1.18.4
RUN mkdir -p /root/.config/opencode/plugins
COPY --from=builder /plugin/dist/index.js /root/.config/opencode/plugins/opencode-kilo-gateway.js
COPY docker/opencode-test.jsonc /root/.config/opencode/opencode.jsonc
WORKDIR /workspace
ENTRYPOINT ["opencode"]
