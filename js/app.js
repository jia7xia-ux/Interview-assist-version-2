document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

let state = {
    settings: { apiKey: '', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    resumes: [
        { id: 'resume_a', name: '简历版本 A (例如：策略/运营方向)', content: '' },
        { id: 'resume_b', name: '简历版本 B (例如：产品/产品运营方向)', content: '' },
        { id: 'resume_c', name: '简历版本 C (例如：数据分析方向)', content: '' }
    ],
    applications: [], 
    events: [], // 秋招日程数组 { id, appId, title, date, startTime, endTime, type, notes }
    activeSession: { companyName: '', region: 'Singapore', roleTitle: '', language: 'bilingual', jd: '', results: {} },
    activeAppId: null, // 标记当前工作台会话绑定的看板记录 id（null 表示自由模式）
    calendarViewDate: new Date(), // 日历当前展示的月份/周
    calendarViewMode: 'month' // 'month' 或 'week'
};

function initApp() {
    const savedSettings = localStorage.getItem('interview_prep_settings');
    if (savedSettings) state.settings = JSON.parse(savedSettings);
    const savedResumes = localStorage.getItem('interview_prep_resumes');
    if (savedResumes) state.resumes = JSON.parse(savedResumes);
    
    const savedApps = localStorage.getItem('interview_prep_apps');
    if (savedApps) state.applications = JSON.parse(savedApps);

    const savedEvents = localStorage.getItem('interview_prep_events');
    if (savedEvents) state.events = JSON.parse(savedEvents);

    const savedSession = localStorage.getItem('interview_prep_active_session');
    if (savedSession) {
        try {
            state.activeSession = JSON.parse(savedSession);
        } catch (e) {
            console.warn('恢复上次会话失败:', e);
        }
    }
    const savedActiveAppId = localStorage.getItem('interview_prep_active_app_id');
    if (savedActiveAppId) state.activeAppId = JSON.parse(savedActiveAppId);

    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('track-date');
    if (dateInput) dateInput.value = today;

    // 配置 pdf.js worker
    if (window['pdfjsLib']) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    renderResumeBankInputs();
    renderApplications(); 
    setupEventListeners();
    checkApiKeyStatus();
    restoreActiveSessionToUI(); 
    restoreDebriefSessionToUI(); 
    renderCalendarView(); 
    renderUpcomingEvents();

    // 默认展示首个视图 (对接 Stitch 的内置控制)
    if (window.switchTab) {
        window.switchTab('tracker');
    }
}

// 恢复上次的录音复盘结果渲染回界面
function restoreDebriefSessionToUI() {
    const saved = localStorage.getItem('interview_prep_debrief_session');
    if (!saved) return;
    try {
        const session = JSON.parse(saved);
        if (session.report) {
            if (session.company) document.getElementById('debrief-company').value = session.company;
            if (session.role) document.getElementById('debrief-role').value = session.role;
            if (session.jd) document.getElementById('debrief-jd').value = session.jd;
            if (session.transcript) document.getElementById('debrief-transcript').value = session.transcript;

            const initialNode = document.getElementById('debrief-initial-state');
            if (initialNode) initialNode.classList.add('hidden');
            
            const reportRawNode = document.getElementById('debrief-report-raw');
            if (reportRawNode) {
                if (window.marked && window.marked.parse) {
                    reportRawNode.innerHTML = window.marked.parse(session.report);
                } else {
                    reportRawNode.innerText = session.report;
                }
            }
        }
    } catch (e) {
        console.warn('恢复复盘会话失败:', e);
    }
}

// 把 state.activeSession 中保存的结果渲染回工作台界面
function restoreActiveSessionToUI() {
    const session = state.activeSession;
    if (!session || !session.results || Object.keys(session.results).length === 0) return;

    if (session.companyName) document.getElementById('in-company').value = session.companyName;
    if (session.roleTitle) document.getElementById('in-role').value = session.roleTitle;
    if (session.jd) document.getElementById('in-jd').value = session.jd;
    if (session.region) document.getElementById('in-region').value = session.region;
    if (session.language) document.getElementById('in-lang').value = session.language;

    const tabKeyToPanel = {
        match: 'tab-panel-match-raw',
        business: 'tab-panel-business-raw',
        intro: 'tab-panel-intro-raw',
        star: 'tab-panel-star-raw',
        qa: 'tab-panel-qa-raw'
    };
    Object.entries(tabKeyToPanel).forEach(([key, panelId]) => {
        if (session.results[key]) renderMarkdown(panelId, session.results[key]);
    });

    const initialState = document.getElementById('initial-state');
    if (initialState) initialState.classList.add('hidden');

    // 默认激活第一个 AI 子标签页
    const firstTabBtn = document.querySelector('.tab-btn[data-tab="match"]');
    if (firstTabBtn) firstTabBtn.click();
}

// 清空当前工作台的生成结果
window.clearActiveSessionResults = () => {
    if (!confirm('确定要清空当前工作台的全部生成结果吗？此操作不可恢复。')) return;
    state.activeSession.results = {};
    localStorage.removeItem('interview_prep_active_session');

    if (state.activeAppId) {
        state.applications = state.applications.map(a => a.id === state.activeAppId ? { ...a, prepResults: {} } : a);
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
        renderApplications();
    }
    state.activeAppId = null;
    localStorage.removeItem('interview_prep_active_app_id');

    document.querySelectorAll('.tab-content-panel').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-primary', 'text-primary'));
    const initialState = document.getElementById('initial-state');
    if (initialState) initialState.classList.remove('hidden');
};

// 清空录音复盘报告
window.clearDebriefResults = () => {
    if (!confirm('确定要清空当前复盘报告吗？此操作不可恢复。')) return;
    localStorage.removeItem('interview_prep_debrief_session');

    const reportRawNode = document.getElementById('debrief-report-raw');
    if (reportRawNode) reportRawNode.innerHTML = '';
    const initialState = document.getElementById('debrief-initial-state');
    if (initialState) initialState.classList.remove('hidden');
};

function checkApiKeyStatus() {
    const banner = document.getElementById('api-warning-banner');
    if (banner) {
        if (!state.settings.apiKey) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
    }
}

function renderResumeBankInputs() {
    const container = document.getElementById('resume-bank-settings-container');
    if (!container) return;
    
    container.innerHTML = state.resumes.map(r => `
        <div class="mb-4 p-4 border border-outline-variant rounded-xl bg-surface-container-low">
            <div class="flex items-center justify-between mb-2 gap-2">
                <div class="flex-1">
                    <input type="text" value="${r.name}" onchange="updateResumeName('${r.id}', this.value)" class="bg-transparent border-b border-transparent hover:border-outline focus:border-primary font-semibold text-on-surface w-full focus:outline-none text-sm">
                </div>
                <label class="shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-medium cursor-pointer hover:shadow-md transition">
                    📄 上传 PDF
                    <input type="file" accept="application/pdf" class="hidden" onchange="handleResumePdfUpload('${r.id}', this)">
                </label>
            </div>
            <p id="pdf-status-${r.id}" class="text-xs text-primary mb-1 min-h-[16px] font-mono"></p>
            <textarea rows="4" placeholder="粘贴该版本的简历文本内容，或点击右上角上传 PDF 自动填入..." onchange="updateResumeContent('${r.id}', this.value)" class="w-full mt-1 p-2.5 bg-surface border border-outline-variant rounded-lg text-xs focus:ring-1 focus:ring-primary focus:outline-none font-mono text-on-surface-variant">${r.content || ''}</textarea>
        </div>
    `).join('');

    const selectionContainer = document.getElementById('resume-selectors');
    if (!selectionContainer) return;
    selectionContainer.innerHTML = state.resumes.map(r => `
        <label class="flex items-start gap-3 p-3 border border-outline-variant rounded-xl hover:bg-surface-container transition cursor-pointer text-xs">
            <input type="checkbox" name="selected_resumes" value="${r.id}" class="mt-0.5 rounded text-primary focus:ring-primary border-outline">
            <div class="flex-1">
                <span class="font-semibold text-on-surface block">${r.name}</span>
                <span class="text-[11px] text-on-surface-variant block mt-0.5">${r.content ? '已同步内容 (' + r.content.length + '字)' : '暂无内容文本'}</span>
            </div>
        </label>
    `).join('');
}

window.updateResumeName = (id, newName) => {
    state.resumes = state.resumes.map(r => r.id === id ? { ...r, name: newName } : r);
    localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));
    renderResumeBankInputs();
};

