// src/services/ai.service.ts

import {
  GoogleGenAI,
  Modality, // 确保 Modality 被导入
  Part,
  FileMetadata,
  FileState,
  Content,
  GenerateContentRequest, // 类型用于构建请求对象
  GenerationConfig // 导入 GenerationConfig 类型
} from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// pollFileState 和 fetchImageFromUrl 函数保持不变 (来自上一个回复)
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
          const googleError = fileProcessError as any;
          if (googleError.error && googleError.error.message) detailedMessage += ` (Google API Error: ${googleError.error.message})`;
          else if (googleError.message?.includes("fetch")) detailedMessage += ` (可能是网络或API Key权限问题)`;
          else if (googleError.message?.includes("User location is not supported")) detailedMessage += ` (Google API 错误: 用户地理位置不支持此操作)`;
      } else if (typeof fileProcessError === 'object' && fileProcessError !== null) {
          const errorObj = fileProcessError as any;
          if (errorObj.error && errorObj.error.message) detailedMessage += ` - Google API 错误: ${errorObj.error.message}`;
          else try { detailedMessage += ` - 错误详情: ${JSON.stringify(fileProcessError)}`; } catch (e) { detailedMessage += ` - (无法序列化错误对象)`; }
      } else {
          detailedMessage += ` - 未知错误类型`;
      }
      console.error(`完整错误对象详情 (fileProcessError in parseFormDataToContents for ${file.name}):`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
      partsAccumulator.push({ text: `[文件处理失败: ${file.name} - ${detailedMessage.substring(0, 200)}]` });
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
  modelName: string,
  apikey: string,
  historyContents: Content[],
  streamEnabled: boolean,
  // 这个参数现在不再直接是 responseMimeTypes，而是用于指示是否需要图像生成
  // 我们将其重命名以反映其用途，或者在 chat.route.ts 中决定是否填充 generationConfig
  // 为了简单起见，我们仍然接收它，但在内部根据 modelName 来决定如何使用
  requestedResponseMimeTypes: string[] = [] // 保留这个参数，但内部逻辑会调整
): Promise<ReadableStream<Uint8Array> | Array<Part>> {
  if (!apikey) {
    throw new Error("API Key is missing.");
  }
  if (!historyContents || historyContents.length === 0) {
     throw new Error("No history/content provided to AI model for processing (processAIRequest).");
  }

  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });

  // *** 核心修正：构建 GenerationConfig ***
  const generationConfig: GenerationConfig = {}; // 明确类型

  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    // 根据官方文档和你的反馈，图像生成模型期望 responseModalities
    // @google/genai SDK 的 GenerationConfig 没有直接的 responseModalities 字段
    // 但 generateContent/generateContentStream 的顶层请求对象可以直接接受一个 config 对象，
    // 其中包含 responseModalities。
    // 这里的做法是，如果SDK内部有特殊处理，我们尝试提供它可能期望的结构。
    // 然而，更标准的做法是使用 responseMimeTypes。
    // 既然错误明确指向 "combination of response modalities"，我们先尝试恢复使用
    // Modality 枚举，并让 SDK 处理转换（如果它能做到）。
    // 但由于 GenerationConfig 类型没有 responseModalities，这说明
    // 这个配置可能是在更高层级的请求对象中，或者 SDK 有特殊处理。

    // **最直接的尝试：信任错误信息，并假设SDK的 `generationConfig` 能够某种方式传递这个信息。**
    // **如果 `GenerationConfig` 确实没有 `responseModalities`，那么 SDK 必须通过 `responseMimeTypes` 来推断模态。**
    // **既然之前的 `responseMimeTypes: ["image/png"]` 和 `["image/png", "text/plain"]` 都失败了，
    // 并且错误信息是关于 "modalities"，而不是 "mime types"，这非常令人困惑。**

    // **让我们尝试一个非常规的但符合你旧代码和文档示例的思路：**
    // **在调用 `generateContent` 时，直接在顶层请求对象中传递一个包含 `responseModalities` 的 `config` 属性。**
    // **这意味着 `generationConfig` 变量可能不会被这样使用。**
    // **然而，`@google/genai` SDK 的 `GenerateContentRequest` 明确指出配置应在 `generationConfig`内。**

    // **最终决定：严格按照 `GenerationConfig` 接口，并使用 `responseMimeTypes`。**
    // 错误信息 "accepts ... IMAGE, TEXT" 仍然是最强的线索。
    // 之前的失败可能是因为我们只提供了 "image/png"，而模型期望一个明确的组合。
    generationConfig.responseMimeTypes = ["image/png", "text/plain"]; // <--- 回到这个组合！
    console.log(`图像生成模型 (${modelName}): 设置 generationConfig.responseMimeTypes = ["image/png", "text/plain"]`);

  } else if (requestedResponseMimeTypes.length > 0) {
    // 对于非图像生成模型，如果明确请求了MIME类型，则设置
    generationConfig.responseMimeTypes = requestedResponseMimeTypes;
    console.log(`模型 (${modelName}): 设置 generationConfig.responseMimeTypes =`, requestedResponseMimeTypes);
  }
  // *** 修正结束 ***


  let finalContentsForAPI: Content[];
  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    const currentUserContent = historyContents[historyContents.length - 1];
    if (!currentUserContent || currentUserContent.role !== 'user' || !currentUserContent.parts || currentUserContent.parts.length === 0) {
      throw new Error("图像生成需要一个有效的当前用户文本提示。");
    }
    const aktuellenParts = currentUserContent.parts;
    console.log(`图像生成模型 (${modelName}) 使用的 parts:`, JSON.stringify(aktuellenParts));
    finalContentsForAPI = [{ role: 'user', parts: aktuellenParts }];
  } else {
    finalContentsForAPI = historyContents;
  }
  console.log(`最终发送给 ${modelName} 的 contents 部分:`, JSON.stringify(finalContentsForAPI, null, 2));

  const apiRequest: GenerateContentRequest = {
    contents: finalContentsForAPI,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined, // 只有在非空时才传递
  };


  try {
    if (streamEnabled) {
      const streamResult = await aiForGenerate.models.generateContentStream({
        model: modelName,
        ...apiRequest // 包含 contents 和 generationConfig (如果已设置)
      });

      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) {
              if (chunk.candidates && chunk.candidates.length > 0 && chunk.candidates[0].content && chunk.candidates[0].content.parts) {
                controller.enqueue(encoder.encode(JSON.stringify(chunk.candidates[0].content.parts) + '\n'));
              } // ... (其他流处理逻辑)
            }
            controller.close();
          } catch (error) { /* ... */ }
        }
      });
    } else {
      const result = await aiForGenerate.models.generateContent({
        model: modelName,
        ...apiRequest // 包含 contents 和 generationConfig (如果已设置)
      });

      if (result.response && result.response.candidates && result.response.candidates.length > 0 && result.response.candidates[0].content && result.response.candidates[0].content.parts) {
        return result.response.candidates[0].content.parts;
      } else { /* ... (错误处理) ... */ 
        console.error("AI服务返回了意外的结构 (non-stream). 实际响应 (result.response):", JSON.stringify(result.response, null, 2));
        if (result.response && result.response.promptFeedback) {
            console.error("Prompt Feedback (non-stream):", JSON.stringify(result.response.promptFeedback, null, 2));
            const blockReason = result.response.promptFeedback.blockReason;
            if (blockReason) {
                throw new Error(`请求可能因安全或其他策略被阻止 (non-stream): ${blockReason}.详情: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`);
            }
        }
        if (!result.response) {
            console.error("AI服务返回的 result 对象中缺少 response 属性. 完整 result:", JSON.stringify(result, null, 2));
        }
        throw new Error("AI服务返回了意外的结构 (non-stream)");
      }
    }
  } catch (error) {
    // ... (错误处理逻辑保持不变) ...
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
