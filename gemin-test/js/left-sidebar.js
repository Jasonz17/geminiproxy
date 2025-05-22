// js/left-sidebar.js

// Add JavaScript for the left sidebar here

// Model information data
const modelInfo = {
    'gemini-2.5-flash-preview-04-17': {
        maxInputToken: 1048576,
        maxOutputToken: 65536,
        rpd: '500 req/day',
        rpm: '10 RPM',
        inputTypes: '多模态',
        outputTypes: '文本'
    },
    'gemini-2.0-flash-preview-image-generation': {
        maxInputToken: 32000,
        maxOutputToken: 8192,
        rpd: '1500 req/day',
        rpm: '10 RPM',
        inputTypes: '多模态',
        outputTypes: '文本、图片'
    },
    'gemini-2.0-flash': {
        maxInputToken: 1048576,
        maxOutputToken: 8192,
        rpd: '1500 req/day',
        rpm: '15 RPM',
        inputTypes: '多模态',
        outputTypes: '文本'
    },
    'gemini-1.5-pro': {
        maxInputToken: 2097152,
        maxOutputToken: 8192,
        rpd: '1500 req/day',
        rpm: '15 RPM',
        inputTypes: '多模态',
        outputTypes: '文本'
    }
};

// Function to format number with thousand separators
function formatNumberWithCommas(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Function to update model information display
function updateModelInfo(selectedModel) {
    const info = modelInfo[selectedModel];
    // 确保 info 对象存在
    if (!info) {
        console.warn(`Model info not found for model: ${selectedModel}`);
        // 可以设置默认值或清空显示
        document.getElementById('max-input-token').textContent = 'N/A';
        document.getElementById('max-output-token').textContent = 'N/A';
        document.getElementById('rpd').textContent = 'N/A';
        document.getElementById('rpm').textContent = 'N/A';
        document.getElementById('input-types').textContent = 'N/A';
        document.getElementById('output-types').textContent = 'N/A';
        return;
    }

    const maxInputTokenElement = document.getElementById('max-input-token');
    if (maxInputTokenElement) {
        maxInputTokenElement.textContent = formatNumberWithCommas(info.maxInputToken);
    }
    const maxOutputTokenElement = document.getElementById('max-output-token');
    if (maxOutputTokenElement) {
        maxOutputTokenElement.textContent = formatNumberWithCommas(info.maxOutputToken);
    }
    const rpdElement = document.getElementById('rpd');
    if (rpdElement) {
        rpdElement.textContent = info.rpd;
    }
    const rpmElement = document.getElementById('rpm');
    if (rpmElement) {
        rpmElement.textContent = info.rpm;
    }
    const inputTypesElement = document.getElementById('input-types');
    if (inputTypesElement) {
        inputTypesElement.textContent = info.inputTypes;
    }
    const outputTypesElement = document.getElementById('output-types');
    if (outputTypesElement) {
        outputTypesElement.textContent = info.outputTypes;
    }
}

export function initializeLeftSidebar() {
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        modelSelect.addEventListener('change', (event) => {
            updateModelInfo(event.target.value);
        });
        // 确保在页面加载时调用一次，显示初始模型信息
        updateModelInfo(modelSelect.value);
    } else {
        console.error("Model select element not found, skipping left sidebar initialization.");
    }
}
