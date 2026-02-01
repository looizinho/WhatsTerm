import { startWhatsApp } from "./whatsapp/baileys.js";

// Start the WhatsApp ingestion service when the application runs.
async function main() {
  try {
    await startWhatsApp();
  } catch (err) {
    console.error("Failed to start WhatsApp service:", err);
    process.exit(1);
  }
}

main();
