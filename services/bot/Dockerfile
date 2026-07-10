FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/bot/package.json services/bot/package.json

RUN npm install --workspaces --include-workspace-root

COPY services/bot services/bot

WORKDIR /app/services/bot
CMD ["npm", "run", "start"]
