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
}

// 恢复上次的录音复盘结果渲染回界面
function restoreDebriefSessionToUI() {
    const saved = localStorage.getItem('interview_prep_debrief_session');
    if (!saved) return;
    try {
        const session = JSON.parse(saved);
        if (!session.report) return;

        if (session.company) document.getElementById('debrief-company').value = session.company;
        if (session.role) document.getElementById('debrief-role').value = session.role;
        if (session.jd) document.getElementById('debrief-jd').value = session.jd;
        if (session.transcript) document.getElementById('debrief-transcript').value = session.transcript;

        document.getElementById('debrief-initial-state').classList.add('hidden');
        const reportRawNode = document.getElementById('debrief-report-raw');
        if (window.marked && window.marked.parse) {
            reportRawNode.innerHTML = window.marked.parse(session.report);
        } else {
            reportRawNode.innerText = session.report;
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

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));
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
        <div class="mb-4 p-3 border border-zinc-200 rounded-lg bg-zinc-50">
            <div class="flex items-center justify-between mb-1 gap-2">
                <label class="block text-xs font-semibold text-zinc-600 flex-1">
                    <input type="text" value="${r.name}" onchange="updateResumeName('${r.id}', this.value)" class="bg-transparent border-b border-transparent hover:border-zinc-300 font-bold focus:outline-none text-zinc-800 w-full">
                </label>
                <label class="shrink-0 px-2.5 py-1 bg-zinc-900 text-white rounded text-[10px] font-bold cursor-pointer hover:bg-zinc-700 transition">
                    📄 上传 PDF
                    <input type="file" accept="application/pdf" class="hidden" onchange="handleResumePdfUpload('${r.id}', this)">
                </label>
            </div>
            <p id="pdf-status-${r.id}" class="text-[10px] text-zinc-400 mb-1 min-h-[14px]"></p>
            <textarea rows="4" placeholder="粘贴该版本的简历文本内容，或点击右上角上传 PDF 自动填入..." onchange="updateResumeContent('${r.id}', this.value)" class="w-full mt-1 p-2 border border-zinc-200 rounded text-xs focus:outline-none font-mono">${r.content || ''}</textarea>
        </div>
    `).join('');

    const selectionContainer = document.getElementById('resume-selectors');
    if (!selectionContainer) return;
    selectionContainer.innerHTML = state.resumes.map(r => `
        <label class="flex items-start gap-2 p-2.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer text-xs">
            <input type="checkbox" name="selected_resumes" value="${r.id}" class="mt-0.5 rounded">
            <div>
                <span class="font-medium text-zinc-800 block">${r.name}</span>
                <span class="text-[10px] text-zinc-400">${r.content ? '已填入内容 (' + r.content.length + '字)' : '未填入内容'}</span>
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
        if (statusEl) statusEl.innerText = `❌ PDF 解析库未加载成功，请检查网络后刷新页面重试。`;
        return;
    }

    if (statusEl) statusEl.innerText = `⏳ 正在解析「${file.name}」...`;

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
            if (statusEl) statusEl.innerText = `⚠️ 未能提取到文字，该 PDF 可能是图片扫描版，请手动粘贴文本。`;
            return;
        }

        state.resumes = state.resumes.map(r => r.id === resumeId ? { ...r, content: fullText } : r);
        localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));

        renderResumeBankInputs();
        const refreshedStatusEl = document.getElementById(`pdf-status-${resumeId}`);
        if (refreshedStatusEl) refreshedStatusEl.innerText = `✅ 已从「${file.name}」提取 ${fullText.length} 字`;

    } catch (err) {
        console.error('PDF解析失败:', err);
        if (statusEl) statusEl.innerText = `❌ 解析失败: ${err.message}`;
    }
};

