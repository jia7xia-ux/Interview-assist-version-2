// app.js

// ==========================================
// 1. 页面加载与基础模块切换逻辑
// ==========================================
document.addEventListener("DOMContentLoaded", function() {
    // 检查暗号状态（配合 index.html 弹窗）
    const savedCode = localStorage.getItem('access_code');
    const loginModal = document.getElementById('login-modal');
    if (!savedCode && loginModal) {
        loginModal.style.display = 'flex';
    }

    // 初始化各个板块的点击切换（修复你之前点不了的问题）
    initNavigation();
});

function initNavigation() {
    const navs = [
        { btn: 'nav-workspace', view: 'view-workspace' },
        { btn: 'nav-tracker', view: 'view-tracker' },
        { btn: 'nav-calendar', view: 'view-calendar' },
        { btn: 'nav-debrief', view: 'view-debrief' }
    ];

    navs.forEach(item => {
        const btn = document.getElementById(item.btn);
        if (btn) {
            btn.addEventListener('click', () => {
                // 隐藏所有 section
                navs.forEach(n => {
                    const view = document.getElementById(n.view);
                    if (view) view.classList.add('hidden');
                });
                // 显示当前选中的 section
                const targetView = document.getElementById(item.view);
                if (targetView) targetView.classList.remove('hidden');
            });
        }
    });
}

// ==========================================
// 2. 👉 核心修改：对接工作台的 AI 策略请求
// ==========================================

// 绑定工作台四大硬核按钮
document.getElementById('btn-run-analysis')?.addEventListener('click', () => callWorkflow('analysis'));
document.getElementById('btn-run-qa')?.addEventListener('click', () => callWorkflow('qa'));
document.getElementById('btn-run-mock')?.addEventListener('click', () => callWorkflow('mock'));
document.getElementById('btn-run-cheat')?.addEventListener('click', () => callWorkflow('cheat'));

// 绑定复盘诊断按钮
document.getElementById('btn-debrief-ai-optimize')?.addEventListener('click', callDebriefWorkflow);

/**
 * 工作台 AI 核心请求沙箱
 * @param {string} type 策略类型 
 */
async function callWorkflow(type) {
    const resume = document.getElementById('textarea-resume-content')?.value.trim();
    const jd = document.getElementById('textarea-target-jd')?.value.trim();
    const company = document.getElementById('input-target-company')?.value.trim();
    const role = document.getElementById('input-target-role')?.value.trim();
    
    if (!resume || !jd) {
        alert('请先填写您的求职简历与目标岗位 JD 要求哦！');
        return;
    }

    // 拼装发送给大模型的 Prompt 上下文（这里可以结合你的 prompts.js）
    let systemPrompt = "你是一个专业的大厂面试官。"; 
    // 示例：可以根据 prompts.js 动态读取：systemPrompt = prompts[type];
    
    const userContent = `目标企业: ${company}\n目标岗位: ${role}\n\n【岗位JD】:\n${jd}\n\n【我的简历】:\n${resume}`;

    // 构建传递给后端的 messages 数组
    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ];

    // 调用统一的 Vercel 请求核心
    await requestVercelAI(messages, (resultText) => {
        const renderContainer = document.getElementById('workspace-markdown-render');
        const emptyState = document.getElementById('workspace-empty-state');
        
        if (renderContainer) {
            // 使用 marked.js 解析 markdown 并渲染
            renderContainer.innerHTML = marked.parse(resultText);
            renderContainer.classList.remove('hidden');
        }
        if (emptyState) emptyState.classList.add('hidden');
    });
}

/**
 * 面试复盘诊断 AI 请求
 */
async function callDebriefWorkflow() {
    const questions = document.getElementById('textarea-debrief-questions')?.value.trim();
    const reflections = document.getElementById('textarea-debrief-reflections')?.value.trim();

    if (!questions) {
        alert('请至少填写一行面试真题再现组数。');
        return;
    }

    const messages = [
        { role: "system", content: "你是一个大厂面试专家，请针对用户的面试表现进行高分话术优化。" },
        { role: "user", content: `【面试真题】:\n${questions}\n\n【我的现场应答与卡壳反思】:\n${reflections}` }
    ];

    await requestVercelAI(messages, (resultText) => {
        const renderContainer = document.getElementById('debrief-ai-render');
        const emptyState = document.getElementById('debrief-ai-empty');
        
        if (renderContainer) {
            renderContainer.innerHTML = marked.parse(resultText);
            renderContainer.classList.remove('hidden');
        }
        if (emptyState) emptyState.classList.add('hidden');
    });
}

/**
 * 📦 统一请求 Vercel 后端与暗号拦截核心函数
 */
async function requestVercelAI(messages, successCallback) {
    const loadingOverlay = document.getElementById('global-loading-overlay');
    const code = localStorage.getItem('access_code') || '';

    // 显示全局加载菊花
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        // 👉 将请求发送到 Vercel 后端路由
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: messages, 
                code: code // 带着暗号让后端校验
            })
        });

        const data = await response.json();

        // 隐藏加载状态
        if (loadingOverlay) loadingOverlay.classList.add('hidden');

        // 👉 处理暗号错误的拦截情况
        if (data.isCodeError) {
            alert(data.error);
            localStorage.removeItem('access_code'); // 清除错误暗号
            
            const codeInput = document.getElementById('access-code-input');
            const loginModal = document.getElementById('login-modal');
            if (codeInput) codeInput.value = '';
            if (loginModal) loginModal.style.display = 'flex'; // 重新弹窗拦截
            return;
        }

        // 正常接收并执行渲染
        if (data.choices && data.choices[0]) {
            const aiReply = data.choices[0].message.content;
            successCallback(aiReply);
        } else {
            alert('抱歉，服务器返回了不完整的数据，请稍后再试。');
        }

    } catch (error) {
        console.error("请求失败:", error);
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        alert('网络请求失败，请检查网络或暗号是否正确。');
    }
}
