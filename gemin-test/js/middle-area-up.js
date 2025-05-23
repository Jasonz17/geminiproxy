// js/middle-area-up.js

// 显示消息的函数
export function displayMessage(message, chatDisplay) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    if (message.type === 'user') {
        messageElement.classList.add('user-message');
    } else if (message.type === 'ai') {
        messageElement.classList.add('ai-message');
    }

    // 添加marked库的CDN引用 (确保只加载一次)
    if (!window.marked) {
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = () => {
            renderMessage();
        };
        document.head.appendChild(markedScript);
    } else {
        renderMessage();
    }

    function renderMessage() {
        let textContent = '';
        let mediaAndFileElements = []; // 用于存储图片、视频、音频和文件链接元素

        // message.content 可以是字符串（纯文本），也可以是AI返回的 parts 数组
        if (Array.isArray(message.content)) {
            // 遍历所有部分，文本累积，其他类型媒体/文件创建对应元素
            message.content.forEach(part => {
                if (part.text) {
                    textContent += part.text;
                } else if (part.inlineData) {
                    // 处理 Base64 编码的内联数据（通常是小图片）
                    const imgElement = document.createElement('img');
                    imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    imgElement.alt = 'Generated Image';
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    mediaAndFileElements.push(imgElement);
                } else if (part.fileData) {
                    // 处理外部文件 URI (大文件)
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
                        videoElement.controls = true; // 显示播放控制条
                        videoElement.style.maxWidth = '100%';
                        videoElement.style.height = 'auto';
                        mediaAndFileElements.push(videoElement);
                    } else if (mimeType.startsWith('audio/')) {
                        const audioElement = document.createElement('audio');
                        audioElement.src = uri;
                        audioElement.controls = true; // 显示播放控制条
                        audioElement.style.maxWidth = '100%';
                        mediaAndFileElements.push(audioElement);
                    } else {
                        // 对于其他文件类型（如PDF, 文档, 代码等），显示为链接或文件图标+名称
                        const fileLinkDiv = document.createElement('div');
                        fileLinkDiv.classList.add('message-displayed-file');
                        
                        // 从URI中尝试提取文件名，或者显示一个通用名称
                        const fileName = uri.substring(uri.lastIndexOf('/') + 1) || '文件';
                        // 移除URI中的查询参数和哈希
                        const cleanFileName = fileName.split('?')[0].split('#')[0];

                        // 添加一个文件图标 SVG (你可以根据需要替换为真实的图标)
                        const fileIconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>`;

                        fileLinkDiv.innerHTML = `${fileIconSvg} <a href="${uri}" target="_blank" rel="noopener noreferrer">${cleanFileName} (${mimeType})</a>`;
                        mediaAndFileElements.push(fileLinkDiv);
                    }
                }
            });
            // 最后一次性解析并设置文本内容
            if (textContent) {
                // 将 marked 渲染后的文本放在一个 div 中，以便和媒体元素分开管理
                const textDiv = document.createElement('div');
                // 配置 marked 选项，禁用自动段落包装
            marked.setOptions({
                breaks: true,  // 将换行符转换为 <br>
                gfm: true,     // 启用 GitHub 风格的 Markdown
                headerIds: false,  // 禁用标题ID
                mangle: false,     // 禁用段落ID
                smartLists: true,  // 优化列表输出
                smartypants: false // 禁用智能标点转换
            });
            textDiv.innerHTML = marked.parse(textContent);
                messageElement.appendChild(textDiv);
            }
            // 将所有媒体和文件元素添加到消息元素
            mediaAndFileElements.forEach(el => messageElement.appendChild(el));
        } else {
            // 处理纯文本响应或用户消息
            const textDiv = document.createElement('div');
            // 配置 marked 选项，禁用自动段落包装
            marked.setOptions({
                breaks: true,  // 将换行符转换为 <br>
                gfm: true,     // 启用 GitHub 风格的 Markdown
                headerIds: false,  // 禁用标题ID
                mangle: false,     // 禁用段落ID
                smartLists: true,  // 优化列表输出
                smartypants: false // 禁用智能标点转换
            });
            textDiv.innerHTML = marked.parse(message.content.toString());
            messageElement.appendChild(textDiv);
        }

        // 处理代码块的样式
        messageElement.querySelectorAll('pre code').forEach(block => {
            block.style.whiteSpace = 'pre-wrap';
            block.style.wordBreak = 'break-word';
        });

        // 将消息元素添加到聊天显示区域
        chatDisplay.appendChild(messageElement);

        // 如果消息包含文件（来自用户消息，通常是当前发送的），显示文件预览
        // 注意：这里的 message.files 是在 handleSendMessage 中直接从 File 对象创建的
        // 历史消息不会有 message.files，而是 message.content 中的 fileData/inlineData
        if (message.files && message.files.length > 0) {
            const filePreviewContainer = document.createElement('div');
            filePreviewContainer.classList.add('message-file-preview-container');

            message.files.forEach(file => {
                const previewItem = document.createElement('div');
                previewItem.classList.add('message-preview-item');

                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    previewItem.appendChild(img);
                } else {
                    const fileNameDiv = document.createElement('div');
                    fileNameDiv.classList.add('message-file-name');
                    fileNameDiv.textContent = file.name;
                    previewItem.appendChild(fileNameDiv);
                }
                filePreviewContainer.appendChild(previewItem);
            });
            // 将文件预览容器添加到聊天显示区域，位于消息元素下方
            chatDisplay.appendChild(filePreviewContainer);
        }

        // 确保滚动到最新消息
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    }
}

// 初始化聊天显示区域
export function initializeChatDisplay() {
    const chatDisplay = document.getElementById('chat-display');
    
    // 添加默认欢迎消息
    const welcomeMessage = {
        type: 'ai',
        content: '你好！我是AI助手，很高兴为您服务。请问有什么我可以帮您的吗？'
    };
    displayMessage(welcomeMessage, chatDisplay);
    
    return chatDisplay;
}
