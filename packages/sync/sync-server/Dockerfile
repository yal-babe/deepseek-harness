FROM node:22-bookworm-slim

WORKDIR /app
ENV HOST=0.0.0.0
ENV PORT=8787
ENV STUDIO_SYNC_DB=/data/studio-sync.sqlite

COPY package.json ./
COPY lib ./lib

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "lib/index.js"]
