FROM oven/bun:latest

WORKDIR /app

# Copy package files plus the patches/ directory. The patches dir
# must exist before `bun install` because package.json references
# patchedDependencies which point at patch files inside it. Without
# this, bun install fails with "Couldn't find patch file".
COPY package.json bun.lock* ./
COPY patches/ ./patches/

# Install dependencies (including dev dependencies for build).
# Patches in patches/ are applied automatically during install.
RUN bun install

# Copy the application code
COPY . .

# Build the application
# RUN bun run build

# Expose the port (porter.yaml maps service port → 80)
EXPOSE 80

# Run the app
CMD ["bun", "start"]