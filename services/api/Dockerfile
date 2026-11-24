# DressIt API / worker image. Build from the repository root:
#   docker build -f services/api/Dockerfile -t dressit-api .
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/stylist-engine/package.json packages/stylist-engine/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @dressit/api... --prod=false

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY services/api ./services/api
USER node
EXPOSE 3000
# Node ≥ 24 runs the TypeScript sources directly (type stripping): no build step.
CMD ["node", "services/api/src/server.ts"]
