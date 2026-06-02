# syntax=docker/dockerfile:1.7

FROM node:24-slim AS base
WORKDIR /app
ENV YARN_CACHE_FOLDER=/root/.cache/yarn
RUN corepack enable

FROM base AS deps
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
RUN --mount=type=cache,id=apt-lists-${TARGETOS}-${TARGETARCH}${TARGETVARIANT},target=/var/lib/apt/lists,sharing=locked \
  --mount=type=cache,id=apt-cache-${TARGETOS}-${TARGETARCH}${TARGETVARIANT},target=/var/cache/apt,sharing=locked \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++
COPY --link package.json yarn.lock .yarnrc ./
RUN --mount=type=cache,id=yarn-${TARGETOS}-${TARGETARCH}${TARGETVARIANT},target=/root/.cache/yarn,sharing=locked \
  --mount=type=cache,id=npm-${TARGETOS}-${TARGETARCH}${TARGETVARIANT},target=/root/.npm,sharing=locked \
  --mount=type=cache,id=node-gyp-${TARGETOS}-${TARGETARCH}${TARGETVARIANT},target=/root/.cache/node-gyp,sharing=locked \
  yarn install --frozen-lockfile --non-interactive --prefer-offline

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --link tsconfig.json ./
COPY --link src ./src
RUN yarn build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/service-notification.sqlite
RUN mkdir -p /data && chown 1000:1000 /data
COPY --chown=1000:1000 --link package.json ./package.json
COPY --chown=1000:1000 --from=deps /app/node_modules ./node_modules
COPY --chown=1000:1000 --from=build /app/dist ./dist
EXPOSE 3000
VOLUME ["/data"]
USER 1000:1000
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/index.js"]
