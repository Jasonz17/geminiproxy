// src/services/ai.service.ts

import {
  GoogleGenAI,
  Modality,
  Part,
  FileMetadata,
  FileState,
  Content,
  GenerateContentRequest,
  GenerateContentResponse // chunk 的类型
  // GenerateContentStreamResult // 不再直接使用这个类型来解构 stream 和 response
} from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// pollFileState 和 fetchImageFromUrl 函数保持不变
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
        console.log(`文件 ${fileNameInApi} 状态已变为 ACTIVE.`);
        return fileMeta;
      }
      if (fileMeta.state === FileState.FAILED) throw new Error(`文件 ${fileNameInApi} 处理失败: ${fileMeta.error?.message || "未知错误"}`);
      console.log(`文件 ${fileNameInApi} 当前状态: ${fileMeta.state}, 等待 ${delayMs / 1000} 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`轮询文件 ${fileNameInApi} 状态时发生错误:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`文件 ${fileNameInApi} 在 ${maxRetries} 次尝试后仍未变为 ACTIVE 状态。`);
}

async function fetchImageFromUrl(imageUrl: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) return null;
    const imageBuffer = await response.arrayBuffer();
    return { data: new Uint8Array(imageBuffer), mimeType: contentType };
  } catch (error) { return null; }
}

export async function parseFormDataToContents(formData: FormData, inputText: string, apikey: string): Promise<Array<Part>> {
  const partsAccumulator: Array<Part> = [];
  let textContentForModel = inputText;
  const aiForFiles = new GoogleGenAI({ apiKey: apikey });
  const fileSizeLimitForBase64 = 5 * 1024 * 1024;
  const urlRegex = /(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp))/gi;
  const extractedUrls: string[] = [];
  let match;
  while ((match = urlRegex.exec(inputText)) !== null) extractedUrls.push(match[0]);

  if (extractedUrls.length > 0) {
    textContentForModel = inputText;
    for (const url of extractedUrls) textContentForModel = textContentForModel.replace(url, "");
    textContentForModel = textContentForModel.trim();
    for (const imageUrl of extractedUrls) {
      const imageData = await fetchImageFromUrl(imageUrl);
      if (imageData) {
        try {
          if (imageData.data.byteLength > fileSizeLimitForBase64) {
            const blob = new Blob([imageData.data], { type: imageData.mimeType });
            const fileNameFromUrl = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0].split('#')[0] || `downloaded_${Date.now()}`;
            const uploadResponse: any = await aiForFiles.files.upload({ file: blob, config: { mimeType: imageData.mimeType, displayName: fileNameFromUrl } });
            const initialFileMeta: FileMetadata = uploadResponse.file || uploadResponse;
            if (!initialFileMeta?.uri || !initialFileMeta?.name) throw new Error(`从URL(${imageUrl})下载的图片上传后未返回元数据`);
            let activeFileMeta: FileMetadata = initialFileMeta;
            if (initialFileMeta.state === FileState.PROCESSING) activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
            else if (initialFileMeta.state !== FileState.ACTIVE) throw new Error(`从URL(${imageUrl})下载的图片上传后状态为 ${initialFileMeta.state}`);
            if (!activeFileMeta?.uri) throw new Error(`轮询后未能获取从URL(${imageUrl})下载图片的活动URI`);
            partsAccumulator.push({ fileData: { mimeType: activeFileMeta.mimeType, fileUri: activeFileMeta.uri } });
          } else {
            partsAccumulator.push({ inlineData: { mimeType: imageData.mimeType, data: encodeBase64(imageData.data) } });
          }
        } catch (error) { partsAccumulator.push({ text: `[图片URL ${imageUrl} 处理失败: ${error instanceof Error ? error.message : String(error)}]` }); }
      }
    }
  }

  const fileEntries: Array<[string, File]> = [];
  for (const [key, value] of formData.entries()) if (value instanceof File) fileEntries.push([key, value]);
  if (!apikey && fileEntries.length > 0) throw new Error("处理文件需要API Key");

  for (const [_key, file] of fileEntries) {
    try {
      const shouldUseFileAPI = file.type.startsWith('video/') || file.type.startsWith('audio/') || file.size > fileSizeLimitForBase64;
      if (shouldUseFileAPI) {
        const uploadResponse: any = await aiForFiles.files.upload({ file: file, config: { mimeType: file.type, displayName: file.name } });
        const initialFileMeta: FileMetadata = uploadResponse.file || uploadResponse;
        if (!initialFileMeta?.uri || !initialFileMeta?.name) throw new Error(`文件 ${file.name} 上传后未返回元数据`);
        let activeFileMeta: FileMetadata = initialFileMeta;
        if (initialFileMeta.state === FileState.PROCESSING) activeFileMeta = await pollFileState(aiForFiles, initialFileMeta.name);
        else if (initialFileMeta.state !== FileState.ACTIVE) throw new Error(`文件 ${file.name} 上传后状态为 ${initialFileMeta.state} (非ACTIVE)`);
        if (!activeFileMeta?.uri) throw new Error(`轮询文件 ${file.name} 后未获取活动URI`);
        partsAccumulator.push({ fileData: { mimeType: activeFileMeta.mimeType, fileUri: activeFileMeta.uri } });
      } else {
        partsAccumulator.push({ inlineData: { mimeType: file.type, data: encodeBase64(await file.arrayBuffer()) } });
      }
    } catch (fileProcessError) {
      const detailedMessage = `处理文件失败: ${file.name} - ${(fileProcessError instanceof Error ? fileProcessError.message : String(fileProcessError))}`;
      partsAccumulator.push({ text: `[文件处理失败: ${file.name} - ${detailedMessage.substring(0, 200)}]` });
    }
  }
  if (textContentForModel.trim()) partsAccumulator.push({ text: textContentForModel });
  if (partsAccumulator.length === 0 && !inputText.trim()) {
      console.warn("输入为空，将发送一个空文本 part 以触发可能的默认响应或错误。");
      // partsAccumulator.push({ text: "" }); // 确保至少有一个 part
  }
  return partsAccumulator;
}


