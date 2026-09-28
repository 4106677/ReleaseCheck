FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build:packages && npm run build -w @releasecheck/demo-site && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers HOME=/tmp
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/checks ./packages/checks
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/fixtures/demo-site ./fixtures/demo-site
COPY --from=build /app/package.json ./package.json
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/* /root/.npm
COPY docker/container-entry.mjs ./container-entry.mjs
USER 1000:1000
ENTRYPOINT ["node", "/app/container-entry.mjs"]