function renderApplications() {
    const tbody = document.getElementById('tracker-table-body');
    const statsContainer = document.getElementById('tracker-stats');
    if (!tbody) return;

    if (state.applications.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-stone-400 italic">暂无投递记录，快在左侧添加你的第一个意向吧！</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-stone-400 italic">没有找到符合筛选条件的投递记录 ☕</td></tr>`;
    } else {
        tbody.innerHTML = sortedApps.map(app => {
            const roleCellHtml = app.link
                ? `<div class="flex items-center gap-1.5">
                    <a href="${app.link}" target="_blank" rel="noopener noreferrer" class="text-stone-700 hover:text-stone-400 font-medium no-underline hover:underline hover:decoration-stone-300 transition-all">${app.role} 🔗</a>
                    <span onclick="inlineEditPrompt('${app.id}', 'role', '${app.role}')" class="text-stone-300 hover:text-stone-500 cursor-pointer text-[10px]" title="修改岗位名称">✏️</span>
                   </div>`
                : `<div contenteditable="true" onblur="updateAppField('${app.id}', 'role', this.innerText)" class="px-1 py-0.5 rounded hover:bg-stone-100/80 focus:bg-white focus:ring-1 focus:ring-stone-400 outline-none text-stone-700">${app.role}</div>`;
            
            let prioritySelectColor = 'text-stone-600 bg-stone-50 border-stone-200';
            if (app.priority?.includes('P0')) prioritySelectColor = 'text-red-600 bg-red-50 border-red-200 font-bold';
            if (app.priority?.includes('P1')) prioritySelectColor = 'text-amber-600 bg-amber-50 border-amber-200';

            const hasPrep = app.prepResults && Object.keys(app.prepResults).length > 0;
            const prepBtn = hasPrep
                ? `<button onclick="activateAppForPrep('${app.id}')" class="px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[11px] font-bold hover:bg-rose-100 transition cursor-pointer">📂 备战</button>`
                : `<button onclick="activateAppForPrep('${app.id}')" class="px-2 py-0.5 bg-stone-900 text-white rounded text-[11px] font-bold hover:bg-stone-800 transition cursor-pointer">🚀 备战</button>`;

            return `
                <tr class="border-b border-stone-100 hover:bg-stone-50/40 transition">
                    <td class="p-3 font-mono text-[11px] text-stone-400">${app.date}</td>
                    <td class="p-3">
                        <div contenteditable="true" onblur="updateAppField('${app.id}', 'company', this.innerText)" class="px-1 py-0.5 rounded hover:bg-stone-100/80 focus:bg-white focus:ring-1 focus:ring-stone-400 outline-none font-bold text-stone-800">${app.company}</div>
                    </td>
                    <td class="p-3">${roleCellHtml}</td>
                    <td class="p-3">
                        <div contenteditable="true" onblur="updateAppField('${app.id}', 'base', this.innerText)" class="px-1 py-0.5 rounded hover:bg-stone-100/80 focus:bg-white focus:ring-1 focus:ring-stone-400 outline-none text-stone-500 font-medium">${app.base || '—'}</div>
                    </td>
                    <td class="p-3">
                        <select onchange="updateAppField('${app.id}', 'priority', this.value); renderApplications();" class="text-[10px] px-2 py-0.5 border rounded-full font-medium cursor-pointer outline-none ${prioritySelectColor}">
                            <option value="P0" ${app.priority === 'P0' ? 'selected' : ''}>P0</option>
                            <option value="P1" ${(app.priority === 'P1' || !app.priority) ? 'selected' : ''}>P1</option>
                            <option value="P2" ${app.priority === 'P2' ? 'selected' : ''}>P2</option>
                        </select>
                    </td>
                    <td class="p-3">
                        <div contenteditable="true" onblur="updateAppField('${app.id}', 'salary', this.innerText)" class="px-1 py-0.5 rounded hover:bg-stone-100/80 focus:bg-white focus:ring-1 focus:ring-stone-400 outline-none font-mono text-stone-600 text-[11px]">${app.salary || '—'}</div>
                    </td>
                    <td class="p-3">
                        <select onchange="updateAppStatus('${app.id}', this.value)" class="text-[11px] px-2 py-1 rounded border border-stone-200 bg-white font-medium ${getStatusColorClass(app.status)}">
                            <option value="已投递" ${app.status === '已投递' ? 'selected' : ''}>已投递</option>
                            <option value="笔试中" ${app.status === '笔试中' ? 'selected' : ''}>笔试/测评</option>
                            <option value="面试中" ${app.status === '面试中' ? 'selected' : ''}>面试中 ⚡</option>
                            <option value="已拿Offer" ${app.status === '已拿Offer' ? 'selected' : ''}>🎉 收到Offer</option>
                            <option value="流程终止" ${app.status === '流程终止' ? 'selected' : ''}>流程终止</option>
                        </select>
                    </td>
                    <td class="p-3 text-center flex items-center justify-center gap-1.5">
                        ${prepBtn}
                        <button onclick="openEventModalForApp('${app.id}')" class="text-stone-400 hover:text-rose-600 text-xs p-1 cursor-pointer" title="添加日程">📅</button>
                        <button onclick="startAudioReviewFromBoard('${app.id}')" class="text-stone-400 hover:text-amber-600 text-xs p-1 cursor-pointer" title="录音复盘">🎙️</button>
                        <button onclick="deleteApp('${app.id}')" class="text-stone-400 hover:text-red-500 text-xs p-1 cursor-pointer">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    const total = state.applications.length;
    const interviewing = state.applications.filter(a => a.status === '面试中').length;
    const offers = state.applications.filter(a => a.status === '已拿Offer').length;
    if (statsContainer) {
        statsContainer.innerHTML = `<span>总投放: <strong class="text-stone-800">${total}</strong></span> | <span class="text-amber-600 font-bold">面试中: ${interviewing}</span> | <span class="text-green-600 font-bold">Offers: ${offers}</span>`;
    }
}

function getStatusColorClass(status) {
    if (status === '面试中') return 'text-amber-700 bg-amber-50 border-amber-200 font-bold';
    if (status === '已拿Offer') return 'text-green-700 bg-green-50 border-green-200 font-bold';
    if (status === '流程终止') return 'text-zinc-400 bg-zinc-100';
    if (status === '笔试中') return 'text-blue-700 bg-blue-50 border-blue-200';
    return 'text-zinc-600 bg-white';
}

window.updateAppStatus = (id, newStatus) => {
    state.applications = state.applications.map(a => a.id === id ? { ...a, status: newStatus } : a);
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    renderApplications();
};

window.deleteApp = (id) => {
    if (!confirm('确定要删除这条投递记录吗？')) return;
    state.applications = state.applications.filter(a => a.id !== id);
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    state.events = state.events.map(e => e.appId === id ? { ...e, appId: '' } : e);
    saveEvents();

    renderApplications();
    renderCalendarView();
    renderUpcomingEvents();
};

window.activateAppForPrep = (id) => {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;

    state.activeAppId = id;
    localStorage.setItem('interview_prep_active_app_id', JSON.stringify(id));

    switchView('workspace');
    document.getElementById('in-company').value = app.company;
    document.getElementById('in-role').value = app.role;
    document.getElementById('in-jd').value = app.jd || '';

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));

    const hasPrep = app.prepResults && Object.keys(app.prepResults).length > 0;
    if (hasPrep) {
        state.activeSession = {
            companyName: app.company,
            region: app.region || 'Singapore',
            roleTitle: app.role,
            language: app.language || 'bilingual',
            jd: app.jd || '',
            results: app.prepResults
        };
        document.getElementById('initial-state').classList.add('hidden');

        const tabKeyToPanel = {
            match: 'tab-panel-match-raw', business: 'tab-panel-business-raw',
            intro: 'tab-panel-intro-raw', star: 'tab-panel-star-raw', qa: 'tab-panel-qa-raw'
        };
        Object.entries(tabKeyToPanel).forEach(([key, panelId]) => {
            if (app.prepResults[key]) renderMarkdown(panelId, app.prepResults[key]);
        });
        document.querySelector('.tab-btn[data-tab="match"]').click();
    } else {
        state.activeSession = { companyName: app.company, region: 'Singapore', roleTitle: app.role, language: 'bilingual', jd: app.jd || '', results: {} };
        document.getElementById('initial-state').classList.remove('hidden');
    }
};

