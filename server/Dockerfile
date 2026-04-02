# Development Dockerfile for server (bind-mount friendly)
# Builds an image with dependencies installed and runs the dev script.

FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies
# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install all deps (including dev) so `npm run dev` works inside container
RUN npm ci --quiet

# Copy remaining files (optional - in dev we'll usually mount source over this)
COPY . .

# Expose server port
EXPOSE 5000

ENV NODE_ENV=development
ENV PORT=5000

# Default to running the dev script (uses tsx index-dev.ts)
CMD ["npm", "run", "dev"]
