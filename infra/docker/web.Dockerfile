# syntax=docker/dockerfile:1.7
# Static build of apps/web. In production deploy.sh copies /usr/share/nginx/html out of this image
# into a release folder served by the long-running edge Nginx (no Nginx restart on deploy).
# The image is also runnable on its own for a quick local preview.

FROM node:20-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY apps/web ./apps/web
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "web..."
RUN pnpm --filter web build

FROM nginx:1.27-alpine
ARG APP_VERSION=dev
LABEL org.opencontainers.image.revision=$APP_VERSION
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
