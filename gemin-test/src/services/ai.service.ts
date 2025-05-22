// src/services/ai.service.ts

import { GoogleGenAI, Modality, Part, FileMetadata, FileState } from "npm:@google/genai"; // 导入需要的类型
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// 辅助函数：轮询文件状态
async function pollFileState(
  ai: GoogleGenAI,
  fileNameInApi: string, // 这是 files.upload 返回的 file.name，例如 "files/xxxx"
  maxRetries = 10,
  delayMs = 5000 // 5秒轮询一次
): Promise<FileMetadata> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`轮询文件状态 (${i + 1}/${maxRetries}): ${fileNameInApi}`);
      const fileMeta = await ai.files.get({ name: fileNameInApi }); // 使用 get 方法获取最新状态

      if (fileMeta.state === FileState.ACTIVE) {
        console.log(`文件 ${fileNameInApi} 状态已变为 ACTIVE. URI: ${fileMeta.uri}`);
        return fileMeta;
      } else if (fileMeta.state === FileState.FAILED) {
        console.error(`文件 ${fileNameInApi} 处理失败:`, fileMeta.error || "未知错误");
        throw new Error(`文件 ${fileNameInApi} 处理失败: ${fileMeta.error?.message || "未知错误"}`);
      }
      // 如果是 PROCESSING 或其他非最终状态，则等待后重试
      console.log(`文件 ${fileNameInApi} 当前状态: ${fileMeta.state}, 等待 ${delayMs / 1000} 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

    } catch (error) {
      // files.get 也可能失败
      console.error(`轮询文件 ${fileNameInApi} 状态时发生错误:`, error);
      if (i === maxRetries - 1) { // 最后一次尝试失败则抛出
          throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs)); // 等待后重试
    }
  }
  throw new Error(`文件 ${fileNameInApi} 在 ${maxRetries} 次尝试后仍未变为 ACTIVE 状态。`);
}


/**
 * Parses FormData to extract text input and file content for AI model.
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
        
        // files.upload() 返回的是 UploadFileResponse，但我们实际观察到它直接返回了 FileMetadata 结构
        // 为了代码健壮性，我们先假设它可能返回 UploadFileResponse，再检查直接属性
        // deno-lint-ignore no-explicit-any
        const uploadResponse: any = await aiForFiles.files.upload({
          file: file,
          config: {
            mimeType: file.type,
            displayName: file.name,
          }
        });

        // 从 uploadResponse 中提取 FileMetadata
        // SDK 定义是 uploadResponse.file，但日志显示 uploadResponse 直接就是 FileMetadata
        const initialFileMeta: FileMetadata = uploadResponse.file || uploadResponse;

        if (!initialFileMeta || !initialFileMeta.uri || !initialFileMeta.name) {
          console.error("File upload did not return expected metadata (uri or name):", initialFileMeta);
          throw new Error(`文件上传后未返回有效的元数据 (uri 或 name): ${file.name}`);
        }
        console.log(`文件上传初始响应 for ${file.name}: Name: ${initialFileMeta.name}, URI: ${initialFileMeta.uri}, State: ${initialFileMeta.state}`);

        let activeFileMeta: FileMetadata;
        if (initialFileMeta.state === FileState.PROCESSING) {
          console.log(`文件 ${initialFileMeta.name} 正在处理中，开始轮询状态...`);
          activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
        } else if (initialFileMeta.state === FileState.ACTIVE) {
          console.log(`文件 ${initialFileMeta.name} 上传后状态即为 ACTIVE.`);
          activeFileMeta = initialFileMeta;
        } else if (initialFileMeta.state === FileState.FAILED) {
            console.error(`文件 ${initialFileMeta.name} 上传后即为 FAILED 状态:`, initialFileMeta.error);
            throw new Error(`文件 ${initialFileMeta.name} 上传失败: ${initialFileMeta.error?.message || "未知上传错误"}`);
        }
         else {
          // 对于UNSPECIFIED或其他未知状态，也尝试轮询，或者直接报错
          console.warn(`文件 ${initialFileMeta.name} 状态未知 (${initialFileMeta.state}), 尝试轮询...`);
          activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
        }
        
        // 确保 activeFileMeta 存在且 URI 有效
        if (!activeFileMeta || !activeFileMeta.uri) {
             console.error("Failed to get active file metadata or URI is missing after polling for file:", file.name, activeFileMeta);
             throw new Error(`轮询后未能获取活动文件元数据或URI丢失: ${file.name}`);
        }


        contents.push({
          fileData: {
            mimeType: activeFileMeta.mimeType, // 使用从元数据获取的MIME类型
            uri: activeFileMeta.uri,
          },
        });

      } else { // Base64 编码逻辑保持不变
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
      // ... (错误处理逻辑保持不变) ...
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

// processAIRequest 函数保持不变 (使用上一版本给出的)
// ... (processAIRequest 函数的完整代码，如上一条回复所示) ...
export async function processAIRequest(
  model: string,
  apikey: string,
  contents: Content[],
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
    } else { 
      // deno-lint-ignore no-explicit-any
      const result: any = await aiForGenerate.models.generateContent({
        model: model,
        contents: contents,
        generationConfig: generationConfig,
      });
      
      if (result && result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts) {
        return result.candidates[0].content.parts;
      } else {
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
