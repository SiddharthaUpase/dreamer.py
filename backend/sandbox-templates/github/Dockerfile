FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  curl \
  wget \
  netcat-openbsd \
  procps \
  python3 \
  python3-pip \
  python3-venv \
  # Chromium dependencies
  chromium \
  fonts-liberation \
  fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Install Playwright globally as a Node module + browser binary
RUN npm install -g playwright \
  && npx playwright install chromium --with-deps

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_PATH=/usr/local/lib/node_modules

WORKDIR /app

COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PATH="/usr/local/bin:$PATH"

ENTRYPOINT ["/entrypoint.sh"]
