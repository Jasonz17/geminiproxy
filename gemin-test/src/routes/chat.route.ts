// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts";
import { Modality, Content, Part } from "npm:@google/genai";

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
      
      if (userContentParts.length === 0 && !messageText.trim()) {
        return new Response("没有提供文本或文件", { status: 400 });
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

      // --- 关键修正点 ---
      // responseMimeTypes 应该是一个包含具体 MIME 类型字符串的数组
      let responseMimeTypesForConfig: string[] = []; 
      if (model === 'gemini-2.0-flash-preview-image-generation') {
        // 根据错误提示，模型接受 IMAGE 和 TEXT。
        // 我们需要提供具体的 MIME 类型。通常图像是 image/png 或 image/jpeg。
        // 文本是 text/plain。
        responseMimeTypesForConfig = ["image/png", "text/plain"]; 
        console.log(`为图像生成模型 ${model} 设置 responseMimeTypes:`, responseMimeTypesForConfig);
      } else {
        // 对于其他模型，通常不需要显式设置 responseMimeTypes，它们默认返回文本。
        // 如果有其他模型也需要特定响应类型，可以在这里添加逻辑。
        console.log(`模型 ${model} 使用默认响应类型 (通常是文本)`);
      }
      // --- 修正结束 ---


      if (!apikey) {
        return new Response("API Key is missing for AI service call.", { status: 400 });
      }
      
      // 将 responseMimeTypesForConfig 传递给 processAIRequest
      // processAIRequest 内部会用它来设置 generationConfig.responseMimeTypes
      // 注意：processAIRequest 的第五个参数是 responseModalities，我们现在直接传递 string[]
      // 所以需要修改 processAIRequest 的签名或内部逻辑来接收 string[]
      // 为了保持最小改动，我们修改 processAIRequest 内部如何使用第五个参数

      const aiResponse = await processAIRequest(
        model,
        apikey,
        fullAiContents,
        streamEnabled,
        responseMimeTypesForConfig // <--- 传递 string[]
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

      } else {
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
