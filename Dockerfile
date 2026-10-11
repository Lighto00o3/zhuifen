# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps apps
RUN npm run build -w @zhuifen/api && npm run build -w @zhuifen/web

FROM node:24.21.0-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@zhuifen/api --no-audit --no-fund
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]

FROM node:24.21.0-alpine AS web
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output /app/.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
