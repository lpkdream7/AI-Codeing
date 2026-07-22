FROM node:22-bookworm-slim AS dependencies

ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
    && npm ci

FROM dependencies AS build

COPY app ./app
COPY selfhost ./selfhost
COPY public ./public
COPY postcss.config.mjs vite.selfhost.config.ts ./
RUN npm run build:selfhost

FROM node:22-bookworm-slim AS production

ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
    && npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build --chown=node:node /app/selfhost/dist ./selfhost/dist
COPY --chown=node:node selfhost/server.mjs ./selfhost/server.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "selfhost/server.mjs"]
