// src/database/models/message.ts

export interface Message {
  id?: number;
  chatId: number;
  role: 'user' | 'model';
  // content 现在是一个数组，包含文本和内联数据部分
  content: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  createdAt?: Date;
}
