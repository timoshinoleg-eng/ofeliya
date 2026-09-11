FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
ARG VITE_MAX_BOT_NAME=""
ARG VITE_MAX_BOT_USERNAME=""
ARG VITE_TG_BOT_USERNAME=""
ARG VITE_DEVELOPER_BRAND=""
ARG VITE_DEVELOPER_LEGAL_NAME=""
ARG VITE_DEVELOPER_REGISTRATION=""
ARG VITE_DEVELOPER_ADDRESS=""
ARG VITE_SUPPORT_EMAIL=""
ARG VITE_SUPPORT_PHONE=""
ENV VITE_MAX_BOT_NAME=$VITE_MAX_BOT_NAME
ENV VITE_MAX_BOT_USERNAME=$VITE_MAX_BOT_USERNAME
ENV VITE_TG_BOT_USERNAME=$VITE_TG_BOT_USERNAME
ENV VITE_DEVELOPER_BRAND=$VITE_DEVELOPER_BRAND
ENV VITE_DEVELOPER_LEGAL_NAME=$VITE_DEVELOPER_LEGAL_NAME
ENV VITE_DEVELOPER_REGISTRATION=$VITE_DEVELOPER_REGISTRATION
ENV VITE_DEVELOPER_ADDRESS=$VITE_DEVELOPER_ADDRESS
ENV VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
ENV VITE_SUPPORT_PHONE=$VITE_SUPPORT_PHONE
RUN npm run build:max

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node bot ./bot
RUN mkdir -p /app/certs && chown node:node /app/certs
USER node

FROM node:22-alpine AS score
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /app/server/data && chown -R node:node /app/server
COPY --chown=node:node server/index.mjs ./server/index.mjs
USER node
CMD ["node", "server/index.mjs"]

FROM nginx:alpine AS static
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
USER nginx
CMD ["nginx", "-c", "/etc/nginx/nginx.conf", "-g", "daemon off;"]
