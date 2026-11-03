FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node gateway/server.mjs gateway/server.mjs
COPY --chown=node:node api/_lib/util.js api/_lib/util.js
COPY --chown=node:node package.json package.json
COPY --chown=node:node public/media/welcome public/media/welcome
COPY --chown=node:node public/media/channel-offline public/media/channel-offline
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "gateway/server.mjs"]
