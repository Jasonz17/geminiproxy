// src/services/ai.service.ts

import { GoogleGenAI, Modality } from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

export async function parseFormDataToContents(formData: FormData, inputText: string, apikey: string): Promise<Array<any>> {
  const contents = [];

  if (inputText) {
    contents.push({ text: inputText });
  }

  const fileEntries = Array.from(formData.entries()).filter(([key, _value]) => formData.get(key) instanceof File);


  if (!apikey) {
    console.error("API Key not provided for file upload service.");
    throw new Error("API Key is required for file uploads.");
  }

  // 此 GoogleGenAI 实例专门用于文件上传
  const aiForFiles = new GoogleGenAI({ apiKey: apikey });

  for (const [_key, fileValue] of fileEntries) {
    const file = fileValue as File;
    // 为 Base64 编码设置一个更合理的阈值，例如 5MB。
    // Google 官方文档通常建议视频、音频总是使用 File API。
    const fileSizeLimitForBase64 = 5 * 1024 * 1024; // 5MB

    const isVideoFile = file.type.startsWith('video/');
    const isAudioFile = file.type.startsWith('audio/');

    // 决策逻辑：音视频文件总是使用 File API。其他类型文件根据大小判断。
    const shouldUseFileAPI = isVideoFile || isAudioFile || file.size > fileSizeLimitForBase64;

    try {
      if (shouldUseFileAPI) {
        // 使用 Google GenAI 的文件上传 API
        console.log(`正在通过 File API 上传文件: ${file.name}, 类型: ${file.type}, 大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        
        const uploadResult = await aiForFiles.files.upload({
          file: file, 
          config: {
            mimeType: file.type,
            displayName: file.name,
          }
        });
        
        if (!uploadResult.file || !uploadResult.file.uri) {
          console.error("File upload result did not contain expected file URI:", uploadResult);
          throw new Error(`文件上传成功但未返回有效的URI: ${file.name}`);
        }
        console.log(`文件上传完成 ${file.name}, URI: ${uploadResult.file.uri}`);

        contents.push({
          fileData: {
            mimeType: file.type,
            uri: uploadResult.file.uri,
          },
        });
      } else {
        // 小于等于 fileSizeLimitForBase64 且非音视频的文件，使用 base64 编码
        console.log(`正在进行 Base64 编码: ${file.name}, 类型: ${file.type}, 大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        const fileBuffer = await file.arrayBuffer();
        const base64Data = encodeBase64(new Uint8Array(fileBuffer));

        contents.push({
          inlineData: {
            mimeType: file.type,
            data: base64Data,
          },
        });
      }
    } catch (fileProcessError) {
      console.error(`处理文件 ${file.name} 时出错:`, fileProcessError);
      let detailedMessage = `处理文件失败: ${file.name}`;
      if (fileProcessError instanceof Error) {
          detailedMessage += ` - ${fileProcessError.message}`;
          // deno-lint-ignore no-explicit-any
          const googleError = fileProcessError as any;
          if (googleError.error && googleError.error.message) {
              detailedMessage += ` (Google API Error: ${googleError.error.message})`;
          } else if (googleError.message && googleError.message.includes("fetch")) {
              detailedMessage += ` (可能是网络或API Key权限问题)`;
          } else if (googleError.message && googleError.message.includes("User location is not supported")){
              detailedMessage += ` (Google API 错误: 用户地理位置不支持此操作，请检查代理或VPN设置)`;
          }
      } else if (typeof fileProcessError === 'object' && fileProcessError !== null) {
          // deno-lint-ignore no-explicit-any
          const errorObj = fileProcessError as any;
          if (errorObj.error && errorObj.error.message) {
               detailedMessage += ` - Google API 错误: ${errorObj.error.message}`;
          } else {
              try {
                  detailedMessage += ` - 错误详情: ${JSON.stringify(fileProcessError)}`;
              } catch (e) {
                  detailedMessage += ` - (无法序列化错误对象)`;
              }
          }
      } else {
          detailedMessage += ` - 未知错误类型`;
      }
      // 打印完整的错误对象，以便更深入的调试
      console.error(`完整错误对象详情 (fileProcessError in parseFormDataToContents):`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
      throw new Error(detailedMessage);
    }
  }
  return contents;
}

// processAIRequest 函数保持不变，但其收到的 contents 参数会因 parseFormDataToContents 的改变而改变。
// 确保 processAIRequest 中的错误日志也足够详细
export async function processAIRequest(
  model: string,
  apikey: string,
  contents: Array<any>,
  streamEnabled: boolean,
  responseModalities: Modality[] = []
): Promise<ReadableStream<Uint8Array> | Array<any>> {
  if (!apikey) {
    throw new Error("API Key is missing.");
  }
  if (!contents || contents.length === 0) {
    // 修正：如果只有文件没有文本，contents[0]可能是fileData/inlineData，而不是text: ""。
    // 应该检查 contents 数组本身是否为空，或者所有 part 是否都无效。
    // 不过，parseFormDataToContents 应该确保至少有一个有效的 part（文本或文件）。
    // 这里的检查可以简化为：
    if (contents.every(content => !content.parts || content.parts.length === 0)) {
        throw new Error("No content provided to AI model for processing.");
    }
  }

  // 此 GoogleGenAI 实例专门用于内容生成
  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });

  // deno-lint-ignore no-explicit-any
  const generationConfig: any = {};
  if (responseModalities.length > 0) {
    generationConfig.responseMimeTypes = responseModalities;
  }

  try {
    if (streamEnabled) {
      const streamResult = await aiForGenerate.models.generateContentStream({
        model: model,
        contents: contents, // contents 应该是完整的对话历史 + 当前用户输入
        generationConfig: generationConfig,
      });

      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) { // 注意：访问 streamResult.stream
              if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                controller.enqueue(encoder.encode(JSON.stringify(chunk.candidates[0].content.parts) + '\n'));
              }
            }
            controller.close();
          } catch (error) {
            console.error("Error during AI stream processing:", error);
            // 详细记录流处理中的错误
            console.error(`完整错误对象详情 (stream processing error in processAIRequest):`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
            controller.error(error);
          }
        }
      });
    } else {
      const result = await aiForGenerate.models.generateContent({
        model: model,
        contents: contents,
        generationConfig: generationConfig,
      });
          
      if (result.response && result.response.candidates && result.response.candidates.length > 0 && result.response.candidates[0].content && result.response.candidates[0].content.parts) {
        return result.response.candidates[0].content.parts; // 注意：访问 result.response.candidates
      } else {
        console.error("AI服务返回了意外的结构 (non-stream):", JSON.stringify(result, null, 2));
        throw new Error("AI服务返回了意外的结构 (non-stream)");
      }
    }
  } catch (error) {
    console.error("Error generating content from AI model:", error);
    let detailedMessage = `AI模型生成内容错误`;
    if (error instanceof Error) {
        detailedMessage += ` - ${error.message}`;
        // deno-lint-ignore no-explicit-any
        const googleError = error as any;
        if (googleError.error && googleError.error.message) { // Google API 错误结构
            detailedMessage += ` (Google API Error: ${googleError.error.message})`;
        } else if (googleError.message && googleError.message.includes("API key not valid")) {
            detailedMessage += ` (请检查API Key是否有效或已启用Gemini API)`;
        } else if (googleError.message && googleError.message.includes("User location is not supported")){
             detailedMessage += ` (Google API 错误: 用户地理位置不支持此操作，请检查代理或VPN设置)`;
        }
    } else if (typeof error === 'object' && error !== null) {
        // deno-lint-ignore no-explicit-any
        const errorObj = error as any;
        if (errorObj.error && errorObj.error.message) { // 另一种可能的 Google API 错误结构
             detailedMessage += ` - Google API 错误: ${errorObj.error.message}`;
        } else {
            try {
                detailedMessage += ` - 错误详情: ${JSON.stringify(error)}`;
            } catch (e) {
                detailedMessage += ` - (无法序列化错误对象)`;
            }
        }
    } else {
        detailedMessage += ` - 未知错误类型`;
    }
    // 打印完整的错误对象
    console.error(`完整AI生成错误对象详情 (processAIRequest):`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw new Error(detailedMessage);
  }
}
