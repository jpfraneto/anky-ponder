import { onchainTable, primaryKey, relations } from "ponder";

export const writer = onchainTable("writer", (t) => ({
  fid: t.integer().primaryKey(),
  currentSessionId: t.text(),
  totalSessions: t.integer().notNull().default(0),
}));

export const writerRelations = relations(writer, ({ many }) => ({
  sessions: many(session),
  ankyTokens: many(ankyToken),
}));

export const session = onchainTable("session", (t) => ({
  id: t.text().primaryKey(),
  fid: t.integer().notNull(),
  startTime: t.bigint().notNull(),
  endTime: t.bigint(),
  ipfsHash: t.text(),
  isAnky: t.boolean().default(false),
  isMinted: t.boolean().default(false),
}));

export const sessionRelations = relations(session, ({ one, many }) => ({
  writer: one(writer, {
    fields: [session.fid],
    references: [writer.fid],
  }),
  ankyToken: one(ankyToken, {
    fields: [session.id],
    references: [ankyToken.sessionId],
  }),
}));

export const ankyToken = onchainTable("anky_token", (t) => ({
  id: t.bigint().primaryKey(),
  owner: t.hex().notNull(),
  writingIpfsHash: t.text().notNull(),
  metadataIpfsHash: t.text().notNull(),
  sessionId: t.text().notNull(),
  mintedAt: t.bigint().notNull(),
  fid: t.integer().notNull(),
}));

export const ankyTokenRelations = relations(ankyToken, ({ one }) => ({
  writer: one(writer, {
    fields: [ankyToken.fid],
    references: [writer.fid],
  }),
  session: one(session, {
    fields: [ankyToken.sessionId],
    references: [session.id],
  }),
}));

export const validAnkyHash = onchainTable(
  "valid_anky_hash",
  (t) => ({
    fid: t.integer(),
    ipfsHash: t.text(),
    createdAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.fid, table.ipfsHash] }),
  })
);

export const validAnkyHashRelations = relations(validAnkyHash, ({ one }) => ({
  writer: one(writer, {
    fields: [validAnkyHash.fid],
    references: [writer.fid],
  }),
}));

export const leaderboard = onchainTable("leaderboard", (t) => ({
  fid: t.integer().primaryKey(),
  currentStreak: t.integer().notNull().default(0),
  maxStreak: t.integer().notNull().default(0),
  daysInAnkyverse: t.integer().notNull().default(0),
  lastUpdated: t.bigint().notNull(),
  totalSessions: t.integer().notNull().default(0),
  totalAnky: t.integer().notNull().default(0),
  totalAnkyMinted: t.integer().notNull().default(0),
}));

export const leaderboardRelations = relations(leaderboard, ({ one }) => ({
  writer: one(writer, {
    fields: [leaderboard.fid],
    references: [writer.fid],
  }),
}));
