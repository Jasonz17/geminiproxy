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
    const info = modelInfo[selectedModel]; // Added semicolon here
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
    // Event listener for model selection change (assuming a select element with id 'model-select')
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        modelSelect.addEventListener('change', (event) => {
            updateModelInfo(event.target.value);
        });
        // Update info on initial load with the default selected model
        updateModelInfo(modelSelect.value);
    }

    // The temperature slider was removed, so no synchronization is needed.
    // The number input handles min, max, and step constraints via HTML attributes.


}