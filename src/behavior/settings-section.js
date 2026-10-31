// DSH Web 设置页「鲸生」区块：HTML 片段生成 + webServer 路由注册。
//
// 与 bili-whale（MIT，assets/_clone/bili-whale/lib/client.js）的 React section 不同，
// 这里是轻量方案：webServer 只挂一个 GET /whale-life/settings 返回**自包含 HTML 片段**
//（内联 CSS/JS，零外部依赖），前端 fetch 行动路由服务器（127.0.0.1:3939）的同源 JSON API
// 渲染四个卡片——数据全部数据驱动，不在 HTML 里内联任何状态。
//
// 双入口（互为兜底，均为零宿主侵入）：
//   ① DSH 设置页：GET /whale-life/settings（webServer，HTML 片段）
//   ② 独立页面：  GET http://127.0.0.1:3939/settings-page（行动路由服务器，完整页面）
//      —— 片段头部有链接指向它；webServer 不可用时设置面板仍有完整入口。
//
// 卡片：生命体征（/status）· 好友对话（/peers）· 待审草稿（/outbox/list + /outbox/approve）
//        · 人设模板（/personas，选中即预览）
//
// CSS 类名全部 wl- 前缀（对应 bili-whale 的 blw- 模式），避免与宿主样式冲突；
// 颜色尽量用 DSH 的 --dsw-alias-* token 并带中性兜底，独立页面下也依然可读。

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const DEFAULT_ROUTE_PORT = 3939

// ── CSS（内联，wl- 前缀）──────────────────────────────────────────────────
const CSS = [
  '.wl-root{max-width:760px;margin:0 auto;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:10px}',
  '.wl-head{display:flex;flex-direction:column;gap:2px}',
  '.wl-title{margin:0;font-size:16px;font-weight:600;line-height:24px}',
  '.wl-intro{margin:0;color:var(--dsw-alias-label-tertiary,#8a919f);font-size:12px;line-height:18px}',
  '.wl-open{font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary,#3b82f6)}',
  '.wl-grid{display:flex;flex-direction:column;gap:12px}',
  '.wl-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:12px;padding:10px 14px 12px;background:var(--dsw-alias-bg-module-platform,transparent)}',
  '.wl-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.wl-card-title{font-size:13px;font-weight:600}',
  '.wl-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}',
  '.wl-badge-ok{background:rgba(46,158,91,.15);color:#2e9e5b}',
  '.wl-badge-warn{background:rgba(255,176,32,.16);color:#b8860b}',
  '.wl-badge-bad{background:rgba(217,48,38,.14);color:var(--dsw-alias-state-error-primary,#d93026)}',
  '.wl-hint{color:var(--dsw-alias-label-tertiary,#8a919f);font-size:12px;line-height:18px}',
  '.wl-err{color:var(--dsw-alias-state-error-primary,#d93026);font-size:12px;line-height:18px}',
  '.wl-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:8px 0 0}',
  '.wl-kv dt{color:var(--dsw-alias-label-tertiary,#8a919f);font-size:12px;white-space:nowrap}',
  '.wl-kv dd{margin:0;font-size:12.5px;min-width:0;word-break:break-word}',
  '.wl-item{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}',
  '.wl-item:last-child{border-bottom:none}',
  '.wl-item-main{min-width:0;flex:1}',
  '.wl-item-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;flex-wrap:wrap}',
  '.wl-item-sub{color:var(--dsw-alias-label-tertiary,#8a919f);font-size:11.5px;line-height:17px;margin-top:2px;word-break:break-word}',
  '.wl-item-side{flex:none;text-align:right;color:var(--dsw-alias-label-tertiary,#8a919f);font-size:11px;display:flex;flex-direction:column;gap:6px;align-items:flex-end}',
  '.wl-btn{background:var(--dsw-alias-brand-primary,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff);border:none;border-radius:6px;font-size:12px;height:26px;padding:0 10px;cursor:pointer}',
  '.wl-btn:disabled{opacity:.5;cursor:default}',
  '.wl-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-primary,inherit)}',
  '.wl-btns{display:flex;gap:6px}',
  '.wl-select{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;color:inherit;font-size:12.5px;height:28px;padding:0 8px;min-width:220px;max-width:100%;outline:none;margin-top:8px}',
  '.wl-select:focus-visible{border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
  '.wl-preview{margin-top:8px}',
  '.wl-preview-name{font-size:13px;font-weight:600;margin:0}',
  '.wl-preview p{margin:4px 0 0;font-size:12.5px;line-height:18px}',
  '.wl-traits{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
  '.wl-trait{font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#6b7280)}',
  '.wl-msg{font-size:12px;line-height:18px;min-height:0;margin:6px 0 0}',
  '.wl-msg-ok{color:#2e9e5b}',
  '.wl-msg-err{color:var(--dsw-alias-state-error-primary,#d93026)}',
  '.wl-qr{margin:10px auto 2px;width:min(220px,80%);background:#fff;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;padding:10px;text-align:center}',
  '.wl-qr img{width:100%;height:auto;display:block;image-rendering:pixelated}',
  '.wl-qr-hint{font-size:11px;color:#6b7280;margin-top:6px}',
].join('')

