FROM node:22-bookworm-slim
WORKDIR /opt/pi
COPY . .
RUN npm ci --ignore-scripts
ENV PI_AGENT_MODE=sec
ENTRYPOINT ["node", "packages/coding-agent/dist/bundle/cli.js", "--agent-mode", "sec"]
