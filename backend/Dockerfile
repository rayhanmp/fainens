FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* tsconfig.json ./
COPY src ./src
RUN corepack enable && pnpm install && pnpm build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --prod
CMD ["node", "dist/server.js"]

