// src/services/ai.service.ts

import {
  GoogleGenAI,
  Modality,
  Part,
  FileMetadata,
  FileState,
  Content,
  GenerateContentResult,
  GenerateContentStreamResult
} from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// 辅助函数：轮询文件状态
async function pollFileState(
  ai: GoogleGenAI,
  fileNameInApi: string,
  maxRetries = 10,
  delayMs = 5000
): Promise<FileMetadata> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`轮询文件状态 (${i + 1}/${maxRetries}): ${fileNameInApi}`);
      const fileMeta = await ai.files.get({ name: fileNameInApi });

      if (fileMeta.state === FileState.ACTIVE) {
        console.log(`文件 ${fileNameInApi} 状态已变为 ACTIVE. URI: ${fileMeta.uri}`);
        return fileMeta;
      } else if (fileMeta.state === FileState.FAILED) {
        console.error(`文件 ${fileNameInApi} 处理失败:`, fileMeta.error || "未知错误");
        throw new Error(`文件 ${fileNameInApi} 处理失败: ${fileMeta.error?.message || "未知错误"}`);
      }
      console.log(`文件 ${fileNameInApi} 当前状态: ${fileMeta.state}, 等待 ${delayMs / 1000} 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

    } catch (error) {
      console.error(`轮询文件 ${fileNameInApi} 状态时发生错误:`, error);
      if (i === maxRetries - 1) {
          throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`文件 ${fileNameInApi} 在 ${maxRetries} 次尝试后仍未变为 ACTIVE 状态。`);
}

async function fetchImageFromUrl(imageUrl: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
  try {
    console.log(`正在从 URL 下载图片: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`下载图片失败 ${imageUrl}: ${response.status} ${response.statusText}`);
      return null;
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      console.error(`URL ${imageUrl} 返回的不是有效的图片MIME类型: ${contentType}`);
      return null;
    }
    const imageBuffer = await response.arrayBuffer();
    console.log(`图片下载成功: ${imageUrl}, 大小: ${imageBuffer.byteLength} bytes, 类型: ${contentType}`);
    return { data: new Uint8Array(imageBuffer), mimeType: contentType };
  } catch (error) {
    console.error(`从 URL 下载图片时发生错误 ${imageUrl}:`, error);
    return null;
  }
}