window.switchView = function(viewName) {
    const wsNav = document.getElementById('nav-workspace');
    const trNav = document.getElementById('nav-tracker');
    const calNav = document.getElementById('nav-calendar');
    const dbNav = document.getElementById('nav-debrief');

    const wsView = document.getElementById('view-workspace');
    const trView = document.getElementById('view-tracker');
    const calView = document.getElementById('view-calendar');
    const dbView = document.getElementById('view-debrief');

    const activeClass = "px-4 py-1.5 rounded-md text-xs font-bold transition bg-white text-zinc-950 shadow-xs cursor-pointer";
    const inactiveClass = "px-4 py-1.5 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 transition cursor-pointer";

    if(wsView) wsView.classList.add('hidden');
    if(trView) trView.classList.add('hidden');
    if(calView) calView.classList.add('hidden');
    if(dbView) dbView.classList.add('hidden');

    if(wsNav) wsNav.className = inactiveClass;
    if(trNav) trNav.className = inactiveClass;
    if(calNav) calNav.className = inactiveClass;
    if(dbNav) dbNav.className = inactiveClass;

    if (viewName === 'workspace' && wsView) {
        wsView.classList.remove('hidden');
        if(wsNav) wsNav.className = activeClass;
    } else if (viewName === 'tracker' && trView) {
        trView.classList.remove('hidden');
        if(trNav) trNav.className = activeClass;
        renderApplications();
    } else if (viewName === 'calendar' && calView) {
        calView.classList.remove('hidden');
        if(calNav) calNav.className = activeClass;
        renderCalendarView();
        renderUpcomingEvents();
    } else if (viewName === 'debrief' && dbView) {
        dbView.classList.remove('hidden');
        if(dbNav) dbNav.className = activeClass;
    }
};

// ================= 秋招日程日历模块 =================
const EVENT_TYPE_CLASS = { '面试': 'type-interview', '笔试': 'type-oa', '其他': 'type-other' };
const EVENT_TYPE_ICON = { '面试': '🎙️', '笔试': '📝', '其他': '📌' };

function saveEvents() {
    localStorage.setItem('interview_prep_events', JSON.stringify(state.events));
}

function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !bStart) return false;
    const aS = aStart, aE = aEnd && aEnd > aStart ? aEnd : aStart;
    const bS = bStart, bE = bEnd && bEnd > bStart ? bEnd : bStart;
    return aS < bE && bS < aE;
}

function getConflictingEventIdsForDate(dateKey) {
    const dayEvents = state.events.filter(e => e.date === dateKey);
    const conflictIds = new Set();
    for (let i = 0; i < dayEvents.length; i++) {
        for (let j = i + 1; j < dayEvents.length; j++) {
            const a = dayEvents[i], b = dayEvents[j];
            if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
                conflictIds.add(a.id);
                conflictIds.add(b.id);
            }
        }
    }
    return conflictIds;
}

function renderCalendarView() {
    if (state.calendarViewMode === 'week') {
        document.getElementById('cal-month-view').classList.add('hidden');
        document.getElementById('cal-week-view').classList.remove('hidden');
        renderWeekView();
    } else {
        document.getElementById('cal-week-view').classList.add('hidden');
        document.getElementById('cal-month-view').classList.remove('hidden');
        renderCalendar();
    }
    updateViewModeButtonStyles();
}

