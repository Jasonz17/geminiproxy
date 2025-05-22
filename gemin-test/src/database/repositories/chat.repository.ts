// src/database/repositories/chat.repository.ts

import { Client } from "jsr:@db/postgres";
import { Chat } from "../models/chat.ts";

export class ChatRepository {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async createChat(): Promise<number> {
    const result = await this.client.queryObject<{ id: number }>(
      "INSERT INTO chats DEFAULT VALUES RETURNING id"
    );
    return result.rows[0].id;
  }

  async getChatById(chatId: number): Promise<Chat | undefined> {
    const result = await this.client.queryObject<Chat>(
      "SELECT id, created_at FROM chats WHERE id = $1",
      [chatId]
    );
    return result.rows[0];
  }

  // Add other chat-related database operations here
}