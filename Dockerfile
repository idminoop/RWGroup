ARG NODE_IMAGE=node:22.22.0-alpine3.23

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV RW_DATA_DIR=/app/server/data
ENV RW_UPLOADS_DIR=/app/server/uploads

# Keep full node_modules because runtime uses tsx to execute TypeScript server files.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/shared ./shared
COPY --from=builder --chown=node:node /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN install -d -o node -g node /app/server/data /app/server/uploads \
  && chmod +x /app/docker-entrypoint.sh

USER node

EXPOSE 3001

CMD ["./docker-entrypoint.sh"]
