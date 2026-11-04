# Seansai: one container serving the API and the built web app (plan.md, "Deployment").
#
#   docker build -t seansai .
#   docker run -p 3000:3000 -v seansai-data:/data -e SEANSAI_CONTACT=https://github.com/zygislauk/Seansai seansai
#
# SEANSAI_CONTACT is required: it is sent in the User-Agent so cinemas can reach the operator.
# DISABLED_SOURCES=vue,cinamon is the kill switch for the robots.txt overrides (research.md §1b).

# The package manifests both installs below need.
FROM node:24-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Builds the web app (and checks its bundle budget).
FROM manifests AS build
RUN npm ci
COPY . .
RUN npm run build -w @seansai/web

# Only what the API needs at run time.
FROM manifests AS runtime-deps
RUN npm ci --omit=dev --workspace @seansai/api --include-workspace-root

FROM node:24-slim
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  DB_PATH=/data/seansai.sqlite
WORKDIR /app
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/src/main.ts"]
