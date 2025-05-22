// js/middle-area.js

import { initializeChatDisplay, displayMessage } from './middle-area-up.js';
import { initializeInputArea } from './middle-area-down.js';

export function initializeMiddleArea() {
    // 初始化聊天显示区域
    const chatDisplay = initializeChatDisplay();
    
    // 初始化输入区域，传入displayMessage函数用于显示消息
    initializeInputArea((message) => {
        // 使用已经获取的chatDisplay变量，而不是重新获取元素
        displayMessage(message, chatDisplay);
    });
}