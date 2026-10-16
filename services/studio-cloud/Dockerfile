# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /service
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --workspaces=false --strict-ssl=true
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --workspaces=false
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /service
COPY --chown=node:node --from=build /service/node_modules ./node_modules
COPY --chown=node:node --from=build /service/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
RUN mkdir -p /service/data && chown node:node /service/data
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8788/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist/main.js"]
