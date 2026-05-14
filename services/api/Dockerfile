ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/api/package.json services/api/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY packages/shared-types packages/shared-types
COPY services/api services/api
COPY docs docs

RUN pnpm --filter @rag/shared-types run build
RUN pnpm --filter api run prisma:generate
RUN pnpm --filter api run build
RUN pnpm --filter api run build:verify

FROM base AS runtime

ENV NODE_ENV=production

RUN groupadd --system appgroup \
  && useradd --system --gid appgroup --create-home appuser

COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/docs /app/docs
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/api /app/services/api

WORKDIR /app/services/api

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health/live', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

CMD ["node", "dist/main.js"]