function updateViewModeButtonStyles() {
    const monthBtn = document.getElementById('btn-view-mode-month');
    const weekBtn = document.getElementById('btn-view-mode-week');
    if (!monthBtn || !weekBtn) return;
    
    // Stitch 重构后使用特定的类，精准通过 classList 调整而不重写全部 className
    monthBtn.classList.toggle('view-mode-active', state.calendarViewMode === 'month');
    weekBtn.classList.toggle('view-mode-active', state.calendarViewMode === 'week');
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('cal-month-label');
    if (!grid || !label) return;

    const viewDate = state.calendarViewDate;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    label.innerText = `${year} 年 ${month + 1} 月`;

    const firstOfMonth = new Date(year, month, 1);
    const firstWeekdayMon0 = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayKey = formatDateKey(today);

    let cells = [];
    for (let i = 0; i < firstWeekdayMon0; i++) {
        const dayNum = daysInPrevMonth - firstWeekdayMon0 + i + 1;
        cells.push({ dayNum, otherMonth: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ dayNum: d, otherMonth: false, dateObj: new Date(year, month, d) });
    }
    while (cells.length % 7 !== 0) {
        const dayNum = cells.length - (firstWeekdayMon0 + daysInMonth) + 1;
        cells.push({ dayNum, otherMonth: true });
    }

    grid.innerHTML = cells.map(cell => {
        if (cell.otherMonth) {
            return `<div class="cal-day cal-day-other-month"><span class="cal-day-number" style="color:#d6d3d1;">${cell.dayNum}</span></div>`;
        }
        const dateKey = formatDateKey(cell.dateObj);
        const isToday = dateKey === todayKey;
        const dayEvents = state.events.filter(e => e.date === dateKey)
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        const conflictIds = getConflictingEventIdsForDate(dateKey);

        const pillsHtml = dayEvents.slice(0, 3).map(e => {
            const typeClass = EVENT_TYPE_CLASS[e.type] || 'type-other';
            const conflictClass = conflictIds.has(e.id) ? 'has-conflict' : '';
            const timeLabel = e.startTime ? e.startTime : '';
            return `<div class="cal-event-pill ${typeClass} ${conflictClass}" onclick="openEventModal('${e.id}')" title="${e.title}${conflictIds.has(e.id) ? ' ⚠️ 时间冲突' : ''}">${timeLabel ? timeLabel + ' ' : ''}${EVENT_TYPE_ICON[e.type] || ''} ${e.title}</div>`;
        }).join('');
        const moreLabel = dayEvents.length > 3 ? `<div class="text-[9px] text-stone-400 px-1">+${dayEvents.length - 3} 更多</div>` : '';

        return `
            <div class="cal-day ${isToday ? 'cal-day-today' : 'cal-day-current'}">
                <span class="cal-day-number">${cell.dayNum}</span>
                ${pillsHtml}
                ${moreLabel}
            </div>
        `;
    }).join('');
}

function renderWeekView() {
    const weekContainer = document.getElementById('cal-week-view');
    const label = document.getElementById('cal-month-label');
    if (!weekContainer || !label) return;

    const viewDate = state.calendarViewDate;
    const currentDay = viewDate.getDay();
    const distanceToMon = (currentDay === 0 ? -6 : 1 - currentDay);
    
    const monday = new Date(viewDate);
    monday.setDate(viewDate.getDate() + distanceToMon);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatLabelDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    label.innerText = `${formatLabelDate(monday)} — ${formatLabelDate(sunday)}`;

    const todayStr = formatDateKey(new Date());
    let weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDays.push(d);
    }

    const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    let html = `
        <div class="grid grid-cols-7 gap-2 border-b border-stone-200 pb-2 mb-2">
            ${weekDays.map((day, idx) => {
                const dateKey = formatDateKey(day);
                const isToday = dateKey === todayStr;
                return `
                    <div class="text-center p-1 rounded ${isToday ? 'bg-rose-50 border border-rose-200' : ''}">
                        <div class="text-[11px] font-medium text-stone-400">${weekdayNames[idx]}</div>
                        <div class="text-xs font-bold ${isToday ? 'text-rose-600' : 'text-stone-700'}">${day.getDate()}</div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="grid grid-cols-7 gap-2 min-h-[350px] bg-stone-50/50 p-2 rounded-lg relative">
    `;

    html += weekDays.map(day => {
        const dateKey = formatDateKey(day);
        const dayEvents = state.events.filter(e => e.date === dateKey)
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        const conflictIds = getConflictingEventIdsForDate(dateKey);

        return `
            <div class="flex flex-col gap-1.5 border-r border-stone-100 last:border-none pr-1">
                ${dayEvents.length === 0 ? `
                    <div class="text-[10px] text-stone-300 italic text-center mt-4">暂无日程</div>
                ` : dayEvents.map(e => {
                    const typeClass = EVENT_TYPE_CLASS[e.type] || 'type-other';
                    const hasConflict = conflictIds.has(e.id);
                    const timeStr = e.startTime ? `${e.startTime}${e.endTime ? '-' + e.endTime : ''}` : '全天';

                    return `
                        <div onclick="openEventModal('${e.id}')" 
                             class="p-2 rounded border cursor-pointer transition shadow-xs hover:scale-[1.01] ${typeClass} ${hasConflict ? 'border-red-300 bg-red-50/80' : ''}"
                             title="${e.title} ${hasConflict ? '⚠️ 时间冲突' : ''}">
                            <div class="text-[9px] font-mono font-semibold text-stone-500 flex justify-between items-center mb-0.5">
                                <span>${timeStr}</span>
                                ${hasConflict ? '<span class="text-red-500 animate-pulse">⚠️</span>' : ''}
                            </div>
                            <div class="text-[11px] font-bold text-stone-800 truncate">${EVENT_TYPE_ICON[e.type] || ''} ${e.title}</div>
                            ${e.notes ? `<div class="text-[9px] text-stone-400 line-clamp-2 mt-0.5">${e.notes}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }).join('');

    // 动态添加今天的时间指示红线
    const isCurrentWeek = weekDays.some(d => formatDateKey(d) === todayStr);
    if (isCurrentWeek) {
        const now = new Date();
        const hours = now.getHours();
        const mins = now.getMinutes();
        const topPercent = ((hours * 60 + mins) / 1440) * 100;
        const todayIdx = (now.getDay() + 6) % 7; 
        const leftPercent = (todayIdx / 7) * 100;
        const widthPercent = 14.28;

        html += `
            <div class="absolute border-t-2 border-red-500 z-10 pointer-events-none flex items-center" 
                 style="top: ${topPercent}%; left: ${leftPercent}%; width: ${widthPercent}%;">
                <span class="w-1.5 h-1.5 bg-red-500 rounded-full -mt-[4px]"></span>
            </div>
        `;
    }

    html += `</div>`;
    weekContainer.innerHTML = html;
}

