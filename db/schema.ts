import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    priority: text("priority", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    due: text("due").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("tasks_owner_updated_idx").on(table.ownerEmail, table.updatedAt),
    index("tasks_owner_due_idx").on(table.ownerEmail, table.due),
  ],
);

export type TaskRecord = typeof tasks.$inferSelect;
