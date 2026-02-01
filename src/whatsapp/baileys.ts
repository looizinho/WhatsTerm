/**
 * WhatsApp ingestion using Baileys.
 *
 * Listens for incoming messages, extracts sender, text, timestamp and the raw payload.
 * Persists each conversation and message using Prisma without modifying the schema.
 * Non‑text messages are stored with a `null` text value and the full raw payload.
 * Each received message is also logged to the console.
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket } from "@whiskeysockets/baileys";
import { PrismaClient } from "@prisma/client";

// Initialise Prisma client (singleton for the process)
const prisma = new PrismaClient();

/**
 * Start the Baileys WhatsApp socket and attach a listener for incoming messages.
 * This function resolves when the socket is ready.
 */
export async function startWhatsApp(): Promise<WASocket> {
  // Use a folder to store auth credentials so that the session persists across restarts.
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  // Persist credentials on every update.
  socket.ev.on("creds.update", saveCreds);

  // Reconnect handling – simple auto‑restart on disconnect.
  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log("Attempting to reconnect to WhatsApp...");
        await startWhatsApp();
      } else {
        console.log("WhatsApp logged out – stop reconnecting.");
      }
    }
  });

  // Listen for new messages.
  socket.ev.on("messages.upsert", async (msgUpsert) => {
    const { messages, type } = msgUpsert;
    // Only handle fresh incoming messages.
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid) continue; // ignore system messages

        // Extract text if present (simple conversation messages)
        const text =
          msg.message?.conversation ??
          msg.message?.imageMessage?.caption ??
          msg.message?.videoMessage?.caption ??
          msg.message?.documentMessage?.caption ??
          null;

        const timestamp = msg.messageTimestamp
          ? new Date(msg.messageTimestamp * 1000)
          : new Date();

        // Log to console
        console.log(`[WhatsApp] From: ${remoteJid} Text: ${text ?? "<non-text>"} Timestamp: ${timestamp.toISOString()}`);

        // Upsert conversation based on the sender JID
        const conversation = await prisma.conversation.upsert({
          where: { from: remoteJid },
          update: {},
          create: { from: remoteJid },
        });

        // Persist the message
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: "incoming",
            text: typeof text === "string" ? text : null,
            rawPayload: JSON.stringify(msg),
          },
        });
      } catch (e) {
        console.error("Error processing incoming WhatsApp message:", e);
      }
    }
  });

  // Wait until the socket is fully opened before returning.
  await socket.waitForConnectionState("open");
  console.log("WhatsApp socket connected and listening for messages.");
  return socket;
}

