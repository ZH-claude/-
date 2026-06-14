FROM node:22-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/

RUN npm ci --prefix apps/api \
  && npm ci --prefix apps/web

COPY . .

EXPOSE 3000 3001
