# Stage 1: Build the application
FROM node:20-alpine as build

WORKDIR /app

# Copy package files first to leverage caching
COPY package*.json ./

# Install dependencies strictly from lockfile
RUN npm ci

# Copy source code
COPY . .

# Vite embeds these values in the static frontend at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GEMINI_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY

# Build the application
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from builder stage
COPY --from=build /app/dist /usr/share/nginx/html

# Serve the SPA and PWA assets. nginx.conf is reserved for the local API gateway.
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf

# Healthcheck for Docker and Coolify
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
