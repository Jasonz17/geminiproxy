// src/services/chat.service.ts

import { ChatRepository } from "../database/repositories/chat.repository.ts";
import { MessageRepository } from "../database/repositories/message.repository.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts";

export class ChatService {
  private chatRepository: ChatRepository;
  private messageRepository: MessageRepository;

  constructor(client: Client) {
    this.chatRepository = new ChatRepository(client);
    this.messageRepository = new MessageRepository(client);
  }

  async createNewChat(): Promise<number> {
    return this.chatRepository.createChat();
  }

  async addMessageToChat(chatId: number, role: string, content: string): Promise<number> {
    return this.messageRepository.createMessage(chatId, role, content);
  }

  async getChatHistory(chatId: number): Promise<Message[]> {
    return this.messageRepository.getMessagesByChatId(chatId);
  }

  // Add other chat-related business logic here
}