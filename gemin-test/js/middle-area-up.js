// js/middle-area-up.js

// 显示消息的函数
export function displayMessage(message, chatDisplay) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', message.type === 'user' ? 'user-message' : 'ai-message');

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
        // message.content 可以是字符串（纯文本），也可以是AI返回的 parts 数组
        if (Array.isArray(message.content)) {
            let textContent = '';
            // 遍历所有部分，文本累积，图片立即创建
            message.content.forEach(part => {
                if (part.text) {
                    textContent += part.text;
                } else if (part.inlineData) {
                    const imgElement = document.createElement('img');
                    imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    messageElement.appendChild(imgElement); // 图片直接添加
                }
            });
            // 最后一次性解析并设置文本内容
            if (textContent) {
                 // 使用 innerHTML = marked.parse(...) + messageElement.innerHTML;
                 // 这样可以将文本放在图片前面
                messageElement.innerHTML = marked.parse(textContent) + messageElement.innerHTML;
            }
        } else {
            // 处理纯文本响应或用户消息
            messageElement.innerHTML = marked.parse(message.content.toString());
        }

        // 处理代码块的样式
        messageElement.querySelectorAll('pre code').forEach(block => {
            block.style.whiteSpace = 'pre-wrap';
            block.style.wordBreak = 'break-word';
        });

        // 将消息元素添加到聊天显示区域
        chatDisplay.appendChild(messageElement);

        // 如果消息包含文件（来自用户消息），显示文件预览
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
