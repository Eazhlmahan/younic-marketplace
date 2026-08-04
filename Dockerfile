# Younic — production image (Express + SQLite + static web client)
FROM node:20-alpine

WORKDIR /app

# Build tools so better-sqlite3 compiles cleanly if no prebuilt binary matches.
RUN apk add --no-cache python3 make g++

# Install server deps first for layer caching.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Copy app source and static web client.
COPY server/src ./server/src
COPY web ./web

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/younic.db
ENV SEED_ON_START=true

# The /data mount point is provided by the platform's persistent volume (no VOLUME
# instruction — Railway/Render create the mount from the deploy config).
RUN mkdir -p /data

EXPOSE 4000

WORKDIR /app/server
CMD ["npm", "start"]