# Per-submission isolation is enforced by bubblewrap, never by this outer container.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap util-linux python3 g++ coreutils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown node:node /app/data
# Root bypasses RLIMIT_NPROC; the runner deliberately rejects root execution.
USER node
ENV PORT=3000
EXPOSE 3000
# Requires working nested unprivileged namespaces. Do not mount the Docker socket
# or add --privileged to work around blocked namespaces; execution fails closed.
CMD ["npm", "run", "start", "--", "-p", "3000"]
