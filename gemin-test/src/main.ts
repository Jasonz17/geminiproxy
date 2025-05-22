// main.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

import { handleChatRequest, initializeDatabaseClient } from "./routes/chat.route.ts"; // Only import handleChatRequest
import { client as dbClient, ensureTablesExist } from "./database/client.ts";

// 获取当前脚本所在的目录
const __dirname = dirname(fromFileUrl(import.meta.url));

// 连接数据库并在路由中初始化客户端
await dbClient.connect();
await ensureTablesExist(); // 确保数据库表存在
await initializeDatabaseClient(dbClient); // Pass the connected client to the route handler

console.log("Server running on http://localhost:8000/");

serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // 移除了 /process 路由，所有AI交互都通过 /chat
  // if (pathname === "/process") {
  //   // This route is no longer used, its logic is integrated into /chat
  //   return new Response("Not Found", { status: 404 });
  // }

  // 处理聊天请求
  if (pathname === "/chat") {
    return handleChatRequest(req); // Call handleChatRequest without aiService parameter
  }

  // 处理静态文件请求
  try {
    const filename = pathname === '/' ? 'index.html' : pathname.substring(1);
    const filePath = join(__dirname, '..', filename); // Adjust path to serve from project root

    console.log(`尝试提供静态文件: ${filePath}`);
    const fileResponse = await serveFile(req, filePath);
    console.log(`已提供静态文件: ${filePath}`);
    return fileResponse;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(`未找到静态文件: ${pathname}`);
      return new Response("未找到", { status: 404 });
    } else {
      console.error(`提供静态文件 ${pathname} 时出错:`, error);
      return new Response("内部服务器错误", { status: 500 });
    }
  }
}, { port: 8000 });

// 在程序退出时关闭数据库连接
Deno.addSignalListener("SIGINT", async () => {
  console.log("服务器正在关闭...");
  await dbClient.end();
  Deno.exit();
});
