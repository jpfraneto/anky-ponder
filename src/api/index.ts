/**
 * @file src/api/index.ts
 * @description Type-safe API routes for the Anky Framesgiving application using Ponder
 */

import { Context, ponder } from "ponder:registry";
import {
  writer as WriterTable,
  session as SessionTable,
  ankyToken as AnkyTokenTable,
  validAnkyHash as ValidAnkyHashTable,
  leaderboard as LeaderboardTable,
} from "ponder:schema";
import { eq, desc, and, gt, lt, sql } from "ponder";

// Constants
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const ANKYVERSE_START = new Date("2023-08-10T05:00:00-04:00").getTime();

// Utility function to serialize BigInt values
const serializeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return obj;
};

// Utility function to parse pagination params
const getPaginationParams = (c: any) => {
  const cursor = c.req.query("cursor") || null;
  const limit = Math.min(
    parseInt(c.req.query("limit") || DEFAULT_PAGE_SIZE.toString()),
    MAX_PAGE_SIZE
  );
  const direction = c.req.query("direction") === "prev" ? "prev" : "next";
  return { cursor, limit, direction };
};

// Writers endpoints
ponder.get("/writers", async (c) => {
  const { cursor, limit, direction } = getPaginationParams(c);

  const writers = await c.db.query.writer.findMany({
    limit: limit + 1,
    with: { sessions: true, ankyTokens: true },
    orderBy: (fields) => [desc(fields.fid)],
    where: cursor
      ? (fields) =>
          direction === "next"
            ? lt(fields.fid, parseInt(cursor))
            : gt(fields.fid, parseInt(cursor))
      : undefined,
  });

  const hasMore = writers.length > limit;
  const items = writers.slice(0, limit);

  return c.json(
    serializeBigInt({
      items,
      nextCursor: hasMore ? items[items.length - 1]?.fid?.toString() : null,
      prevCursor: cursor ? writers[0]?.fid?.toString() : null,
    })
  );
});

// Leaderboard endpoints
ponder.get("/leaderboard", async (c) => {
  try {
    const leaderboard = await c.db.query.leaderboard.findMany({
      orderBy: (fields) => [desc(fields.currentStreak)],
      limit: 8,
      with: { writer: true },
    });

    return c.json(serializeBigInt(leaderboard));
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    throw error;
  }
});

type Session = {
  startTime: string;
  isAnky: boolean;
};

type Stats = {
  currentStreak: number;
  maxStreak: number;
  daysInAnkyverse: number;
};

const calculateWriterStats = (sessions: any[]): Stats => {
  // First filter for only isAnky sessions and sort them
  const ankySessions = sessions
    .filter((session) => session.isAnky)
    .sort((a, b) => Number(a.startTime) - Number(b.startTime));

  if (!ankySessions.length) {
    return {
      currentStreak: 0,
      maxStreak: 0,
      daysInAnkyverse: Math.floor(
        (Date.now() / 1000 - ANKYVERSE_START) / 86400
      ),
    };
  }

  // Get unique days
  const days = [
    ...new Set(
      ankySessions.map(
        (session) =>
          new Date(Number(session.startTime) * 1000).toISOString().split("T")[0]
      )
    ),
  ].sort();

  let currentStreak = 0;
  let maxStreak = 0;
  let tempStreak = 1;

  // Calculate streaks
  for (let i = 1; i < days.length; i++) {
    const diff = Math.floor(
      (new Date(days[i]!).getTime() - new Date(days[i - 1]!).getTime()) /
        86400000
    );

    if (diff === 1) {
      tempStreak++;
    } else {
      maxStreak = Math.max(maxStreak, tempStreak);
      tempStreak = 1;
    }
  }

  maxStreak = Math.max(maxStreak, tempStreak);

  // Calculate current streak
  const lastDay = new Date(days[days.length - 1]!);
  const today = new Date();
  const diffToToday = Math.floor(
    (today.getTime() - lastDay.getTime()) / 86400000
  );

  currentStreak = diffToToday <= 1 ? tempStreak : 0;

  return {
    currentStreak,
    maxStreak,
    daysInAnkyverse: Math.floor((Date.now() / 1000 - ANKYVERSE_START) / 86400),
  };
};

