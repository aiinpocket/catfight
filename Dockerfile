# ---- build web ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @catfight/web

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# build tools are needed for better-sqlite3 native module only if no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev --workspace @catfight/server --workspace @catfight/engine \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY packages/engine ./packages/engine
COPY packages/server ./packages/server
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY data/questions ./data/questions
ENV PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/packages/web/dist \
    QUESTIONS_DIR=/app/data/questions
EXPOSE 8080
WORKDIR /app/packages/server
CMD ["npx", "tsx", "src/main.ts"]
