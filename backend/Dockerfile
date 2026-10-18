FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm install && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Salary periods, due dates and daily figures follow the user's calendar (WIB).
ENV TZ=Asia/Jakarta
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
CMD ["node", "dist/server.js"]
