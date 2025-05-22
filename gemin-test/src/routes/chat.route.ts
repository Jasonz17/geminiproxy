// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts";
import { Content, Part } from "npm:@google/genai"; // Modality 不再需要

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

      const userContentParts: Part[] = await parseFormDataToContents(formData, messageText, apikey);
      
      if (userContentParts.length === 0) {
        if (!messageText.trim() && !Array.from(formData.values()).some(v => v instanceof File)) {
             return new Response("请输入消息或上传文件。", { status: 400 });
        }
      }

      await chatService.addMessageToChat(currentChatId, "user", userContentParts);
      console.log(`用户消息已保存到数据库 (Chat ID: ${currentChatId}):`, userContentParts);

      const historyMessages: Message[] = await chatService.getChatHistory(currentChatId);
      const fullAiContents: Content[] = [];
      for (const msg of historyMessages) {
          const role = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'user';
          const parts: Part[] = msg.content as Part[];
          fullAiContents.push({ role: role, parts: parts });
      }

      // *** 核心修正：不再为图像生成模型传递 responseMimeTypes 给 processAIRequest ***
      // processAIRequest 内部会根据模型名称自行处理图像生成的配置
      let mimeTypesForOtherModels: string[] = []; 
      if (model !== 'gemini-2.0-flash-preview-image-generation') {
        // 如果有其他模型需要特定MIME类型，可以在这里设置
        // 例如： if (model === 'some-other-model-expecting-json') mimeTypesForOtherModels = ["application/json"];
        console.log(`模型 ${model} 使用默认响应类型或由 processAIRequest 内部的 _requestedResponseMimeTypes (如果提供) 决定。`);
      }
      // *** 修正结束 ***

      if (!apikey) {
        return new Response("API Key is missing for AI service call.", { status: 400 });
      }
      
      const aiResponse = await processAIRequest(
        model,
        apikey,
        fullAiContents,
        streamEnabled,
        // 对于图像生成，processAIRequest 内部会处理 config.responseModalities
        // 对于其他模型，如果需要，这里传递的数组会被用于 generationConfig.responseMimeTypes
        mimeTypesForOtherModels
      );
      
      // ... (后续的流式和非流式响应处理逻辑保持不变) ...
       if (streamEnabled) {
        const aiMessagePartsAccumulator: Part[] = [];
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
                      const partsInChunk: Part[] = JSON.parse(line);
                      aiMessagePartsAccumulator.push(...partsInChunk);
                      controller.enqueue(encoder.encode(line + '\n'));
                    } catch (e) {
                      console.error('解析AI流式响应JSON块时出错:', e, '原始行:', line);
                    }
                  }
                }
              }
              if (buffer.trim()) {
                try {
                  const partsInChunk: Part[] = JSON.parse(buffer);
                  aiMessagePartsAccumulator.push(...partsInChunk);
                  controller.enqueue(encoder.encode(buffer + '\n'));
                } catch (e) {
                  console.error('解析AI流式响应最终缓冲时出错:', e, '原始缓冲:', buffer);
                }
              }
            } catch (error) {
              console.error("AI流式响应处理过程中发生错误:", error);
              controller.error(error);
            } finally {
              controller.close();
              if (aiMessagePartsAccumulator.length > 0) {
                await chatService.addMessageToChat(currentChatId, "model", aiMessagePartsAccumulator);
                console.log(`AI流式响应已保存到数据库 (Chat ID: ${currentChatId}):`, aiMessagePartsAccumulator);
              } else {
                console.log(`AI流式响应为空，未保存到数据库 (Chat ID: ${currentChatId})`);
              }
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

      } else { // 非流式
        const aiMessageParts = aiResponse as Part[];
        if (aiMessageParts && aiMessageParts.length > 0) {
            await chatService.addMessageToChat(currentChatId, "model", aiMessageParts);
            console.log(`AI非流式响应已保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);
        } else {
            console.log(`AI非流式响应为空或无效，未保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);
        }
        return new Response(JSON.stringify({ chatId: currentChatId, response: aiMessageParts }), {
          headers: { "Content-Type": "application/json" },
        });
      }

    } catch (error) {
      console.error("处理聊天请求时发生错误:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(`处理聊天消息时出错: ${errorMessage}`, { status: 500 });
    }
  }
  return new Response("未找到或方法不允许", { status: 404 });
}
