# PariAI AI Judge - Phala CVM image.
#
# Build from repo root:
#   docker build -f services/ai-judge/Dockerfile -t pariai-ai-judge:latest .
#
# Managed signer smoke:
#   docker run --rm -p 8090:8090 \
#     -e JUDGE_MODE=server \
#     -e JUDGE_PRIVATE_KEY=0x... \
#     -e ANTHROPIC_API_KEY=sk-ant-... \
#     pariai-ai-judge:latest
#
# Phala deploy: push to your registry, then deploy via Phala Cloud UI with the
# image tag pinned by digest. The dstack socket is auto-mounted at
# /var/run/dstack.sock inside the CVM. Use JUDGE_MODE=phala.

FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ai-judge/package.json ./services/ai-judge/

RUN corepack enable && corepack prepare pnpm@10 --activate \
  && pnpm install --filter @pariai/ai-judge... --frozen-lockfile --prod

COPY services/ai-judge/ ./services/ai-judge/

ENV NODE_ENV=production
ENV JUDGE_PORT=8090
ENV JUDGE_HOST=0.0.0.0
ENV JUDGE_MODE=phala
EXPOSE 8090

WORKDIR /app/services/ai-judge
CMD ["node", "--import", "tsx/esm", "src/server.ts"]
