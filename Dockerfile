# Dockerfile — Node 20 + system Chromium for Puppeteer/Lighthouse
FROM node:20-bullseye

# 1) System Chromium + common headless deps
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# 2) Let puppeteer/lighthouse use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# 3) Install deps first (better layer caching)
COPY package*.json ./
RUN npm config set engine-strict false \
 && npm ci --omit=dev || npm install --omit=dev

# 4) Copy app
COPY . .

# Railway will inject PORT; Express reads process.env.PORT
EXPOSE 3000

CMD ["node", "server/server.js"]
