// js/middle-area-up.js

// 显示消息的函数
export function displayMessage(message, chatDisplay) {
    const messageElement = document.createElement('div');
    if (message.type === 'user') {
        messageElement.classList.add('message', 'user');
    } else if (message.type === 'ai') {
        messageElement.classList.add('message', 'ai');
    }

    // 确保 marked 库已加载并设置好选项
    const ensureMarkedIsReady = (callback) => {
        if (!window.marked) {
            const markedScript = document.createElement('script');
            markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
            markedScript.onload = () => {
                window.marked.setOptions({
                    breaks: true,        // 将换行符转换为 <br>
                    gfm: true,           // 启用 GitHub 风格的 Markdown
                    headerIds: false,    // 禁用标题ID
                    mangle: false,       // 禁用邮件地址混淆（如果你的 marked 版本支持）
                    // pedantic: false,  // 如果需要，可以关闭一些严格模式，但通常 gfm:true 更好
                    smartLists: true,    // 优化列表输出
                    smartypants: false   // 禁用智能标点转换
                });
                callback();
            };
            document.head.appendChild(markedScript);
        } else {
            // 如果 marked 已加载，确保选项是最新的（可选，如果选项固定不变则不需要每次都设置）
            // 为了简单起见，这里可以假设如果 marked 存在，选项已经被正确设置过一次
            // 或者，为了保险起见，可以再次设置：
            // window.marked.setOptions({ /* ... 你的选项 ... */ });
            callback();
        }
    };

    ensureMarkedIsReady(() => {
        renderMessageContent();
    });

    function renderMessageContent() {
        let textContent = '';
        let mediaAndFileElements = []; // 用于存储图片、视频、音频和文件链接元素

        // message.content 可以是字符串（纯文本），也可以是AI返回的 parts 数组
        if (Array.isArray(message.content)) {
            message.content.forEach(part => {
                if (part.text) {
                    textContent += part.text;
                } else if (part.inlineData) {
                    const imgElement = document.createElement('img');
                    imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    imgElement.alt = 'Generated Image';
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    mediaAndFileElements.push(imgElement);
                } else if (part.fileData) {
                    const mimeType = part.fileData.mimeType;
                    const uri = part.fileData.uri;

                    if (mimeType.startsWith('image/')) {
                        const imgElement = document.createElement('img');
                        imgElement.src = uri;
                        imgElement.alt = 'Uploaded Image';
                        imgElement.style.maxWidth = '100%';
                        imgElement.style.height = 'auto';
                        mediaAndFileElements.push(imgElement);
                    } else if (mimeType.startsWith('video/')) {
                        const videoElement = document.createElement('video');
                        videoElement.src = uri;
                        videoElement.controls = true;
                        videoElement.style.maxWidth = '100%';
                        videoElement.style.height = 'auto';
                        mediaAndFileElements.push(videoElement);
                    } else if (mimeType.startsWith('audio/')) {
                        const audioElement = document.createElement('audio');
                        audioElement.src = uri;
                        audioElement.controls = true;
                        audioElement.style.maxWidth = '100%';
                        mediaAndFileElements.push(audioElement);
                    } else {
                        const fileLinkDiv = document.createElement('div');
                        fileLinkDiv.classList.add('message-displayed-file');
                        const fileName = uri.substring(uri.lastIndexOf('/') + 1) || '文件';
                        const cleanFileName = fileName.split('?')[0].split('#')[0];
                        const fileIconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
                        fileLinkDiv.innerHTML = `${fileIconSvg} <a href="${uri}" target="_blank" rel="noopener noreferrer">${cleanFileName} (${mimeType})</a>`;
                        mediaAndFileElements.push(fileLinkDiv);
                    }
                }
            });

            if (textContent) {
                const textDiv = document.createElement('div');
                // 1. 先 trim 原始文本，去除首尾可能存在的空白（包括换行符）
                const processedText = textContent.trim();
                // 2. 使用 marked 解析处理过的文本
                const parsedHtml = window.marked.parse(processedText);
                // 3. 对 marked 解析后的 HTML 字符串再次 trim，去除 marked 可能添加的末尾换行符
                textDiv.innerHTML = parsedHtml.trim();
                messageElement.appendChild(textDiv);
            }
            // 将所有媒体和文件元素添加到消息元素
            mediaAndFileElements.forEach(el => messageElement.appendChild(el));

        } else if (typeof message.content === 'string') { // 处理纯文本响应或用户消息
            const textDiv = document.createElement('div');
            // 1. 先 trim 原始文本
            const processedText = message.content.trim();
            // 2. 使用 marked 解析
            const parsedHtml = window.marked.parse(processedText);
            // 3. 对解析后的 HTML 字符串再次 trim
            textDiv.innerHTML = parsedHtml.trim();
            messageElement.appendChild(textDiv);
        }


        // 处理代码块的样式 (如果需要，可以移到CSS中)
        messageElement.querySelectorAll('pre code').forEach(block => {
            block.style.whiteSpace = 'pre-wrap';
            block.style.wordBreak = 'break-word';
        });

        // 将消息元素添加到聊天显示区域
        chatDisplay.appendChild(messageElement);

        // 如果消息包含文件（来自用户消息，通常是当前发送的）
        if (message.files && message.files.length > 0) {
            const filePreviewContainer = document.createElement('div');
            filePreviewContainer.classList.add('message-file-preview-container');

            message.files.forEach(file => {
                const previewItem = document.createElement('div');
                previewItem.classList.add('message-preview-item');

                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    img.onload = () => URL.revokeObjectURL(img.src); // 释放对象 URL
                    previewItem.appendChild(img);
                } else {
                    // 对于非图片文件，显示一个通用图标和文件名
                    const iconDiv = document.createElement('div');
                    // 你可以使用更复杂的SVG或字体图标
                    iconDiv.innerHTML = '📄'; // 简单的文本图标
                    iconDiv.style.fontSize = '24px'; // 调整图标大小
                    iconDiv.style.textAlign = 'center';
                    previewItem.appendChild(iconDiv);

                    const fileNameDiv = document.createElement('div');
                    fileNameDiv.classList.add('message-file-name');
                    fileNameDiv.textContent = file.name;
                    previewItem.appendChild(fileNameDiv);
                }
                filePreviewContainer.appendChild(previewItem);
            });
            // 将文件预览容器添加到聊天显示区域，位于消息元素下方
            // 注意：如果用户消息和文件预览应该在同一个气泡内，则需要调整DOM结构
            // 目前的逻辑是消息气泡后跟一个文件预览容器（如果文件来自用户输入）
            chatDisplay.appendChild(filePreviewContainer);
        }

        // 确保滚动到最新消息
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    }
}

// 初始化聊天显示区域
export function initializeChatDisplay() {
    const chatDisplay = document.getElementById('chat-display');

    // 确保 marked 加载和选项设置在显示欢迎消息之前完成
    // 但由于 displayMessage 内部会处理 marked 加载，这里可以直接调用
    const welcomeMessage = {
        type: 'ai',
        content: '你好！我是AI助手，很高兴为您服务。请问有什么我可以帮您的吗？'
    };
    displayMessage(welcomeMessage, chatDisplay);

    return chatDisplay;
}
