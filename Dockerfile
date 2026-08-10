FROM node:22.23.2-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:22.23.2-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node

# Override this command per service. The Circle worker must remain private.
CMD ["npm", "--workspace", "@agentops-pmoa/api", "run", "start"]