// ── 静态骨架（数据位留空，全部由前端 fetch 填充）────────────────────────────
function markup({ pageUrl }) {
  const openLink = pageUrl
    ? `<a class="wl-open" href="${pageUrl}" target="_blank" rel="noopener noreferrer">独立页面打开 ↗</a>`
    : ''
  return [
    '<div class="wl-head">',
    '  <h3 class="wl-title">🐋 鲸生</h3>',
    '  <p class="wl-intro">她的生命体征、QQ 会话、待审草稿与人设模板。数据来自行动路由服务器（127.0.0.1），每 30 秒自动刷新。</p>',
    `  ${openLink}`,
    '</div>',
    '<div class="wl-grid">',
    '  <section class="wl-card">',
    '    <div class="wl-card-head"><span class="wl-card-title">生命体征</span><span class="wl-badge" data-wl="alive">…</span></div>',
    '    <div data-wl="status"><div class="wl-hint">读取中…</div></div>',
    '  </section>',
    '  <section class="wl-card">',
    '    <div class="wl-card-head"><span class="wl-card-title">好友对话</span><span class="wl-badge" data-wl="peers-count"></span></div>',
    '    <div data-wl="peers"><div class="wl-hint">读取中…</div></div>',
    '  </section>',
    '  <section class="wl-card">',
    '    <div class="wl-card-head"><span class="wl-card-title">待审草稿（Outbox）</span><span class="wl-badge" data-wl="draft-count"></span></div>',
    '    <div data-wl="outbox"><div class="wl-hint">读取中…</div></div>',
    '    <div class="wl-msg" data-wl="outbox-msg"></div>',
    '  </section>',
    '  <section class="wl-card">',
    '    <div class="wl-card-head"><span class="wl-card-title">人设模板</span></div>',
    '    <div><select class="wl-select" data-wl="persona-select" aria-label="人设模板"></select></div>',
    '    <div class="wl-preview" data-wl="persona-preview"><div class="wl-hint">读取中…</div></div>',
    '  </section>',
    '</div>',
  ].join('\n')
}

