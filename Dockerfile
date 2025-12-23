# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.16.0
FROM node:${NODE_VERSION}-slim AS base

# LABEL fly_launch_runtime="Next.js"

# Next.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
# RUN apt-get update -qq && \
#     apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci --include=dev
# RUN npm ci

# Copy application code
COPY . .

# Build application
RUN npm run build

# Note: We don't prune dev dependencies because some are needed at build time
# and Next.js needs them during the build process


# Final stage for app image
FROM base

# Copy only the necessary files for running the app
COPY --from=build /app/.next /app/.next
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/public /app/public
COPY --from=build /app/next.config.ts /app/next.config.ts
COPY --from=build /app/src/scripts /app/src/scripts
COPY --from=build /app/src/db /app/src/db
COPY --from=build /app/src/types /app/src/types
COPY --from=build /app/tsconfig.json /app/tsconfig.json

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]
