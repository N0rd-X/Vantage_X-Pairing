FROM node:20-alpine

WORKDIR /app

# package-lock.json is required for reproducible builds with npm ci
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

# Create sessions directory
RUN mkdir -p sessions

# Expose port
EXPOSE 8000

# Health check — orchestrators use this to know the service is actually ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8000/ || exit 1

# Start server
CMD ["npm", "start"]