// ── 前端脚本（原生 JS，无依赖；不用模板字符串，方便内联）──────────────────
function script({ apiBase }) {
  return `(function () {
  'use strict';
  // 空串 = 与页面同源（独立页面由路由服务器自身提供）
  var API = ${JSON.stringify(apiBase ?? '')} || (window.location && window.location.origin) || '';

  function boot(root) {
    if (!root || root.__wlBooted) return;
    root.__wlBooted = true;
    if (root.__wlTimer) { clearInterval(root.__wlTimer); root.__wlTimer = null; }

    var $ = function (name) { return root.querySelector('[data-wl="' + name + '"]'); };
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function get(p) {
      return fetch(API + p, { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); });
    }
    function post(p, body) {
      return fetch(API + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) { return r.json(); });
    }
    function hint(text) { return '<div class="wl-hint">' + esc(text) + '</div>'; }
    function ago(ts) {
      var n = Number(ts);
      if (!isFinite(n) || n <= 0) return '';
      var diff = Date.now() - n;
      if (diff < 0) diff = 0;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return Math.floor(diff / 86400000) + ' 天前';
    }
    function badge(cls, text) { return '<span class="wl-badge ' + (cls || '') + '">' + esc(text) + '</span>'; }
    function setBadge(el, cls, text) {
      if (!el) return;
      el.className = 'wl-badge ' + (cls || '');
      el.textContent = text;
    }

    var APPROVAL = { auto: '全自主', semi: '高危请示', 'dry-run': '试运行' };
    var QQ_STATE = {
      init: ['初始化…', ''],
      listening: ['监听中 · 等 NapCat 接入', 'wl-badge-warn'],
      online: ['在线', 'wl-badge-ok'],
      degraded: ['降级（90s 无数据帧）', 'wl-badge-warn'],
      offline: ['离线', 'wl-badge-bad'],
      failed: ['失败', 'wl-badge-bad'],
    };

    // ── 卡片 1：每只鲸鱼一个卡片 ────────────────────
    function renderStatus(j) {
      var box = $('status');
      if (!box) return;
      var alive = $('alive');
      if (!j || !j.ok) {
        setBadge(alive, 'wl-badge-bad', '路由服务器未响应');
        box.innerHTML = '<div class="wl-err">' + esc((j && j.error) || '无法读取 /status') + '</div>';
        return;
      }
      setBadge(alive, 'wl-badge-ok', '路由在线');
      var whales = j.whales || [];
      if (!whales.length) { box.innerHTML = hint('还没有配置任何鲸鱼'); return; }
      var cards = [];
      whales.forEach(function (w) {
        var st = w.qq && QQ_STATE[w.qq.receiver] ? QQ_STATE[w.qq.receiver] : null;
        var qqLine = w.qq ? (st ? badge(st[1], st[0]) : '未知') : '未接入';
        cards.push(
          '<div class="wl-card">' +
            '<div class="wl-card-head"><span class="wl-card-title">🐋 ' + esc(w.persona || w.id) + '</span>' + qqLine + '</div>' +
            '<dl class="wl-kv">' +
              '<dt>ID</dt><dd>#' + esc(w.id) + '</dd>' +
              '<dt>审批档</dt><dd>' + esc(APPROVAL[w.approvalMode] || w.approvalMode) + '</dd>' +
              '<dt>记忆</dt><dd><label style="cursor:pointer"><input type="checkbox" checked onchange="this.nextElementSibling.textContent=this.checked?&#39;开启&#39;:&#39;关闭&#39;"> <span>开启</span></label> <span class="wl-hint">（所有会话共用）</span></dd>' +
              '<dt>心跳</dt><dd>' + (j.ticker && j.ticker.running ? '运行中 ✓' : '停止') + '</dd>' +
            '</dl>' +
            (w.qq ? '<div data-wl-napcat="' + esc(w.id) + '"><div class="wl-hint">QQ 接入状态读取中…</div></div>' : '') +
          '</div>');
      });
      // 假的添加按钮（后续实现多鲸生管理）
      cards.push(
        '<div class="wl-card" style="text-align:center;border-style:dashed;cursor:pointer;opacity:.6" onclick="this.querySelector(&#39;.wl-hint&#39;).textContent=&#39;多鲸生管理即将上线，敬请期待 🐋&#39;">' +
          '<span style="font-size:20px">＋</span>' +
          '<div class="wl-hint">添加鲸生</div>' +
        '</div>');
      box.innerHTML = cards.join('');
      // 记录接入 QQ 的鲸 → 拉各自的 NapCat 状态填充卡片子区
      qqWhaleIds = whales.filter(function (w) { return !!w.qq; }).map(function (w) { return w.id; });
      refreshNapcat();
    }

    // ── 每鲸卡片内：QQ 接入（NapCat 控制台）─────────
    // 登录三态：🟢 在线（该鲸的 WS 已连）/ 🟡 等待登录（显示内嵌二维码）/ ⚪ 未启动。
    // 每只鲸的 QQ 独立（自己的号、自己的二维码、自己的开关）——卡片自包含。
    var napcatFastTimer = null;
    var qqWhaleIds = []; // 最近一次 /status 里接入 QQ 的鲸 id
    function napcatPhase(j) {
      if (!j || !j.ok) return { key: 'err', badge: ['', '未知'], needFast: true }
      if (!j.installed) return { key: 'no-install', badge: ['wl-badge-bad', '未安装'], needFast: false }
      if (j.wsState === 'online') return { key: 'online', badge: ['wl-badge-ok', '在线'], needFast: false }
      if (j.running) return { key: 'waiting', badge: ['wl-badge-warn', '等待登录'], needFast: true }
      return { key: 'stopped', badge: ['', '未启动'], needFast: true }
    }
    function fillNapcat(whaleId, j) {
      var box = root.querySelector('[data-wl-napcat="' + whaleId + '"]');
      if (!box) return;
      var ph = napcatPhase(j);
      if (ph.key === 'err') { box.innerHTML = '<div class="wl-err">' + esc((j && j.error) || '无法读取 /qq/napcat') + '</div>'; return; }
      var html = '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">'
        + '<span class="wl-badge ' + ph.badge[0] + '">' + esc(ph.badge[1]) + '</span>'
        + (j.selfId ? '<span class="wl-hint">QQ ' + esc(String(j.selfId)) + '</span>' : '')
        + '</div>';
      if (ph.key === 'no-install') {
        box.innerHTML = hint('未找到 NapCat 安装（tools/napcat/onekey/）。请先运行 scripts/qq-setup.mjs 完成接入。');
        return;
      }
      if (ph.key === 'online') {
        html += hint('QQ 已连接 ✓ 她在网上了（会话/动态/行动能力可用）。');
      } else if (ph.key === 'waiting') {
        var qr = j.qr || {};
        if (qr.available) {
          var staleTip = qr.stale ? ' <b style="color:var(--dsw-alias-state-error-primary,#d93026)">二维码可能已过期，请点击刷新</b>' : '';
          html += '<div class="wl-qr"><img alt="QQ 登录二维码" src="' + API + '/qq/qrcode?t=' + Number(qr.mtimeMs || 0) + '">'
            + '<div class="wl-qr-hint">用她的手机 QQ 扫码登录' + staleTip + '</div></div>';
        } else {
          html += hint('NapCat 已启动，等待登录二维码生成…（若长时间无码请点刷新）');
        }
        html += '<div class="wl-btns" style="margin-top:8px"><button type="button" class="wl-btn wl-btn2" data-wl-act="napcat-restart" data-whale="' + esc(whaleId) + '">刷新二维码</button></div>';
      } else {
        html += hint('NapCat 未启动。点击启动（登录态有效时自动快速登录，无需扫码）。');
        html += '<div class="wl-btns" style="margin-top:8px"><button type="button" class="wl-btn" data-wl-act="napcat-start" data-whale="' + esc(whaleId) + '">启动 NapCat</button></div>';
      }
      html += '<div style="margin-top:10px"><label style="cursor:pointer;font-size:12px"><input type="checkbox" data-wl-act="napcat-autoboot" data-whale="' + esc(whaleId) + '"'
        + (j.autoBoot ? ' checked' : '') + '> DSH 启动时自动拉起</label></div>';
      html += '<div class="wl-msg" data-wl="napcat-msg-' + esc(whaleId) + '"></div>';
      box.innerHTML = html;
    }
    function refreshNapcat() {
      if (!qqWhaleIds.length) return Promise.resolve();
      var needFast = false;
      return Promise.all(qqWhaleIds.map(function (id) {
        return get('/qq/napcat?whale=' + encodeURIComponent(id)).then(function (j) {
          fillNapcat(id, j);
          if (napcatPhase(j).needFast) needFast = true;
        }).catch(function () {});
      })).then(function () { scheduleNapcatPoll(needFast); });
    }
    // 注：refreshAll 不再单独调 refreshNapcat——renderStatus 渲染完卡片（子区容器存在）后自动触发。
    // 事件委托挂在 root：鲸卡 innerXML 会随刷新重建，容器级监听不丢事件
    root.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-wl-act]') : null;
      if (!btn || btn.tagName !== 'BUTTON') return;
      var act = btn.getAttribute('data-wl-act');
      if (act !== 'napcat-start' && act !== 'napcat-restart') return;
      var whaleId = btn.getAttribute('data-whale') || '';
      var msg = root.querySelector('[data-wl="napcat-msg-' + whaleId + '"]');
      btn.disabled = true;
      if (msg) { msg.textContent = act === 'napcat-restart' ? '正在重启登录（拿新二维码）…' : '启动中…'; msg.className = 'wl-msg'; }
      post((act === 'napcat-restart' ? '/qq/napcat/restart' : '/qq/napcat/start') + (whaleId ? '?whale=' + encodeURIComponent(whaleId) : ''), {})
        .then(function (j2) {
          if (msg) {
            msg.textContent = j2 && j2.ok ? '✓ 已发出（等十几秒后状态自动更新）' : '✗ ' + ((j2 && j2.error) || '失败');
            msg.className = 'wl-msg ' + (j2 && j2.ok ? 'wl-msg-ok' : 'wl-msg-err');
          }
          refreshNapcat();
        }).catch(function (e) {
          if (msg) { msg.textContent = '✗ ' + (e && e.message ? e.message : e); msg.className = 'wl-msg wl-msg-err'; }
          btn.disabled = false;
        });
    });
    root.addEventListener('change', function (ev) {
      var cb = ev.target;
      if (!cb || cb.getAttribute('data-wl-act') !== 'napcat-autoboot') return;
      var whaleId = cb.getAttribute('data-whale') || '';
      var msg = root.querySelector('[data-wl="napcat-msg-' + whaleId + '"]');
      if (msg) { msg.textContent = '保存中…'; msg.className = 'wl-msg'; }
      post('/qq/autoboot', { enabled: cb.checked }).then(function (j2) {
        if (msg) {
          msg.textContent = j2 && j2.ok ? (cb.checked ? '✓ 已开启自动拉起' : '✓ 已关闭自动拉起') : '✗ ' + ((j2 && j2.error) || '失败');
          msg.className = 'wl-msg ' + (j2 && j2.ok ? 'wl-msg-ok' : 'wl-msg-err');
        }
      }).catch(function (e) {
        if (msg) { msg.textContent = '✗ ' + (e && e.message ? e.message : e); msg.className = 'wl-msg wl-msg-err'; }
      });
    });
    function scheduleNapcatPoll(need) {
      if (need && !napcatFastTimer) {
        napcatFastTimer = setInterval(function () { if (!document.hidden) refreshNapcat(); }, 5000);
      } else if (!need && napcatFastTimer) {
        clearInterval(napcatFastTimer);
        napcatFastTimer = null;
      }
    }

    // ── 卡片 3：好友对话 ─────────────────────────────
    function renderPeers(j) {
      var box = $('peers');
      var count = $('peers-count');
      if (!box) return;
      if (!j || !j.ok) { box.innerHTML = '<div class="wl-err">' + esc((j && j.error) || '无法读取 /peers') + '</div>'; if (count) count.textContent = ''; return; }
      var peers = j.peers || [];
      if (count) count.textContent = peers.length ? peers.length + ' 个会话' : '';
      if (!peers.length) { box.innerHTML = hint('还没有活跃会话（有人找她以后会出现在这里）'); return; }
      box.innerHTML = peers.map(function (p) {
        var isGroup = String(p.key || '').indexOf('group:') === 0;
        return '<div class="wl-item">' +
          '<div class="wl-item-main">' +
            '<div class="wl-item-title">' + esc(p.name || p.key) + badge('', isGroup ? '群' : '私聊') + '</div>' +
            '<div class="wl-item-sub">' + esc(p.recentMessage || '（暂无消息预览）') + '</div>' +
          '</div>' +
          '<div class="wl-item-side"><span>' + esc(ago(p.lastAt)) + '</span><span class="wl-hint">' + esc(p.key) + '</span></div>' +
        '</div>';
      }).join('');
    }

    // ── 卡片 3：待审草稿（放行 / 拒绝）────────────────
    function renderOutbox(j) {
      var box = $('outbox');
      var count = $('draft-count');
      if (!box) return;
      if (!j || !j.ok) { box.innerHTML = '<div class="wl-err">' + esc((j && j.error) || '无法读取 /outbox/list') + '</div>'; if (count) count.textContent = ''; return; }
      var drafts = j.drafts || [];
      if (count) count.textContent = drafts.length ? drafts.length + ' 条待审' : '';
      if (!drafts.length) { box.innerHTML = hint('队列是空的 ✓（没有等着放行的草稿）'); return; }
      box.innerHTML = drafts.map(function (d) {
        return '<div class="wl-item" data-file="' + esc(d.file) + '">' +
          '<div class="wl-item-main">' +
            '<div class="wl-item-title">→ ' + esc(d.to || '对方') + badge('', String(d.at || '').slice(5, 16).replace('T', ' ')) + '</div>' +
            (d.reason ? '<div class="wl-item-sub">' + esc(d.reason) + '</div>' : '') +
            '<div class="wl-item-sub" style="color:inherit">' + esc(String(d.text || '').slice(0, 120)) + (String(d.text || '').length > 120 ? '…' : '') + '</div>' +
          '</div>' +
          '<div class="wl-item-side">' +
            '<div class="wl-btns">' +
              '<button type="button" class="wl-btn" data-act="approve">放行</button>' +
              '<button type="button" class="wl-btn wl-btn2" data-act="reject">拒绝</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    var outboxBox = $('outbox');
    if (outboxBox) {
      outboxBox.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!btn) return;
        var item = btn.closest('[data-file]');
        if (!item) return;
        var file = item.getAttribute('data-file');
        var approve = btn.getAttribute('data-act') === 'approve';
        var msg = $('outbox-msg');
        btn.disabled = true;
        if (msg) { msg.textContent = approve ? '放行中…' : '拒绝中…'; msg.className = 'wl-msg'; }
        post('/outbox/approve', { file: file, approve: approve }).then(function (j) {
          if (msg) {
            msg.textContent = j && j.ok ? (approve ? '✓ 已放行并发出' : '✓ 已拒绝（留痕）') : '✗ ' + ((j && j.error) || '失败');
            msg.className = 'wl-msg ' + (j && j.ok ? 'wl-msg-ok' : 'wl-msg-err');
          }
          refreshOutbox();
        }).catch(function (e) {
          if (msg) { msg.textContent = '✗ ' + (e && e.message ? e.message : e); msg.className = 'wl-msg wl-msg-err'; }
          btn.disabled = false;
        });
      });
    }

    // ── 卡片 4：人设模板（下拉 + 预览）──────────────
    var personaList = [];
    function renderPersonaPreview(id) {
      var box = $('persona-preview');
      if (!box) return;
      var p = null;
      for (var i = 0; i < personaList.length; i++) if (personaList[i].id === id) { p = personaList[i]; break; }
      if (!p) { box.innerHTML = hint('（没有这个模板）'); return; }
      var traits = (p.traits || []).map(function (t) { return '<span class="wl-trait">' + esc(t) + '</span>'; }).join('');
      box.innerHTML =
        '<p class="wl-preview-name">' + esc(p.name) + ' <span class="wl-hint">' + esc(p.id) + '</span></p>' +
        '<p>' + esc(p.summary || '（无简介）') + '</p>' +
        (traits ? '<div class="wl-traits">' + traits + '</div>' : '');
    }
    function renderPersonas(j) {
      var sel = $('persona-select');
      if (!sel) return;
      if (!j || !j.ok) {
        sel.innerHTML = '<option value="">' + esc((j && j.error) || '无法读取 /personas') + '</option>';
        sel.disabled = true;
        return;
      }
      personaList = j.personas || [];
      sel.disabled = false;
      sel.innerHTML = personaList.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + '（' + esc(p.id) + '）</option>';
      }).join('');
      if (personaList.length) renderPersonaPreview(personaList[0].id);
    }
    var personaSel = $('persona-select');
    if (personaSel) {
      personaSel.addEventListener('change', function () { renderPersonaPreview(personaSel.value); });
    }

    // ── 拉取（各卡片互不拖累）+ 30s 轮询 ─────────────
    // refreshNapcat 已在上方（每鲸版）：renderStatus 渲染卡片后自动触发。
    function refreshStatus() { get('/status').then(renderStatus).catch(function (e) { renderStatus({ ok: false, error: e && e.message }); }); }
    function refreshPeers() { get('/peers').then(renderPeers).catch(function (e) { renderPeers({ ok: false, error: e && e.message }); }); }
    function refreshOutbox() { get('/outbox/list').then(renderOutbox).catch(function (e) { renderOutbox({ ok: false, error: e && e.message }); }); }
    function refreshPersonas() { get('/personas').then(renderPersonas).catch(function (e) { renderPersonas({ ok: false, error: e && e.message }); }); }
    function refreshAll() {
      if (document.hidden) return;
      refreshStatus(); refreshPeers(); refreshOutbox(); refreshPersonas();
    }
    refreshAll();
    root.__wlTimer = setInterval(refreshAll, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(); });
  }

  window.__whaleLifeSettingsBoot = boot;
  // 自动引导：脚本内联在片段末尾，随片段执行；
  // 宿主若用 innerHTML 注入（script 不执行），可在插入后调用 window.__whaleLifeSettingsBoot(container)。
  var el = document.querySelector('[data-wl-root]');
  if (el) boot(el);
})();`
}

