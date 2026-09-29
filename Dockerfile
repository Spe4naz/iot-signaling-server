# IoT signaling server — standalone image.
# The server has zero runtime dependencies (Node built-ins only), so no
# package install step is needed.

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY web/dist ./web/dist

RUN mkdir -p /app/data

EXPOSE 3100

CMD ["node", "src/index.js"]