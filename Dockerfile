FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY src ./src

ENV PORT=3420
ENV PRINTER_HOST=192.168.1.200
ENV PRINTER_PORT=9100

EXPOSE 3420

CMD ["bun", "run", "src/index.ts"]
