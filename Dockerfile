# Browser-App bauen (braucht die Entwicklungs-Pakete, die im fertigen Bild fehlen)
FROM node:22-alpine AS app
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY src/lib ./src/lib
RUN cd frontend && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY docs ./docs
COPY scripts ./scripts
COPY frontend/server.cjs frontend/package.json ./frontend/
COPY --from=app /app/frontend/dist ./frontend/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/launcher.js"]