function renderUpcomingEvents() {
    const listContainer = document.getElementById('upcoming-events-list');
    if (!listContainer) return;

    const todayStr = formatDateKey(new Date());
    const upcoming = state.events
        .filter(e => e.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''))
        .slice(0, 5);

    if (upcoming.length === 0) {
        listContainer.innerHTML = `<div class="text-xs text-stone-400 italic p-2">近期没有排期的复习或面试 ☕</div>`;
        return;
    }

    listContainer.innerHTML = upcoming.map(e => {
        const typeClass = EVENT_TYPE_CLASS[e.type] || 'type-other';
        return `
            <div onclick="openEventModal('${e.id}')" class="flex items-center justify-between p-2 mb-1.5 border border-stone-200 rounded-md bg-white hover:bg-stone-50 cursor-pointer text-xs transition">
                <div class="flex items-center gap-2 truncate">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${typeClass}">${EVENT_TYPE_ICON[e.type] || ''}</span>
                    <span class="font-medium text-stone-800 truncate">${e.title}</span>
                </div>
                <div class="text-[10px] font-mono text-stone-400 shrink-0 ml-2">
                    ${e.date.substring(5)} ${e.startTime || ''}
                </div>
            </div>
        `;
    }).join('');
}

function setupEventListeners() {
    // 1. 全局配置保存
    const saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            state.settings.apiKey = document.getElementById('settings-apikey').value.trim();
            state.settings.apiBase = document.getElementById('settings-apibase').value.trim() || 'https://api.deepseek.com/v1';
            state.settings.model = document.getElementById('settings-model').value.trim() || 'deepseek-chat';
            
            localStorage.setItem('interview_prep_settings', JSON.stringify(state.settings));
            checkApiKeyStatus();
            alert('基础配置保存成功！');
        });
    }
    
    const settingsBtn = document.getElementById('btn-open-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            document.getElementById('settings-apikey').value = state.settings.apiKey || '';
            document.getElementById('settings-apibase').value = state.settings.apiBase || 'https://api.deepseek.com/v1';
            document.getElementById('settings-model').value = state.settings.model || 'deepseek-chat';
        });
    }

    // 2. 看板添加新投递意向
    const addTrackBtn = document.getElementById('btn-add-track');
    if (addTrackBtn) {
        addTrackBtn.addEventListener('click', () => {
            const company = document.getElementById('track-company').value.trim();
            const role = document.getElementById('track-role').value.trim();
            const base = document.getElementById('track-base').value.trim();
            const priority = document.getElementById('track-priority').value;
            const salary = document.getElementById('track-salary').value.trim();
            const date = document.getElementById('track-date').value;
            const link = document.getElementById('track-link').value.trim();
            const jd = document.getElementById('track-jd').value.trim();

            if (!company || !role) {
                alert('公司名称与目标岗位为必填项！');
                return;
            }

            const newApp = {
                id: 'app_' + Date.now(),
                company, role, base, priority, salary, date, link, jd,
                status: '已投递',
                prepResults: {}
            };

            state.applications.push(newApp);
            localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
            
            // 清空输入框
            document.getElementById('track-company').value = '';
            document.getElementById('track-role').value = '';
            document.getElementById('track-base').value = '';
            document.getElementById('track-salary').value = '';
            document.getElementById('track-link').value = '';
            document.getElementById('track-jd').value = '';

            renderApplications();
            alert('成功添加一条意向投放记录！');
        });
    }

    // 3. 看板搜索筛选过滤
    const searchKeyword = document.getElementById('search-track-keyword');
    if (searchKeyword) searchKeyword.addEventListener('input', renderApplications);
    const filterStatus = document.getElementById('filter-track-status');
    if (filterStatus) filterStatus.addEventListener('change', renderApplications);

    // 4. 工作台一键调用全套 Pipeline 报告
    const runPipelineBtn = document.getElementById('btn-run-pipeline');
    if (runPipelineBtn) runPipelineBtn.addEventListener('click', runFullPipeline);

    // 5. 切换标签页的监听器
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));
            
            const targetPanel = document.getElementById(`tab-panel-${tabName}`);
            if (targetPanel) targetPanel.classList.remove('hidden');
            tab.classList.add('border-zinc-900', 'text-zinc-900');
        });
    });

    // 6. 日历翻页及视图控件切换
    const prevBtn = document.getElementById('btn-cal-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => changeCalendarPeriod(-1));
    const nextBtn = document.getElementById('btn-cal-next');
    if (nextBtn) nextBtn.addEventListener('click', () => changeCalendarPeriod(1));

    const viewModeMonth = document.getElementById('btn-view-mode-month');
    if (viewModeMonth) viewModeMonth.addEventListener('click', () => setCalendarViewMode('month'));
    const viewModeWeek = document.getElementById('btn-view-mode-week');
    if (viewModeWeek) viewModeWeek.addEventListener('click', () => setCalendarViewMode('week'));

    // 7. 日程模态框提交
    const eventForm = document.getElementById('event-modal-form');
    if (eventForm) {
        eventForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('event-id').value;
            const appId = document.getElementById('event-target-app-id').value || '';
            const title = document.getElementById('event-title').value.trim();
            const date = document.getElementById('event-date').value;
            const startTime = document.getElementById('event-starttime').value;
            const endTime = document.getElementById('event-endtime').value;
            const type = document.getElementById('event-type').value;
            const notes = document.getElementById('event-notes').value.trim();

            if (!title || !date) {
                alert('标题和日期不能为空！');
                return;
            }

            if (id) {
                state.events = state.events.map(ev => ev.id === id ? { ...ev, appId, title, date, startTime, endTime, type, notes } : ev);
            } else {
                state.events.push({ id: 'evt_' + Date.now(), appId, title, date, startTime, endTime, type, notes });
            }

            saveEvents();
            closeEventModal();
            renderCalendarView();
            renderUpcomingEvents();
        });
    }

    // 8. 录音复盘模块 AI 诊断提炼
    const runDebriefBtn = document.getElementById('btn-run-debrief');
    if (runDebriefBtn) runDebriefBtn.addEventListener('click', runAudioDebriefPipeline);
}

