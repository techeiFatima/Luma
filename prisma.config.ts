import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moves the datasource URL out of schema.prisma. The CLI reads it
 * from here; the runtime client builds its own adapter in src/lib/db.ts.
 */
const url = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "luma.db")}`;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url,
  },
});
