import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const donations = pgTable("donations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }),
  amount: integer("amount"),
  createdAt: timestamp("created_at").defaultNow()
});