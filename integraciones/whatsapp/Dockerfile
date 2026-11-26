# Puente de WhatsApp para NÚCLEO ERP: Node + Chromium del sistema (whatsapp-web.js).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY servidor.mjs puente.mjs ./
RUN mkdir -p /session
VOLUME ["/session"]
EXPOSE 47620
CMD ["node", "puente.mjs"]