// ================= 把原本被错误锁死的全局工具函数抽离至最外层 =================
window.copyTabContent = (panelId) => {
    const el = document.getElementById(panelId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => alert('内容已成功复制！'));
};

function persistPipelineResult(key, value) {
    state.activeSession.results[key] = value;
    localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

    if (state.activeAppId) {
        state.applications = state.applications.map(a => {
            if (a.id === state.activeAppId) {
                return { ...a, prepResults: { ...a.prepResults, [key]: value } };
            }
            return a;
        });
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    }
}

async function runFullPipeline() {
    const company = document.getElementById('in-company').value.trim();
    const role = document.getElementById('in-role').value.trim();
    const jd = document.getElementById('in-jd').value.trim();
    const region = document.getElementById('in-region').value;
    const language = document.getElementById('in-lang').value;

    if (!company || !role) {
        alert('公司名称与岗位名称是必填项，无法进行 AI 诊断。');
        return;
    }

    const checkedBoxes = document.querySelectorAll('input[name="selected_resumes"]:checked');
    if (checkedBoxes.length === 0) {
        alert('请至少勾选库中一份简历版本，作为大模型匹配的数据底座！');
        return;
    }

    let mergedResumeText = "";
    checkedBoxes.forEach(cb => {
        const rObj = state.resumes.find(r => r.id === cb.value);
        if (rObj && rObj.content) {
            mergedResumeText += `--- 简历版本: ${rObj.name} ---\n${rObj.content}\n\n`;
        }
    });

    if (!mergedResumeText.trim()) {
        alert('选中的简历版本中没有任何文本内容，请先在配置页填入简历。');
        return;
    }

    if (!state.settings.apiKey) {
        alert('未配置 API Key，请点击右上角设置图标填写 DeepSeek 密钥后再试。');
        return;
    }

    state.activeSession = { companyName: company, region, roleTitle: role, language, jd, results: {} };
    document.getElementById('initial-state').classList.add('hidden');
    
    // 强制锁定第一个 Tab 并渲染加载中
    document.querySelector('.tab-btn[data-tab="match"]').click();

    const pipelineTabs = ['match', 'business', 'intro', 'star', 'qa'];
    const runBtn = document.getElementById('btn-run-pipeline');
    if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerText = "⏳ 深度备战报告全速生成中...";
    }

    try {
        // Step 1: 匹配度评测
        renderMarkdown('tab-panel-match-raw', `⏳ **[1/5 简历匹配评测]** 正在进行匹配矩阵计算与扣分点排查，请稍候...`);
        const p1 = `你是一名资深的大厂技术与战略猎头。请根据以下求职者的简历库文本与目标公司的岗位JD，生成一份硬核的【简历匹配度与通关排查评测】。
目标公司: ${company} (地区: ${region})
目标岗位: ${role}
目标JD内容: ${jd || '未提供具体JD，请结合公开的该大厂同岗位职责进行通用对齐预测'}
输出语言要求: ${language === 'bilingual' ? '中英双语混合（关键学术及专业业务术语用英文，其余用中文）' : '纯中文'}

求职者多版本简历银行底座内容:
${mergedResumeText}

请严格按以下模块输出：
### 1. 核心硬技能匹配矩阵 (Match Matrix)
以高对比度的 Markdown 列表或表格形式展现。列出【JD必备要求】 vs 【简历现有锚点】，给出匹配度百分比。
### 2. 致命扣分点排查 (Red Flags)
指出简历中可能会被 HR 或第一轮业务面试官挑战的短板。
### 3. 简历精简优化微调 (Resume Tuning)
提供 2-3 条可直接替换到简历中的高含金量描述。`;
        const r1 = await callLLM(p1);
        renderMarkdown('tab-panel-match-raw', r1);
        persistPipelineResult('match', r1);

        // Step 2: 商业大盘拆解
        renderMarkdown('tab-panel-business-raw', `⏳ **[2/5 商业与核心指标拆解]** 正在透视该公司核心业务线的核心数据模型，请稍候...`);
        const p2 = `你是一名顶尖的互联网商业分析师与行业专家。请针对求职者即将面试的岗位目标，拆解该公司的核心商业盘。
目标公司: ${company} (地区: ${region})
目标岗位: ${role}
输出语言要求: ${language === 'bilingual' ? '中英双语混合' : '纯中文'}

请严格按以下模块输出：
### 1. 核心业务线与营收大盘 (Business Landscape)
### 2. 核心考核指标与业务痛点预测 (North Star Metrics & Painpoints)
### 3. 近期行业动态与竞争对手打法对比 (Competitive Analysis)`;
        const r2 = await callLLM(p2);
        renderMarkdown('tab-panel-business-raw', r2);
        persistPipelineResult('business', r2);

        // Step 3: 自我介绍生成
        renderMarkdown('tab-panel-intro-raw', `⏳ **[3/5 黄金三阶自我介绍]** 正在根据匹配点进行多模态文案润色，请稍候...`);
        const p3 = `根据前述匹配数据，为求职者量身定制【30秒快速破冰】、【1分钟黄金标准】、【2分钟深度立体】三种场景的口语化自我介绍。
公司: ${company} | 岗位: ${role}
求职者简历素材: ${mergedResumeText}
输出语言要求: ${language === 'bilingual' ? '中英双语混合' : '纯中文'}`;
        const r3 = await callLLM(p3);
        renderMarkdown('tab-panel-intro-raw', r3);
        persistPipelineResult('intro', r3);

        // Step 4: STAR 故事挖掘
        renderMarkdown('tab-panel-star-raw', `⏳ **[4/5 STAR 原则故事库]** 正在重塑过往项目履历的业务价值，请稍候...`);
        const p4 = `请从求职者的多版本简历素材中，深度挖掘并重塑 2 个最契合【${company} - ${role}】岗位的【STAR原则硬核故事】。
要求精细到：Situation（背景），Task（核心难点/考核指标），Action（求职者具体的 SQL/数据驱动/策略执行动作），Result（可量化的 GMV/ROI/留存率等数据成果）。
求职者简历素材: ${mergedResumeText}`;
        const r4 = await callLLM(p4);
        renderMarkdown('tab-panel-star-raw', r4);
        persistPipelineResult('star', r4);

        // Step 5: 业务压测问答
        renderMarkdown('tab-panel-qa-raw', `⏳ **[5/5 突发压测与高质量反问]** 正在进行真题预测，请稍候...`);
        const p5 = `作为 ${company} 针对 ${role} 岗位的专业面试官，请输出：
1. 【3道最具杀伤力的业务与情境压测真题】并附带标准通关高分回答要点。
2. 【3个能彰显行业格局的高端反问面试官（Reverse Q&A）策略】。`;
        const r5 = await callLLM(p5);
        renderMarkdown('tab-panel-qa-raw', r5);
        persistPipelineResult('qa', r5);

        renderApplications();
        alert('🎉 全套深度备战数据已全部全自动生成完毕！已同步存入看板。');
    } catch (err) {
        console.error(err);
        alert('AI 管道在某一步骤发生中断，请检查 API 配置或网络连接。错误: ' + err.message);
    } finally {
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.innerHTML = "⚡ 自动开启五维全套深度备战管道";
        }
    }
}