export async function processAIRequest(
  modelName: string,
  apikey: string,
  historyContents: Content[],
  streamEnabled: boolean,
  _requestedResponseMimeTypes: string[] = []
): Promise<ReadableStream<Uint8Array> | Array<Part>> {
  if (!apikey) throw new Error("API Key is missing.");
  if (!historyContents || historyContents.length === 0) {
    // 即使 historyContents 为空，如果 parseFormDataToContents 返回了有效的 userContentParts，
    // chat.route.ts 也会确保 fullAiContents (即这里的 historyContents) 至少包含当前用户的输入。
    // 因此，如果到这里 historyContents 仍然为空，说明连当前用户输入都是空的。
    console.warn("processAIRequest 收到空的 historyContents。");
    // 确保至少有一个空的 user content，以防 API 不接受完全空的 contents 数组
    // historyContents = [{role: 'user', parts: [{text: ""}]}];
    // 或者根据API要求，如果完全不允许空，则在此抛错
     throw new Error("No content provided to AI model (historyContents is empty).");
  }


  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });
  let finalContentsForAPI: Content[];

  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    const currentUserContent = historyContents[historyContents.length - 1];
    if (!currentUserContent?.parts?.length) {
        // 如果 parts 为空，但文本存在于 historyContents[...].parts[0].text，需要确保它被正确传递
        // 这里的逻辑是，如果 parts 数组本身不存在或为空，则报错。
        // parseFormDataToContents 如果只有空文本，会返回空 partsAccumulator。
        // chat.route.ts 中，如果 userContentParts 为空但 messageText 非空，会继续。
        // 如果 messageText 也为空，会返回400。
        // 所以理论上到这里，currentUserContent.parts 不应该完全没有。
        // 但为了保险，如果 parts 为空但有文本，我们构造一个。
        if (currentUserContent && currentUserContent.parts.length === 0 && historyContents[historyContents.length-1]?.parts[0]?.text === "") {
             finalContentsForAPI = [{ role: 'user', parts: [{text: ""}] }]; // 对于图像生成，至少需要一个空提示？
        } else {
            throw new Error("图像生成需要有效的当前用户提示 (parts are empty or undefined).");
        }
    } else {
        finalContentsForAPI = [{ role: 'user', parts: currentUserContent.parts }];
    }
  } else {
    finalContentsForAPI = historyContents;
  }

  // deno-lint-ignore no-explicit-any
  const requestOptions: any = { contents: finalContentsForAPI };
  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    requestOptions.config = { responseModalities: [Modality.TEXT, Modality.IMAGE] };
  } else if (_requestedResponseMimeTypes.length > 0) {
    requestOptions.generationConfig = { responseMimeTypes: _requestedResponseMimeTypes };
  }
  console.log(`构建的 requestOptions (model: ${modelName}):`, JSON.stringify(requestOptions, null, 2));

  try {
    const fullRequest = { model: modelName, ...requestOptions };

    if (streamEnabled) {
      console.log(`执行流式请求 (model: ${modelName})...`);
      // *** 严格按照您提供的和官方文档的简单模式 ***
      const stream = await aiForGenerate.models.generateContentStream(fullRequest);
      
      console.log(`generateContentStream 调用完成 (model: ${modelName}). 返回的 stream 对象:`, stream);

      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          try {
            // **直接迭代 generateContentStream 的返回值 (stream)**
            for await (const chunk of stream) { // chunk 的类型应该是 GenerateContentResponse
              // 从 chunk 中提取 parts
              // 官方示例使用 chunk.text()，但为了通用性和处理图片，我们检查 parts
              if (chunk.candidates?.[0]?.content?.parts) {
                const partsInChunk = chunk.candidates[0].content.parts;
                console.log(`流式块 (model: ${modelName}):`, JSON.stringify(partsInChunk));
                controller.enqueue(encoder.encode(JSON.stringify(partsInChunk) + '\n'));
              } else if (chunk.text && typeof chunk.text === 'function' && chunk.text().trim()) {
                // 备用方案：如果 chunk 有 text() 方法且内容非空 (纯文本模型的简化响应)
                const text = chunk.text();
                console.log(`流式块 (model: ${modelName}, text() method):`, text);
                controller.enqueue(encoder.encode(JSON.stringify([{text: text}]) + '\n'));
              } else if (chunk.candidates?.[0]?.finishReason) {
                console.log(`流式结束 (model: ${modelName}), 原因: ${chunk.candidates[0].finishReason}`);
              } else if (chunk.promptFeedback) {
                 console.warn(`流式收到 promptFeedback (model: ${modelName}):`, chunk.promptFeedback);
              } else {
                 console.log(`流式块 (model: ${modelName}) 未包含预期的 parts 或 text()。Chunk:`, JSON.stringify(chunk));
              }
            }
            console.log(`模型 ${modelName} 的流迭代完成。`);
            controller.close();
          } catch (error) {
            console.error(`迭代 stream (model: ${modelName}) 时出错:`, error);
            controller.error(error);
          }
        }
      });

    } else { // 非流式
      console.log(`执行非流式请求 (model: ${modelName})...`);
      // deno-lint-ignore no-explicit-any
      const result: any = await aiForGenerate.models.generateContent(fullRequest);
      if (result?.candidates?.[0]?.content?.parts) {
        return result.candidates[0].content.parts;
      } else {
        console.error("AI服务返回了意外的结构 (non-stream). 实际响应 (result):", JSON.stringify(result, null, 2));
        if (result?.promptFeedback?.blockReason) {
          throw new Error(`请求被阻止 (non-stream): ${result.promptFeedback.blockReason}`);
        }
        throw new Error("AI服务返回了意外的结构 (non-stream)");
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let detailedMessage = `AI模型生成内容错误 - ${errorMessage}`;
    const googleError = error as any;
    if (googleError.error?.message) detailedMessage += ` (API Error: ${googleError.error.message})`;
    else if (googleError.response?.promptFeedback?.blockReason) detailedMessage += ` (请求被阻止: ${googleError.response.promptFeedback.blockReason})`;
    console.error(`完整AI生成错误对象详情:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw new Error(detailedMessage);
  }
}
