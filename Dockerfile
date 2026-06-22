FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S unirate && adduser -S unirate -G unirate
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --ignore-scripts --omit=dev
USER unirate
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["node", "dist/index.js"]
