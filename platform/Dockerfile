FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json *.mjs ./
COPY web ./web
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
