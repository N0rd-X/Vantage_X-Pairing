FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Create sessions directory
RUN mkdir -p sessions

# Expose port
EXPOSE 8000

# Start server
CMD ["npm", "start"]
