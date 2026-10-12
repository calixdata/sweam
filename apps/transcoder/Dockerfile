# Sweam transcoder worker: Node 22 + ffmpeg, polling the API for jobs.
# Built from the repository root so the shared package is available for types:
#   docker build -f apps/transcoder/Dockerfile .
# Fly builds it the same way (see fly.toml).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace manifests first so the install layer caches.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/transcoder/package.json apps/transcoder/
RUN npm ci --omit=dev --workspace @sweam/transcoder --workspace @sweam/shared --include-workspace-root=false \
  && npm install --no-save tsx@^4.19.0

COPY packages/shared packages/shared
COPY apps/transcoder apps/transcoder

WORKDIR /app/apps/transcoder
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
