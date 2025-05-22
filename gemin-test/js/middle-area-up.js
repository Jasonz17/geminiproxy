// js/middle-area-up.js

// 显示消息的函数
export function displayMessage(message, chatDisplay) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', message.type);

    // 添加marked库的CDN引用
    if (!window.marked) {
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        document.head.appendChild(markedScript);

        markedScript.onload = () => {
            renderMessage();
        };
    } else {
        renderMessage();
    }

    function renderMessage() {
        if (Array.isArray(message.content)) {
            message.content.forEach(part => {
                if (part.text) {
                    const textElement = document.createElement('div');
                    // 使用marked解析Markdown格式
                    textElement.innerHTML = marked.parse(part.text);
                    messageElement.appendChild(textElement);
                } else if (part.inlineData) {
                    const imgElement = document.createElement('img');
                    imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    messageElement.appendChild(imgElement);
                }
            });
        } else {
            // 处理纯文本响应，同样使用marked解析
            messageElement.innerHTML = marked.parse(message.content);
            // 处理代码块的样式
            messageElement.querySelectorAll('pre code').forEach(block => {
                block.style.whiteSpace = 'pre-wrap';
                block.style.wordBreak = 'break-word';
            });
        }

        chatDisplay.appendChild(messageElement);
        // 确保滚动到最新消息
        chatDisplay.scrollTop = chatDisplay.scrollHeight;

        // 如果消息包含文件，显示文件预览
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
                filePreviewContainer.style.display = 'flex';
            });
            // 将文件预览容器添加到聊天显示区域，位于消息元素下方
            chatDisplay.appendChild(filePreviewContainer);
        }

        // 滚动到最新消息
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