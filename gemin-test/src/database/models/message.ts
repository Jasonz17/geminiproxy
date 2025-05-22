// src/database/models/message.ts

export interface Message {
  id?: number; // Optional ID for database primary key
  chatId: number; // Foreign key linking to the chat
  role: 'user' | 'model'; // Role of the message sender
  content: string; // Message content
  createdAt?: Date; // Optional timestamp
}