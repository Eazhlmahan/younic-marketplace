# Younic — production image (Express + SQLite + static web client)
FROM node:20-alpine

WORKDIR /app

# Install (server deps) first for layer caching
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev || npm ci

# Copy source
COPY server/src ./server/src
COPY web ./web

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/younic.db
ENV SEED_ON_START=true

# Persistent volume for the SQLite database
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4000

WORKDIR /app/server
CMD ["npm", "start"]