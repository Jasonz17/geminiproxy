// js/script.js

import { initializeTopArea } from './top-area.js';
import { initializeLeftSidebar } from './left-sidebar.js';
import { initializeMiddleArea } from './middle-area.js';

document.addEventListener('DOMContentLoaded', () => {
    initializeTopArea(); // 初始化顶部区域 (API Key等)
    initializeLeftSidebar(); // 初始化左侧边栏 (模型信息等)
    initializeMiddleArea(); // 初始化聊天显示和输入区域

    // 初始化左侧容器的展开/收起功能
    const listIcon = document.querySelector('.list-icon');
    const leftSidebar = document.getElementById('left-sidebar');
    
    if (listIcon && leftSidebar) {
        listIcon.addEventListener('click', () => {
            leftSidebar.classList.toggle('collapsed');
        });
    }

    // *** 移除所有与聊天消息发送、接收、API Key管理、模型选择等相关的冗余代码 ***
    // 这些功能现在都由 middle-area-down.js, middle-area-up.js, top-area.js 负责。
    // 以下变量和事件监听器都应该被移除或已在其他模块中处理。
    /*
    const userInput = document.getElementById('user-input');
    const chatDisplay = document.getElementById('chat-display'); // chatDisplay现在由middle-area-up.js初始化和管理
    const sendButton = document.querySelector('.send-button');
    const streamToggle = document.querySelector('.stream-toggle');
    const apiKeyInput = document.getElementById('api-key-input'); // apiKeyInput由top-area.js管理
    const modelSelect = document.getElementById('model-select'); // modelSelect由left-sidebar.js和top-area.js管理

    // 移除 初始化流式响应状态
    // 移除 存储当前聊天ID (currentChatId现在由middle-area-down.js管理)
    // 移除 切换流式响应状态 (streamToggle由middle-area-down.js管理)
    // 移除 发送消息处理函数 handleSend (由middle-area-down.js的handleSendMessage替代)
    // 移除 添加消息到聊天显示区域 addMessage (由middle-area-up.js的displayMessage替代)
    // 移除 事件监听器 sendButton, userInput (由middle-area-down.js管理)
    */
});