window.updateResumeContent = (id, content) => {
    state.resumes = state.resumes.map(r => r.id === id ? { ...r, content: content } : r);
    localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));
    renderResumeBankInputs();
};

window.handleResumePdfUpload = async (resumeId, inputEl) => {
    const file = inputEl.files[0];
    if (!file) return;

    const statusEl = document.getElementById(`pdf-status-${resumeId}`);
    if (!window['pdfjsLib']) {
        if (statusEl) statusEl.innerText = `❌ PDF 解析库未同步，请刷新重试。`;
        return;
    }

    if (statusEl) statusEl.innerText = `⏳ 正在极速解析「${file.name}」...`;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        fullText = fullText.trim();
        if (!fullText) {
            if (statusEl) statusEl.innerText = `⚠️ 未能提取到文本（图片型PDF），请手动粘贴。`;
            return;
        }

        state.resumes = state.resumes.map(r => r.id === resumeId ? { ...r, content: fullText } : r);
        localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));

        renderResumeBankInputs();
        const refreshedStatusEl = document.getElementById(`pdf-status-${resumeId}`);
        if (refreshedStatusEl) refreshedStatusEl.innerText = `✅ 成功解析 ${fullText.length} 字`;

    } catch (err) {
        console.error('PDF解析失败:', err);
        if (statusEl) statusEl.innerText = `❌ 解析错误: ${err.message}`;
    }
};

