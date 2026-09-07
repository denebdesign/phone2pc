FROM node:20-slim

WORKDIR /app

# 의존성만 먼저 넣어서 소스만 바뀔 때 이 레이어를 캐시로 재사용한다
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
