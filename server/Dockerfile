FROM node:20-alpine

WORKDIR /app

# Reproducible install from the committed lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
