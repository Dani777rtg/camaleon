# --- Compilación ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY data ./data
RUN npm run build && npm prune --omit=dev

# --- Ejecución (local con docker compose o Cloud Run) ---
FROM node:22-slim
ENV NODE_ENV=production
# ffmpeg: convierte el audio de Gemini TTS a OGG/Opus para responder notas de voz.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
COPY public ./public
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
