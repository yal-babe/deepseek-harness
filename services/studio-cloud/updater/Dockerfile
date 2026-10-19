FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-compose util-linux
WORKDIR /updater
COPY server.mjs ./server.mjs
# This opt-in executor needs the Docker socket; the application container does not.
CMD ["node", "server.mjs"]
