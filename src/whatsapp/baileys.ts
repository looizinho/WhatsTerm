/**
 * WhatsApp ingestion using Baileys.
 *
 * Listens for incoming messages, extracts sender, text, timestamp and the raw payload.
 * Persists each conversation and message using Prisma (mock for now).
 * Non-text messages are stored with `null` text and full raw payload.
 * Each received message is logged to the console.
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";

// Prisma mock for demonstration
const prisma = {
  conversation: {
    async upsert(_args: any) {
      return { id: 1 };
    },
  },
  message: {
    async create({ data }: any) {
      console.log("[Prisma mock] Message stored", data);
    },
  },
};

export async function startWhatsApp(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using WA Web v${version.join(".")} (isLatest: ${isLatest})`);

  const socket = makeWASocket({
    auth: state,
    version,
  });

  // Persist credentials
  socket.ev.on("creds.update", saveCreds);

  // Reconnect handling
  socket.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

      // 515 = restart required after successful pairing
      if (statusCode === 515) {
        console.log("🔄 Restart required after pairing. Restarting socket...");
        process.nextTick(() => {
          startWhatsApp().catch(console.error);
        });
        return;
      }

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("⚠️ Connection closed. Manual restart may be required.");
      } else {
        console.log("🚪 WhatsApp logged out – credentials invalid.");
      }
    }
  });

  // Handle QR code manually (Baileys >= 7.x)
  socket.ev.on("connection.update", ({ qr, connection }) => {
    if (qr) {
      console.log("📱 Escaneie este QR Code:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp conectado com sucesso.");
    }
  });

  // Listen for incoming messages
  socket.ev.on("messages.upsert", async (msgUpsert) => {
    if (msgUpsert.type !== "notify") return;

    for (const msg of msgUpsert.messages) {
      // Ignore messages sent by this same WhatsApp account (avoid loops)
      if (msg.key?.fromMe) continue;

      // Ignore empty/system messages
      if (!msg.message) continue;

      try {
        const remoteJid = msg.key?.remoteJid;
        if (!remoteJid) continue;

        const text =
          msg.message?.conversation ??
          msg.message?.imageMessage?.caption ??
          msg.message?.videoMessage?.caption ??
          msg.message?.documentMessage?.caption ??
          null;

        // Simple ping/pong command
        if (text === "/ping") {
          await socket.sendMessage(remoteJid, { text: "pong" });
          continue;
        }

        const timestamp = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000)
          : new Date();

        console.log(`[WhatsApp] From: ${remoteJid} Text: ${text ?? "<non-text>"} Timestamp: ${timestamp.toISOString()}`);

        const conversation = await prisma.conversation.upsert({
          where: { from: remoteJid },
          update: {},
          create: { from: remoteJid },
        });

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

  console.log("WhatsApp socket initialized. Waiting for events...");

  return socket;
}