async function callLLM(prompt) {
    const res = await fetch(`${state.settings.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.settings.apiKey}`
        },
        body: JSON.stringify({
            model: state.settings.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3
        })
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API 报错 [${res.status}]: ${errText}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
}

function renderMarkdown(elementId, markdownText) {
    const node = document.getElementById(elementId);
    if (!node) return;
    if (window.marked && window.marked.parse) {
        node.innerHTML = window.marked.parse(markdownText);
    } else {
        node.innerText = markdownText;
    }
}

function startAudioReviewFromBoard(appId) {
    const app = state.applications.find(a => a.id === appId);
    if (!app) return;
    switchView('debrief');

    document.getElementById('debrief-company').value = app.company || '';
    document.getElementById('debrief-role').value = app.role || '';
    document.getElementById('debrief-jd').value = app.jd || '';
    document.getElementById('debrief-transcript').value = '';

    const savedDebrief = localStorage.getItem('interview_prep_debrief_session');
    if (savedDebrief) {
        try {
            const session = JSON.parse(savedDebrief);
            if (session.appId === appId && session.report) {
                document.getElementById('debrief-transcript').value = session.transcript || '';
                document.getElementById('debrief-initial-state').classList.add('hidden');
                renderMarkdown('debrief-report-raw', session.report);
                return;
            }
        } catch (e) {
            console.warn(e);
        }
    }
    document.getElementById('debrief-initial-state').classList.remove('hidden');
    document.getElementById('debrief-report-raw').innerHTML = '';
}

