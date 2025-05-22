// js/script.js

// 移除右面板相关引用
import { initializeTopArea } from './top-area.js';
import { initializeLeftSidebar } from './left-sidebar.js';
import { initializeMiddleArea } from './middle-area.js';

document.addEventListener('DOMContentLoaded', () => {
    initializeTopArea();
    initializeLeftSidebar();
    initializeMiddleArea();

    // 初始化左侧容器的展开/收起功能
    const listIcon = document.querySelector('.list-icon');
    const leftSidebar = document.getElementById('left-sidebar');
    
    listIcon.addEventListener('click', () => {
        leftSidebar.classList.toggle('collapsed');
    });
    
    // 获取DOM元素
    const userInput = document.getElementById('user-input');
    const chatDisplay = document.getElementById('chat-display');
    const sendButton = document.querySelector('.send-button');
    const streamToggle = document.querySelector('.stream-toggle');
    const apiKeyInput = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');

    // 初始化流式响应状态
    let isStreamEnabled = false;

    // 存储当前聊天ID
    let currentChatId = null;

    // 切换流式响应状态
    streamToggle.addEventListener('click', () => {
        isStreamEnabled = !isStreamEnabled;
        streamToggle.classList.toggle('active', isStreamEnabled);
    });

    // 发送消息处理函数
    async function handleSend() {
        const text = userInput.value.trim();
        if (!text) return;

        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            alert('请输入API Key');
            return;
        }

        // 添加用户消息
        addMessage(text, true);
        userInput.value = '';

        // 准备请求数据
        const formData = new FormData();
        formData.append('model', modelSelect.value);
        formData.append('apikey', apiKey);
        formData.append('input', text);
        formData.append('stream', isStreamEnabled.toString());

        // 如果存在当前聊天ID，则添加到formData
        if (currentChatId) {
            formData.append('chatId', currentChatId);
        }

        try {
            if (isStreamEnabled) {
                // 流式响应处理
                const response = await fetch('/chat', { // Change endpoint to /chat
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const aiMessageDiv = addMessage('');
                
                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, {stream: true});
                    const parts = JSON.parse(chunk);
                    
                    // 更新AI消息内容
                    let messageContent = '';
                    for (const part of parts) {
                        if (part.text) {
                            messageContent += part.text;
                        } else if (part.inlineData) {
                            // 处理图片数据
                            const imgSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                            messageContent += `<img src="${imgSrc}" alt="Generated Image" style="max-width: 100%">`;
                        }
                    }
                    aiMessageDiv.innerHTML = messageContent;
                }
            } else {
                // 非流式响应处理
                const response = await fetch('/chat', { // Change endpoint to /chat
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const result = await response.json(); // 接收包含chatId和response的对象
                const parts = result.response; // 获取AI响应内容
                
                // Update currentChatId with the chatId from the response
                if (result.chatId) {
                    currentChatId = result.chatId;
                    console.log(`Updated currentChatId to: ${currentChatId}`);
                }

                let messageContent = '';
                
                for (const part of parts) {
                    if (part.text) {
                        messageContent += part.text;
                    } else if (part.inlineData) {
                        // 处理图片数据
                        const imgSrc = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        messageContent += `<img src="${imgSrc}" alt="Generated Image" style="max-width: 100%">`;
                    }
                }
                
                addMessage(messageContent);
            }
        } catch (error) {
            console.error('Error:', error);
            addMessage(`发生错误: ${error.message}`);
        }
    }

    // 添加消息到聊天显示区域
    function addMessage(content, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        messageDiv.innerHTML = content;
        chatDisplay.appendChild(messageDiv);
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
        return messageDiv;
    }

    // 事件监听器
    sendButton.addEventListener('click', handleSend);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
});
