import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenAI, Modality } from "npm:@google/genai"; // 使用正确的库
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// 获取当前脚本所在的目录
const __dirname = dirname(fromFileUrl(import.meta.url));

export class AIService {
  // This class can be used to encapsulate AI related logic if needed later.
  // For now, we'll keep the core logic in a function.
}

export async function handleProcessRequest(req: Request): Promise<Response> {
  // --- 1. 处理 API 代理请求 ---
  // 只处理 /process 的 POST 请求
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // 解析 FormData
    const formData = await req.formData();
    const model = formData.get('model');
    const apikey = formData.get('apikey');
    const inputText = formData.get('input');

    if (!model || !apikey) {
      return new Response("Missing model or apikey in request body", { status: 400 });
    }


      const ai = new GoogleGenAI({ apiKey: apikey.toString() });

      // 构建内容数组
      const contents = [];

      // 检查输入是否为图片 URL
      const imageUrlRegex = /^(http(s?):)([/|.][\w\s-])*\.(?:jpg|jpeg|gif|png|webp|heic|heif)$/i;
      if (inputText && imageUrlRegex.test(inputText.toString())) {
        // 如果是图片 URL，添加到 contents 数组
        const imageUrl = inputText.toString();
        // 尝试从 URL 推断 MIME 类型，或者使用默认值
        const mimeType = imageUrl.split('.').pop()?.toLowerCase() === 'jpg' ? 'image/jpeg' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'jpeg' ? 'image/jpeg' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'png' ? 'image/png' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'gif' ? 'image/gif' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'webp' ? 'image/webp' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'heic' ? 'image/heic' :
                         imageUrl.split('.').pop()?.toLowerCase() === 'heif' ? 'image/heif' :
                         'image/*'; // 默认或未知类型

        contents.push({
          fileData: {
            mimeType: mimeType,
            uri: imageUrl,
          },
        });
      } else if (inputText) {
        // 如果不是图片 URL，作为文本添加
        contents.push({ text: inputText.toString() });
      }

      // 添加文件部分 (处理上传的文件)
      const fileEntries = Array.from(formData.entries()).filter(([key, value]) => value instanceof File);

      for (const [key, file] of fileEntries) {
        if (file instanceof File) {
          const fileSizeLimit = 20 * 1024 * 1024; // 20MB

          try {
            if (file.size <= fileSizeLimit) {
              // 小于等于 20MB，使用 base64 编码
              const fileBuffer = await file.arrayBuffer();
              const base64Data = encodeBase64(new Uint8Array(fileBuffer));

              contents.push({
                inlineData: {
                  mimeType: file.type,
                  data: base64Data,
                },
              });
            } else {
              // 大于 20MB，使用文件上传 API
              console.log(`Uploading large file: ${file.name}`);
              const uploadResult = await ai.uploadFile(file, {
                mimeType: file.type,
                displayName: file.name,
              });
              console.log(`Upload complete for ${file.name}, URI: ${uploadResult.file.uri}`);

              contents.push({
                fileData: {
                  mimeType: file.type,
                  uri: uploadResult.file.uri,
                },
              });
            }
          } catch (fileProcessError) {
            console.error(`Error processing file ${file.name}:`, fileProcessError);
            // 尝试打印更详细的错误信息，如果 fileProcessError 是一个 Error 对象
            if (fileProcessError instanceof Error) {
                console.error(`Error details: ${fileProcessError.message}`);
                if (fileProcessError.stack) {
                    console.error(`Error stack: ${fileProcessError.stack}`);
                }
            }
            // 如果错误对象有其他属性，也可以尝试打印
            console.error(`Full error object:`, JSON.stringify(fileProcessError, null, 2));

            return new Response(`Error processing file: ${file.name}`, { status: 500 });
          }
        }
      }

      if (contents.length === 0) {
         return new Response("No text or files provided", { status: 400 });
      }

      // 调用 Gemini API
      const config: any = {};
      if (model === 'gemini-2.0-flash-preview-image-generation') {
        config.responseModalities = [Modality.TEXT, Modality.IMAGE];
      }

      // 检查是否启用流式响应
      const streamEnabled = formData.get('stream') === 'true';
      
      if (streamEnabled) {
        // 流式响应处理
        const stream = await ai.models.generateContentStream({
          model: model.toString(),
          contents: contents,
          config: config,
        });

        // 设置响应头，使用Transfer-Encoding: chunked
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                  // 将每个块转换为JSON字符串并发送
                  controller.enqueue(encoder.encode(JSON.stringify(chunk.candidates[0].content.parts) + '\n'));
                }
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          }
        });

        return new Response(body, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      } else {
        // 非流式响应处理
        const result = await ai.models.generateContent({
          model: model.toString(),
          contents: contents,
          config: config,
        });
        
        // 处理响应，检查文本和图片部分
        if (result && result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts) {
          const parts = result.candidates[0].content.parts;
          return new Response(JSON.stringify(parts), {
            headers: { "Content-Type": "application/json" },
          });
        } else {
          console.error("Unexpected API response structure:", JSON.stringify(result, null, 2));
          return new Response("Error: Unexpected API response structure", { status: 500 });
        }

    }
  } catch (error) {
    console.error("Error handling process request:", error);
    return new Response("Error processing request", { status: 500 });
  }
}
