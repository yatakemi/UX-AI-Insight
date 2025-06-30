# Base image for Next.js
FROM node:22-slim AS base

# Install Playwright dependencies
# Playwrightのドキュメント (https://playwright.dev/docs/docker) を参照し、必要な依存関係をインストールします。
FROM base AS deps
RUN apt-get update && apt-get install -y     chromium     libnss3     libfontconfig1     libgbm1     libasound2     libatk-bridge2.0-0     libatk1.0-0     libcairo2     libcups2     libdbus-1-3     libdrm2     libegl1     libepoxy0     libgdk-pixbuf2.0-0     libgl1     libgstreamer-gl1.0-0     libgstreamer-plugins-base1.0-0     libgstreamer1.0-0     libgtk-3-0     libharfbuzz0b     libjpeg62-turbo     libnotify4     libopengl0     libpng16-16     libsecret-1-0     libsqlite3-0     libstdc++6     libwebpdemux2     libx11-6     libxcomposite1     libxdamage1     libxext6     libxfixes3     libxkbcommon0     libxrandr2     libxrender1     libxslt1.1     libxss1     libxtst6     libvulkan1     xdg-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Next.jsアプリケーションのビルド
FROM deps AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 本番環境用イメージ
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

# ビルドされたNext.jsアプリケーションをコピー
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Chromium実行ファイルのパスを設定
# ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
RUN npx -y playwright install --with-deps chromium

EXPOSE 3000
CMD ["npm", "start"]
