// src/database/repositories/message.repository.ts

import { Client } from "jsr:@db/postgres";
import { Message } from "../models/message.ts";

export class MessageRepository {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  // content 参数现在接收 Message['content'] 类型 (即 parts 数组)
  async createMessage(chatId: number, role: string, content: Message['content']): Promise<number> {
    const result = await this.client.queryObject<{ id: number }>(
      "INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3::jsonb) RETURNING id", // <-- 关键：强制类型转换为 jsonb
      [chatId, role, JSON.stringify(content)] // <-- 关键：将 content 数组序列化为 JSON 字符串
    );
    return result.rows[0].id;
  }

  async getMessagesByChatId(chatId: number): Promise<Message[]> {
    const result = await this.client.queryObject<Message>(
      "SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId]
    );
    // jsr:@db/postgres 会自动将 JSONB 数据反序列化为 JavaScript 对象/数组
    return result.rows;
  }

  // Add other message-related database operations here
}
