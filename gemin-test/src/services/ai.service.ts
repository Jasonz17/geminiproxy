// src/services/ai.service.ts

// 确保这里是 @google/genai，且类名是 GoogleGenAI
import { GoogleGenAI, Modality } from "npm:@google/genai";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/**
 * Parses FormData to extract text input and file content for AI model.
 * Handles base64 encoding for smaller files and uploads/references for larger ones.
 * @param formData The FormData object from the request.
 * @param inputText The main text input from the user.
 * @param apikey The API key to initialize GoogleGenAI for file uploads.
 * @returns An array of content parts suitable for the Gemini API.
 */
export async function parseFormDataToContents(formData: FormData, inputText: string, apikey: string): Promise<Array<any>> {
  const contents = [];

  // Handle text input
  if (inputText) {
    contents.push({ text: inputText });
  }

  // Handle files
  const fileEntries = Array.from(formData.entries()).filter(([key, value]) => value instanceof File);

  // Ensure API key is available for file uploads if needed
  if (!apikey) {
    console.error("API Key not provided for file upload service.");
    // It's better to throw an error that can be caught by the route handler and returned as a 4xx/5xx
    throw new Error("API Key is required for file uploads.");
  }

  const aiForFiles = new GoogleGenAI({ apiKey: apikey });
  // No need for a separate fileService variable if using aiForFiles.files directly

  for (const [_key, fileValue] of fileEntries) { // Renamed 'key' to '_key' as it's not used
    const file = fileValue as File; // Explicitly cast to File
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
          
          // >>> KEY CHANGE HERE <<<
          // Corrected call to the file upload API
          const uploadResult = await aiForFiles.files.upload({
            file: file, // Pass the File object
            config: {   // Configuration object
              mimeType: file.type,
              displayName: file.name,
            }
          });
          
          // Ensure uploadResult.file.uri is the correct path to access the URI
          if (!uploadResult.file || !uploadResult.file.uri) {
            console.error("File upload result did not contain expected file URI:", uploadResult);
            throw new Error(`文件上传成功但未返回有效的URI: ${file.name}`);
          }
          console.log(`文件上传完成 ${file.name}, URI: ${uploadResult.file.uri}`);

          contents.push({
            fileData: {
              mimeType: file.type,
              uri: uploadResult.file.uri, // Use the URI from the upload result
            },
          });
        }
      } catch (fileProcessError) {
        console.error(`处理文件 ${file.name} 时出错:`, fileProcessError);
        let detailedMessage = `处理文件失败: ${file.name}`;
        if (fileProcessError instanceof Error) {
            detailedMessage += ` - ${fileProcessError.message}`;
            // Check if it's a Google API error structure
            // deno-lint-ignore no-explicit-any
            const googleError = fileProcessError as any;
            if (googleError.error && googleError.error.message) {
                detailedMessage += ` (Google API Error: ${googleError.error.message})`;
            } else if (googleError.message && googleError.message.includes("fetch")) {
                detailedMessage += ` (可能是网络或API Key权限问题)`;
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
        console.error(`完整错误对象详情:`, JSON.stringify(fileProcessError, Object.getOwnPropertyNames(fileProcessError), 2));
        throw new Error(detailedMessage);
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

  const ai = new GoogleGenAI({ apiKey: apikey }); // This instance is for generateContent

  // deno-lint-ignore no-explicit-any
  const generationConfig: any = {};
  if (responseModalities.length > 0) {
    generationConfig.responseMimeTypes = responseModalities;
  }

  try {
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
        }
    } else if (typeof error === 'object' && error !== null) {
        // deno-lint-ignore no-explicit-any
        const errorObj = error as any;
        if (errorObj.error && errorObj.error.message) {
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
    console.error(`完整AI生成错误对象详情:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw new Error(detailedMessage);
  }
}
