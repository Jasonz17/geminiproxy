// js/middle-area-down.js

// 存储选中的文件
let selectedFiles = [];

// 存储当前聊天ID。初始为null，表示新会话。
let currentChatId = null;

// 文件类型映射
const fileTypeMap = {
    'image': '.png,.jpg,.jpeg,.webp,.heic,.heif',
    'document': '.pdf,.txt,.md,.csv,.xml',
    'code': '.js,.py,.html,.css,.md,.xml',
    'audio': '.wav,.mp3,.aiff,.aac,.ogg,.flac',
    'video': '.mp4,.mpeg,.mov,.avi,.flv,.wmv,.3gp,.webm'
};

// 定义工具图标和提示信息
const tooltipTexts = {
    'image': '格式支持：PNG, JPEG, WEBP, HEIC, HEIF',
    'document': '格式支持：PDF, TXT, Markdown, CSV, XML',
    'code': '格式支持：JavaScript, Python, HTML, CSS, Markdown, XML',
    'audio': '格式支持：WAV, MP3, AIFF, AAC, OGG Vorbis, FLAC',
    'video': '格式支持：MP4, MPEG, MOV, AVI, X-FLV, WMV, 3GPP, WEBM'
};

// 存储当前请求的控制器，用于中断请求
let currentController = null;

// 初始化输入区域
export function initializeInputArea(displayMessage) {
    const userInput = document.getElementById('user-input');
    const inputContainer = document.getElementById('input-container');
    const toolbarLeft = document.querySelector('.toolbar-left');
    let isStreamMode = false; // 初始流式响应状态

    // 创建文件预览容器
    const filePreviewContainer = document.createElement('div');
    filePreviewContainer.id = 'file-preview-container';
    filePreviewContainer.style.display = 'none'; // 初始隐藏
    inputContainer.insertBefore(filePreviewContainer, inputContainer.firstChild);

    // 初始化工具栏图标
    initializeToolbar(toolbarLeft, filePreviewContainer);

    // 输入框高度自动调整
    function adjustInputHeight() {
        userInput.style.height = 'auto';
        const maxHeight = parseInt(getComputedStyle(userInput).maxHeight, 10);
        const calculatedHeight = Math.max(userInput.scrollHeight, 40); // 最小高度40px
        userInput.style.height = Math.min(calculatedHeight, maxHeight) + 'px';
        userInput.style.overflowY = calculatedHeight >= maxHeight ? 'auto' : 'hidden';
        userInput.scrollTop = userInput.scrollHeight; // 确保滚动到底部
    }

    // 初始化高度并添加监听器
    adjustInputHeight();
    userInput.addEventListener('input', adjustInputHeight);

    // 添加流式响应开关按钮的点击事件
    const streamToggle = document.querySelector('.stream-toggle');
    if (streamToggle) {
        streamToggle.addEventListener('click', () => {
            isStreamMode = !isStreamMode;
            streamToggle.classList.toggle('active');
        });
    }

    // 添加发送按钮的点击事件
    const sendButton = document.querySelector('.send-button');
    if (sendButton) {
        sendButton.addEventListener('click', () => handleSendMessage(userInput, sendButton, filePreviewContainer, displayMessage, isStreamMode));
    }

    // 添加键盘事件监听
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // 阻止默认换行行为
            handleSendMessage(userInput, sendButton, filePreviewContainer, displayMessage, isStreamMode);
        }
    });
}

