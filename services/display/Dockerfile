FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/display/package.json services/display/package.json

RUN npm install --workspaces --include-workspace-root

COPY services/display services/display

WORKDIR /app/services/display
EXPOSE 3000
CMD ["npm", "run", "start"]
