FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
COPY . .
RUN npm install -g pnpm@latest-10 && pnpm install && pnpm build && \
    sed -i 's/crossorigin //g' dist/index.html

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

