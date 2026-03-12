FROM node:22-alpine

RUN apk update && apk add --no-cache \
  git \
  curl \
  netcat-openbsd \
  && rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

# Create Next.js project with TypeScript, Tailwind, App Router, and Turbopack
RUN mkdir -p /app \
  && npx create-next-app@latest /app --use-npm --typescript --eslint --tailwind --src-dir --app --import-alias "@/*" --no-git --yes \
  && cd /app && npm install --save @next/swc-linux-x64-musl

COPY ./next.config.ts /app/next.config.ts

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Add npm global modules to PATH
ENV PATH="/usr/local/bin:$PATH"

ENTRYPOINT ["/entrypoint.sh"]
