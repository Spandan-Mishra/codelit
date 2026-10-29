# Codelit runs candidate Python and C++ locally, so it ships as a
# container (Node + python3 + g++), not a serverless function.
# Full bookworm (not slim): python3 and g++ come preinstalled, so the
# build needs no apt access.
FROM node:22-bookworm

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000"]
