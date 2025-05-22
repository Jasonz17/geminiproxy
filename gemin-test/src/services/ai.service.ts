// src/services/ai.service.ts

import { GoogleGenAI, Modality } from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/**
 * Parses FormData to extract text input and file content for AI model.
 * Handles base64 encoding for smaller files and uploads/references for larger ones.
 * @param formData The FormData object from the request.
 * @param inputText The main text input from the user.
 * @returns An array of content parts suitable for the Gemini API.
 */
export async function parseFormDataToContents(formData: FormData, inputText: string): Promise<Array<any>> {
  const contents = [];

  // Handle text input
  if (inputText) {
    contents.push({ text: inputText });
  }

  // Handle files
  const fileEntries = Array.from(formData.entries()).filter(([key, value]) => value instanceof File);
  // 为每个请求创建一个新的 GoogleGenAI 实例，以确保 API 密钥正确应用
  // 或者确保在外面传入一个已初始化的 ai 实例
  // 这里暂时这样处理，但更好的做法是将 ai 实例作为参数传入
  const apikey = formData.get('apikey')?.toString();
  if (!apikey) {
    console.error("API Key not found in formData for file upload.");
    throw new Error("API Key is required for file uploads.");
  }
  const ai = new GoogleGenAI({ apiKey: apikey });


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
          // 大于 20MB，使用 Google GenAI 的文件上传 API
          console.log(`正在上传大文件: ${file.name}, 大小: ${file.size / (1024 * 1024)}MB`);
          const uploadResult = await ai.uploadFile(file, { // <-- 关键：重新启用此调用
            mimeType: file.type,
            displayName: file.name,
          });
          console.log(`文件上传完成 ${file.name}, URI: ${uploadResult.file.uri}`);

          contents.push({
            fileData: {
              mimeType: file.type,
              uri: uploadResult.file.uri, // 这就是 URI
            },
          });
        }
      } catch (fileProcessError) {
        console.error(`处理文件 ${file.name} 时出错:`, fileProcessError);
        // 如果错误对象有其他属性，也可以尝试打印
        if (fileProcessError instanceof Error) {
            console.error(`错误详情: ${fileProcessError.message}`);
            if (fileProcessError.stack) {
                console.error(`错误堆栈: ${fileProcessError.stack}`);
            }
        }
        console.error(`完整错误对象:`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
        // 对于文件处理错误，可以选择跳过该文件或者抛出错误中断请求
        // 这里选择抛出错误，因为文件处理失败可能导致 AI 响应不完整
        throw new Error(`处理文件失败: ${file.name} - ${fileProcessError.message}`);
      }
    }
  }
  return contents;
}

/**
 * Processes an AI request by interacting with the Google Gemini API.
 * This function handles both streamed and non-streamed responses.
 * @param model The name of the AI model to use.
 * @param apikey Your Google Gemini API key.
 * @param contents An array of content parts (text, inline data, file data) representing the conversation.
 * @param streamEnabled True if a streamed response is desired, false otherwise.
 * @param responseModalities Optional array of Modality for response configuration (e.g., for image generation).
 * @returns A ReadableStream for streamed responses, or an Array of content parts for non-streamed responses.
 * @throws Error if API key is missing, content is empty, or unexpected API response structure.
 */
export async function processAIRequest(
  model: string,
  apikey: string,
  contents: Array<any>, // This will be the full conversation including the current turn
  streamEnabled: boolean,
  responseModalities: Modality[] = []
): Promise<ReadableStream<Uint8Array> | Array<any>> {
  if (!apikey) {
    throw new Error("API Key is missing.");
  }
  if (!contents || contents.length === 0) {
    throw new Error("No content provided to AI model for processing.");
  }

  const ai = new GoogleGenAI({ apiKey: apikey }); // 这里的ai实例用于generateContent

  const generationConfig: any = {};
  if (responseModalities.length > 0) {
    generationConfig.responseMimeTypes = responseModalities;
  }

  if (streamEnabled) {
    const stream = await ai.models.generateContentStream({
      model: model,
      contents: contents,
      generationConfig: generationConfig,
    });

    const encoder = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
              controller.enqueue(encoder.encode(JSON.stringify(chunk.candidates[0].content.parts) + '\n'));
            }
          }
          controller.close();
        } catch (error) {
          console.error("Error during AI stream processing:", error);
          controller.error(error);
        }
      }
    });
  } else {
    const result = await ai.models.generateContent({
      model: model,
      contents: contents,
      generationConfig: generationConfig,
    });
        
    if (result && result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts) {
      return result.candidates[0].content.parts;
    } else {
      console.error("AI服务返回了意外的结构:", JSON.stringify(result, null, 2));
      throw new Error("AI服务返回了意外的结构");
    }
  }
}
