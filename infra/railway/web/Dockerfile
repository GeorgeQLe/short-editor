# check=skip=SecretsUsedInArgOrEnv
# Vite publishable configuration is intentionally embedded in the public bundle.
FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
COPY packages/saas-contracts/package.json packages/saas-contracts/package.json
RUN npm ci --workspaces --include-workspace-root=false
COPY apps/web apps/web
COPY packages/saas-contracts packages/saas-contracts
RUN npm run build -w @siftcut/saas-contracts \
 && npm run build -w @siftcut/web

FROM caddy:2.10-alpine
COPY infra/railway/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 8080
