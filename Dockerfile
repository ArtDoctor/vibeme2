# syntax=docker/dockerfile:1
# Multi-stage: Vite client → dist/, Rust binary serves static + WebSocket /ws.

FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY tsconfig.json vite.config.ts index.html VERSION ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM rust:1.85-bookworm AS rust
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./server/
COPY server/src ./server/src
WORKDIR /app/server
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=frontend /app/dist ./dist
COPY --from=rust /app/server/target/release/vibeme2-server /app/vibeme2-server
ENV PORT=8080
ENV STATIC_ROOT=/app/dist
EXPOSE 8080
CMD ["/app/vibeme2-server"]
