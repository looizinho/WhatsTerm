import { Db, MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB ?? "whatsterm";

if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is required.");
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(mongoDbName);

  return db;
}
