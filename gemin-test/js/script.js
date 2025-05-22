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
    } else {
        console.warn("Left sidebar toggle elements (list-icon or left-sidebar) not found.");
    }
});
