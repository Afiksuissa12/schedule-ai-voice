# Schedule AI Voice - web demo image.
# Build from the repository root:
#   docker build -f deploy/web-demo/Dockerfile -t schedule-ai-voice-web-demo .
# The container talks to Ollama on the Docker host (host.docker.internal:11434) and
# serves ONLY the demo web app on port 8080. It publishes nothing by itself; see
# deploy/web-demo/README.md for the tunnel that makes it public.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npx tsc --noEmit -p tsconfig.json

ENV NODE_ENV=production \
    WEB_DEMO_PORT=8080 \
    WEB_DEMO_DATA_DIR=/tmp/web-demo \
    LOCAL_LLM_MODEL=qwen2.5:7b-instruct \
    LOCAL_LLM_BASE_URL=http://host.docker.internal:11434

USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/web/server.ts"]
