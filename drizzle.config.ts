import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.AIRLOCK_DATABASE_URL ?? "file:./data/airlock.db",
  },
  strict: true,
  verbose: true,
});