async function runAudioDebriefPipeline() {
    const company = document.getElementById('debrief-company').value.trim();
    const role = document.getElementById('debrief-role').value.trim();
    const jd = document.getElementById('debrief-jd').value.trim();
    const transcript = document.getElementById('debrief-transcript').value.trim();

    if (!transcript) {
        alert('复盘复盘，请至少在左侧框内粘贴你的录音识别转文字或作答草稿！');
        return;
    }

    if (!state.settings.apiKey) {
        alert('请配置 API 密钥后再复盘诊断。');
        return;
    }

    const reportNode = document.getElementById('debrief-report-raw');
    document.getElementById('debrief-initial-state').classList.add('hidden');
    reportNode.innerHTML = `<div class="text-xs text-stone-500 italic animate-pulse">⏳ 正在启动 AI 模拟终审官复盘，正在逐字拆解你的作答逻辑与微表情心理学，请稍候...</div>`;

    const prompt = `你是一名拥有10年以上大厂核心业务面试官经验的【终审复盘专家】。请针对以下面试现场的录音文字进行深度诊断，指出回答中的破绽并给出完美的重塑微调方案。
目标公司: ${company}
目标岗位: ${role}
目标岗位JD: ${jd || '未提供具体JD，请按通用资深标准推演'}

【候选人面试现场录音转文字/口语化作答原稿】：
"""
${transcript}
"""

请严厉、精准且富有建设性地按以下三个维度输出复盘报告：
### 1. 致命破绽与扣分项诊断 (Flaws & Risks)
直接点出候选人回答中语气拖沓、数据不闭环、逻辑松散、或者缺乏业务深度的地方。
### 2. 面试官心理学投射 (Interviewer's Perspective)
推演当面试官听到这段回答时，内心深处真正产生的顾虑是什么。
### 3. 完美作答重塑示范 (The Winning Rewrite)
提供一段高度润色、结构极其严整且口语化自然的标准高分重塑回答。`;

    try {
        const report = await callLLM(prompt);
        renderMarkdown('debrief-report-raw', report);

        const sessionData = { appId: state.activeAppId || '', company, role, jd, transcript, report };
        localStorage.setItem('interview_prep_debrief_session', JSON.stringify(sessionData));
    } catch (e) {
        alert('复盘管道中断: ' + e.message);
    }
}

// ================= 日历模态框工具函数 =================
window.openEventModal = (eventId = null) => {
    const modal = document.getElementById('event-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    document.getElementById('event-id').value = eventId || '';
    document.getElementById('event-target-app-id').value = '';

    if (eventId) {
        const ev = state.events.find(e => e.id === eventId);
        if (ev) {
            document.getElementById('event-title').value = ev.title || '';
            document.getElementById('event-date').value = ev.date || '';
            document.getElementById('event-starttime').value = ev.startTime || '';
            document.getElementById('event-endtime').value = ev.endTime || '';
            document.getElementById('event-type').value = ev.type || '面试';
            document.getElementById('event-notes').value = ev.notes || '';
            document.getElementById('event-target-app-id').value = ev.appId || '';
            const delBtn = document.getElementById('btn-delete-event');
            if (delBtn) delBtn.classList.remove('hidden');
        }
    } else {
        document.getElementById('event-title').value = '';
        document.getElementById('event-date').value = document.getElementById('track-date')?.value || new Date().toISOString().split('T')[0];
        document.getElementById('event-starttime').value = '';
        document.getElementById('event-endtime').value = '';
        document.getElementById('event-type').value = '面试';
        document.getElementById('event-notes').value = '';
        const delBtn = document.getElementById('btn-delete-event');
        if (delBtn) delBtn.classList.add('hidden');
    }
};

window.closeEventModal = () => {
    const modal = document.getElementById('event-modal');
    if (modal) modal.classList.add('hidden');
};

window.deleteEventFromModal = () => {
    const id = document.getElementById('event-id').value;
    if (!id) return;
    if (!confirm('确定要删除此日程吗？')) return;
    state.events = state.events.filter(e => e.id !== id);
    saveEvents();
    closeEventModal();
    renderCalendarView();
    renderUpcomingEvents();
};

window.openEventModalForApp = (appId) => {
    const app = state.applications.find(a => a.id === appId);
    if (!app) return;
    
    openEventModal(null);
    const titleInput = document.getElementById('event-title');
    if (titleInput) titleInput.value = `[面试] ${app.company} - ${app.role}`;
    
    const hiddenAppIdContainer = document.getElementById('event-target-app-id');
    if (hiddenAppIdContainer) hiddenAppIdContainer.value = appId;
};

window.inlineEditPrompt = (appId, field, currentValue) => {
    const newValue = prompt("请输入修改后的岗位名称：", currentValue);
    if (newValue !== null && newValue.trim() !== "") {
        updateAppField(appId, field, newValue);
        renderApplications();
    }
};

window.updateAppField = (appId, field, value) => {
    const app = state.applications.find(a => a.id === appId);
    if (!app) return;
    let cleanValue = value.replace(/[\r\n]/g, "").trim();
    if (cleanValue === '—') cleanValue = '';
    app[field] = cleanValue;
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    console.log(`[看板同步] 成功将岗位 ID ${appId} 的 ${field} 字段修改为: ${cleanValue}`);
};

function changeCalendarPeriod(direction) {
    const viewDate = state.calendarViewDate;
    if (state.calendarViewMode === 'week') {
        viewDate.setDate(viewDate.getDate() + (direction * 7));
    } else {
        viewDate.setMonth(viewDate.getMonth() + direction);
    }
    renderCalendarView();
}

function setCalendarViewMode(mode) {
    state.calendarViewMode = mode;
    renderCalendarView();
}
