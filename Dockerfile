FROM node:24.22.1@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS builder

WORKDIR /app

ARG PRIVATE_NPM_HOST
ARG PRIVATE_NPM_TOKEN

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY packages/client/package.json packages/client/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN if [ -n "${PRIVATE_NPM_HOST}" ]; then \
      yarn config set --home 'npmScopes.zyno-io.npmRegistryServer' "https://${PRIVATE_NPM_HOST}/" && \
      yarn config set --home 'npmScopes.zyno-io.npmAuthToken' "${PRIVATE_NPM_TOKEN}"; \
    fi && \
    yarn --immutable

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

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
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