export async function parseFormDataToContents(formData: FormData, inputText: string, apikey: string): Promise<Array<Part>> {
  const partsAccumulator: Array<Part> = [];
  let textContentForModel = inputText;

  const aiForFiles = new GoogleGenAI({ apiKey: apikey });
  const fileSizeLimitForBase64 = 5 * 1024 * 1024; // 5MB

  const urlRegex = /(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp))/gi;
  const extractedUrls: string[] = [];
  let match;
  while ((match = urlRegex.exec(inputText)) !== null) {
    extractedUrls.push(match[0]);
  }

  if (extractedUrls.length > 0) {
    textContentForModel = inputText;
    for (const url of extractedUrls) {
        textContentForModel = textContentForModel.replace(url, "");
    }
    textContentForModel = textContentForModel.trim();

    for (const imageUrl of extractedUrls) {
      const imageData = await fetchImageFromUrl(imageUrl);
      if (imageData) {
        try {
          if (imageData.data.byteLength > fileSizeLimitForBase64) {
            const blob = new Blob([imageData.data], { type: imageData.mimeType });
            const fileNameFromUrl = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0].split('#')[0] || `downloaded_${Date.now()}`;
            // deno-lint-ignore no-explicit-any
            const uploadResponse: any = await aiForFiles.files.upload({
              file: blob,
              config: { mimeType: imageData.mimeType, displayName: fileNameFromUrl }
            });
            const initialFileMeta: FileMetadata = uploadResponse.file || uploadResponse;
            if (!initialFileMeta?.uri || !initialFileMeta?.name) throw new Error(`从URL(${imageUrl})下载的图片上传后未返回元数据`);
            
            let activeFileMeta: FileMetadata = initialFileMeta;
            if (initialFileMeta.state === FileState.PROCESSING) {
              activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
            } else if (initialFileMeta.state !== FileState.ACTIVE) {
              throw new Error(`从URL(${imageUrl})下载的图片上传后状态为 ${initialFileMeta.state}`);
            }
            if (!activeFileMeta?.uri) throw new Error(`轮询后未能获取从URL(${imageUrl})下载图片的活动URI`);
            partsAccumulator.push({ fileData: { mimeType: activeFileMeta.mimeType, fileUri: activeFileMeta.uri } });
            console.log(`已添加来自URL的图片 (File API): ${imageUrl}`);
          } else {
            const base64Data = encodeBase64(imageData.data);
            partsAccumulator.push({ inlineData: { mimeType: imageData.mimeType, data: base64Data } });
            console.log(`已添加来自URL的图片 (Base64): ${imageUrl}`);
          }
        } catch (error) {
            console.error(`处理来自URL ${imageUrl} 的图片时出错:`, error instanceof Error ? error.message : String(error));
            partsAccumulator.push({ text: `[图片URL ${imageUrl} 处理失败: ${error instanceof Error ? error.message : String(error)}]` });
        }
      }
    }
  }

  const fileEntries: Array<[string, File]> = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) fileEntries.push([key, value]);
  }

  if (!apikey && fileEntries.length > 0) throw new Error("处理文件需要API Key");

  for (const [_key, file] of fileEntries) {
    try {
      const isVideoFile = file.type.startsWith('video/');
      const isAudioFile = file.type.startsWith('audio/');
      const shouldUseFileAPI = isVideoFile || isAudioFile || file.size > fileSizeLimitForBase64;

      if (shouldUseFileAPI) {
        console.log(`正在通过 File API 上传文件: ${file.name}, 类型: ${file.type}, 大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        // deno-lint-ignore no-explicit-any
        const uploadResponse: any = await aiForFiles.files.upload({
          file: file,
          config: { mimeType: file.type, displayName: file.name }
        });
        const initialFileMeta: FileMetadata = uploadResponse.file || uploadResponse;
        if (!initialFileMeta?.uri || !initialFileMeta?.name) throw new Error(`文件 ${file.name} 上传后未返回元数据`);
        
        let activeFileMeta: FileMetadata = initialFileMeta;
        if (initialFileMeta.state === FileState.PROCESSING) {
          activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
        } else if (initialFileMeta.state !== FileState.ACTIVE) {
          throw new Error(`文件 ${file.name} 上传后状态为 ${initialFileMeta.state} (非ACTIVE)`);
        }
        if (!activeFileMeta?.uri) throw new Error(`轮询文件 ${file.name} 后未获取活动URI`);
        partsAccumulator.push({ fileData: { mimeType: activeFileMeta.mimeType, fileUri: activeFileMeta.uri } });
         console.log(`已添加来自FormData的文件 (File API): ${file.name}`);
      } else {
        console.log(`正在进行 Base64 编码: ${file.name}, 类型: ${file.type}, 大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        const fileBuffer = await file.arrayBuffer();
        const base64Data = encodeBase64(new Uint8Array(fileBuffer));
        partsAccumulator.push({ inlineData: { mimeType: file.type, data: base64Data } });
        console.log(`已添加来自FormData的文件 (Base64): ${file.name}`);
      }
    } catch (fileProcessError) {
      console.error(`处理FormData文件 ${file.name} 时出错:`, fileProcessError);
      let detailedMessage = `处理文件失败: ${file.name}`;
      if (fileProcessError instanceof Error) {
          detailedMessage += ` - ${fileProcessError.message}`;
          // deno-lint-ignore no-explicit-any
          const googleError = fileProcessError as any;
          if (googleError.error && googleError.error.message) detailedMessage += ` (Google API Error: ${googleError.error.message})`;
          else if (googleError.message?.includes("fetch")) detailedMessage += ` (可能是网络或API Key权限问题)`;
          else if (googleError.message?.includes("User location is not supported")) detailedMessage += ` (Google API 错误: 用户地理位置不支持此操作)`;
      } else if (typeof fileProcessError === 'object' && fileProcessError !== null) {
          // deno-lint-ignore no-explicit-any
          const errorObj = fileProcessError as any;
          if (errorObj.error && errorObj.error.message) detailedMessage += ` - Google API 错误: ${errorObj.error.message}`;
          else try { detailedMessage += ` - 错误详情: ${JSON.stringify(fileProcessError)}`; } catch (e) { detailedMessage += ` - (无法序列化错误对象)`; }
      } else {
          detailedMessage += ` - 未知错误类型`;
      }
      console.error(`完整错误对象详情 (fileProcessError in parseFormDataToContents for ${file.name}):`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
      partsAccumulator.push({ text: `[文件处理失败: ${file.name} - ${detailedMessage.substring(0, 200)}]` }); // 限制错误消息长度
    }
  }

  if (textContentForModel.trim()) {
    partsAccumulator.push({ text: textContentForModel });
    console.log(`已添加文本内容: "${textContentForModel}"`);
  } else if (partsAccumulator.length === 0 && (!inputText || !inputText.trim()) && fileEntries.length === 0 && extractedUrls.length === 0) {
    console.warn("所有输入（文本、文件、URL）均为空或处理失败，返回空parts数组。");
  }

  return partsAccumulator;
}

export async function processAIRequest(
  model: string,
  apikey: string,
  contentsArg: Content[],
  streamEnabled: boolean,
  responseMimeTypes: string[] = [] // 接收 string[]
): Promise<ReadableStream<Uint8Array> | Array<Part>> {
  if (!apikey) {
    throw new Error("API Key is missing.");
  }
  if (!contentsArg || contentsArg.length === 0 || contentsArg.every(contentItem => !contentItem.parts || contentItem.parts.length === 0)) {
     throw new Error("No content provided to AI model for processing (processAIRequest).");
  }

  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });

  // deno-lint-ignore no-explicit-any
  const generationConfig: any = {};
  if (responseMimeTypes.length > 0) {
    generationConfig.responseMimeTypes = responseMimeTypes; // 直接使用 string[]
    console.log(`在 processAIRequest 中设置 generationConfig.responseMimeTypes:`, responseMimeTypes);
  }

  try {
    if (streamEnabled) {
      const streamResult: GenerateContentStreamResult = await aiForGenerate.models.generateContentStream({
        model: model,
        contents: contentsArg,
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
      const result: any = await aiForGenerate.models.generateContent({ // 类型改为 GenerateContentResult
        model: model,
        contents: contentsArg,
        generationConfig: generationConfig,
      });

      if (result && result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts) {
        return result.candidates[0].content.parts;
      } else {
        console.error("AI服务返回了意外的结构 (non-stream). 实际响应内容 (result):", JSON.stringify(result, null, 2));
        if (result && result.promptFeedback) {
            console.error("Prompt Feedback (non-stream):", JSON.stringify(result.promptFeedback, null, 2));
            const blockReason = result.promptFeedback.blockReason;
            if (blockReason) {
                throw new Error(`请求可能因安全或其他策略被阻止 (non-stream): ${blockReason}.详情: ${JSON.stringify(result.promptFeedback.safetyRatings)}`);
            }
        }
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
        } else if (googleError.message && (googleError.message.includes("API key not valid") || googleError.message.includes("User location is not supported") || googleError.message.includes("Invalid JSON payload received") || googleError.message.includes("The requested combination of response modalities is not supported"))) {
            detailedMessage += ` (${googleError.message})`;
        } else if (googleError.response && googleError.response.promptFeedback) {
             detailedMessage += ` (请求可能因安全或其他策略被阻止: ${JSON.stringify(googleError.response.promptFeedback)})`;
        } else if (googleError.details && Array.isArray(googleError.details) && googleError.details.length > 0 && googleError.details[0].fieldViolations) {
            detailedMessage += ` (字段验证错误: ${JSON.stringify(googleError.details[0].fieldViolations)})`;
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
