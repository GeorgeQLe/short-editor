FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
COPY packages/saas-contracts/package.json packages/saas-contracts/package.json
RUN npm ci --workspaces --include-workspace-root=false
COPY apps/api apps/api
COPY packages/infrastructure packages/infrastructure
COPY packages/saas-contracts packages/saas-contracts
RUN npm run build -w @siftcut/saas-contracts \
 && npm run build -w @siftcut/infrastructure \
 && npm run build -w @siftcut/api

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
