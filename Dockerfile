# ==========================================
# Stage 1: Build & Dependency Stage
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Tell Puppeteer to store the browser in a predictable path inside the build stage
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Install all dependencies (including devDependencies to compile TypeScript)
# Puppeteer will download exactly ONE official Chrome for Testing binary here (~170 MB compressed)
COPY package*.json ./
RUN npm ci

# Copy TypeScript configuration and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep only production node_modules
RUN npm prune --omit=dev && npm cache clean --force

# ==========================================
# Stage 2: Lean Production Runtime (~700 MB vs 1.6+ GB)
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Configure environment variables
ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer \
    PORT=3000

# Install ONLY the minimal OS runtime shared libraries required by headless Chrome.
# CRITICAL: We DO NOT install 'chromium' via apt! 
# Debian's chromium package pulls in llvm-15-runtime and mesa-dri (~850 MB of compiler/3D bloat).
# Chrome for Testing already contains the browser engine; it only needs these base .so libraries.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy production node_modules, compiled dist, and static web assets from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node public/ ./public/

# Copy the single Chrome for Testing binary downloaded in Stage 1 to node user's home
COPY --from=builder --chown=node:node /app/.cache/puppeteer /home/node/.cache/puppeteer

# Run as non-privileged system user for container security
USER node

# Expose microservice HTTP port
EXPOSE 3000

# Container liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/healthz || exit 1

# Start microservice server and BullMQ background worker fleet
CMD ["node", "dist/index.js"]
