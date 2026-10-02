# ── Stage 1: Build Frontend ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Install Production Dependencies ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# Exclude devDependencies for a lightweight production image
RUN npm ci --omit=dev

# ── Stage 3: Production Runner ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3201

# Copy built frontend assets, production dependencies, and server backend
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json

# Persistent data mount directory for SQLite DB and file uploads
RUN mkdir -p /data
VOLUME /data

EXPOSE 3201
CMD ["npm", "start"]
