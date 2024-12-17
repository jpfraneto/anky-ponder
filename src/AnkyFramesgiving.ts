import { eq, and, desc } from "drizzle-orm";
import { ponder } from "ponder:registry";
import { writer, session, ankyToken, validAnkyHash } from "ponder:schema";
import { getContract } from "viem";
import { AnkyFramesgivingAbi } from "../abis/AnkyFramesgivingAbi";

ponder.on("AnkyFramesgiving:SessionStarted", async ({ event, context }) => {
  console.log("SessionStarted event received");
  const { db } = context;
  const { fid, sessionId, startTime } = event.args;
  console.log(
    `Session starting for fid: ${fid}, sessionId: ${sessionId}, startTime: ${startTime}`
  );

  // Create new session first
  console.log("Creating new session...");
  await db.insert(session).values({
    id: sessionId,
    fid: Number(fid),
    startTime,
    isAnky: false,
    isMinted: false,
  });
  console.log("Session created successfully");

  // Create or update writer with new session
  console.log("Creating or updating writer...");
  await db
    .insert(writer)
    .values({
      fid: Number(fid),
      currentSessionId: sessionId,
      totalSessions: 1,
    })
    .onConflictDoUpdate((existing) => ({
      currentSessionId: sessionId,
      totalSessions: existing.totalSessions + 1,
    }));
  console.log("Writer updated successfully");
});

ponder.on(
  "AnkyFramesgiving:SessionEndedAbruptly",
  async ({ event, context }) => {
    console.log("SessionEndedAbruptly event received");
    const { db } = context;
    const { fid, sessionId } = event.args;
    console.log(
      `Session ending abruptly for fid: ${fid}, sessionId: ${sessionId}`
    );

    // Update session with end time
    console.log("Updating session end time...");
    await db
      .insert(session)
      .values({
        id: sessionId,
        fid: Number(fid),
        startTime: BigInt(0), // placeholder for abruptly ended sessions
        endTime: BigInt(event.block.timestamp),
        isAnky: false,
        isMinted: false,
      })
      .onConflictDoUpdate(() => ({
        endTime: BigInt(event.block.timestamp),
      }));
    console.log("Session end time updated");

    // Clear writer's current session
    console.log("Clearing writer's current session...");
    await db
      .update(writer, { fid: Number(fid) })
      .set({ currentSessionId: null });
    console.log("Writer's session cleared");
  }
);

ponder.on("AnkyFramesgiving:SessionEnded", async ({ event, context }) => {
  console.log("SessionEnded event received");
  const { db, client, contracts } = context;
  const { fid, isAnky } = event.args;

  console.log(`Session ending normally for fid: ${fid}, isAnky: ${isAnky}`);

  // Find the writer's current session
  console.log("Finding writer's current session...");
  const writerData = await db.find(writer, { fid: Number(fid) });
  if (!writerData?.currentSessionId) {
    console.log("No current session found for writer");
    return;
  }

  // fid is typically a BigInt from the event. If it's a number, convert to BigInt:
  const fidBigInt = typeof fid === "bigint" ? fid : BigInt(fid);

  console.log("Fetching completed session count from contract...");
  const completedSessionCount = await client.readContract({
    abi: contracts.AnkyFramesgiving.abi,
    address: contracts.AnkyFramesgiving.address,
    functionName: "getCompletedSessionCount",
    args: [fidBigInt],
  });
  console.log("completedSessionCount", completedSessionCount);

  // completedSessionCount is a bigint, so subtract using bigint arithmetic
  const lastIndex = completedSessionCount - 1n;
  console.log(`Fetching IPFS hash for last session index: ${lastIndex}...`);
  const ipfsHash = await client.readContract({
    abi: contracts.AnkyFramesgiving.abi,
    address: contracts.AnkyFramesgiving.address,
    functionName: "completedSessions",
    args: [fidBigInt, lastIndex],
  });
  console.log("The IPFS hash is", ipfsHash);
  console.log(`Found session: ${writerData.currentSessionId}`);

  // Update session in the database
  console.log("Updating session...");
  await db
    .insert(session)
    .values({
      id: writerData.currentSessionId,
      fid: Number(fid),
      startTime: BigInt(0), // If you have a real start time saved, use it
      endTime: BigInt(event.block.timestamp),
      ipfsHash,
      isAnky,
      isMinted: false,
    })
    .onConflictDoUpdate(() => ({
      endTime: BigInt(event.block.timestamp),
      ipfsHash,
      isAnky,
    }));
  console.log("Session updated successfully");

  // Clear writer's current session
  console.log("Clearing writer's current session...");
  await db.update(writer, { fid: Number(fid) }).set({ currentSessionId: null });
  console.log("Writer's session cleared");
});

ponder.on("AnkyFramesgiving:AnkyWritten", async ({ event, context }) => {
  console.log("AnkyWritten event received");
  const { db } = context;
  const { fid, sessionId, ipfsHash, writtenAt } = event.args;
  console.log(
    `Anky written for fid: ${fid}, sessionId: ${sessionId}, ipfsHash: ${ipfsHash}`
  );

  console.log("Inserting valid Anky hash...");
  await db.insert(validAnkyHash).values({
    fid: Number(fid),
    ipfsHash,
    createdAt: writtenAt,
  });
  console.log("Valid Anky hash inserted");

  // Also update the session to mark it as an Anky
  console.log("Updating session as Anky...");
  await db
    .insert(session)
    .values({
      id: sessionId,
      fid: Number(fid),
      startTime: BigInt(0), // Will be updated if exists
      ipfsHash,
      isAnky: true,
      isMinted: false,
    })
    .onConflictDoUpdate(() => ({
      ipfsHash,
      isAnky: true,
    }));
  console.log("Session updated as Anky");
});

ponder.on("AnkyFramesgiving:AnkyMinted", async ({ event, context }) => {
  console.log("AnkyMinted event received");
  const { db } = context;
  const { fid, ipfsHash: metadataIpfsHash, tokenId } = event.args;
  console.log(
    `Anky minting for fid: ${fid}, tokenId: ${tokenId}, metadataIpfsHash: ${metadataIpfsHash}`
  );

  // Find the latest unminted Anky session
  console.log("Finding latest unminted Anky session...");
  const sessions = await db.sql.query.session.findMany({
    where: (fields) =>
      and(
        eq(fields.fid, Number(fid)),
        eq(fields.isAnky, true),
        eq(fields.isMinted, false)
      ),
    orderBy: (fields) => [desc(fields.endTime)],
    limit: 1,
  });

  const sessionData = sessions[0];
  if (!sessionData?.ipfsHash) {
    console.log("No unminted Anky session found");
    return;
  }
  console.log(`Found unminted session with ipfsHash: ${sessionData.ipfsHash}`);

  // Create token record
  console.log("Creating token record...");
  await db.insert(ankyToken).values({
    id: tokenId,
    owner: event.transaction.from,
    writingIpfsHash: sessionData.ipfsHash,
    metadataIpfsHash,
    sessionId: sessionData.id,
    mintedAt: BigInt(event.block.timestamp),
    fid: Number(fid),
  });
  console.log("Token record created");

  // Mark session as minted
  console.log("Marking session as minted...");
  await db.update(session, { id: sessionData.id }).set({ isMinted: true });
  console.log("Session marked as minted");
});
