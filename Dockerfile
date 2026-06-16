# zny-nomp portal image.
#
# The stratum-pool dependency pulls in the multi-hashing NAN native addon,
# which needs a C++20 toolchain (GCC 10+). node:24-bookworm ships GCC 12, and
# git is needed to fetch the #main git dependencies.
FROM node:24-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 git \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App sources (config.json / pool_configs / coins are mounted at runtime).
COPY . .

# Build the Vite + React SPA that the website worker serves from web/dist.
# (--legacy-peer-deps: react-i18next declares an optional TS ^5 peer; we use 6.)
RUN cd web \
    && npm ci --legacy-peer-deps --no-audit --no-fund \
    && npm run build

# Website (8080) and CLI listener (cliPort, 17117 in config_example.json).
# These must match your config; stratum ports are per-pool, publish them in
# docker-compose as needed.
EXPOSE 8080 17117

# Point Redis at the compose service by default; override per environment.
ENV REDIS_HOST=redis \
    REDIS_PORT=6379

CMD ["node", "src/init.ts"]
