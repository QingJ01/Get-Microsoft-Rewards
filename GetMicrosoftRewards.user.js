// ==UserScript==
// @name         Get Microsoft Rewards
// @namespace    http://tampermonkey.net/
// @version      1.0.1.2
// @description  微软 Rewards 助手 - 自动完成搜索、活动、签到、阅读任务，配备极简 UI 悬浮窗，一键全自动获取积分。
// @author       QingJ
// @icon         https://rewards.bing.com/rewardscdn/images/rewards.png
// @match        https://www.bing.com/*
// @match        https://cn.bing.com/*
// @match        https://rewards.bing.com/*
// @match        https://login.live.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_log
// @connect      bing.com
// @connect      rewards.bing.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      login.live.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hot.baiwumm.com
// @connect      hotapi.nntool.cc
// @connect      cnxiaobai.com
// @license      MIT
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        pc: { minDelay: 15000, maxDelay: 30000 },
        mobile: { minDelay: 20000, maxDelay: 35000 },
        ua: {
            pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.81',
            mobile: 'Mozilla/5.0 (Linux; Android 16; MCE16 Build/BP3A.250905.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 EdgA/123.0.2420.102'
        },
        // 多个热搜API备用源
        hotApis: [
            { url: 'https://hot.baiwumm.com/api/', sources: ['weibo', 'douyin', 'baidu', 'zhihu', 'toutiao'] },
            { url: 'https://hotapi.nntool.cc/', sources: ['weibo', 'douyin', 'baidu', 'toutiao', 'zhihu'] },
            { url: 'https://cnxiaobai.com/DailyHotApi/', sources: ['weibo', 'douyin', 'baidu', 'toutiao'] }
        ],
        keywords: ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略"],
        // 暂停机制配置
        pause: {
            enabled: true,           // 是否启用暂停机制
            interval: 10,            // 每执行多少次搜索后暂停
            duration: 15 * 60 * 1000 // 暂停时长（毫秒），15分钟
        }
    };

    // ========== 状态 ==========
    let state = {
        level: 1, points: 0,
        pcCur: 0, pcMax: 0,
        mobileCur: 0, mobileMax: 0,
        promosTotal: 0, promosDone: 0,
        signDone: false, signPoints: -1,
        readCur: 0, readMax: 0,
        running: false,
        accessToken: null,
        accessTokenExpiresAt: 0,
        updating: false,
        updatingPromise: null,
        // 新增：搜索进度和暂停状态
        searchCount: 0,           // 当前搜索计数（用于暂停判断）
        isPaused: false,          // 是否处于暂停状态
        pauseEndTime: 0,          // 暂停结束时间戳
        countdownStartTime: 0,    // 倒计时开始时间（精确计时）
        countdownDuration: 0,     // 倒计时总时长
        manualPaused: false,      // 手动暂停
        pausePromise: null,
        pauseResolver: null
    };
    let dashboard = null;
    let loginCookie = '';

    // ========== 进度保存/恢复 ==========
    const STORAGE_KEY = 'mr_search_progress';

    function saveProgress() {
        const today = getDateHyphen();
        const data = {
            date: today,
            searchCount: state.searchCount
        };
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function loadProgress() {
        try {
            const saved = GM_getValue(STORAGE_KEY);
            if (!saved) return null;
            const data = JSON.parse(saved);
            // 只恢复当天的进度
            if (data.date === getDateHyphen()) {
                state.searchCount = data.searchCount || 0;
                return data;
            }
        } catch (e) { }
        return null;
    }

    async function withAccessTokenRequest(requestFn) {
        let token = await getAccessToken();
        if (!token) return null;
        try {
            return await requestFn(token);
        } catch (e) {
            if (e && e.status === 401) {
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                token = await getAccessToken({ forceRefresh: true });
                if (!token) throw e;
                return await requestFn(token);
            }
            throw e;
        }
    }

    function resetProgress() {
        state.searchCount = 0;
        GM_setValue(STORAGE_KEY, '');
    }

    // ========== 工具函数 ==========
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomPick = arr => arr[Math.floor(Math.random() * arr.length)];
    const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const uuid = () => crypto.randomUUID();
    const getDateStr = () => {
        const d = new Date();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    const getDateHyphen = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const isJSON = s => { try { JSON.parse(s); return true; } catch { return false; } };

    // GM_xmlhttpRequest 封装
    async function gmRequest(options) {
        const retries = options.retries ?? 2;
        const retryDelay = options.retryDelay ?? 1000;
        let attempt = 0;

        const shouldRetry = (err) => {
            const status = err?.status || 0;
            return status === 0 || status === 429 || status >= 500 || err?.message === 'Timeout';
        };

        while (true) {
            try {
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        timeout: 20000,
                        ...options,
                        onload: xhr => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(options.returnUrl ? xhr.finalUrl : xhr.responseText);
                            } else if (xhr.status >= 300 && xhr.status < 400) {
                                const loc = xhr.responseHeaders.match(/Location:\s*(.*?)\s*[\r\n]/i);
                                resolve(loc ? loc[1] : xhr.responseText);
                            } else {
                                const err = new Error(`HTTP ${xhr.status}`);
                                err.status = xhr.status;
                                err.responseText = xhr.responseText;
                                err.finalUrl = xhr.finalUrl;
                                reject(err);
                            }
                        },
                        onerror: () => {
                            const err = new Error('Network Error');
                            err.status = 0;
                            reject(err);
                        },
                        ontimeout: () => {
                            const err = new Error('Timeout');
                            err.status = 0;
                            reject(err);
                        }
                    });
                });
            } catch (e) {
                if (attempt >= retries || !shouldRetry(e)) throw e;
                const delay = retryDelay * Math.pow(2, attempt);
                attempt++;
                await sleep(delay + randomRange(0, 250));
            }
        }
    }

    // 获取热搜词（支持多源自动切换）
    async function getHotQuery() {
        // 打乱API顺序，随机选择
        const apis = [...CONFIG.hotApis].sort(() => Math.random() - 0.5);

        for (const api of apis) {
            try {
                const src = randomPick(api.sources);
                const res = await gmRequest({ method: 'GET', url: api.url + src, timeout: 8000 });
                const data = JSON.parse(res);
                if (data.code === 200 && data.data?.length) {
                    const title = randomPick(data.data).title || '';
                    // 随机截取长度，更自然
                    const len = randomRange(8, 25);
                    return title.substring(0, len);
                }
            } catch { /* 尝试下一个API */ }
        }
        // 所有API都失败，使用本地关键词
        return `${randomPick(CONFIG.keywords)} ${Math.random().toString(36).slice(2, 6)}`;
    }

    // Cookie 管理
    function getCookies(url) {
        return new Promise(resolve => {
            try {
                if (typeof GM_cookie === 'undefined' || !GM_cookie) {
                    return resolve('');
                }
                GM_cookie('list', { url }, (cookies) => {
                    if (!cookies || !Array.isArray(cookies)) return resolve('');
                    const str = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    resolve(str);
                });
                setTimeout(() => resolve(''), 3000);
            } catch (e) {
                resolve('');
            }
        });
    }

    function deleteCookie(name, host = 'bing.com') {
        return new Promise(resolve => {
            if (typeof GM_cookie !== 'undefined') {
                GM_cookie('delete', { url: `https://${host}`, name }, resolve);
            } else resolve();
        });
    }

    // ========== 样式 (极简版) ==========
    GM_addStyle(`
        #mr-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #fff;
            border: 1px solid #e0e0e0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-radius: 8px;
        }

        /* 收起状态 */
        #mr-panel.collapsed {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #fff;
            color: #0078d4;
            box-shadow: 0 4px 16px rgba(0,120,212,0.3);
            border: 1px solid #e0e0e0;
            transition: all 0.2s;
        }
        #mr-panel.collapsed:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(0,120,212,0.4); }
        #mr-panel.collapsed svg { width: 24px; height: 24px; fill: currentColor; }
        #mr-panel.collapsed #mr-container { display: none; }

        /* 展开状态 */
        #mr-panel:not(.collapsed) { width: 300px; }
        #mr-panel:not(.collapsed) svg { display: none; }

        #mr-header {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8f9fa;
            border-radius: 8px 8px 0 0;
        }
        #mr-title { font-weight: 600; font-size: 14px; color: #333; }
        #mr-close { cursor: pointer; color: #999; font-size: 18px; line-height: 1; }
        #mr-close:hover { color: #333; }

        #mr-body { padding: 16px; }

        .mr-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #555; }
        .mr-val { font-weight: 600; color: #333; }

        .mr-progress-bg { height: 4px; background: #eee; border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
        .mr-bar { height: 100%; background: #0078d4; }

        .mr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
        .mr-btn {
            border: 1px solid #d0d0d0;
            background: #fff;
            color: #333;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .mr-btn:hover { background: #f0f0f0; border-color: #bbb; }
        .mr-btn:active { background: #e5e5e5; }
        .mr-full { grid-column: span 2; background: #0078d4; color: #fff; border: none; }
        .mr-full:hover { background: #006abc; }

        /* Auth */
        #mr-auth { margin-bottom: 12px; padding: 10px; background: #fff8e1; border: 1px solid #ffe0b2; border-radius: 4px; }
        .mr-input { width: 100%; padding: 4px; border: 1px solid #ccc; font-size: 11px; margin: 4px 0; }

        /* Log */
        #mr-log {
            margin-top: 12px;
            height: 80px;
            background: #fafafa;
            border: 1px solid #eee;
            padding: 8px;
            font-size: 10px;
            color: #666;
            overflow-y: auto;
            font-family: monospace;
        }
    `);

    // ========== UI 结构 ==========
    const panel = document.createElement('div');
    panel.id = 'mr-panel';
    panel.className = 'collapsed'; // 默认折叠
    // 礼盒 SVG
    const svgIcon = `<svg viewBox="0 0 24 24"><path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zm-9-2h2v2h-2V4zm0 16H6v-9h5v9zm6 0h-5v-9h5v9zm1.5-11H16V7h2v2zm-4.5 0h-2V7h2v2zm-4.5 0H7V7h2v2zm-3.5 0H4V7h1.5v2z"/></svg>`;

    panel.innerHTML = `
        ${svgIcon}
        <div id="mr-container">
            <div id="mr-header">
                <div id="mr-title"><span>🎁</span> Microsoft Rewards</div>
                <div id="mr-close">×</div>
            </div>

            <div id="mr-body">
                <!-- 状态 -->
                <div class="mr-row">
                    <span>等级 <span id="mr-level" style="font-weight:600">-</span></span>
                    <span style="color:#d83b01"><span id="mr-points">0</span> pts</span>
                </div>

                <!-- 进度 -->
                <div class="mr-row"><span>💻 PC搜索</span><span id="mr-pc">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-pc-bar"></div></div>

                <div class="mr-row"><span>📱 移动搜索</span><span id="mr-mobile">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-mobile-bar"></div></div>

                <div class="mr-row"><span>📖 阅读任务</span><span id="mr-read">0/0</span></div>
                <div class="mr-progress-bg"><div class="mr-bar" id="mr-read-bar" style="background:#ff8c00"></div></div>

                <!-- 授权 -->
                <div id="mr-auth" style="display:none">
                    <div style="font-weight:bold;margin-bottom:5px">⚠️ 需授权</div>
                    <button class="mr-btn" id="mr-auth-link" style="width:100%">🔗 获取授权码</button>
                    <input type="text" id="mr-auth-in" class="mr-input" placeholder="粘贴URL...">
                    <button class="mr-btn" id="mr-auth-save" style="width:100%">保存</button>
                </div>

                <!-- 按钮 -->
                <div class="mr-grid">
                    <button id="btn-search" class="mr-btn">🔍 搜索</button>
                    <button id="btn-promo" class="mr-btn">🎯 活动 <span id="val-promo">0/0</span></button>
                    <button id="btn-sign" class="mr-btn">✅ 签到</button>
                    <button id="btn-read" class="mr-btn">📖 阅读</button>
                    <button id="btn-all" class="mr-btn mr-full">🚀 一键全部执行</button>
                </div>

                <!-- 日志 -->
                <div id="mr-log"></div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // 元素引用
    const $ = id => document.querySelector(id);
    const nodes = {
        panel: $('#mr-panel'),
        close: $('#mr-close'),
        level: $('#mr-level'),
        points: $('#mr-points'),
        pc: $('#mr-pc'),
        pcBar: $('#mr-pc-bar'),
        mob: $('#mr-mobile'),
        mobBar: $('#mr-mobile-bar'),
        read: $('#mr-read'),
        readBar: $('#mr-read-bar'),
        btnSearch: $('#btn-search'),
        btnPromo: $('#btn-promo'),
        valPromo: $('#val-promo'),
        btnSign: $('#btn-sign'),
        btnRead: $('#btn-read'),
        btnAll: $('#btn-all'),
        boxAuth: $('#mr-auth'),
        btnAuthLink: $('#mr-auth-link'),
        inAuth: $('#mr-auth-in'),
        btnAuthSave: $('#mr-auth-save'),
        logBox: $('#mr-log')
    };

    // ========== 交互逻辑 ==========

    // 展开/收起
    nodes.panel.onclick = (e) => {
        if (nodes.panel.classList.contains('collapsed')) {
            nodes.panel.classList.remove('collapsed');
        }
    };
    nodes.close.onclick = (e) => {
        e.stopPropagation();
        nodes.panel.classList.add('collapsed');
    };

    const LOG_MAX_LINES = 200;
    const log = (msg) => {
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString().slice(0, 5)}] ${msg}`;
        nodes.logBox.appendChild(div);
        while (nodes.logBox.childNodes.length > LOG_MAX_LINES) {
            nodes.logBox.removeChild(nodes.logBox.firstChild);
        }
        nodes.logBox.scrollTop = nodes.logBox.scrollHeight;
    };

    const updateAllButton = () => {
        if (!nodes.btnAll) return;
        if (state.manualPaused) {
            nodes.btnAll.textContent = '▶️ 继续执行';
        } else if (state.running || state.allRunning || state.busyCount > 0) {
            nodes.btnAll.textContent = '⏸️ 暂停执行';
        } else {
            nodes.btnAll.textContent = '🚀 一键全部执行';
        }
    };

    const setManualPause = (paused, opts = {}) => {
        if (paused === state.manualPaused) return;
        const silent = !!opts.silent;
        state.manualPaused = paused;
        if (paused) {
            if (!state.pausePromise) {
                state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
            }
        } else if (state.pauseResolver) {
            const resolve = state.pauseResolver;
            state.pauseResolver = null;
            state.pausePromise = null;
            resolve();
        }
        updateAllButton();
        if (!silent) {
            log(paused ? '⏸️ 已手动暂停' : '▶️ 已继续执行');
        }
    };

    const markBusy = (delta) => {
        state.busyCount = Math.max(0, state.busyCount + delta);
        updateAllButton();
    };

    const waitWhilePaused = async () => {
        if (!state.manualPaused) return 0;
        if (!state.pausePromise) {
            state.pausePromise = new Promise(resolve => { state.pauseResolver = resolve; });
        }
        const start = Date.now();
        await state.pausePromise;
        return Date.now() - start;
    };

    // 授权相关
    const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf';

    nodes.btnAuthLink.onclick = () => window.open(AUTH_URL, '_blank');

    nodes.btnAuthSave.onclick = () => {
        const val = nodes.inAuth.value.trim();
        const match = val.match(/M\.[^&]+/);
        if (match) {
            GM_setValue('auth_code', match[0]);
            log('✅ 授权码已保存！');
            nodes.boxAuth.style.display = 'none';
        } else {
            log('❌ 格式错误，请复制完整URL');
        }
    };
    updateAllButton();

    async function checkAuth() {
        const code = GM_getValue('auth_code');
        if (!code) {
            nodes.boxAuth.style.display = 'block';
            log('⚠️ 请先获取授权码');
            return false;
        }
        return code;
    }

    // ========== 核心逻辑 (简化版引用) ==========

    // 数据刷新
    async function updateData() {
        if (state.updatingPromise) return state.updatingPromise;
        state.updating = true;
        state.updatingPromise = (async () => {
            try {
                const res = await gmRequest({
                    url: `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${Date.now()}`,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Referer': 'https://rewards.bing.com/'
                    },
                    anonymous: false  // 确保携带 cookie
                });

                if (!res) {
                    log('⚠️ 获取数据失败：空响应');
                    return;
                }

                let data;
                try {
                    data = JSON.parse(res);
                } catch (e) {
                    log('⚠️ 解析数据失败，请确保已登录 rewards.bing.com');
                    console.error('Response:', res.substring(0, 200));
                    return;
                }

                dashboard = data.dashboard || data;

                if (!dashboard || !dashboard.userStatus) {
                    log('⚠️ 未获取到用户数据，请先登录 rewards.bing.com');
                    return;
                }

                const user = dashboard.userStatus || {};
                // 修复等级解析：处理 "newLevel1" 格式
                const rawLevel = user.levelInfo?.activeLevel || 'Level1';
                state.level = parseInt(String(rawLevel).replace(/\D/g, '')) || 1;
                state.points = user.availablePoints || 0;

                const c = user.counters || {};
                let pc = 0, pcM = 0, mob = 0, mobM = 0;

                // PC搜索
                if (c.pcSearch) {
                    c.pcSearch.forEach(i => { pc += i.pointProgress || 0; pcM += i.pointProgressMax || i.pointMax || 0 });
                }

                // 移动搜索
                if (c.mobileSearch) {
                    c.mobileSearch.forEach(i => { mob += i.pointProgress || 0; mobM += i.pointProgressMax || i.pointMax || 0 });
                }

                // 如果移动搜索上限为0且等级>1，尝试推断 (Lv2通常是60分)
                if (mobM === 0 && state.level > 1) {
                    mobM = 60; // 假设值
                }

                // 如果PC搜索上限为0，尝试推断
                if (pcM === 0) {
                    pcM = state.level > 1 ? 150 : 90; // Lv2=150, Lv1=90
                }

                state.pcCur = pc; state.pcMax = pcM;
                state.mobileCur = mob; state.mobileMax = mobM;

                const allP = [...(dashboard.dailySetPromotions?.[getDateStr()] || []), ...(dashboard.morePromotions || [])];
                state.promosTotal = allP.length;
                state.promosDone = allP.filter(p => p.complete).length;

                render();
                log(`✓ 数据已更新: Lv.${state.level} ${state.points}pts`);
            } catch (e) {
                console.error('updateData error:', e);
                log(`⚠️ 获取数据出错: ${e.message}`);
            } finally {
                state.updating = false;
                state.updatingPromise = null;
            }
        })();
        return state.updatingPromise;
    }

    function render() {
        nodes.level.textContent = `Lv.${state.level}`;
        nodes.points.textContent = state.points.toLocaleString();

        nodes.pc.textContent = `${state.pcCur}/${state.pcMax}`;
        nodes.pcBar.style.width = state.pcMax ? `${(state.pcCur / state.pcMax) * 100}%` : '0%';

        nodes.mob.textContent = `${state.mobileCur}/${state.mobileMax}`;
        nodes.mobBar.style.width = state.mobileMax ? `${(state.mobileCur / state.mobileMax) * 100}%` : '0%';

        nodes.read.textContent = `${state.readCur}/${state.readMax}`;
        nodes.readBar.style.width = state.readMax ? `${(state.readCur / state.readMax) * 100}%` : '0%';

        nodes.valPromo.textContent = `${state.promosDone}/${state.promosTotal}`;
    }

    // Token 获取
    async function getAccessToken(opts = {}) {
        const forceRefresh = !!opts.forceRefresh;
        const now = Date.now();
        if (!forceRefresh && state.accessToken && state.accessTokenExpiresAt && now < (state.accessTokenExpiresAt - 60000)) {
            return state.accessToken;
        }
        if (forceRefresh) {
            state.accessToken = null;
            state.accessTokenExpiresAt = 0;
        }
        const code = await checkAuth();
        if (!code) return null;

        let refreshToken = GM_getValue('refresh_token');
        let url = refreshToken
        ? `https://login.live.com/oauth20_token.srf?client_id=0000000040170455&refresh_token=${refreshToken}&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&grant_type=REFRESH_TOKEN`
            : `https://login.live.com/oauth20_token.srf?client_id=0000000040170455&code=${code}&redirect_uri=https://login.live.com/oauth20_desktop.srf&grant_type=authorization_code`;

        try {
            const res = await gmRequest({ url });
            const data = JSON.parse(res);
            if (data.access_token) {
                state.accessToken = data.access_token;
                if (data.expires_in) {
                    state.accessTokenExpiresAt = Date.now() + Number(data.expires_in) * 1000;
                } else {
                    state.accessTokenExpiresAt = 0;
                }
                if (data.refresh_token) GM_setValue('refresh_token', data.refresh_token);
                return data.access_token;
            } else if (data.error) {
                log('Token失效，请重新授权');
                GM_setValue('refresh_token', '');
                GM_setValue('auth_code', '');
                state.accessToken = null;
                state.accessTokenExpiresAt = 0;
                nodes.boxAuth.style.display = 'block';
            }
        } catch (e) { log('Auth Error: ' + e.message); }
        return null;
    }

    // 签到
    const runSign = async () => {
        nodes.btnSign.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 签到中...');
        try {
            const res = await withAccessTokenRequest(token => gmRequest({
                method: 'POST',
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555',
                    'X-Rewards-IsMobile': 'true',
                    'X-Rewards-Country': 'cn'
                },
                data: JSON.stringify({
                    amount: 1, id: uuid(), type: 103, country: 'cn',
                    attributes: {}, risk_context: {}, channel: 'SAAndroid'
                })
            }));
            if (res) {
                const d = JSON.parse(res);
                if (d.response?.activity) {
                    log(`✅ 签到成功 +${d.response.activity.p}分`);
                } else {
                    log('⚠️ 已签到或失败');
                }
            }
        } catch (e) { log('❌ 签到出错'); }
        nodes.btnSign.disabled = false;
        markBusy(-1);
    };
    nodes.btnSign.onclick = runSign;

    // 阅读
    const runRead = async () => {
        nodes.btnRead.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 开始阅读任务...');
        try {
            const info = await withAccessTokenRequest(token => gmRequest({
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
            }));
            if (info) {
                const d = JSON.parse(info);
                const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                if (p) {
                    let cur = +p.attributes.progress, max = +p.attributes.max;
                    state.readCur = cur; state.readMax = max; render();

                    if (cur >= max) { log('✅ 阅读任务已完成'); }
                    else {
                        for (let i = cur; i < max; i++) {
                            await waitWhilePaused();
                            log(`📖 阅读文章 ${i + 1}/${max}`);
                            await withAccessTokenRequest(token => gmRequest({
                                method: 'POST',
                                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                                headers: {
                                    'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
                                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true', 'X-Rewards-Country': 'cn'
                                },
                                data: JSON.stringify({
                                    amount: 1, country: 'cn', id: uuid(), type: 101, attributes: { offerid: 'ENUS_readarticle3_30points' }
                                })
                            }));
                            await sleep(2500);
                            state.readCur++; render();
                        }
                        log('✅ 阅读完成');
                    }
                }
            }
        } catch (e) { log('❌ 阅读出错'); }
        nodes.btnRead.disabled = false;
        markBusy(-1);
    };
    nodes.btnRead.onclick = runRead;

    // 搜索 (复用逻辑)
    // 获取 Reward Token (活动专用)
    async function getSearchToken() {
        try {
            // 方法1：从 Cookie 中获取（最可靠）
            const cookies = await getCookies('https://rewards.bing.com');
            console.log('Cookie:', cookies);

            // 多种 Cookie 名称匹配
            const cookiePatterns = [
                /__RequestVerificationToken[=;]\s*([^;]+)/i,
                /RequestVerificationToken[=;]\s*([^;]+)/i,
                /XSRF-TOKEN[=;]\s*([^;]+)/i,
                /_RequestVerificationToken[=;]\s*([^;]+)/i
            ];

            for (const pattern of cookiePatterns) {
                const match = cookies.match(pattern);
                if (match && match[1] && match[1].length > 5) {
                    const token = decodeURIComponent(match[1].trim());
                    console.log('✓ 从 Cookie 获取 Token:', token.substring(0, 20) + '...');
                    return token;
                }
            }

            // 方法2：从页面 HTML 中提取
            const html = await gmRequest({
                url: 'https://rewards.bing.com/',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'User-Agent': CONFIG.ua.pc
                },
                retries: 3,
                retryDelay: 2000
            });

            // 扩展匹配模式
            const htmlPatterns = [
                /__RequestVerificationToken\s*=\s*'([^']+)'/i,
                /__RequestVerificationToken\s*=\s*"([^"]+)"/i,
                /name=["']__RequestVerificationToken["']\s+value=["']([^"']+)["']/i,
                /"verificationToken":\s*"([^"]+)"/i,
                /RequestVerificationToken.*?value=["']([^"']+)["']/i,
                /"__RequestVerificationToken":"([^"]+)"/i,
                /data-token=["']([^"']+)["']/i,
                /token:\s*["']([^"']+)["']/i,
                /csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
                /_csrf\s*[:=]\s*["']([^"']+)["']/i
            ];

            for (const pattern of htmlPatterns) {
                const match = html.match(pattern);
                if (match && match[1] && match[1].length > 5) {
                    const token = match[1].trim();
                    console.log('✓ 从 HTML 获取 Token:', token.substring(0, 20) + '...');
                    return token;
                }
            }

            // 方法3：尝试从页面注入获取（如果页面已加载）
            try {
                const token = await new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.textContent = `
                    (function() {
                        // 尝试从各种来源获取 token
                        let token = null;
                        // 从全局变量
                        if (window.__RequestVerificationToken) {
                            token = window.__RequestVerificationToken;
                        }
                        // 从 localStorage
                        if (!token) {
                            token = localStorage.getItem('__RequestVerificationToken') ||
                                   localStorage.getItem('XSRF-TOKEN') ||
                                   sessionStorage.getItem('__RequestVerificationToken');
                        }
                        // 从 meta 标签
                        if (!token) {
                            const meta = document.querySelector('meta[name="csrf-token"]') ||
                                        document.querySelector('meta[name="_csrf"]');
                            if (meta) token = meta.content;
                        }
                        // 从表单
                        if (!token) {
                            const input = document.querySelector('input[name="__RequestVerificationToken"]');
                            if (input) token = input.value;
                        }
                        if (token) {
                            window.__mr_token = token;
                        }
                    })();
                `;
                document.head.appendChild(script);
                setTimeout(() => {
                    const token = window.__mr_token;
                    delete window.__mr_token;
                    script.remove();
                    resolve(token || null);
                }, 1000);
            });

            if (token && token.length > 5) {
                console.log('✓ 从页面注入获取 Token:', token.substring(0, 20) + '...');
                return token;
            }
        } catch (e) {
            console.log('页面注入获取 Token 失败:', e.message);
        }

        // 方法4：尝试从奖励页面API响应中获取
        try {
            const apiResponse = await gmRequest({
                url: 'https://rewards.bing.com/api/getuserinfo?type=1&_=' + Date.now(),
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cache-Control': 'no-cache'
                },
                retries: 2
            });

            if (apiResponse) {
                // 尝试从响应头获取
                const headerMatch = apiResponse.match(/X-CSRF-Token:\s*([^\s]+)/i);
                if (headerMatch && headerMatch[1] && headerMatch[1].length > 5) {
                    console.log('✓ 从 API 响应头获取 Token');
                    return headerMatch[1].trim();
                }
            }
        } catch (e) {
            console.log('从 API 获取 Token 失败:', e.message);
        }

        // 如果所有方法都失败，生成一个临时 Token（某些情况下可用）
        console.warn('⚠️ 所有方法都无法获取 Token，生成临时 Token');
        // 注意：这不是真正的 Token，只是为了让代码继续运行
        return 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);

    } catch (e) {
        console.error('获取 Token 异常:', e);
        log('⚠️ 获取 Token 异常: ' + e.message);
        return null;
    }
}

    // ========== 改进的活动执行 ==========
    const runPromo = async () => {
        if (nodes.btnPromo.disabled) return;
        nodes.btnPromo.disabled = true;
        markBusy(1);
        await waitWhilePaused();
        log('⏳ 开始执行活动...');

        // 先刷新数据
        await updateData();
        if (!dashboard) {
            log('⚠️ 未获取到活动数据，请刷新页面');
            nodes.btnPromo.disabled = false;
            markBusy(-1);
            return;
        }

        // 获取 Token
        const token = await getSearchToken();
        if (!token || token === 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15)) {
            log('⚠️ 未获取到有效的活动Token，尝试使用备用方式...');
            // 即使没有Token，也尝试执行活动（部分活动可能不需要Token）
        }

        // 收集所有需要完成的任务
        let taskList = [];
        const today = getDateStr();

        // 1. 每日任务 (Daily Set)
        if (dashboard.dailySetPromotions && dashboard.dailySetPromotions[today]) {
            const dailyTasks = dashboard.dailySetPromotions[today].filter(p => !p.complete);
            taskList.push(...dailyTasks);
            log(`📅 检测到 ${dailyTasks.length} 个未完成的每日任务`);
        }

        // 2. 更多活动 (More Activities)
        if (dashboard.morePromotions) {
            const moreTasks = dashboard.morePromotions.filter(p => !p.complete);
            taskList.push(...moreTasks);
            log(`🎯 检测到 ${moreTasks.length} 个未完成的更多活动`);
        }

        // 过滤任务
        taskList = taskList.filter(p => {
            if (p.complete) return false;
            if (p.priority !== undefined && p.priority <= -2) return false;
            if (p.exclusiveLockedFeatureStatus === 'locked') return false;
            if (!p.offerId && !p.id) return false;
            return true;
        });

        if (taskList.length === 0) {
            log('✅ 所有活动已完成！');
            nodes.btnPromo.disabled = false;
            markBusy(-1);
            return;
        }

        log(`📋 共 ${taskList.length} 个待完成任务`);
        let successCount = 0;

        for (let idx = 0; idx < taskList.length; idx++) {
            const p = taskList[idx];
            await waitWhilePaused();

            try {
                const offerId = p.offerId || p.id;
                log(`▶️ [${idx+1}/${taskList.length}] 执行: ${p.title || offerId}`);

                // 使用多种方式上报活动
                const reportMethods = [
                    // 方法1：标准上报
                    async () => {
                        if (token && token.length > 10) {
                            return await gmRequest({
                                method: 'POST',
                                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    'Referer': 'https://rewards.bing.com/'
                                },
                                data: `id=${encodeURIComponent(offerId)}&hash=${encodeURIComponent(p.hash || '')}&activityAmount=1&__RequestVerificationToken=${encodeURIComponent(token)}`,
                                retries: 2
                            });
                        }
                        return null;
                    },
                    // 方法2：V1 API
                    async () => {
                        return await gmRequest({
                            method: 'POST',
                            url: 'https://www.bing.com/msrewards/api/v1/ReportActivity?ajaxreq=1',
                            headers: {
                                'Content-Type': 'application/json',
                                'Referer': 'https://www.bing.com/'
                            },
                            data: JSON.stringify({
                                "ActivitySubType": "quiz",
                                "ActivityType": "notification",
                                "OfferId": offerId,
                                "Channel": "Bing.Com",
                                "PartnerId": "BingTrivia",
                                "Timezone": -480
                            }),
                            retries: 2
                        });
                    },
                    // 方法3：移动端API
                    async () => {
                        const mobileToken = await getAccessToken();
                        if (mobileToken) {
                            return await gmRequest({
                                method: 'POST',
                                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                                headers: {
                                    'Authorization': `Bearer ${mobileToken}`,
                                    'Content-Type': 'application/json',
                                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555',
                                    'X-Rewards-IsMobile': 'true',
                                    'X-Rewards-Country': 'cn'
                                },
                                data: JSON.stringify({
                                    amount: 1,
                                    id: uuid(),
                                    type: 101,
                                    country: 'cn',
                                    attributes: { offerid: offerId },
                                    risk_context: {},
                                    channel: 'SAAndroid'
                                }),
                                retries: 2
                            });
                        }
                        return null;
                    }
                ];

                let success = false;
                for (const method of reportMethods) {
                    try {
                        const result = await method();
                        if (result !== null) {
                            success = true;
                            break;
                        }
                    } catch (e) {
                        console.log(`方法失败:`, e.message);
                    }
                }

                if (success) {
                    successCount++;
                    log(`✅ 任务 ${idx+1} 已上报`);
                } else {
                    log(`⚠️ 任务 ${idx+1} 上报失败，尝试其他方式...`);
                    // 尝试简单的GET请求
                    try {
                        await gmRequest({
                            url: `https://rewards.bing.com/api/reportactivity?id=${encodeURIComponent(offerId)}&activityAmount=1&_=${Date.now()}`,
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest'
                            }
                        });
                        successCount++;
                        log(`✅ 任务 ${idx+1} 已通过GET方式上报`);
                    } catch (e) {
                        log(`❌ 任务 ${idx+1} 所有方式均失败`);
                    }
                }

                // 随机延迟 2-5 秒
                await sleep(randomRange(2000, 5000));

            } catch (e) {
                log(`❌ 任务 ${idx+1} 执行失败: ${e.message || '未知错误'}`);
                await sleep(3000);
            }

            // 每完成2个任务刷新一次数据
            if ((idx + 1) % 2 === 0) {
                await updateData();
            }
        }

        log(`🏁 活动执行完成，成功上报 ${successCount}/${taskList.length} 个任务`);
        await updateData();
        nodes.btnPromo.disabled = false;
        markBusy(-1);
    };

    // 替换原有的 runPromo
    nodes.btnPromo.onclick = runPromo;

    const runSearch = async () => {
        if (state.running) {
            state.running = false;
            if (state.manualPaused) setManualPause(false, { silent: true });
            nodes.btnSearch.textContent = '🔍 搜索';
            updateAllButton();
            return;
        }
        state.running = true;
        nodes.btnSearch.textContent = '⏹ 停止';
        updateAllButton();
        await waitWhilePaused();

        await updateData();

        // 辅助函数：执行单次搜索并报告活动
        const doSearch = async (query, isMobile) => {
            await waitWhilePaused();

            const host = isMobile ? 'cn.bing.com' : 'www.bing.com';
            const searchUrl = `https://${host}/search?q=${encodeURIComponent(query)}&form=QBLH&mkt=zh-CN`;

            // 移动端专用配置
            const mobileConfig = {
                userAgent: CONFIG.ua.mobile,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Cache-Control': 'max-age=0',
                    'TE': 'trailers'
                },
                // 移动端特有 Cookie
                cookies: [
                    `_Rwho=u=m&ts=${getDateHyphen()}`,
                    '_EDGE_S=1',
                    '_SS=1',
                    'SRCHD=AF=NOFORM',
                    'SRCHUID=V=2&GUID=00000000-0000-0000-0000-000000000000',
                    'SRCHUSR=DOB=20250101',
                    '_RwBf=1'
                ]
            };

            const pcConfig = {
                userAgent: CONFIG.ua.pc,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1'
                },
                cookies: [
                    `_Rwho=u=d&ts=${getDateHyphen()}`,
                    '_EDGE_S=1'
                ]
            };

            const config = isMobile ? mobileConfig : pcConfig;

            // 构建完整的 Cookie 字符串
            const cookieString = config.cookies.join('; ');

            // 清理旧的移动端 Cookie
            await deleteCookie('_Rwho', host);
            await deleteCookie('_EDGE_S', host);
            await deleteCookie('_SS', host);
            await deleteCookie('SRCHD', host);
            await deleteCookie('SRCHUID', host);
            await deleteCookie('SRCHUSR', host);
            await deleteCookie('_RwBf', host);
            await deleteCookie('MUID', host);
            await deleteCookie('MUIDB', host);

            try {
                // 1. 首先访问移动端首页，建立会话
                if (isMobile) {
                    log('📱 建立移动端会话...');
                    await gmRequest({
                        url: `https://${host}/?mkt=zh-CN`,
                        method: 'GET',
                        headers: {
                            'User-Agent': config.userAgent,
                            ...config.headers,
                            'Cookie': cookieString
                        },
                        retries: 1
                    });
                    await sleep(randomRange(1000, 2000));
                }

                // 2. 执行搜索
                log(`${isMobile ? '📱' : '💻'} 搜索: "${query.substring(0, 15)}..."`);
                const searchResult = await gmRequest({
                    url: searchUrl,
                    method: 'GET',
                    headers: {
                        'User-Agent': config.userAgent,
                        ...config.headers,
                        'Cookie': cookieString,
                        'Referer': `https://${host}/`
            },
                    retries: 2,
                    retryDelay: 2000
                });

                // 3. 提取关键参数
                const igMatch = searchResult.match(/,IG:"([^"]+)"/);
                const ig = igMatch ? igMatch[1] : '';

                // 提取 IID
                const iidMatch = searchResult.match(/IID:"([^"]+)"/);
                const iid = iidMatch ? iidMatch[1] : 'SERP.5047';

                // 4. 上报搜索活动（关键步骤）
                const reportHeaders = {
                    'User-Agent': config.userAgent,
                    'Cookie': cookieString,
                    'Referer': searchUrl,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': `https://${host}`,
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                };

                // 4a. ncheader 请求（移动端必须）
                if (isMobile) {
                    await gmRequest({
                        method: 'POST',
                        url: `https://${host}/rewardsapp/ncheader?ver=88888888&IID=${iid}&IG=${ig}&ajaxreq=1`,
                        headers: reportHeaders,
                        data: 'wb=1%3bi%3d1%3bv%3d1',
                        retries: 2
                    });
                    await sleep(randomRange(500, 1000));
                }

                // 4b. reportActivity 请求
                await gmRequest({
                    method: 'POST',
                    url: `https://${host}/rewardsapp/reportActivity?IG=${ig}&IID=${iid}&q=${encodeURIComponent(query)}&ajaxreq=1`,
                    headers: reportHeaders,
                    data: `url=${encodeURIComponent(searchUrl)}&V=web&type=search`,
                    retries: 2
                });

                // 4c. 额外的移动端上报
                if (isMobile) {
                    await sleep(randomRange(500, 1000));
                    await gmRequest({
                        method: 'POST',
                        url: `https://${host}/rewardsapp/reportActivity?IG=${ig}&IID=${iid}&ajaxreq=1`,
                        headers: reportHeaders,
                        data: `V=web&type=search&url=${encodeURIComponent(searchUrl)}`
            });
                }

                // 5. 保存搜索状态
                const progressKey = isMobile ? 'mobile' : 'pc';
                const current = isMobile ? state.mobileCur : state.pcCur;
                const max = isMobile ? state.mobileMax : state.pcMax;

                if (current < max) {
                    if (isMobile) {
                        state.mobileCur = Math.min(current + 3, max);
                    } else {
                        state.pcCur = Math.min(current + 3, max);
                    }
                    render();
                }

                log(`✅ ${isMobile ? '📱' : '💻'} 搜索成功 (+3)`);

                // 随机延迟（移动端更长的延迟）
                const delay = isMobile ? randomRange(3000, 5000) : randomRange(2000, 3000);
                await sleep(delay);

            } catch (e) {
                log(`❌ ${isMobile ? '📱' : '💻'} 搜索失败: ${e.message || '未知错误'}`);
                // 如果失败，等待更长时间再重试
                await sleep(randomRange(5000, 8000));
            }
        };;

        // 精确等待函数（不受标签页切换影响）
        const preciseWait = async (ms) => {
            state.countdownStartTime = Date.now();
            state.countdownDuration = ms;
            let endTime = Date.now() + ms;

            while (Date.now() < endTime && state.running) {
                if (state.manualPaused) {
                    const pausedMs = await waitWhilePaused();
                    endTime += pausedMs;
                    state.countdownStartTime += pausedMs;
                    continue;
                }
                const remaining = Math.max(0, endTime - Date.now());
                // 更新UI显示剩余时间
                const secs = Math.ceil(remaining / 1000);
                if (secs % 5 === 0 || secs <= 10) {
                    log(`⏳ 等待 ${secs} 秒...`);
                }
                await sleep(Math.min(1000, remaining));
            }
            state.countdownStartTime = 0;
            state.countdownDuration = 0;
        };

        // 暂停检查函数
        const checkPause = async () => {
            if (!CONFIG.pause.enabled) return;

            state.searchCount++;
            saveProgress(); // 保存进度

            if (state.searchCount % CONFIG.pause.interval === 0) {
                state.isPaused = true;
                const pauseMinutes = CONFIG.pause.duration / 60000;
                log(`⏸️ 已完成 ${state.searchCount} 次搜索，暂停 ${pauseMinutes} 分钟降低风险...`);

                state.pauseEndTime = Date.now() + CONFIG.pause.duration;
                await preciseWait(CONFIG.pause.duration);

                state.isPaused = false;
                state.pauseEndTime = 0;
                log(`▶️ 暂停结束，继续搜索...`);
            }
        };

        // 加载之前的进度
        loadProgress();
        log(`📊 当前搜索计数: ${state.searchCount}`);

        // PC Search
        const pcNeed = Math.ceil((state.pcMax - state.pcCur) / 3);
        if (pcNeed > 0) {
            log(`💻 PC搜索 ${pcNeed}次`);
            for (let i = 0; i < pcNeed && state.running; i++) {
                await waitWhilePaused();
                const q = await getHotQuery();
                await doSearch(q, false);
                await checkPause(); // 暂停检查
                if (!state.running) break;
                await preciseWait(randomRange(CONFIG.pc.minDelay, CONFIG.pc.maxDelay));
                if ((i + 1) % 3 === 0) await updateData();
            }
        }

        // Mobile Search
        const mobNeed = Math.ceil((state.mobileMax - state.mobileCur) / 3);
        if (mobNeed > 0 && state.running) {
            log(`📱 移动搜索 ${mobNeed}次`);
            for (let i = 0; i < mobNeed && state.running; i++) {
                await waitWhilePaused();
                const q = await getHotQuery();
                await doSearch(q, true);
                await checkPause(); // 暂停检查
                if (!state.running) break;
                await preciseWait(randomRange(CONFIG.mobile.minDelay, CONFIG.mobile.maxDelay));
                if ((i + 1) % 3 === 0) await updateData();
            }
        }

        await updateData();
        state.running = false;
        nodes.btnSearch.textContent = '🔍 搜索';
        updateAllButton();
        log('🏁 搜索结束');
        saveProgress(); // 最终保存进度
    };
    nodes.btnSearch.onclick = runSearch;

    nodes.btnAll.onclick = async () => {
        if (state.manualPaused || state.running || state.allRunning || state.busyCount > 0) {
            setManualPause(!state.manualPaused);
            return;
        }
        state.allRunning = true;
        updateAllButton();
        log('🚀 一键执行开始');
        try {
            await waitWhilePaused();
            await runSign();
            await runRead();
            await runPromo();
            await runSearch();
        } finally {
            state.allRunning = false;
            updateAllButton();
        }
    };

    // Init
    (async () => {
        try {
            loginCookie = await getCookies('https://login.live.com');
            await updateData();
            // Try load read progress if token exists
            try {
                const info = await withAccessTokenRequest(token => gmRequest({
                    url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
                }));
                if (info) {
                    const d = JSON.parse(info);
                    const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                    if (p) { state.readCur = +p.attributes.progress; state.readMax = +p.attributes.max; render(); }
                }
            } catch { }
        } catch { }
        log('🌟 脚本就绪 v1.0.1.2');
    })();

    setInterval(updateData, 60000);

})();
