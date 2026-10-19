FROM node:24 AS frontend-build
WORKDIR /app
COPY . .
RUN node scripts/build-pages.mjs

FROM node:24 AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/tsconfig.json server/nest-cli.json ./
COPY server/src ./src
COPY core/finance/rules.js core/finance/rules.d.ts /app/core/finance/
COPY core/loyalty/price-condition.js core/loyalty/price-condition.d.ts /app/core/loyalty/
RUN npm run build

FROM node:24 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma
COPY server/scripts ./scripts
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/core /app/core
COPY --from=frontend-build /app/_site /app/site
EXPOSE 3000
CMD ["sh", "-c", "node scripts/wait-for-database.mjs && node scripts/recover-failed-prelaunch-migration.mjs; prelaunch_status=$?; if [ \"$prelaunch_status\" -eq 42 ]; then npx prisma migrate resolve --rolled-back 20260922075500_prelaunch_hard_delete_clean_start; elif [ \"$prelaunch_status\" -eq 43 ]; then npx prisma migrate resolve --rolled-back 20260930143000_remove_first_run_runtime; elif [ \"$prelaunch_status\" -eq 44 ]; then npx prisma migrate resolve --rolled-back 20261008214500_deposit_benefit_balances; elif [ \"$prelaunch_status\" -eq 45 ]; then npx prisma migrate resolve --rolled-back 20261009014500_loyalty_price_percent_guard; elif [ \"$prelaunch_status\" -ne 0 ]; then exit \"$prelaunch_status\"; fi; node scripts/reset-test-account-before-global-migration.mjs; reset_status=$?; if [ \"$reset_status\" -eq 42 ]; then npx prisma migrate resolve --rolled-back 20260921130000_global_account_identity; elif [ \"$reset_status\" -ne 0 ]; then exit \"$reset_status\"; fi; npx prisma migrate deploy && npm run seed:owner && node dist/main.js"]
