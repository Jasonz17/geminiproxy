// js/middle-area-up.js

// ... (keep existing imports and displayMessage signature) ...

export function displayMessage(message, chatDisplay) {
    const messageElement = document.createElement('div');
    if (message.type === 'user') {
        messageElement.classList.add('message', 'user');
    } else if (message.type === 'ai') {
        messageElement.classList.add('message', 'ai');
    }

    // Add marked library (ensure it's loaded)
    if (!window.marked) {
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = () => {
            window.marked.setOptions({ // Set options once loaded
                breaks: true,
                gfm: true,
                headerIds: false,
                mangle: false,
                smartLists: true,
                smartypants: false
            });
            renderMessageContent();
        };
        document.head.appendChild(markedScript);
    } else {
        // Ensure options are set if marked is already loaded
        if (!window.marked.defaults.breaks) { // Or a more robust check if options were set
             window.marked.setOptions({
                breaks: true,
                gfm: true,
                headerIds: false,
                mangle: false,
                smartLists: true,
                smartypants: false
            });
        }
        renderMessageContent();
    }

    function renderMessageContent() {
        let textContent = '';
        let mediaAndFileElements = [];

        if (Array.isArray(message.content)) {
            message.content.forEach(part => {
                if (part.text) {
                    textContent += part.text;
                } else if (part.inlineData) {
                    // ... (your existing inlineData handling)
                    const imgElement = document.createElement('img');
                    imgElement.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    imgElement.alt = 'Generated Image';
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    mediaAndFileElements.push(imgElement);
                } else if (part.fileData) {
                    // ... (your existing fileData handling)
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
                        videoElement.controls = true;
                        videoElement.style.maxWidth = '100%';
                        videoElement.style.height = 'auto';
                        mediaAndFileElements.push(videoElement);
                    } else if (mimeType.startsWith('audio/')) {
                        const audioElement = document.createElement('audio');
                        audioElement.src = uri;
                        audioElement.controls = true;
                        audioElement.style.maxWidth = '100%';
                        mediaAndFileElements.push(audioElement);
                    } else {
                        const fileLinkDiv = document.createElement('div');
                        fileLinkDiv.classList.add('message-displayed-file');
                        const fileName = uri.substring(uri.lastIndexOf('/') + 1) || '文件';
                        const cleanFileName = fileName.split('?')[0].split('#')[0];
                        const fileIconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
                        fileLinkDiv.innerHTML = `${fileIconSvg} <a href="${uri}" target="_blank" rel="noopener noreferrer">${cleanFileName} (${mimeType})</a>`;
                        mediaAndFileElements.push(fileLinkDiv);
                    }
                }
            });

            if (textContent) {
                const textDiv = document.createElement('div');
                // Trim trailing newlines/whitespace to prevent extra <br> at the end
                // For AI messages, newlines within the text (not double \n\n) should become <br>
                // Double newlines (\n\n) will correctly become separate <p> tags.
                const processedText = textContent.trim(); // Primarily targets trailing newlines
                textDiv.innerHTML = window.marked.parse(processedText);
                messageElement.appendChild(textDiv);
            }
            mediaAndFileElements.forEach(el => messageElement.appendChild(el));

        } else if (typeof message.content === 'string') { // Handle plain string content
            const textDiv = document.createElement('div');
             // Trim trailing newlines/whitespace
            const processedText = message.content.trim();
            textDiv.innerHTML = window.marked.parse(processedText);
            messageElement.appendChild(textDiv);
        }


        messageElement.querySelectorAll('pre code').forEach(block => {
            block.style.whiteSpace = 'pre-wrap';
            block.style.wordBreak = 'break-word';
        });

        chatDisplay.appendChild(messageElement);

        if (message.files && message.files.length > 0) {
            // ... (your existing file preview handling) ...
            const filePreviewContainer = document.createElement('div');
            filePreviewContainer.classList.add('message-file-preview-container');

            message.files.forEach(file => {
                const previewItem = document.createElement('div');
                previewItem.classList.add('message-preview-item');

                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    previewItem.appendChild(img);
                } else { // Display file name for non-image files
                    const iconDiv = document.createElement('div');
                    // Basic file icon (you can make this more sophisticated)
                    iconDiv.innerHTML = '📄'; 
                    iconDiv.style.fontSize = '24px'; // Adjust as needed
                    previewItem.appendChild(iconDiv);

                    const fileNameDiv = document.createElement('div');
                    fileNameDiv.classList.add('message-file-name');
                    fileNameDiv.textContent = file.name;
                    previewItem.appendChild(fileNameDiv);
                }
                filePreviewContainer.appendChild(previewItem);
            });
            chatDisplay.appendChild(filePreviewContainer);
        }

        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    }
}

export function initializeChatDisplay() {
    const chatDisplay = document.getElementById('chat-display');
    
    const welcomeMessage = {
        type: 'ai',
        content: '你好！我是AI助手，很高兴为您服务。请问有什么我可以帮您的吗？' // No trailing \n here
    };
    displayMessage(welcomeMessage, chatDisplay);
    
    return chatDisplay;
}
