// src/routes/chat.route.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { ChatService } from "../services/chat.service.ts";
import { connectDatabase } from "../database/client.ts"; // Remove this import
import { Client } from "jsr:@db/postgres";
import { AIService } from "../services/ai.service.ts"; // Import AIService
import { Message } from "../database/models/message.ts"; // Import Message type

// Assume database client is initialized and connected elsewhere, or handle it here
// For simplicity, let's assume the client is available globally or passed in.
// A better approach might be to initialize it once in main.ts and pass it down.

// Placeholder for the database client instance
let dbClient: Client | null = null;

// Function to initialize the database client (can be called from main.ts)
export async function initializeDatabaseClient(client: Client) {
  dbClient = client;
  // await connectDatabase(); // Remove this line
}

// Basic request handler for the chat route
export async function handleChatRequest(req: Request, aiService: AIService): Promise<Response> { // Add aiService parameter
  if (!dbClient) {
    return new Response("Database client not initialized", { status: 500 });
  }

  const chatService = new ChatService(dbClient);

  // Example: Handle a POST request to /chat
  if (req.method === "POST") {
    try {
      const formData = await req.formData();
      const chatId = formData.get('chatId');
      const model = formData.get('model');
      const message = formData.get('input'); // Frontend sends text as 'input'
      // Files are also in formData, but we'll handle them later if needed

      // If no chatId is provided, create a new chat
      let currentChatId: number;
      if (chatId) {
        currentChatId = parseInt(chatId as string, 10); // Parse chatId as integer
      } else {
        currentChatId = await chatService.createNewChat();
        console.log(`New chat created with ID: ${currentChatId}`);
      }

      // Add user message to history
      await chatService.addMessageToChat(currentChatId, "user", message);

      // Get chat history from database
      const history: Message[] = await chatService.getChatHistory(currentChatId);

      // Map history to the format required by AI service
      const aiHistory = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model', // Map roles if necessary
        parts: [{ text: msg.content }],
      }));

      // Start chat with history and send the new message
      // Note: The AI service needs to handle potential file parts if included in the future
      const chat = aiService.startChat({ model: model, history: aiHistory }); // Use startChat
      const result = await chat.sendMessage({ message: message }); // Send user message
      const aiResponseContent = result.text; // Get AI response text

      // Add AI response to history
      await chatService.addMessageToChat(currentChatId, "model", aiResponseContent);

      return new Response(JSON.stringify({ chatId: currentChatId, response: aiResponseContent }), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      console.error("Error handling chat request:", error);
      return new Response("Error processing chat message", { status: 500 });
    }
  }

  // Handle other methods or paths if needed
  return new Response("Not Found", { status: 404 });
}

// This file will export the handler function to be used in main.ts
