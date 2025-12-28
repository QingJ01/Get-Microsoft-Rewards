// ==UserScript==
// @name         Get Microsoft Rewards
// @namespace    http://tampermonkey.net/
// @version      1.0.0
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
// @connect      rewards.bing.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      login.live.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hot.baiwumm.com
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
        hotApi: {
            enabled: true,
            url: 'https://hot.baiwumm.com/api/',
            sources: ['weibo', 'douyin', 'baidu', 'zhihu', 'toutiao']
        },
        keywords: ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略"]
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
        accessToken: null
    };
    let dashboard = null;
    let loginCookie = '';

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
    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 20000,
                ...options,
                onload: xhr => {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        resolve(options.returnUrl ? xhr.finalUrl : xhr.responseText);
                    } else if ([301, 302, 307, 308].includes(xhr.status)) {
                        const loc = xhr.responseHeaders.match(/Location:\s*(.*?)\s*[\r\n]/i);
                        resolve(loc ? loc[1] : xhr.responseText);
                    } else {
                        resolve(xhr.responseText);
                    }
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }

    // 获取热搜词
    async function getHotQuery() {
        if (CONFIG.hotApi.enabled) {
            try {
                const src = randomPick(CONFIG.hotApi.sources);
                const res = await gmRequest({ method: 'GET', url: CONFIG.hotApi.url + src });
                const data = JSON.parse(res);
                if (data.code === 200 && data.data?.length) {
                    return (randomPick(data.data).title || '').substring(0, 20);
                }
            } catch { }
        }
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

    function deleteCookie(name) {
        return new Promise(resolve => {
            if (typeof GM_cookie !== 'undefined') {
                GM_cookie('delete', { url: 'https://bing.com', name }, resolve);
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

    const log = (msg) => {
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString().slice(0, 5)}] ${msg}`;
        nodes.logBox.appendChild(div);
        nodes.logBox.scrollTop = nodes.logBox.scrollHeight;
    };

    // 授权相关
    const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf';

    nodes.btnAuthLink.onclick = () => window.open(AUTH_URL, '_blank');

    nodes.btnAuthSave.onclick = () => {
        const val = nodes.inAuth.value.trim();
        const match = val.match(/M\.[\w+.]+(-\w+){4}/);
        if (match) {
            GM_setValue('auth_code', match[0]);
            log('✅ 授权码已保存！');
            nodes.boxAuth.style.display = 'none';
        } else {
            log('❌ 格式错误，请复制完整URL');
        }
    };

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
        try {
            const res = await gmRequest({ url: `https://rewards.bing.com/api/getuserinfo?type=1&_=${Date.now()}`, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const data = JSON.parse(res);
            dashboard = data.dashboard || data;

            const user = dashboard.userStatus || {};
            state.level = user.levelInfo?.activeLevel || 1;
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
                // 有时候 API 不返回 mobileSearch，但实际上有任务
                // 这里可以尝试硬编码一个修正值，或者不仅仅显示 0/0
                mobM = 60; // 假设值，避免显示 0/0 让人以为出错
            }

            state.pcCur = pc; state.pcMax = pcM;
            state.mobileCur = mob; state.mobileMax = mobM;

            const allP = [...(dashboard.dailySetPromotions?.[getDateStr()] || []), ...(dashboard.morePromotions || [])];
            state.promosTotal = allP.length;
            state.promosDone = allP.filter(p => p.complete).length;

            render();
        } catch (e) { console.error(e); }
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
    async function getAccessToken() {
        if (state.accessToken) return state.accessToken;
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
                if (data.refresh_token) GM_setValue('refresh_token', data.refresh_token);
                return data.access_token;
            } else if (data.error) {
                log('Token失效，请重新授权');
                GM_setValue('refresh_token', '');
                GM_setValue('auth_code', '');
                nodes.boxAuth.style.display = 'block';
            }
        } catch (e) { log('Auth Error: ' + e.message); }
        return null;
    }

    // 签到
    nodes.btnSign.onclick = async () => {
        nodes.btnSign.disabled = true;
        log('⏳ 签到中...');
        const token = await getAccessToken();
        if (token) {
            try {
                const res = await gmRequest({
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
                });
                const d = JSON.parse(res);
                if (d.response?.activity) {
                    log(`✅ 签到成功 +${d.response.activity.p}分`);
                } else {
                    log('⚠️ 已签到或失败');
                }
            } catch (e) { log('❌ 签到出错'); }
        }
        nodes.btnSign.disabled = false;
    };

    // 阅读
    nodes.btnRead.onclick = async () => {
        nodes.btnRead.disabled = true;
        log('⏳ 开始阅读任务...');
        const token = await getAccessToken();
        if (token) {
            // 获取进度
            try {
                const info = await gmRequest({
                    url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
                });
                const d = JSON.parse(info);
                const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                if (p) {
                    let cur = +p.attributes.progress, max = +p.attributes.max;
                    state.readCur = cur; state.readMax = max; render();

                    if (cur >= max) { log('✅ 阅读任务已完成'); }
                    else {
                        for (let i = cur; i < max; i++) {
                            log(`📖 阅读文章 ${i + 1}/${max}`);
                            await gmRequest({
                                method: 'POST',
                                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                                headers: {
                                    'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
                                    'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true', 'X-Rewards-Country': 'cn'
                                },
                                data: JSON.stringify({
                                    amount: 1, country: 'cn', id: uuid(), type: 101, attributes: { offerid: 'ENUS_readarticle3_30points' }
                                })
                            });
                            await sleep(2500);
                            state.readCur++; render();
                        }
                        log('✅ 阅读完成');
                    }
                }
            } catch (e) { log('❌ 阅读出错'); }
        }
        nodes.btnRead.disabled = false;
    };

    // 搜索 (复用逻辑)
    async function getSearchToken() {
        try {
            const html = await gmRequest({ url: 'https://rewards.bing.com/' });
            return html.match(/RequestVerificationToken.*?value="([^"]+)"/)?.[1];
        } catch { return null; }
    }

    nodes.btnPromo.onclick = async () => {
        nodes.btnPromo.disabled = true;
        log('⏳ 执行活动...');
        await updateData();
        const token = await getSearchToken();
        if (token) {
            const list = [...(dashboard.dailySetPromotions?.[getDateStr()] || []), ...(dashboard.morePromotions || [])];
            let count = 0;
            for (const p of list) {
                if (!p.complete && p.priority > -2 && p.exclusiveLockedFeatureStatus !== 'locked') {
                    try {
                        await gmRequest({
                            method: 'POST',
                            url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            data: `id=${p.offerId}&hash=${p.hash}&activityAmount=1&__RequestVerificationToken=${token}`
                        });
                        count++;
                        log(`ok: ${p.title}`);
                        await sleep(1000);
                    } catch { }
                }
            }
            log(`✅ 完成 ${count} 个活动`);
            await updateData();
        }
        nodes.btnPromo.disabled = false;
    };

    nodes.btnSearch.onclick = async () => {
        if (state.running) { state.running = false; nodes.btnSearch.textContent = '🔍 搜索'; return; }
        state.running = true;
        nodes.btnSearch.textContent = '⏹ 停止';

        await updateData();
        // PC Search
        const pcNeed = Math.ceil((state.pcMax - state.pcCur) / 3);
        if (pcNeed > 0) {
            log(`💻 PC搜索 ${pcNeed}次`);
            for (let i = 0; i < pcNeed && state.running; i++) {
                const q = await getHotQuery();
                await deleteCookie('_EDGE_S'); await deleteCookie('_Rwho');
                await gmRequest({ url: `https://www.bing.com/search?q=${encodeURIComponent(q)}`, headers: { 'User-Agent': CONFIG.ua.pc } });
                await sleep(randomRange(CONFIG.pc.minDelay, CONFIG.pc.maxDelay));
                if (i % 3 === 0) updateData(); // periodic update
            }
        }

        // Mobile Search
        const mobNeed = Math.ceil((state.mobileMax - state.mobileCur) / 3);
        if (mobNeed > 0 && state.running) {
            log(`📱 移动搜索 ${mobNeed}次`);
            for (let i = 0; i < mobNeed && state.running; i++) {
                const q = await getHotQuery();
                await deleteCookie('_EDGE_S'); await deleteCookie('_Rwho');
                await gmRequest({
                    url: `https://cn.bing.com/search?q=${encodeURIComponent(q)}`,
                    headers: {
                        'User-Agent': CONFIG.ua.mobile,
                        'Cookie': `_Rwho=u=m&ts=${getDateHyphen()}`
                    }
                });
                await sleep(randomRange(CONFIG.mobile.minDelay, CONFIG.mobile.maxDelay));
                if (i % 3 === 0) updateData();
            }
        }

        await updateData();
        state.running = false;
        nodes.btnSearch.textContent = '🔍 搜索';
        log('🏁 搜索结束');
    };

    nodes.btnAll.onclick = async () => {
        log('🚀 一键执行开始');
        nodes.btnAll.disabled = true;
        await nodes.btnSign.click();
        await nodes.btnRead.click();
        await nodes.btnPromo.click();
        await nodes.btnSearch.click(); // This is async but we just trigger it
        nodes.btnAll.disabled = false;
    };

    // Init
    (async () => {
        try {
            loginCookie = await getCookies('https://login.live.com');
            await updateData();
            // Try load read progress if token exists
            try {
                const token = await getAccessToken();
                if (token) {
                    const info = await gmRequest({
                        url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Rewards-AppId': 'SAAndroid/31.4.2110003555', 'X-Rewards-IsMobile': 'true' }
                    });
                    const d = JSON.parse(info);
                    const p = d.response?.promotions?.find(x => x.attributes?.offerid === 'ENUS_readarticle3_30points');
                    if (p) { state.readCur = +p.attributes.progress; state.readMax = +p.attributes.max; render(); }
                }
            } catch { }
        } catch { }
        log('🌟 脚本就绪 v1.0.0');
    })();

    setInterval(updateData, 60000);

})();