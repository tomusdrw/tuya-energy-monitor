FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY assets ./assets
COPY public ./public
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/tuya
COPY bridge/requirements.txt /tmp/tuya-requirements.txt
RUN /opt/tuya/bin/pip install --no-cache-dir -r /tmp/tuya-requirements.txt \
    && /opt/tuya/bin/python -c 'from tuya_sharing.user import LoginControl'
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node bridge ./bridge
COPY --from=build --chown=node:node /app/shared/energy-policy.json ./shared/energy-policy.json
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PYTHON_BIN=/opt/tuya/bin/python HOST=0.0.0.0 PORT=3000
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
