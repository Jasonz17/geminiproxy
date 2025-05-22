// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts";
import { Content, Part } from "npm:@google/genai";

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
          currentChatId = await chatService.createNewChat();
        }
      } else {
        currentChatId = await chatService.createNewChat();
      }

      const userContentParts: Part[] = await parseFormDataToContents(formData, messageText, apikey);
      
      if (userContentParts.length === 0) {
        // 即使 inputText 为空，如果上传了文件，userContentParts 也可能不为空
        // 因此，只有当原始输入文本为空且没有文件时，才认为是完全空输入
        if (!messageText.trim() && !Array.from(formData.values()).some(v => v instanceof File)) {
             return new Response("请输入消息或上传文件。", { status: 400 });
        }
        // 如果 userContentParts 为空但 messageText 非空（例如只包含空格），parseFormDataToContents 可能返回空数组
        // 此时，如果原始 messageText 非空，我们应该允许它继续，processAIRequest 会处理
        // 但如果 parseFormDataToContents 真的返回空，且原始输入也看似为空，则阻止。
      }

      await chatService.addMessageToChat(currentChatId, "user", userContentParts);

      const historyMessages: Message[] = await chatService.getChatHistory(currentChatId);
      const fullAiContents: Content[] = [];
      for (const msg of historyMessages) {
          const role = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'user';
          fullAiContents.push({ role: role, parts: msg.content as Part[] });
      }

      let mimeTypesForOtherModels: string[] = []; 
      if (model !== 'gemini-2.0-flash-preview-image-generation') {
        // 为其他模型准备 mimeTypes (如果需要)
      }
      
      const aiResponse = await processAIRequest(
        model,
        apikey,
        fullAiContents,
        streamEnabled, 
        mimeTypesForOtherModels
      );
      
       if (streamEnabled) {
        const aiMessagePartsAccumulator: Part[] = [];
        const encoder = new TextEncoder();
        const responseBody = new ReadableStream({
          async start(controller) {
            if (!(aiResponse instanceof ReadableStream)) {
                console.error("processAIRequest 在流模式下未返回 ReadableStream");
                controller.error(new Error("内部服务器错误：流处理失败。"));
                return;
            }
            const reader = aiResponse.getReader();
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
                      const partsInChunk: Part[] = JSON.parse(line);
                      aiMessagePartsAccumulator.push(...partsInChunk);
                      controller.enqueue(encoder.encode(line + '\n'));
                    } catch (e) { console.error('解析AI流式响应JSON块时出错:', e, '原始行:', line); }
                  }
                }
              }
              if (buffer.trim()) {
                try {
                  const partsInChunk: Part[] = JSON.parse(buffer);
                  aiMessagePartsAccumulator.push(...partsInChunk);
                  controller.enqueue(encoder.encode(buffer + '\n'));
                } catch (e) { console.error('解析AI流式响应最终缓冲时出错:', e, '原始缓冲:', buffer); }
              }
            } catch (error) {
              console.error("AI流式响应处理过程中发生错误 (ReadableStream):", error);
              controller.error(error); 
            } finally {
              controller.close();
              if (aiMessagePartsAccumulator.length > 0) {
                await chatService.addMessageToChat(currentChatId, "model", aiMessagePartsAccumulator);
              }
            }
          }
        });
        return new Response(responseBody, { headers: { 'Content-Type': 'application/x-ndjson', 'X-Chat-ID': currentChatId.toString(), 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      } else {
        const aiMessageParts = aiResponse as Part[];
        if (aiMessageParts?.length > 0) {
            await chatService.addMessageToChat(currentChatId, "model", aiMessageParts);
        }
        return new Response(JSON.stringify({ chatId: currentChatId, response: aiMessageParts }), { headers: { "Content-Type": "application/json" } });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(`处理聊天消息时出错: ${errorMessage}`, { status: 500 });
    }
  }
  return new Response("未找到或方法不允许", { status: 404 });
}
