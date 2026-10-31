# UI typechecking uses a native TypeScript bridge that requires glibc.
FROM node:26-bookworm-slim AS builder

WORKDIR /app

ARG PRIVATE_NPM_HOST
ARG PRIVATE_NPM_TOKEN

RUN apt-get update && apt-get install --no-install-recommends --yes ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global corepack && corepack enable

COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY packages/client/package.json packages/client/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN yarn --immutable

COPY packages/client packages/client
COPY packages/api packages/api
COPY packages/ui packages/ui

RUN yarn build:client

RUN cd packages/ui && \
    npx generate-openapi-client && \
    yarn build

RUN yarn build:api

RUN yarn workspaces focus @zyno-io/uxrr-api --production

###

FROM node:26-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY --from=builder /app/packages/api .
COPY --from=builder /app/node_modules node_modules
COPY THIRD-PARTY-LICENSES.md LICENSE.md ./

ARG BUILD_VERSION=0.0.0
RUN npm version ${BUILD_VERSION} --allow-same-version

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".", "server:start"]
