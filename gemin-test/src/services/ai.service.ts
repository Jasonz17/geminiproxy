// src/services/ai.service.ts

import { GoogleGenAI, Modality, GenerateContentResult, GenerateContentStreamResult, Part, Content } from "npm:@google/genai"; // 确保导入了类型
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/**
 * Parses FormData to extract text input and file content for AI model.
 * Handles base64 encoding for smaller files and uploads/references for larger ones.
 * @param formData The FormData object from the request.
 * @param inputText The main text input from the user.
 * @param apikey The API key to initialize GoogleGenAI for file uploads.
 * @returns An array of content parts suitable for the Gemini API.
 */
export async function parseFormDataToContents(formData: FormData, inputText: string, apikey: string): Promise<Array<Part>> {
  const contents: Array<Part> = [];

  if (inputText) {
    contents.push({ text: inputText });
  }

  const fileEntries: Array<[string, File]> = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      fileEntries.push([key, value]);
    }
  }

  if (!apikey) {
    console.error("API Key not provided for file upload service.");
    throw new Error("API Key is required for file uploads.");
  }

  const aiForFiles = new GoogleGenAI({ apiKey: apikey });

  for (const [_key, file] of fileEntries) {
    const fileSizeLimitForBase64 = 5 * 1024 * 1024; // 5MB
    const isVideoFile = file.type.startsWith('video/');
    const isAudioFile = file.type.startsWith('audio/');
    const shouldUseFileAPI = isVideoFile || isAudioFile || file.size > fileSizeLimitForBase64;

    try {
      if (shouldUseFileAPI) {
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
      console.error(`完整错误对象详情 (fileProcessError in parseFormDataToContents):`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
      throw new Error(detailedMessage);
    }
  }
  return contents;
}

/**
 * Processes an AI request by interacting with the Google Gemini API.
 * This function handles both streamed and non-streamed responses.
 */
export async function processAIRequest(
  model: string,
  apikey: string,
  contents: Content[], // 明确类型为 Content[]
  streamEnabled: boolean,
  responseModalities: Modality[] = []
): Promise<ReadableStream<Uint8Array> | Array<Part>> {
  if (!apikey) {
    throw new Error("API Key is missing.");
  }
  if (!contents || contents.length === 0 || contents.every(content => !content.parts || content.parts.length === 0)) {
    throw new Error("No content provided to AI model for processing.");
  }

  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });

  // deno-lint-ignore no-explicit-any
  const generationConfig: any = {};
  if (responseModalities.length > 0) {
    generationConfig.responseMimeTypes = responseModalities;
  }

  try {
    if (streamEnabled) {
      const streamResult: GenerateContentStreamResult = await aiForGenerate.models.generateContentStream({
        model: model,
        contents: contents,
        generationConfig: generationConfig,
      });

      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) {
              if (chunk.candidates && chunk.candidates.length > 0 && chunk.candidates[0].content && chunk.candidates[0].content.parts) {
                controller.enqueue(encoder.encode(JSON.stringify(chunk.candidates[0].content.parts) + '\n'));
              } else if (chunk.candidates && chunk.candidates.length > 0 && chunk.candidates[0].finishReason) {
                // console.log("Stream chunk with finishReason:", chunk.candidates[0].finishReason);
              } else if (chunk.promptFeedback) {
                // console.warn("Stream received promptFeedback:", chunk.promptFeedback);
              }
            }
            controller.close();
          } catch (error) {
            console.error("Error during AI stream processing:", error);
            console.error(`完整错误对象详情 (stream processing error in processAIRequest):`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
            controller.error(error);
          }
        }
      });
    } else { // 非流式
      // 注意：这里的 result 类型是 GenerateContentResponse，但为了简单起见，我们直接用 any，然后检查其结构
      // SDK 更新后，GenerateContentResult 可能直接就是 GenerateContentResponse 的内容
      // deno-lint-ignore no-explicit-any
      const result: any = await aiForGenerate.models.generateContent({
        model: model,
        contents: contents,
        generationConfig: generationConfig,
      });
      
      // --- 关键修正点 ---
      // 直接从 result 访问 candidates，因为日志显示 result.response 是 undefined
      if (result && result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts) {
        return result.candidates[0].content.parts; // 返回 Part[]
      } else {
        // 如果上面的条件不满足，记录详细的 result 结构
        console.error("AI服务返回了意外的结构 (non-stream). 实际响应内容 (result):", JSON.stringify(result, null, 2));
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
        if (googleError.error && googleError.error.message) {
            detailedMessage += ` (Google API Error: ${googleError.error.message})`;
        } else if (googleError.message && googleError.message.includes("API key not valid")) {
            detailedMessage += ` (请检查API Key是否有效或已启用Gemini API)`;
        } else if (googleError.message && googleError.message.includes("User location is not supported")){
             detailedMessage += ` (Google API 错误: 用户地理位置不支持此操作，请检查代理或VPN设置)`;
        } else if (googleError.response && googleError.response.promptFeedback) {
             detailedMessage += ` (请求可能因安全或其他策略被阻止: ${JSON.stringify(googleError.response.promptFeedback)})`;
        }
    } else if (typeof error === 'object' && error !== null) {
        // deno-lint-ignore no-explicit-any
        const errorObj = error as any;
        if (errorObj.error && errorObj.error.message) {
             detailedMessage += ` - Google API 错误: ${errorObj.error.message}`;
        } else if (errorObj.response && errorObj.response.promptFeedback) {
             detailedMessage += ` (请求可能因安全或其他策略被阻止: ${JSON.stringify(errorObj.response.promptFeedback)})`;
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
    console.error(`完整AI生成错误对象详情 (processAIRequest catch block):`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw new Error(detailedMessage);
  }
}
