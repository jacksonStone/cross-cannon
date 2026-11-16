# syntax=docker/dockerfile:1
# Node 26's x64 image misparses fractions under this Docker Desktop emulator.
# Build with a pinned compatible Node; the production runtime stays in .nvmrc.
ARG NODE_VERSION=24.13.0
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=1 CROSS_CANNON_UPDATE_DB=0
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates zip unzip libdigest-sha-perl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN node -e "if (0.25 * 4 !== 1) throw Error('Node arithmetic is broken under this container emulator')"
COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps
COPY . .
RUN test "$(node -p process.arch)" = x64
RUN npm run test:unit && npm run typecheck && npm run build
RUN npm prune --omit=dev --legacy-peer-deps
# Remix copies public/ into build/client/. Keep a single copy; serve-web falls
# through to public/ for these identical files. Compiled assets stay in build/.
RUN python3 - <<'PY'
from pathlib import Path
import filecmp
for built in Path('build/client').rglob('*'):
    original = Path('public') / built.relative_to('build/client')
    if built.is_file() and original.is_file() and filecmp.cmp(built, original, shallow=False):
        built.unlink()
PY
RUN mkdir -p /out/app/scripts && cp -a build public scripture-cache node_modules package.json package-lock.json /out/app/ \
    && cp scripts/update-accounts-db.mjs scripts/accounts-schema.sql /out/app/scripts/
RUN node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; import {betterAuth} from 'better-auth'; import '@libsql/client'; const db=new DatabaseSync(':memory:'); db.close(); console.log('Linux x64 production dependencies load.');"
RUN node scripts/smoke-web-container.mjs

FROM scratch AS artifact
COPY --from=build /out/ /