/**
 * 设置区块 HTML 片段（自包含：内联 CSS + 骨架 + JS）。
 * @param {object} opts
 * @param {string} opts.apiBase 行动路由服务器 origin（如 http://127.0.0.1:3939）；
 *                              空串表示同源（独立页面由该服务器自身提供时用）
 * @param {string} [opts.pageUrl] 「独立页面打开」链接；同源渲染（独立页面自身）时省略
 */
export function settingsFragment({ apiBase = '', pageUrl = '' } = {}) {
  return [
    '<div class="wl-root" data-wl-root="1">',
    `<style>\n${CSS}\n</style>`,
    markup({ pageUrl }),
    `<script>\n${script({ apiBase })}\n</script>`,
    '</div>',
  ].join('\n')
}

/**
 * 独立完整页面（GET /settings-page 用）：同一片段 + 最小页面壳。
 * API 走同源相对路径，与路由服务器零跨源问题。
 */
export function settingsPage() {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>鲸生 · 管理面板</title>',
    '<style>',
    'html{color-scheme:light dark}',
    'body{margin:0;padding:24px 16px 48px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f8fa;color:#1f2329}',
    '@media (prefers-color-scheme:dark){body{background:#17181c;color:#e8eaee}}',
    '</style>',
    '</head>',
    '<body>',
    settingsFragment({ apiBase: '' }),
    '</body>',
    '</html>',
  ].join('\n')
}

