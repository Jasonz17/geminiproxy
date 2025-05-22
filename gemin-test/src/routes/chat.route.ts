// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts";
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts"; // 你的 Message 模型
import { Modality, Content, Part } from "npm:@google/genai"; // 导入 Gemini SDK 的类型

let dbClient: Client | null = null;
const decoder = new TextDecoder(); // 用于流式响应解码

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

      // 1. 解析用户当前输入（文本和文件）为 AI 模型所需的 Part[]
      const userContentParts: Part[] = await parseFormDataToContents(formData, messageText, apikey);
      
      if (userContentParts.length === 0 && !messageText.trim()) { // 确保如果只有文本，文本也不能是空的
        return new Response("没有提供文本或文件", { status: 400 });
      }

      // 2. 将用户消息（包括文件部分）保存到数据库
      // 注意：chatService.addMessageToChat 的第二个参数 role 需要是 'user' 或 'model'
      await chatService.addMessageToChat(currentChatId, "user", userContentParts);
      console.log(`用户消息已保存到数据库 (Chat ID: ${currentChatId}):`, userContentParts);

      // 3. 从数据库中检索完整的聊天历史
      const historyMessages: Message[] = await chatService.getChatHistory(currentChatId);

      // 4. 构建传递给 AI 模型的完整 'contents' 数组 (Content[])
      const fullAiContents: Content[] = [];
      for (const msg of historyMessages) {
          // 假设 msg.content 在数据库中存储的就是 Part[] 兼容的结构
          // 如果 msg.role 在数据库中可能是其他值，需要确保这里转换成 'user' | 'model'
          const role = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'user'; // 默认或错误处理
          
          // 确保 msg.content 是 Part[] 类型。
          // 如果 Message['content'] 类型与 Part[] 不完全一致，这里需要转换。
          // 假设 Message['content'] 与 Part[] 兼容：
          const parts: Part[] = msg.content as Part[]; 

          fullAiContents.push({
              role: role,
              parts: parts 
          });
      }

      // 确定响应模态
      const responseModalities: Modality[] = [];
      if (model === 'gemini-2.0-flash-preview-image-generation') {
        responseModalities.push(Modality.TEXT, Modality.IMAGE);
      }

      // 再次检查 apikey 是否存在
      if (!apikey) {
        // 理论上前面已检查，但作为防御性编程
        return new Response("API Key is missing for AI service call.", { status: 400 });
      }

      // 5. 调用 AI service
      const aiResponse = await processAIRequest(model, apikey, fullAiContents, streamEnabled, responseModalities);

      if (streamEnabled) {
        const aiMessagePartsAccumulator: Part[] = []; // 用于累积流式响应的所有 Part
        const encoder = new TextEncoder();
        const responseBody = new ReadableStream({
          async start(controller) {
            const reader = (aiResponse as ReadableStream<Uint8Array>).getReader();
            let buffer = ''; // 用于处理不完整的 JSON 行
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 最后一行可能不完整，放回 buffer

                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const partsInChunk: Part[] = JSON.parse(line); // 期望每一行是 Part[]
                      aiMessagePartsAccumulator.push(...partsInChunk); // 累积到总的 Parts 数组
                      controller.enqueue(encoder.encode(line + '\n')); // 将原始 JSON 行发送给前端
                    } catch (e) {
                      console.error('解析AI流式响应JSON块时出错:', e, '原始行:', line);
                      // 可以选择是否将错误信息发送给前端或记录
                    }
                  }
                }
              }
              // 处理 buffer 中可能剩余的最后一行
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
              // 在整个流接收完毕后，将累积的 AI 响应 Parts 保存到数据库
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
            'Content-Type': 'application/x-ndjson', // ndjson (newline delimited json)
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Chat-ID': currentChatId.toString(),
          }
        });

      } else { // 非流式响应
        const aiMessageParts = aiResponse as Part[]; // processAIRequest 非流式时返回 Part[]

        // 保存 AI 响应到数据库
        if (aiMessageParts && aiMessageParts.length > 0) {
            await chatService.addMessageToChat(currentChatId, "model", aiMessageParts);
            console.log(`AI非流式响应已保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);
        } else {
            console.log(`AI非流式响应为空或无效，未保存到数据库 (Chat ID: ${currentChatId}):`, aiMessageParts);
            // 可以考虑返回一个错误或空内容给前端
        }
        
        return new Response(JSON.stringify({ chatId: currentChatId, response: aiMessageParts }), {
          headers: { "Content-Type": "application/json" },
        });
      }

    } catch (error) {
      console.error("处理聊天请求时发生错误:", error);
      // 确保错误消息是字符串
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(`处理聊天消息时出错: ${errorMessage}`, { status: 500 });
    }
  }

  return new Response("未找到或方法不允许", { status: 404 }); // 更通用的错误
}
