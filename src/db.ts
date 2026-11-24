import "dotenv/config";
import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME;

if (!uri || !databaseName) {
  throw new Error("Set MONGODB_URI and MONGODB_DB_NAME in the server .env file.");
}

export const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
});

const database = client.db(databaseName);

export async function connectToDatabase(): Promise<Db> {
  await client.connect();
  await database.command({ ping: 1 });
  return database;
}
