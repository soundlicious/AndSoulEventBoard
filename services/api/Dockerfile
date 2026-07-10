FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/api/package.json services/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --workspaces --include-workspace-root

COPY services/api services/api
COPY packages/shared packages/shared

WORKDIR /app/services/api
EXPOSE 8080
CMD ["npm", "run", "start"]