function renderApplications() {
    const tbody = document.getElementById('tracker-table-body');
    const statsContainer = document.getElementById('tracker-stats');
    if (!tbody) return;

    if (state.applications.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-on-surface-variant italic text-sm">暂无投递记录，快在上方添加你的第一个意向岗位吧！</td></tr>`;
        if (statsContainer) statsContainer.innerHTML = "总计: 0";
        return;
    }

    const keywordInput = document.getElementById('search-track-keyword');
    const statusSelect = document.getElementById('filter-track-status');
    const keyword = keywordInput ? keywordInput.value.trim().toLowerCase() : '';
    const statusFilter = statusSelect ? statusSelect.value : '全部';

    const filteredApps = state.applications.filter(app => {
        const matchesKeyword = !keyword || 
            (app.company && app.company.toLowerCase().includes(keyword)) || 
            (app.role && app.role.toLowerCase().includes(keyword));
        const matchesStatus = statusFilter === '全部' || app.status === statusFilter;
        return matchesKeyword && matchesStatus;
    });

    const sortedApps = [...filteredApps].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedApps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-on-surface-variant italic text-sm">没有匹配到符合筛选条件的投递记录 ☕</td></tr>`;
    } else {
        tbody.innerHTML = sortedApps.map(app => {
            const roleCellHtml = app.link
                ? `<div class="flex items-center gap-1.5">
                    <a href="${app.link}" target="_blank" rel="noopener noreferrer" class="text-primary font-medium hover:underline transition-all">${app.role} 🔗</a>
                    <span onclick="inlineEditPrompt('${app.id}', 'role', '${app.role}')" class="text-on-surface-variant/40 hover:text-primary cursor-pointer text-xs" title="修改岗位名称">✏️</span>
                   </div>`
                : `<div contenteditable="true" onblur="updateAppField('${app.id}', 'role', this.innerText)" class="px-1 py-0.5 rounded hover:bg-surface-container focus:bg-surface border border-transparent focus:border-outline outline-none text-on-surface font-medium">${app.role}</div>`;
            
            let prioritySelectColor = 'text-on-surface bg-surface-container-high border-outline-variant';
            if (app.priority?.includes('P0')) prioritySelectColor = 'text-error bg-error-container border-error/20 font-bold';
