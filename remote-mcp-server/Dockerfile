FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN npm prune --omit=dev
EXPOSE 3000
CMD ["node", "dist/index.js"]
