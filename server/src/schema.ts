import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One row per feed refresh. `payload` is a JSON array of normalized items
// for that feed; readers take the latest row per feed_key.
export const feedSnapshots = sqliteTable("feed_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedKey: text("feed_key").notNull(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// User bookmarks: a model, tool, space, article or paper the user chose
// to keep. Created only by an explicit tap in the UI.
export const favorites = sqliteTable("favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", {
    enum: ["model", "tool", "space", "news", "paper"],
  }).notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  subtitle: text("subtitle"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
