// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts";
import { Modality } from "npm:@google/genai"; // 修正 import 路径和类名

let dbClient: Client | null = null;
const decoder = new TextDecoder();

export async function initializeDatabaseClient(client: Client) {
  dbClient = client;
}

export async function handleChatRequest(req: Request): Promise<Response> {
  if (!dbClient) {
    console.error("数据库客户端未初始化！");
    return new Response("服务器错误: 数据库客户端未初始化", { status: 500 });
  }

  const chatService = new ChatService(dbClient);

  if (req.method === "POST") {
    try {
      const formData = await req.formData();
      const chatIdParam = formData.get('chatId');
      const model = formData.get('model')?.toString();
      const apikey = formData.get('apikey')?.toString();
      const messageText = formData.get('input')?.toString() || '';
      const streamEnabled = formData.get('stream') === 'true';

      if (!model || !apikey) {
        return new Response("请求体中缺少模型或API密钥", { status: 400 });
      }

      let currentChatId: number;
      if (chatIdParam) {
        currentChatId = parseInt(chatIdParam as string, 10);
        const existingChat = await chatService.chatRepository.getChatById(currentChatId);
        if (!existingChat) {
          console.warn(`收到的chatId: ${chatIdParam} 不存在，创建新聊天。`);
          currentChatId = await chatService.createNewChat();
        }
      } else {
        currentChatId = await chatService.createNewChat();
        console.log(`已创建新聊天，ID: ${currentChatId}`);
      }

      // 解析用户当前输入（文本和文件）为 AI 模型所需的 content parts
      // 传递 apikey 给 parseFormDataToContents 用于内部的文件上传服务初始化
      const userContentParts = await parseFormDataToContents(formData, messageText, apikey);
      
      if (userContentParts.length === 0) {
        return new Response("没有提供文本或文件", { status: 400 });
      }

      // 将用户消息（包括文件部分）保存到数据库
      await chatService.addMessageToChat(currentChatId, "user", userContentParts);
      console.log(`用户消息已保存到数据库 (Chat ID: ${currentChatId}):`, userContentParts);

      // 从数据库中检索完整的聊天历史
      const historyMessages = await chatService.getChatHistory(currentChatId);

      // 构建传递给 AI 模型的完整 'contents' 数组
      const fullAiContents: Array<any> = [];
      for (const msg of historyMessages) {
          // msg.content 现在已经是 parts 数组，直接使用
          fullAiContents.push({
              role: msg.role,
              parts: msg.content // 数据库中存的就是 parts 数组，直接用
          });
      }

      const responseModalities: Modality[] = [];
      if (model === 'gemini-2.0-flash-preview-image-generation') {
        responseModalities.push(Modality.TEXT, Modality.IMAGE);
      }

      // 调用 AI service 之前，再次检查 apikey 是否存在
      if (!apikey) {
        return new Response("API Key is missing for AI service call.", { status: 400 });
      }

      const aiResponse = await processAIRequest(model, apikey, fullAiContents, streamEnabled, responseModalities);

      if (streamEnabled) {
        const aiMessageParts: any[] = [];
        const encoder = new TextEncoder();
        const responseBody = new ReadableStream({
          async start(controller) {
            const reader = (aiResponse as ReadableStream<Uint8Array>).getReader();
            let buffer = '';
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const parts = JSON.parse(line);
                      aiMessageParts.push(...parts);
                      controller.enqueue(encoder.encode(line + '\n'));
                    } catch (e) {
                      console.error('解析AI流式响应JSON块时出错:', e);
                    }
                  }
                }
              }
              if (buffer.trim()) {
                try {
                  const parts = JSON.parse(buffer);
                  aiMessageParts.push(...parts);
                  controller.enqueue(encoder.encode(buffer + '\n'));
                } catch (e) {
                  console.error('解析AI流式响应最终缓冲时出错:', e);
                }
              }
            } catch (error) {
              console.error("AI流式响应处理过程中发生错误:", error);
              controller.error(error);
            } finally {
              controller.close();
              // 在整个流接收完毕后保存 AI 响应
              await chatService.addMessageToChat(currentChatId, "model", aiMessageParts);
              console.log(`AI流式响应已保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);
            }
          }
        });

        return new Response(responseBody, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Chat-ID': currentChatId.toString(),
          }
        });

      } else {
        const aiMessageParts = aiResponse as Message['content']; // 现在期望 Array<any>

        // 保存 AI 响应到数据库
        await chatService.addMessageToChat(currentChatId, "model", aiMessageParts);
        console.log(`AI非流式响应已保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);

        return new Response(JSON.stringify({ chatId: currentChatId, response: aiMessageParts }), {
          headers: { "Content-Type": "application/json" },
        });
      }

    } catch (error) {
      console.error("处理聊天请求时发生错误:", error);
      return new Response(`处理聊天消息时出错: ${error.message}`, { status: 500 });
    }
  }

  return new Response("未找到", { status: 404 });
}
