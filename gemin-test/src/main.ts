import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

import { handleProcessRequest } from "./services/ai.service.ts";
import { handleChatRequest, initializeDatabaseClient } from "./routes/chat.route.ts";
import { AIService } from "./services/ai.service.ts"; // Import AIService class if needed
import { client as dbClient } from "./database/client.ts"; // Import the client instance

// 获取当前脚本所在的目录
const __dirname = dirname(fromFileUrl(import.meta.url));

// 初始化 AI Service (如果需要)
const aiService = new AIService(); // Create an instance if the class has methods

// 连接数据库并在路由中初始化客户端
await dbClient.connect();
await initializeDatabaseClient(dbClient);

console.log("Server running on http://localhost:8000/");

serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // 处理 API 代理请求
  if (pathname === "/process") {
    return handleProcessRequest(req);
  }

  // 处理聊天请求
  if (pathname === "/chat") {
    // Pass the aiService instance to the chat handler
    return handleChatRequest(req, aiService);
  }

  // 处理静态文件请求
  try {
    // 将根路径 '/' 映射到 'index.html'，其他路径移除开头的 '/'
    const filename = pathname === '/' ? 'index.html' : pathname.substring(1);
    // 构建文件在文件系统中的完整路径
    const filePath = join(__dirname, '..', filename); // Adjust path to serve from project root

    // 使用 serveFile 实用函数来处理文件服务。
    console.log(`Attempting to serve static file: ${filePath}`);
    const fileResponse = await serveFile(req, filePath); // Use the original request object
    console.log(`Served static file: ${filePath}`);
    return fileResponse;
  } catch (error) {
    // If serveFile throws NotFound error or other errors (like permission issues)
    // Return 404 Not Found for NotFound errors specifically
    if (error instanceof Deno.errors.NotFound) {
      console.warn(`Static file not found: ${pathname}`);
      return new Response("Not Found", { status: 404 });
    } else {
      // Log other errors and return 500
      console.error(`Error serving static file ${pathname}:`, error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
}, { port: 8000 });

// 在程序退出时关闭数据库连接
Deno.addSignalListener("SIGINT", async () => {
  console.log("Shutting down...");
  await dbClient.end();
  Deno.exit();
});
