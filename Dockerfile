# Dockerfile — Node 20 + Chromium (Puppeteer/Lighthouse OK)
FROM node:20-bullseye

# System Chromium for puppeteer & lighthouse
RUN apt-get update && apt-get install -y chromium \
 && rm -rf /var/lib/apt/lists/*

# Env for puppeteer/lighthouse to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# COPY only manifests first (better layer caching)
COPY package*.json ./

# Make npm tolerant of engine fields and do a resilient install
RUN npm config set engine-strict false \
 && npm ci --omit=dev || npm install --omit=dev

# Now copy the rest of the app
COPY . .

EXPOSE 3000

# If your entry is server/server.js:
CMD ["node", "server/server.js"]
# If your entry is root server.js, use:
# CMD ["node", "server.js"]
