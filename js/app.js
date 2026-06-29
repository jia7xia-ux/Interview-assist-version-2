// app.js

// 1. 页面加载时自动检查登录状态（配合 index.html 中的弹窗）
document.addEventListener("DOMContentLoaded", function() {
    const savedCode = localStorage.getItem('access_code');
    const loginModal = document.getElementById('login-modal');
    if (!savedCode && loginModal) {
        loginModal.style.display = 'flex';
    }
});

// 2. 这里的 prompts 数组保持你原本的引用，结合 prompts.js 即可
// 假设你的 prompts.js 已经在 index.html 中提前引入了

const chatContainer = document.getElementById('chat-container');
const userInputElement = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let chatHistory = [];

// 初始化：可以根据需要塞入 system prompt
function initChat() {
    // 如果你有预设的 prompt，可以在这里加入 chatHistory
    // 比如: chatHistory.push({ role: "system", content: prompts[0].content });
}

// 👉 核心修改：发送消息到 Vercel 后端
async function sendMessage() {
    const text = userInputElement.value.trim();
    if (!text) return;

    // 1. 将用户消息渲染到界面上
    appendMessage(text, 'user');
    userInputElement.value = '';

    // 2. 将消息压入历史记录
    chatHistory.push({ role: "user", content: text });

    // 3. 显示 AI 正在输入的加载状态
    const loadingId = appendMessage('AI 正在思考中...', 'ai-loading');

    // 4. 👉 获取用户存在本地的暗号
    const code = localStorage.getItem('access_code') || '';

    try {
        // 5. 👉 将请求发送到你自己的 Vercel 后端路由
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // ❌ 已经安全地移除了前端的 Authorization Header
            },
            body: JSON.stringify({
                messages: chatHistory, // 将完整的聊天上下文传给后端
                code: code             // 👉 带着暗号让后端校验
            })
        });

        const data = await response.json();

        // 6. 👉 处理暗号错误的拦截情况
        if (data.isCodeError) {
            removeMessage(loadingId); // 移除加载动画
            alert(data.error);
            
            localStorage.removeItem('access_code'); // 清除错误暗号
            const codeInput = document.getElementById('access-code-input');
            const loginModal = document.getElementById('login-modal');
            
            if (codeInput) codeInput.value = '';
            if (loginModal) loginModal.style.display = 'flex'; // 重新弹窗
            return;
        }

        // 7. 正常接收并渲染 DeepSeek 的返回数据
        removeMessage(loadingId);
        if (data.choices && data.choices[0]) {
            const aiReply = data.choices[0].message.content;
            appendMessage(aiReply, 'ai');
            // 将 AI 的回复也压入上下文历史，以便多轮对话
            chatHistory.push({ role: "assistant", content: aiReply });
        } else {
            appendMessage('抱歉，服务器返回了不完整的数据，请稍后再试。', 'ai-error');
        }

    } catch (error) {
        console.error("请求失败:", error);
        removeMessage(loadingId);
        appendMessage('网络请求失败，请检查网络或暗号是否正确。', 'ai-error');
    }
}

// 辅助函数：向页面添加消息气泡（请根据你原本的 UI 样式名进行微调）
function appendMessage(text, sender) {
    const msgId = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = msgId;
    msgDiv.className = `message ${sender}-message`;
    msgDiv.innerText = text;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return msgId;
}

// 辅助函数：移除加载状态
function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// 绑定发送事件
sendBtn.addEventListener('click', sendMessage);
userInputElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// 初始化调用
initChat();
