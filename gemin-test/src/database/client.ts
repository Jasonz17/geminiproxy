import { Client } from "jsr:@db/postgres";

const databaseUrl = Deno.env.get("DATABASE_URL");

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable not set");
}

export const client = new Client(databaseUrl);

// Function to ensure necessary tables exist
async function ensureTablesExist() {
  try {
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables checked/created successfully");
  } catch (error) {
    console.error("Failed to ensure database tables exist:", error);
    throw error;
  }
}

// Optional: Add a function to connect to the database
export async function connectDatabase() {
  try {
    await client.connect();
    console.log("Database connected successfully");
    await ensureTablesExist(); // Ensure tables exist after connecting
  } catch (error) {
    console.error("Failed to connect to database:", error);
    throw error;
  }
}

// Optional: Add a function to disconnect from the database
export async function disconnectDatabase() {
  try {
    await client.end();
    console.log("Database disconnected successfully");
  } catch (error) {
    console.error("Failed to disconnect from database:", error);
  }
}