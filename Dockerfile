FROM oven/bun:1-slim

RUN mkdir /app && chown -R bun:bun /app

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80

USER bun

COPY --chown=bun:bun package.json bun.lock ./

RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun . .

EXPOSE 80

CMD [ "bun", "bin/server" ]
