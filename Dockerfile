FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV APP_BUILD_MARKER=2026-06-03-companies-auth-route

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html app.js styles.css server.mjs data.js ./
COPY normalized-store.mjs supabase-store.mjs progress-report-ai.mjs ./
COPY enrollment-history.json ./
COPY assets ./assets

EXPOSE 4173
CMD ["npm", "start"]
