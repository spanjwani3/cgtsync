import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // DIRECT_URL (port 5432) is preferred for migrations; falls back to DATABASE_URL (pooler).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