ponder.get("/leaderboard-update", async (c) => {
  try {
    const writers = await c.db.query.writer.findMany({
      with: { sessions: true },
    });

    const stats = writers
      .map((writer) => ({
        fid: writer.fid,
        ...calculateWriterStats(writer.sessions),
      }))
      .sort((a, b) => b.currentStreak - a.currentStreak)
      .slice(0, 8);

    // Clear and update leaderboard
    await c.db.delete(LeaderboardTable).where(sql`1=1`);

    for (const stat of stats) {
      await c.db.insert(LeaderboardTable).values({
        ...stat,
        lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
      });
    }

    return c.json({ success: true, leaderboard: stats });
  } catch (error) {
    console.error("Error updating leaderboard:", error);
    return c.json({ success: false, error: String(error) });
  }
});
// Sessions endpoints
ponder.get("/sessions", async (c) => {
  const { cursor, limit, direction } = getPaginationParams(c);

  const sessions = await c.db.query.session.findMany({
    limit: limit + 1,
    with: { writer: true, ankyToken: true },
    orderBy: (fields) => [desc(fields.startTime)],
    where: cursor
      ? (fields) =>
          direction === "next"
            ? lt(fields.startTime, BigInt(cursor))
            : gt(fields.startTime, BigInt(cursor))
      : undefined,
  });

  const hasMore = sessions.length > limit;
  const items = sessions.slice(0, limit);

  return c.json(
    serializeBigInt({
      items,
      nextCursor: hasMore
        ? items[items.length - 1]?.startTime?.toString()
        : null,
      prevCursor: cursor ? sessions[0]?.startTime?.toString() : null,
    })
  );
});

// Writer's sessions
ponder.get("/writer/:fid/sessions", async (c) => {
  const fid = parseInt(c.req.param("fid") || "0");
  const { cursor, limit, direction } = getPaginationParams(c);

  const sessions = await c.db.query.session.findMany({
    limit: limit + 1,
    with: { ankyToken: true },
    orderBy: (fields) => [desc(fields.startTime)],
    where: (fields) =>
      cursor
        ? and(
            eq(fields.fid, fid),
            direction === "next"
              ? lt(fields.startTime, BigInt(cursor))
              : gt(fields.startTime, BigInt(cursor))
          )
        : eq(fields.fid, fid),
  });

  const hasMore = sessions.length > limit;
  const items = sessions.slice(0, limit);

  return c.json(
    serializeBigInt({
      items,
      nextCursor: hasMore
        ? items[items.length - 1]?.startTime?.toString()
        : null,
      prevCursor: cursor ? sessions[0]?.startTime?.toString() : null,
    })
  );
});

// Tokens endpoints
ponder.get("/tokens", async (c) => {
  const { cursor, limit, direction } = getPaginationParams(c);

  const tokens = await c.db.query.ankyToken.findMany({
    limit: limit + 1,
    with: { writer: true, session: true },
    orderBy: (fields) => [desc(fields.mintedAt)],
    where: cursor
      ? (fields) =>
          direction === "next"
            ? lt(fields.mintedAt, BigInt(cursor))
            : gt(fields.mintedAt, BigInt(cursor))
      : undefined,
  });

  const hasMore = tokens.length > limit;
  const items = tokens.slice(0, limit);

  return c.json(
    serializeBigInt({
      items,
      nextCursor: hasMore
        ? items[items.length - 1]?.mintedAt?.toString()
        : null,
      prevCursor: cursor ? tokens[0]?.mintedAt?.toString() : null,
    })
  );
});

// Single item endpoints
ponder.get("/writer/:fid", async (c) => {
  const fid = parseInt(c.req.param("fid") || "0");

  const writer = await c.db.query.writer.findFirst({
    where: (fields) => eq(fields.fid, fid),
    with: { sessions: true, ankyTokens: true },
  });

  if (!writer) return c.json({ error: "Writer not found" }, 404);

  const stats = calculateWriterStats(writer.sessions);
  return c.json(serializeBigInt({ ...writer, ...stats }));
});

ponder.get("/token/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Token ID required" }, 400);

  const token = await c.db.query.ankyToken.findFirst({
    where: (fields) => eq(fields.id, BigInt(id)),
    with: { writer: true, session: true },
  });

  if (!token) return c.json({ error: "Token not found" }, 404);
  return c.json(serializeBigInt(token));
});

// Stats endpoint
ponder.get("/stats", async (c) => {
  const [writerCount, sessionCount, tokenCount, ankyCount] = await Promise.all([
    c.db.select({ count: sql`count(*)` }).from(WriterTable),
    c.db.select({ count: sql`count(*)` }).from(SessionTable),
    c.db.select({ count: sql`count(*)` }).from(AnkyTokenTable),
    c.db
      .select({ count: sql`count(*)` })
      .from(SessionTable)
      .where(eq(SessionTable.isAnky, true)),
  ]);

  return c.json(
    serializeBigInt({
      totalWriters: Number(writerCount[0]?.count),
      totalSessions: Number(sessionCount[0]?.count),
      totalTokens: Number(tokenCount[0]?.count),
      totalAnkys: Number(ankyCount[0]?.count),
    })
  );
});

export default ponder;
