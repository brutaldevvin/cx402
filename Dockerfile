# cx402 facilitator: serves the explainer UI and the x402 compliance API
# from one container, one public URL. Config comes from env (see DEPLOY.md).
FROM node:20-slim

# pin pnpm to match the committed lockfile
RUN npm install -g pnpm@9.15.4

WORKDIR /app
COPY . .

# install all deps including tsx (the facilitator runs TypeScript via tsx).
# --prod=false forces devDeps even when the platform sets NODE_ENV=production.
RUN pnpm install --frozen-lockfile --prod=false

ENV NODE_ENV=production
# demo deployment: accept unsigned policy from the keyless browser UI. this is
# the explicit demo-only flag, baked into the image so it does not depend on a
# host variable. production should set DEMO_ALLOW_UNSIGNED_POLICY=false and use
# signed mandates (see the README "Signed Mandate" section).
ENV DEMO_ALLOW_UNSIGNED_POLICY=true
# the host injects PORT at runtime; the facilitator reads process.env.PORT
EXPOSE 8080

CMD ["pnpm", "-C", "packages/facilitator", "start"]
