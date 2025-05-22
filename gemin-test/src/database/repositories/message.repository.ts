// src/database/repositories/message.repository.ts

import { Client } from "jsr:@db/postgres";
import { Message } from "../models/message.ts";

export class MessageRepository {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async createMessage(chatId: number, role: string, content: string): Promise<number> {
    const result = await this.client.queryObject<{ id: number }>(
      "INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING id",
      [chatId, role, content]
    );
    return result.rows[0].id;
  }

  async getMessagesByChatId(chatId: number): Promise<Message[]> {
    const result = await this.client.queryObject<Message>(
      "SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId]
    );
    return result.rows;
  }

  // Add other message-related database operations here
}