/**
 * 在 DSH 设置页挂载「鲸生」区块：
 *   GET /whale-life/settings → HTML 片段（宿主设置页 fetch 渲染）
 *   GET /whale-life/settings-page → 完整页面（浏览器直开）
 * 返回 cleanup 函数；webServer 不可用时优雅降级（独立页面仍可用）并返回 no-op。
 */
export function registerSettingsSection({ ctx, log = () => {}, port = DEFAULT_ROUTE_PORT } = {}) {
  // Cordis：访问未声明 inject 的服务属性会抛异常（而非返回 undefined），
  // ?? 接不住异常——必须 try-catch，否则拖垮整个插件启动。
  let webServer
  try {
    webServer = ctx?.webServer ?? (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined)
  } catch {
    webServer = undefined
  }
  if (!webServer || typeof webServer.register !== 'function') {
    log('设置页区块未挂载：webServer 服务不可用 —— 用独立页面代替：' + `http://127.0.0.1:${port}/settings-page`)
    return () => {}
  }

  const apiBase = `http://127.0.0.1:${port}`
  const fragment = settingsFragment({ apiBase, pageUrl: `${apiBase}/settings-page` })
  const page = settingsPage()
  const disposers = []

  const html = (res, body) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }

  const routes = [
    { kind: 'get', path: '/whale-life/settings', body: fragment },
    { kind: 'get', path: '/whale-life/settings-page', body: page },
  ]
  for (const r of routes) {
    try {
      disposers.push(webServer.register({
        kind: r.kind,
        path: r.path,
        handler: async (req, res) => {
          if (req.method && req.method !== 'GET') {
            res.statusCode = 405
            res.end()
            return
          }
          html(res, r.body)
        },
      }))
      log(`设置页路由已挂载：${r.path}（API → ${apiBase}）`)
    } catch (e) {
      // 个别路由注册失败不拖垮其余入口（独立页面兜底 ✓）
      log(`设置页路由 ${r.path} 注册失败（用独立页面 ${apiBase}/settings-page 兜底）：${e?.message ?? e}`)
    }
  }

  return () => {
    for (const d of disposers) {
      try { d?.() } catch { /* cleanup 尽力而为 */ }
    }
  }
}

export { PLUGIN_ROOT }
