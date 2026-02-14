FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV RW_DATA_DIR=/app/server/data
ENV RW_UPLOADS_DIR=/app/server/uploads

# Keep full node_modules because runtime uses tsx to execute TypeScript server files.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared

RUN mkdir -p /app/server/data /app/server/uploads

EXPOSE 3000

CMD ["node", "--import", "tsx", "server/server.ts"]
