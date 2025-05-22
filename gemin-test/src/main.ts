// src/routes/chat.route.ts

import { ChatService } from "../services/chat.service.ts";
import { processAIRequest, parseFormDataToContents } from "../services/ai.service.ts"; // Import the new AI service functions
import { Client } from "jsr:@db/postgres";
import { Message } from "../database/models/message.ts"; // Import Message type
import { Modality } from "npm:@google/genai"; // Import Modality for AI response configuration

// Placeholder for the database client instance
let dbClient: Client | null = null;

// Function to initialize the database client (called from main.ts)
export async function initializeDatabaseClient(client: Client) {
  dbClient = client;
}

const decoder = new TextDecoder(); // Decoder for stream processing

// Main request handler for the chat route
export async function handleChatRequest(req: Request): Promise<Response> {
  if (!dbClient) {
    console.error("数据库客户端未初始化！");
    return new Response("服务器错误: 数据库客户端未初始化", { status: 500 });
  }

  const chatService = new ChatService(dbClient);

  if (req.method === "POST") {
    try {
      const formData = await req.formData();
      const chatIdParam = formData.get('chatId'); // Get chatId from frontend
      const model = formData.get('model')?.toString();
      const apikey = formData.get('apikey')?.toString();
      const messageText = formData.get('input')?.toString() || '';
      const streamEnabled = formData.get('stream') === 'true';

      if (!model || !apikey) {
        return new Response("请求体中缺少模型或API密钥", { status: 400 });
      }

      // Determine current chat ID: create new if not provided, otherwise use existing.
      let currentChatId: number;
      if (chatIdParam) {
        currentChatId = parseInt(chatIdParam as string, 10);
        // Optional: Verify if chatId exists in DB, if not, create new
        const existingChat = await chatService.chatRepository.getChatById(currentChatId);
        if (!existingChat) {
          console.warn(`收到的chatId: ${chatIdParam} 不存在，创建新聊天。`);
          currentChatId = await chatService.createNewChat();
        }
      } else {
        currentChatId = await chatService.createNewChat();
        console.log(`已创建新聊天，ID: ${currentChatId}`);
      }

      // Parse user's current input (text and files) into content parts for AI model
      const userContentParts = await parseFormDataToContents(formData, messageText);
      
      // If there's no text or files, return early (though frontend should ideally prevent this)
      if (userContentParts.length === 0) {
        return new Response("没有提供文本或文件", { status: 400 });
      }

      // Store the user message in the database
      // For simplicity, we concatenate text parts for DB storage.
      // If full multimodal content needs to be stored, the DB schema for 'content' needs to be adjusted (e.g., JSONB).
      const userDbContent = userContentParts.map(part => part.text || '').join(' ');
      await chatService.addMessageToChat(currentChatId, "user", userDbContent);
      console.log(`用户消息已保存到数据库 (Chat ID: ${currentChatId}): ${userDbContent}`);

      // Retrieve full chat history from the database to provide context to the AI model
      const historyMessages = await chatService.getChatHistory(currentChatId);

      // Build the full 'contents' array for the AI model, including historical turns and the current user message
      const aiContents: Array<any> = [];
      for (const msg of historyMessages) {
          // For history, assume text content for now. If you store full multimodal in DB, retrieve and reconstruct.
          aiContents.push({
              role: msg.role, // 'user' or 'model'
              parts: [{ text: msg.content }]
          });
      }

      // Add the current user message parts (including files) to the AI conversation context
      // Note: userContentParts already contains the text and inlineData for the current turn.
      // We append it as the last 'user' turn.
      // However, if the history already has the user's *current* message (because it was just saved),
      // we need to be careful not to duplicate it.
      // The current loop `for (const msg of historyMessages)` will include the user's message just added.
      // So, `aiContents` *already* contains the current user message.
      // We just need to make sure the AI service can handle the structured parts.

      // If the `aiContents` array is built from `historyMessages` *after* the user message is saved,
      // then the `aiContents` already contains the user's current message and its content.
      // We need to ensure that `parseFormDataToContents` correctly extracts `inlineData`
      // and that `addMessageToChat` and `getChatHistory` can handle it.
      // For now, `addMessageToChat` only saves text content.
      // This means history sent to AI will only be text.
      // The current user message, if it has files, will be structured with `inlineData`.

      // Let's refine the `aiContents` creation:
      const fullAiContents: Array<any> = [];
      for (const msg of historyMessages) {
          // Re-add historical messages.
          // IMPORTANT: If `msg.content` is just text, it should be `{ text: msg.content }`
          // If you stored rich content (e.g., JSON for multimodal) in `msg.content`, you'd parse it here.
          fullAiContents.push({
              role: msg.role,
              parts: [{ text: msg.content }]
          });
      }
      // The `userContentParts` array already holds the content for the *current* user turn,
      // including any files uploaded. We must add this to the end of the conversation context.
      fullAiContents.push({
          role: 'user',
          parts: userContentParts // This includes text and inlineData for the current user turn
      });

      // Determine response modalities based on the selected model
      const responseModalities: Modality[] = [];
      if (model === 'gemini-2.0-flash-preview-image-generation') {
        responseModalities.push(Modality.TEXT, Modality.IMAGE);
      }

      // Call the AI service to get the response
      const aiResponse = await processAIRequest(model, apikey, fullAiContents, streamEnabled, responseModalities);

      if (streamEnabled) {
        // Streamed response handling
        const aiMessageParts: any[] = []; // To accumulate parts for DB storage later
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
                buffer = lines.pop() || ''; // Keep incomplete last line

                for (const line of lines) {
                  if (line.trim()) {
                    try {
                      const parts = JSON.parse(line);
                      aiMessageParts.push(...parts); // Accumulate all parts
                      controller.enqueue(encoder.encode(line + '\n')); // Send to frontend
                    } catch (e) {
                      console.error('解析AI流式响应JSON块时出错:', e);
                    }
                  }
                }
              }
              // Process any remaining buffer content
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
              controller.error(error); // Propagate error
            } finally {
              controller.close();
              // Store AI response after the entire stream is received
              const accumulatedTextContent = aiMessageParts.map(p => p.text || '').join(' ');
              // For multimodal responses, consider how to store image/other parts.
              // For simplicity, we save only the text part to DB.
              await chatService.addMessageToChat(currentChatId, "model", accumulatedTextContent);
              console.log(`AI流式响应已保存到数据库 (Chat ID: ${currentChatId}): ${accumulatedTextContent}`);
            }
          }
        });

        return new Response(responseBody, {
          headers: {
            'Content-Type': 'application/x-ndjson', // Standard for newline-delimited JSON
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Chat-ID': currentChatId.toString(), // Send chat ID in header for stream
          }
        });

      } else {
        // Non-streamed response handling
        const aiMessageParts = aiResponse as Array<any>;
        const aiResponseContent = aiMessageParts.map(p => p.text || '').join(' '); // Get full text content

        // Store AI response in the database
        await chatService.addMessageToChat(currentChatId, "model", aiResponseContent);
        console.log(`AI非流式响应已保存到数据库 (Chat ID: ${currentChatId}): ${aiResponseContent}`);

        // Return the response parts and chat ID to the frontend
        return new Response(JSON.stringify({ chatId: currentChatId, response: aiMessageParts }), {
          headers: { "Content-Type": "application/json" },
        });
      }

    } catch (error) {
      console.error("处理聊天请求时发生错误:", error);
      return new Response(`处理聊天消息时出错: ${error.message}`, { status: 500 });
    }
  }

  // Handle other HTTP methods if necessary (e.g., GET /chat for history retrieval)
  return new Response("未找到", { status: 404 });
}
