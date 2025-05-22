// src/services/ai.service.ts

import {
  GoogleGenAI,
  Modality,
  Part,
  FileMetadata,
  FileState,
  Content,
  GenerateContentRequest,
  GenerateContentResponse, // 需要此类型来注解 chunk
  GenerateContentStreamResult
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
  if (partsAccumulator.length === 0 && !inputText.trim()) { // 确保如果只有空文本，也返回一个空的 text part，让 processAIRequest 判断
      console.warn("输入为空，将发送一个空文本 part 以触发可能的默认响应或错误。");
      // 或者，如果希望严格禁止完全空输入，可以在 chat.route.ts 中更早地阻止
      // partsAccumulator.push({ text: "" });
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
  // 允许 historyContents 为空数组，因为 parseFormDataToContents 可能会返回空数组（例如只有空文本输入）
  // 但 API 调用时 contents 至少要有一个 Part
  if (!historyContents) throw new Error("History/content array is undefined.");


  const aiForGenerate = new GoogleGenAI({ apiKey: apikey });
  let finalContentsForAPI: Content[];

  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    const currentUserContent = historyContents[historyContents.length - 1];
    // 确保 currentUserContent 和 parts 存在
    if (!currentUserContent?.parts || currentUserContent.parts.length === 0) {
        // 如果是图像生成但没有有效的 parts，这通常是个问题，除非模型能处理空parts（不太可能）
        // 为了安全，可以抛出错误或创建一个默认的空文本 part
        console.warn("图像生成模型收到空的 parts，将尝试发送。");
        // finalContentsForAPI = [{ role: 'user', parts: [{text: ""}] }]; // 或者抛错
        // 保持原样，让API决定如何处理
         if (!currentUserContent) { // 如果 historyContents 为空，currentUserContent 也是 undefined
            throw new Error("图像生成模型需要至少一个用户 Content。");
        }
        finalContentsForAPI = [{ role: 'user', parts: currentUserContent.parts }];

    } else {
        finalContentsForAPI = [{ role: 'user', parts: currentUserContent.parts }];
    }
    console.log(`图像生成模型 (${modelName}) 使用的 parts:`, JSON.stringify(finalContentsForAPI[0].parts));
  } else {
    // 对于其他模型，如果 historyContents 为空（例如，新对话且用户只输入了空文本），
    // 我们需要确保至少有一个 Content 对象，即使其 parts 为空或包含空文本。
    // parseFormDataToContents 如果输入为空文本且无文件，会返回空 Part[]
    // chat.route.ts 中，如果 userContentParts 为空，会检查原始文本和文件
    // 这里假设 historyContents 至少会有一条（即当前用户输入，即使是空的）
     if (historyContents.length === 0) {
        // 这不应该发生，因为 chat.route.ts 会确保 fullAiContents 至少有一条
        console.warn("historyContents 为空，但不是图像生成模型。将创建一个空的user content。");
        finalContentsForAPI = [{role: 'user', parts: [{text: ""}]}];
     } else {
        finalContentsForAPI = historyContents;
     }
  }
   if (finalContentsForAPI.length === 0 || finalContentsForAPI.every(c => c.parts.length === 0)) {
    throw new Error("最终发送给 API 的 contents 为空或不包含任何 parts。");
  }
  // console.log(`最终发送给 ${modelName} 的 contents 部分:`, JSON.stringify(finalContentsForAPI, null, 2));

  // deno-lint-ignore no-explicit-any
  const requestOptions: any = { contents: finalContentsForAPI };
  if (modelName === 'gemini-2.0-flash-preview-image-generation') {
    requestOptions.config = { responseModalities: [Modality.TEXT, Modality.IMAGE] };
    console.log(`图像生成模型 (${modelName}): 设置 config.responseModalities`);
  } else if (_requestedResponseMimeTypes.length > 0) {
    requestOptions.generationConfig = { responseMimeTypes: _requestedResponseMimeTypes };
    console.log(`模型 (${modelName}): 设置 generationConfig.responseMimeTypes`);
  }
  console.log(`构建的 requestOptions (model: ${modelName}):`, JSON.stringify(requestOptions, null, 2));

  try {
    const fullRequest = { model: modelName, ...requestOptions };

    if (streamEnabled) {
      console.log(`执行流式请求 (model: ${modelName})...`);
      // *** 严格按照官方文档示例的模式 ***
      const streamResult: GenerateContentStreamResult = await aiForGenerate.models.generateContentStream(fullRequest);
      
      // 官方文档直接迭代 streamResult.stream
      // 我们将信任 streamResult.stream 是可用的
      console.log(`generateContentStream 返回的 streamResult (model: ${modelName}): stream 属性是否存在: ${!!streamResult.stream}`);

      if (!streamResult || typeof streamResult.stream?.[Symbol.asyncIterator] !== 'function') {
          const errorMessage = `模型 ${modelName} 的 streamResult.stream 不是一个有效的异步迭代器或为 undefined。实际 streamResult.stream: ${streamResult?.stream}`;
          console.error(errorMessage);
          // 即使 stream 属性无效，也尝试从 response Promise 获取一次性数据
          if (streamResult && streamResult.response) {
              console.warn(`由于 stream 无效，尝试从 streamResult.response (model: ${modelName}) 获取数据...`);
              try {
                  const aggregatedResponse: GenerateContentResponse = await streamResult.response;
                  if (aggregatedResponse.candidates?.[0]?.content?.parts) {
                      const parts = aggregatedResponse.candidates[0].content.parts;
                      console.log(`从 streamResult.response (model: ${modelName}) 获取到数据:`, JSON.stringify(parts));
                      const encoder = new TextEncoder();
                      return new ReadableStream({
                          start(controller) {
                              controller.enqueue(encoder.encode(JSON.stringify(parts) + '\n'));
                              controller.close();
                          }
                      });
                  } else {
                       console.error(`streamResult.response (model: ${modelName}) 解析成功但未包含有效 parts:`, aggregatedResponse);
                       // 继续抛出原始的 stream 无效错误
                  }
              } catch (responseError) {
                   console.error(`等待或处理 streamResult.response (model: ${modelName}) 时出错:`, responseError);
                   // 继续抛出原始的 stream 无效错误
              }
          }
          throw new Error(errorMessage); // 如果 stream 无效且无法从 response 恢复，则抛错
      }


      const encoder = new TextEncoder();
      return new ReadableStream({
        async start(controller) {
          try {
            // **直接迭代 streamResult.stream**
            for await (const chunkResponse of streamResult.stream) { // chunkResponse is GenerateContentResponse
              // 从 chunkResponse 中提取 parts
              // 官方示例中 chunk.text() 是一个便捷方法，我们这里保持 parts 结构
              if (chunkResponse.candidates?.[0]?.content?.parts) {
                const partsInChunk = chunkResponse.candidates[0].content.parts;
                console.log(`流式块 (model: ${modelName}):`, JSON.stringify(partsInChunk));
                controller.enqueue(encoder.encode(JSON.stringify(partsInChunk) + '\n'));
              } else if (chunkResponse.candidates?.[0]?.finishReason) {
                console.log(`流式结束 (model: ${modelName}), 原因: ${chunkResponse.candidates[0].finishReason}`);
              } else if (chunkResponse.promptFeedback) {
                 console.warn(`流式收到 promptFeedback (model: ${modelName}):`, chunkResponse.promptFeedback);
              }
            }
            console.log(`模型 ${modelName} 的 streamResult.stream 迭代完成。`);
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
    // ... (错误处理逻辑不变)
    const errorMessage = error instanceof Error ? error.message : String(error);
    let detailedMessage = `AI模型生成内容错误 - ${errorMessage}`;
    const googleError = error as any;
    if (googleError.error?.message) detailedMessage += ` (API Error: ${googleError.error.message})`;
    else if (googleError.response?.promptFeedback?.blockReason) detailedMessage += ` (请求被阻止: ${googleError.response.promptFeedback.blockReason})`;
    console.error(`完整AI生成错误对象详情:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw new Error(detailedMessage);
  }
}