// 初始化工具栏
function initializeToolbar(toolbarLeft, filePreviewContainer) {
    const tools = ['image', 'document', 'code', 'audio', 'video'].map(type => {
        const icon = document.createElement('button');
        icon.className = 'toolbar-icon';
        icon.type = 'button';
        icon.setAttribute('data-type', type);
        
        const tooltip = document.createElement('span');
        tooltip.className = 'tooltip';
        tooltip.textContent = tooltipTexts[type];
        
        icon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${getIconPath(type)}
        </svg>`;
        
        icon.appendChild(tooltip);
        return icon;
    });

    tools.forEach(icon => {
        toolbarLeft.appendChild(icon);
        icon.addEventListener('click', () => handleToolClick(icon.getAttribute('data-type'), filePreviewContainer));
    });
}

// 处理工具按钮点击
function handleToolClick(type, filePreviewContainer) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = fileTypeMap[type];
    fileInput.multiple = true; // 允许选择多个文件
    
    fileInput.click(); // 模拟点击文件输入框
    
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            selectedFiles.push(file); // 添加到全局数组
            const fileName = file.name;
            const fileExt = fileName.substring(fileName.lastIndexOf('.'));
            const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
            const maxLength = 16; // 文件名显示最大长度
            const displayName = fileNameWithoutExt.length > maxLength - fileExt.length
                ? fileNameWithoutExt.substring(0, maxLength - fileExt.length) + '...' + fileExt
                : fileName;
            
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.dataset.fileName = fileName; // 存储原始文件名以便删除
            
            if (type === 'image') {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file); // 创建URL预览图片
                previewItem.appendChild(img);
            } else {
                const fileNameDiv = document.createElement('div');
                fileNameDiv.className = 'file-name';
                fileNameDiv.textContent = displayName;
                previewItem.appendChild(fileNameDiv);
            }
            
            const removeButton = document.createElement('div');
            removeButton.className = 'remove-file';
            removeButton.innerHTML = '×';
            removeButton.addEventListener('click', () => {
                // 从 selectedFiles 中移除对应文件
                selectedFiles = selectedFiles.filter(f => f.name !== file.name);
                previewItem.remove(); // 移除预览项
                if (selectedFiles.length === 0) {
                    filePreviewContainer.style.display = 'none'; // 没有文件时隐藏容器
                }
            });
            previewItem.appendChild(removeButton);
            
            filePreviewContainer.appendChild(previewItem);
            filePreviewContainer.style.display = 'flex'; // 显示容器
        });
    });
}

// 处理发送消息
async function handleSendMessage(userInput, sendButton, filePreviewContainer, displayMessage, isStreamMode) {
    const messageText = userInput.value.trim();
    const chatDisplay = document.getElementById('chat-display');
    if (!chatDisplay) {
        console.error('聊天显示区域未找到');
        return;
    }
    
    // 如果有正在进行的请求，则点击发送按钮表示中断
    if (currentController) {
        currentController.abort();
        currentController = null;
        sendButton.innerHTML = getSendButtonSvg(); // 恢复发送图标
        return;
    }
    
    // 只有当有文本或文件时才发送消息
    if (messageText || selectedFiles.length > 0) {
        // 显示用户消息和文件（如果文本或文件存在）
        // 传递一个包含文本和文件的对象给 displayMessage
        displayMessage({
            type: 'user',
            content: messageText, // 这里是纯文本
            files: selectedFiles // 这里是File对象数组，displayMessage会处理
        }, chatDisplay);

        const modelSelect = document.getElementById('model-select');
        const selectedModel = modelSelect.value;
        const apiKey = modelSelect.getAttribute('data-apikey'); // 从model-select获取API密钥

        // 验证API密钥
        if (!apiKey) {
            alert('请在设置中输入API Key！');
            // 移除加载动画
            const loadingAnimation = chatDisplay.lastChild;
            if (loadingAnimation && loadingAnimation.classList.contains('ai')) {
                loadingAnimation.remove();
            }
            return;
        }

        const formData = new FormData();
        formData.append('model', selectedModel);
        formData.append('apikey', apiKey);
        formData.append('input', messageText); // 用户输入的文本
        formData.append('stream', isStreamMode.toString());
        if (currentChatId) {
            formData.append('chatId', currentChatId.toString()); // 如果有chatId，则发送
        }

        selectedFiles.forEach((file, index) => {
            formData.append(`file${index}`, file); // 附加所有选中的文件
        });

        // 清空输入框和文件预览区
        userInput.value = '';
        userInput.style.height = 'auto'; // 重置输入框高度
        filePreviewContainer.innerHTML = '';
        selectedFiles = []; // 清空选中文件数组
        filePreviewContainer.style.display = 'none';

        // 设置中断控制器
        currentController = new AbortController();
        sendButton.innerHTML = getStopButtonSvg(); // 切换到停止图标

        // 创建AI消息元素并添加加载动画
        const aiMessageElement = document.createElement('div');
        aiMessageElement.classList.add('message', 'ai');
        const loadingElement = document.createElement('div');
        loadingElement.classList.add('loading-animation');
        loadingElement.innerHTML = '<div class="dot-pulse"></div>'; // 加载动画HTML
        aiMessageElement.appendChild(loadingElement);
        chatDisplay.appendChild(aiMessageElement);
        chatDisplay.scrollTop = chatDisplay.scrollHeight; // 滚动到底部

        try {
            const response = await fetch('/chat', { // *** 将 /process 改为 /chat ***
                method: 'POST',
                signal: currentController.signal,
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            // 移除加载动画
            loadingElement.remove();

            if (isStreamMode) {
                // 从响应头中获取chatId（流式响应）
                const chatIdHeader = response.headers.get('X-Chat-ID');
                if (chatIdHeader) {
                    currentChatId = parseInt(chatIdHeader, 10);
                    console.log('从流式响应头中获取到chatId:', currentChatId);
                }
                await handleStreamResponse(response, aiMessageElement, chatDisplay);
            } else {
                // 非流式响应处理
                const result = await response.json(); // 解析整个JSON响应
                // 从响应体中获取chatId
                if (result && result.chatId) {
                    currentChatId = result.chatId;
                    console.log('从非流式响应体中获取到chatId:', currentChatId);
                }
                await handleNormalResponse(result.response, aiMessageElement, chatDisplay); // 传入响应中的parts部分
            }

        } catch (error) {
            console.error('获取AI响应时出错:', error);
            if (error.name !== 'AbortError') { // 排除用户中断引起的错误
                // 确保加载动画被移除
                loadingElement.remove();
                // 显示错误消息
                aiMessageElement.innerHTML = ''; // 清空AI消息元素
                displayMessage({
                    type: 'ai',
                    content: `发生错误: ${error.message}`
                }, chatDisplay);
            }
        } finally {
            currentController = null; // 重置控制器
            sendButton.innerHTML = getSendButtonSvg(); // 恢复发送图标
        }
    }
}

// 处理流式响应
async function handleStreamResponse(response, aiMessageElement, chatDisplay) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = ''; // 累积文本内容，用于 marked 渲染
    let imageParts = []; // 累积图片部分

    // 清空 aiMessageElement 的初始内容（如加载动画）
    aiMessageElement.innerHTML = '';

    while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, {stream: true});
        const lines = chunk.split('\n').filter(line => line.trim()); // 按行分割，过滤空行
        
        for (const line of lines) {
            try {
                const parts = JSON.parse(line); // 每行是一个JSON数组
                parts.forEach(part => {
                    if (part.text) {
                        accumulatedContent += part.text;
                    } else if (part.inlineData) {
                        // 图像数据不能直接追加到 innerHTML，需要单独处理
                        // 如果有图片，我们先累积起来，等待所有文本渲染完再处理
                        imageParts.push(part);
                    }
                });
            } catch (e) {
                console.error('解析流式响应JSON块时出错:', e);
            }
        }
        
        // 每次收到新内容时更新文本部分
        if (accumulatedContent) {
            aiMessageElement.innerHTML = marked.parse(accumulatedContent);
        }
        // 对于图片，如果 accumulateContent 发生变化，需要重新插入图片，否则图片会丢失
        // 简单处理：每次更新时清除旧图片并重新添加
        aiMessageElement.querySelectorAll('img').forEach(img => img.remove());
        imageParts.forEach(part => {
            const imgElement = document.createElement('img');
            imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            imgElement.style.maxWidth = '100%';
            imgElement.style.height = 'auto';
            aiMessageElement.appendChild(imgElement);
        });

        // 确保滚动到最新消息
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    }
}

// 处理普通响应
async function handleNormalResponse(parts, aiMessageElement, chatDisplay) {
    aiMessageElement.innerHTML = ''; // 清空加载动画或之前的内容

    // 假设 parts 是一个数组，包含 text 和 inlineData 部分
    if (Array.isArray(parts)) {
        let textContent = '';
        parts.forEach(part => {
            if (part.text) {
                textContent += part.text;
            } else if (part.inlineData) {
                // 如果有图片数据，直接创建并附加图片元素
                const imgElement = document.createElement('img');
                imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                imgElement.style.maxWidth = '100%';
                imgElement.style.height = 'auto';
                aiMessageElement.appendChild(imgElement);
            }
        });
        // 将所有文本内容一次性用 marked 渲染
        aiMessageElement.innerHTML = marked.parse(textContent) + aiMessageElement.innerHTML; // 文本在前，图片在后
    } else {
        // 如果不是数组，假设是纯文本
        aiMessageElement.innerHTML = marked.parse(parts.toString());
    }

    // 确保滚动到最新消息
    chatDisplay.scrollTop = chatDisplay.scrollHeight;
}

// 获取SVG图标路径
function getIconPath(type) {
    const paths = {
        image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
        document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
        code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
        audio: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
        video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'
    };
    return paths[type] || '';
}

// 获取发送按钮SVG
function getSendButtonSvg() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>`;
}

// 获取停止按钮SVG
function getStopButtonSvg() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <rect x="8" y="8" width="8" height="8"></rect>
    </svg>`;
}
