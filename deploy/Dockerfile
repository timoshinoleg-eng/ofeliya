FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bot ./bot
USER node

# v0.4.x: score-server (zero-dep: node:http + crypto + fs) — API /api/*
# (score/top/daily/season/friends/ref + VK verified).
FROM node:22-alpine AS score
WORKDIR /app
ENV NODE_ENV=production
COPY server/index.mjs ./server/index.mjs
USER node

FROM nginx:alpine AS static
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
USER nginx
CMD ["nginx", "-c", "/etc/nginx/nginx.conf", "-g", "daemon off;"]
