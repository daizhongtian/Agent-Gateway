# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    AUTH_MODE=token \
    ALLOWED_PROJECT_ROOTS=/workspaces \
    API_KEY_STORE_PATH=/data/api-keys.json \
    USAGE_STORE_PATH=/data/usage-stats.json

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

RUN mkdir -p /workspaces /data && chown node:node /workspaces /data
USER node

VOLUME ["/data"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4310)+'/health').then(r=>{if(!r.ok)throw Error(r.status)}).catch(()=>process.exit(1))"

CMD ["node", "src/server/standalone.js"]
