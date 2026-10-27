// ==UserScript==
// @name         PokéBonk 联机增强 / Co-op Connection Doctor
// @namespace    local.pokebonk.coopfix
// @version      1.3.0-beta.2
// @description  实验性联机诊断与恢复：连接状态、有限重试和手动诊断。效果需要实际双人测试。
// @match        https://pokebonk.com/*
// @match        https://www.pokebonk.com/*
// @run-at       document-start
// @license      MIT
// @grant        none
// @inject-into  page
// ==/UserScript==

/* Experimental, unofficial PokéBonk adapter. See README.md for verified limits.
 * Network transport is WebRTC; recovery and signalling rules are game-specific.
 * No telemetry, no game assets, no bundled credentials. */
(function () {
  'use strict';

  const W = window;
  if (W.__pbCoopFix) return;

  /* ---------------- 配置 ---------------- */

  const STORE = 'pbCoopFix.cfg';
  const DEFAULTS = {
    autoRepair: true,       // 死链自动抢修
    inRunFastPoll: true,    // 只限制较慢的轮询，保留游戏自带的快速恢复
    dropIPv6: false,        // 过滤 IPv6 ICE 候选
    noRelayThrottle: false, // 实验功能：增加发送频率，可能加重拥塞
    noLeaveOnHide: false,   // 切后台时不发 leave
    verbose: false,
    panel: 'auto',          // auto | show | hide
    panelPos: null,
  };
  const cfg = Object.assign({}, DEFAULTS, readJSON(STORE) || {});
  if (cfg.panel === true) cfg.panel = 'show';
  if (cfg.panel === false) cfg.panel = 'hide';

  function readJSON(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
  }
  function saveCfg() {
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch {}
  }

  /* ---------------- 定时器（可注入，便于无头测试） ---------------- */

  // 浏览器里走原生定时器；所有周期任务都经这里调度，
  // 这样在沙箱测试中可以把定时器换掉而回调仍在脚本闭包里运行。
  const timers = (W.__pbCoopFixTimers && typeof W.__pbCoopFixTimers === 'object')
    ? W.__pbCoopFixTimers
    : {
      setTimeout: (fn, ms) => W.setTimeout(fn, ms),
      setInterval: (fn, ms) => W.setInterval(fn, ms),
      clearTimeout: (id) => W.clearTimeout(id),
      clearInterval: (id) => W.clearInterval(id),
    };

  /* ---------------- 状态 ---------------- */

  const stats = {
    app: null,
    discovery: 'waiting',
    iceCacheAt: 0,
    clockSamples: [],
    clockSkew: null,
    poll: null,
    rtcCount: 0,
    repairs: 0,
    rebuilds: 0,
    room: null,
    mesh: null,
  };

  const events = [];
  function ev(kind, text) {
    events.push({ t: Date.now(), kind, text });
    if (events.length > 500) events.splice(0, events.length - 500);
  }
  const log = (...a) => { if (cfg.verbose) console.log('[pbCoopFix]', ...a); };
  const short = (id) => (typeof id === 'string' ? id.slice(0, 6) : String(id));

  // 时间基准：优先 window.performance，其次 Date.now()。
  // 不用裸的 `performance` 全局——在隔离沙箱里它可能不存在。
  const nowMs = () => {
    const p = W.performance;
    return p && typeof p.now === 'function' ? p.now() : Date.now();
  };
  const perf = nowMs;

  /* ================================================================ */
  /* ① fetch 拦截                                                      */
  /* ================================================================ */

  const NativeFetch = W.fetch;
  const NativeResponse = W.Response;
  const NativeHeaders = W.Headers;
  let disposed = false;
  const cleanups = [];
  const roomHooks = new Map();
  const pcCleanups = new Map();
  const peerHistories = new Map();
  let pinnedRoom = null;
  let styleElement = null;

  function patchMethod(target, key, value, list = cleanups) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const previous = target[key];
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    list.push(() => {
      if (target[key] !== value) return;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
    return previous;
  }

  function isIPv6Url(s) { return typeof s === 'string' && /\[[0-9a-fA-F:.]+\]/.test(s); }

  function filterIceServers(servers) {
    if (!Array.isArray(servers)) return servers;
    const out = [];
    for (const s of servers) {
      if (!s) continue;
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      const kept = urls.filter((u) => !isIPv6Url(u));
      if (kept.length) out.push(Object.assign({}, s, { urls: kept.length === 1 ? kept[0] : kept }));
    }
    return out;
  }

  if (typeof NativeFetch === 'function') {
    W.fetch = function fetch(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isIce = /\/coop\/ice\b/.test(url);
      const isRoom = /\/coop\/rooms\/[A-Z0-9]{4}/.test(url);
      const isStatus = /\/status\b/.test(url);
      const t0 = nowMs();
      const p = NativeFetch.apply(this, arguments);

      if (isIce) {
        return p.then(async (res) => {
          try {
            const j = await res.clone().json();
            if (Array.isArray(j.servers) && j.servers.length) {
              stats.iceCacheAt = Date.now();
              if (cfg.dropIPv6) {
                const filtered = filterIceServers(j.servers);
                if (JSON.stringify(filtered) !== JSON.stringify(j.servers)) {
                  ev('info', 'ICE 已过滤 IPv6（' + j.servers.length + ' → ' + filtered.length + '）');
                  const headers = new NativeHeaders(res.headers);
                  headers.delete('content-length');
                  headers.delete('content-encoding');
                  return new NativeResponse(JSON.stringify(Object.assign({}, j, { servers: filtered })),
                    { status: res.status, statusText: res.statusText, headers });
                }
              }
            }
          } catch {}
          return res;
        });
      }
      if (isRoom) {
        return p.then((res) => {
          stats.poll = { ms: nowMs() - t0, status: res.status, at: Date.now() };
          return res;
        }, (err) => {
          stats.poll = { ms: 0, status: 'FAIL', at: Date.now(), err: String(err && err.message || err) };
          throw err;
        });
      }
      if (isStatus) {
        return p.then((res) => {
          try {
            const d = res.headers.get('date');
            const server = d && Date.parse(d);
            if (Number.isFinite(server)) {
              stats.clockSamples.push(server - Date.now());
              if (stats.clockSamples.length > 7) stats.clockSamples.shift();
              const s = stats.clockSamples.slice().sort((a, b) => a - b);
              stats.clockSkew = Math.round(s[Math.floor(s.length / 2)] + 500);
            }
          } catch {}
          return res;
        });
      }
      return p;
    };
  }

  const patchedFetch = W.fetch;

  async function fetchFreshIce() {
    const room = findRoom();
    if (!room || typeof room.backend?.coopIce !== 'function') throw new Error('尚未接入游戏房间');
    const j = await room.backend.coopIce(room.acc);
    if (disposed || !room.alive) throw new Error('房间已经结束');
    if (!Array.isArray(j?.servers) || !j.servers.length) throw new Error('返回里没有 servers');
    const servers = cfg.dropIPv6 ? filterIceServers(j.servers) : j.servers;
    if (!servers.length) throw new Error('过滤后没有可用的 ICE 服务器');
    room.mesh.ice = servers;
    stats.iceCacheAt = Date.now();
    // Keep credentials on the game's mesh, never in exported diagnostics/cache.
    return servers;
  }

  /* ================================================================ */
  /* ② RTCPeerConnection 包装：候选过滤 + 计数                          */
  /* ================================================================ */

  const NativePC = W.RTCPeerConnection;
  if (typeof NativePC === 'function') {
    function Patched(config, constraints) {
      const conf = config ? Object.assign({}, config) : {};
      if (cfg.dropIPv6 && Array.isArray(conf.iceServers)) conf.iceServers = filterIceServers(conf.iceServers);
      const pc = new NativePC(conf, constraints);
      stats.rtcCount++;
      try {
        pc.__pb = { createdAt: nowMs(), cands: {}, ipv6: 0, dropped: 0 };
        const observe = (e) => {
          if (disposed) return;
          const c = e && e.candidate;
          if (!c) return;
          pc.__pb.cands[c.type] = (pc.__pb.cands[c.type] || 0) + 1;
          const address = c.address || String(c.candidate || '').split(/\s+/)[4] || '';
          const ipv6 = address.includes(':');
          if (ipv6) pc.__pb.ipv6++;
          if (cfg.dropIPv6 && ipv6) {
            pc.__pb.dropped++;
            e.stopImmediatePropagation();
          }
        };
        pc.addEventListener('icecandidate', observe, true);
        pcCleanups.set(pc, () => { pc.removeEventListener('icecandidate', observe, true); delete pc.__pb; });
      } catch {}
      return pc;
    }
    Patched.prototype = NativePC.prototype;
    try { Object.setPrototypeOf(Patched, NativePC); } catch {}
    try { W.RTCPeerConnection = Patched; } catch {}
  }

  const patchedPC = W.RTCPeerConnection;

  /* ================================================================ */
  /* ③ 定位游戏运行时对象                                              */
  /* ================================================================ */

  // 房间实例特征：mesh{links:Map} + code + alive + retryLink + others
  function isRoom(o) {
    try {
      return !!o && typeof o === 'object'
        && !!o.mesh && o.mesh.links instanceof Map
        && typeof o.code === 'string'
        && typeof o.alive === 'boolean'
        && typeof o.retryLink === 'function'
        && Array.isArray(o.others);
    } catch { return false; }
  }

  function scanFor(obj, want, depth, seen) {
    if (!obj || typeof obj !== 'object') return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (want(obj)) return obj;
    if (depth <= 0) return null;
    let keys;
    try { keys = Object.keys(obj); } catch { return null; }
    for (const k of keys) {
      let v;
      try { v = obj[k]; } catch { continue; }
      if (!v || typeof v !== 'object') continue;
      const hit = scanFor(v, want, depth - 1, seen);
      if (hit) return hit;
    }
    return null;
  }

  function findRoom() {
    const active = pinnedRoom || stats.app?.coopRoom || stats.app?.run?.coop?.room;
    if (isRoom(active) && active.alive) { stats.room = active; return active; }
    if (stats.room && isRoom(stats.room) && stats.room.alive && !stats.app && !pinnedRoom) return stats.room;
    stats.room = null;
    // Compatibility bridges only; the official game does not promise global ctx.
    const direct = scanFor(W.ctx || null, isRoom, 3, new Set())
      || scanFor((W.document && W.document.ctx) || null, isRoom, 3, new Set());
    if (direct && direct.alive) { stats.room = direct; return direct; }
    // 兜底：只在几个已知的命名空间里找一层，不做递归
    for (const key of ['game', 'app', 'G', 'pb']) {
      const holder = W[key] || (W.document && W.document[key]);
      if (!holder || typeof holder !== 'object') continue;
      if (isRoom(holder) && holder.alive) { stats.room = holder; return holder; }
      const hit = scanFor(holder, isRoom, 2, new Set());
      if (hit && hit.alive) { stats.room = hit; return hit; }
    }
    return null;
  }

  // Import only same-origin module URLs already advertised by the page. The
  // browser module cache reuses the loaded game; never rewrite its source/URL.
  let discoveryRunning = false;
  let lastDiscoveryAt = -Infinity;
  async function discoverApp() {
    if (disposed || discoveryRunning || stats.app) return;
    discoveryRunning = true;
    lastDiscoveryAt = perf();
    try {
      const urls = [...document.querySelectorAll('link[rel="modulepreload"], script[type="module"][src]')]
        .map(node => node.href || node.src).filter(Boolean);
      for (const value of new Set(urls)) {
        const url = new URL(value, W.location.href);
        if (url.origin !== W.location.origin || !/^\/assets\/main-[^/]+\.js$/.test(url.pathname)) continue;
        const module = await import(url.href);
        if (disposed) return;
        const proto = module.App?.prototype;
        if (!proto || typeof proto.frameGap !== 'function') continue;
        if (stats.discovery === 'hooked') return;
        const original = proto.frameGap;
        function captureApp(...args) {
          if (!disposed) { stats.app = this; stats.discovery = 'attached'; }
          if (proto.frameGap === captureApp) proto.frameGap = original;
          return original.apply(this, args);
        }
        patchMethod(proto, 'frameGap', captureApp);
        stats.discovery = 'hooked';
        return;
      }
      stats.discovery = 'unsupported';
    } catch (error) {
      stats.discovery = 'unavailable';
      ev('warn', '游戏接入失败：' + error.message);
    } finally { discoveryRunning = false; }
  }
  const onModulesReady = () => { void discoverApp(); };
  W.addEventListener('pokebonk:modules-ready', onModulesReady);
  cleanups.push(() => W.removeEventListener('pokebonk:modules-ready', onModulesReady));

  /* ================================================================ */
  /* ④ 主循环                                                          */
  /* ================================================================ */

  let mainTimer = 0;

  function tick() {
    if (disposed) return;
    try {
      let room = null;
      try { room = findRoom(); } catch (e) { ev('warn', '扫描房间失败：' + (e && e.message)); }
      if (!room) {
        for (const [previous, undo] of roomHooks) { if (!previous.alive) { undo(); roomHooks.delete(previous); } }
        stats.mesh = null;
        if (!stats.app && stats.discovery !== 'hooked' && perf() - lastDiscoveryAt > 5000) void discoverApp();
        render(); return;
      }
      for (const [previous, undo] of roomHooks) {
        if (previous !== room) { undo(); roomHooks.delete(previous); }
      }
      stats.mesh = room.mesh;
      hookRoom(room);
      // 开关可以随时在面板里拨，这里保证它和当前 mesh 的实际状态一致
      syncRelaySwitch(room);
      attachLinks(room);
      sample(room);
      if (cfg.autoRepair) autoRepair(room);
      render();
    } catch (e) {
      ev('warn', 'tick 出错：' + (e && e.message));
      log(e);
    }
  }

  /* ---------- 房间钩子 ---------- */

  function hookRoom(room) {
    if (roomHooks.has(room)) return;
    const undo = [];
    if (typeof room.schedule === 'function') {
      const original = room.schedule;
      patchMethod(room, 'schedule', function (ms) {
        const down = cfg.inRunFastPoll && this.inRun && this.alive
          && this.others.some(peer => this.mesh.state(peer.id) !== 'open');
        // Current upstream has hurryPoll(). Preserve its faster 700ms retries.
        return original.call(this, down && (ms == null || ms > 3000) ? 3000 : ms);
      }, undo);
    }
    if (typeof room.onHide === 'function') {
      const original = room.onHide;
      function onHide(...args) {
        if (cfg.noLeaveOnHide && room.alive) { ev('info', '已跳过本次 pagehide 离房请求；后台可能仍被系统暂停'); return; }
        return original.apply(room, args);
      }
      W.removeEventListener('pagehide', original);
      patchMethod(room, 'onHide', onHide, undo);
      W.addEventListener('pagehide', onHide);
      undo.push(() => { W.removeEventListener('pagehide', onHide); if (room.alive) W.addEventListener('pagehide', original); });
    }
    // This game signals complete SDP after ICE gathering; filtering only
    // icecandidate events would not remove IPv6 candidates from the SDP.
    if (typeof room.mesh.ev?.signal === 'function') {
      const original = room.mesh.ev.signal;
      patchMethod(room.mesh.ev, 'signal', function (id, kind, data) {
        if (cfg.dropIPv6 && (kind === 'offer' || kind === 'answer') && typeof data === 'string') {
          data = data.split('\r\n').filter(line => !line.startsWith('a=candidate:') || !String(line.split(/\s+/)[4] || '').includes(':')).join('\r\n');
        }
        return original.call(this, id, kind, data);
      }, undo);
    }
    roomHooks.set(room, () => { for (const restore of undo.reverse()) restore(); unhookRelayThrottle(room); peerHistories.delete(room); });
  }

  function hookRelayThrottle(room) {
    const mesh = room.mesh;
    if (!mesh || mesh.__pbRelayHooked) return;
    const own = Object.getOwnPropertyDescriptor(mesh, 'relayed');
    const patched = () => false;
    Object.defineProperty(mesh, 'relayed', { value: patched, writable: true, configurable: true });
    mesh.__pbRelayHooked = () => {
      if (mesh.relayed === patched) { if (own) Object.defineProperty(mesh, 'relayed', own); else delete mesh.relayed; }
    };
    ev('info', '实验功能：提高中继发送频率；流量和拥塞可能增加');
  }
  function unhookRelayThrottle(room) {
    const mesh = room?.mesh;
    if (typeof mesh?.__pbRelayHooked !== 'function') return;
    mesh.__pbRelayHooked(); delete mesh.__pbRelayHooked;
  }
  function syncRelaySwitch(room) {
    if (cfg.noRelayThrottle && !room.mesh.__pbRelayHooked) hookRelayThrottle(room);
    else if (!cfg.noRelayThrottle && room.mesh.__pbRelayHooked) unhookRelayThrottle(room);
  }
  function historyFor(room, id) {
    if (!peerHistories.has(room)) peerHistories.set(room, new Map());
    const peers = peerHistories.get(room);
    if (!peers.has(id)) peers.set(id, { window: [], rtts: [], relayJitter: 0, repairs: 0, lastRepairAt: -Infinity, bornAt: perf(), openSince: null, missingSince: null });
    return peers.get(id);
  }

  /* ---------- 链路统计 ---------- */

  function attachLinks(room) {
    for (const [id, link] of room.mesh.links) {
      link.__pbId = id;
      link.__pbHist = historyFor(room, id);
    }
    for (const pc of pcCleanups.keys()) {
      if (pc.connectionState === 'closed') { pcCleanups.get(pc)(); pcCleanups.delete(pc); }
    }
  }

  function sample(room) {
    for (const [id, link] of room.mesh.links) {
      const h = link.__pbHist;
      if (!h) continue;
      if (link.state !== 'open') { h.openSince = null; continue; }
      if (h.openSince == null) h.openSince = perf();
      if (perf() - h.openSince >= 15000) h.repairs = 0;
      h.window.push(link.idle >= 1.5 ? 1 : 0);
      if (h.window.length > 30) h.window.shift();

      // 中继链路抖动统计：RTT 上下浮动超过 1.5 倍就是这条中继在颠簸。
      // 这种颠簸正是 lag 撞上 20 秒判死的主因，早提醒比等它断强。
      h.rtts.push(link.rtt);
      if (h.rtts.length > 20) h.rtts.shift();
      if (link.relayed && h.rtts.length >= 10) {
        const mn = Math.min(...h.rtts);
        const mx = Math.max(...h.rtts);
        h.relayJitter = mn > 0 ? mx / mn : 1;
      } else if (!link.relayed) {
        h.relayJitter = 0;
      }
      void id;
    }
  }

  /* ---------- 抢修 ---------- */

  function autoRepair(room) {
    for (const member of room.others) {
      const id = member.id;
      const link = room.mesh.links.get(id);
      const history = historyFor(room, id);
      if (!link) {
        // A missing answering-side link is normal while the first offer is
        // being gathered. Allow the native 20-second connection window first.
        if (history.missingSince == null) history.missingSince = perf();
        if (perf() - history.missingSince < 20000) continue;
      } else {
        history.missingSince = null;
        if (link.state !== 'failed' && link.state !== 'closed') continue;
      }
      if (perf() - history.lastRepairAt < 15000 || history.repairs >= 5) continue;
      forceRebuild(room, id, '自动恢复');
      break;
    }
  }

  /**
   * 绕过重连预算：关掉旧链路，按原发起方向重新 link() 并加速一次房间轮询。
   * 游戏规则：成员表里 slot 更大的那一方负责发起 offer。
   */
  function forceRebuild(room, id, why) {
    const mesh = room.mesh;
    const old = mesh.links.get(id);
    const me = mesh.members.find((m) => m.id === mesh.me);
    const other = mesh.members.find((m) => m.id === id);
    if (!me || !other) { ev('warn', '重建跳过：成员表里没有 ' + short(id)); return false; }

    const iShouldOffer = me.slot > other.slot;
    const hist = historyFor(room, id);
    hist.repairs++; hist.lastRepairAt = perf(); hist.openSince = null; hist.missingSince = null;
    hist.window = []; hist.rtts = []; hist.relayJitter = 0;
    stats.repairs++;
    mesh.tries.delete(id);
    try { old?.close(); } catch {}
    try { mesh.links.delete(id); } catch {}
    try {
      const nl = mesh.link(id, iShouldOffer);
      if (nl) {
        nl.__pbHist = hist;
        nl.__pbId = id;
      }
      // In this protocol bye resets one peer link, not room membership.
      // An answerer cannot send a new offer: request the larger-slot peer to
      // drop its stale link, then its normal sync() will create a fresh offer.
      if (!iShouldOffer) {
        if (typeof mesh.ev?.signal !== 'function') throw new Error('缺少对端连接重置信令');
        mesh.ev.signal(id, 'bye', '');
      }
      stats.rebuilds++;
      ev('info', '重建链路 ' + short(id) + '（' + why + '）offerer=' + iShouldOffer);
      try { room.schedule(700); } catch {}
      return true;
    } catch (e) {
      ev('warn', '重建失败：' + e.message);
      return false;
    }
  }

  /* ================================================================ */
  /* ⑤ 面板                                                            */
  /* ================================================================ */

  const CSS = `
.pbf{position:fixed;z-index:2147483646;right:10px;bottom:10px;width:320px;max-width:94vw;
 font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8e8f4;
 background:rgba(18,16,36,.95);border:1px solid rgba(255,255,255,.12);border-radius:14px;
 box-shadow:0 12px 34px rgba(0,0,0,.5);overflow:hidden;user-select:none}
.pbf header{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;
 background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.02))}
.pbf header b{font-size:12px}
.pbf .dot{width:8px;height:8px;border-radius:50%;background:#38d39f;box-shadow:0 0 8px #38d39f}
.pbf .dot.warn{background:#ffc75a;box-shadow:0 0 8px #ffc75a}
.pbf .dot.bad{background:#ff5a6e;box-shadow:0 0 8px #ff5a6e}
.pbf .sp{flex:1}
.pbf button{font:inherit;color:#e8e8f4;background:rgba(255,255,255,.1);border:0;border-radius:8px;padding:3px 8px;cursor:pointer}
.pbf button:hover{background:rgba(255,255,255,.2)}
.pbf .body{padding:2px 10px 10px;max-height:60vh;overflow:auto;user-select:text}
.pbf .row{display:flex;gap:6px;align-items:center;padding:1px 0}
.pbf .k{color:#9d9ab8}
.pbf .v{margin-left:auto;font-variant-numeric:tabular-nums}
.pbf .ok{color:#57e0a8}.pbf .bad{color:#ff7080}.pbf .wr{color:#ffcf6a}
.pbf .peer{border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:5px 7px;margin:6px 0}
.pbf .peer h4{margin:0 0 3px;font-size:12px;display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.pbf .chip{font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(255,255,255,.12)}
.pbf .chip.relay{background:#8a5cff33;color:#c9b4ff}
.pbf .acts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}
.pbf label{display:flex;gap:6px;align-items:center;padding:2px 0;cursor:pointer}
.pbf label span{color:#cfcde0}
.pbf input[type=checkbox]{accent-color:#38d39f}
.pbf .log{max-height:104px;overflow:auto;background:rgba(0,0,0,.28);border-radius:8px;padding:5px 7px;
 font:11px/1.5 ui-monospace,Consolas,monospace;color:#b9b6d0;white-space:pre-wrap;word-break:break-all}
.pbf .hint{color:#8d8aa6;font-size:11px;margin:5px 0 0}
`;

  let ui = null;

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (k === 'style') n.style.cssText = v;
      else if (k === 'class') n.className = v;
      else if (k === 'on') for (const t in v) n.addEventListener(t, v[t]);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }

  function mount() {
    if (ui || !document.body) return;
    const style = h('style', {});
    style.textContent = CSS;
    document.head.append(style);
    styleElement = style;

    const dot = h('span', { class: 'dot' });
    const label = h('b', {}, '联机增强');
    const minBtn = h('button', { on: { click: toggle } }, '—');
    const closeBtn = h('button', { on: { click: () => { cfg.panel = 'hide'; saveCfg(); ui.root.style.display = 'none'; } } }, '×');
    const header = h('header', {}, dot, label, h('span', { class: 'sp' }), minBtn, closeBtn);
    const body = h('div', { class: 'body' });
    const foldEl = h('div', { style: 'display:none', class: 'fold', on: { click: toggle } }, '联机增强 —');
    const root = h('div', { class: 'pbf' }, header, body, foldEl);

    if (cfg.panelPos) {
      root.style.left = cfg.panelPos.left + 'px';
      root.style.top = cfg.panelPos.top + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto';
    }

    let folded = false;
    function toggle() {
      folded = !folded;
      body.style.display = folded ? 'none' : '';
      foldEl.style.display = folded ? 'block' : 'none';
      minBtn.textContent = folded ? '+' : '—';
    }

    let drag = null;
    header.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = root.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { header.setPointerCapture(e.pointerId); } catch {}
    });
    header.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = Math.max(-200, Math.min(W.innerWidth - 60, e.clientX - drag.dx));
      const y = Math.max(0, Math.min(W.innerHeight - 36, e.clientY - drag.dy));
      root.style.left = x + 'px'; root.style.top = y + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto';
    });
    header.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      const r = root.getBoundingClientRect();
      cfg.panelPos = { left: Math.round(r.left), top: Math.round(r.top) };
      saveCfg();
    });

    document.body.append(root);
    ui = { root, body, dot, label };
  }

  const fmtMs = (ms) => (!Number.isFinite(ms) || ms <= 0 ? '—'
    : ms >= 1000 ? (ms / 1000).toFixed(1) + ' 秒' : Math.round(ms) + ' 毫秒');

  function row(k, v, c) {
    return h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v ' + (c || '') }, v));
  }

  function render() {
    if (cfg.panel === 'hide') return;
    mount();
    if (!ui) return;

    const onCoop = /\/coop\//.test(W.location.pathname) || /[?&]sala=/.test(W.location.search);
    if (cfg.panel === 'auto' && !onCoop && !stats.room) { ui.root.style.display = 'none'; return; }
    ui.root.style.display = '';

    const room = stats.room && isRoom(stats.room) ? stats.room : null;
    const mesh = room && room.mesh;
    const peers = [];

    if (room) {
      for (const mbr of mesh.members || []) {
        if (!mbr || mbr.id === room.me) continue;
        const link = mesh.links.get(mbr.id);
        peers.push({
          name: mbr.name || '?',
          slot: mbr.slot,
          state: link ? (mesh.state(mbr.id) || link.state) : 'missing',
          rtt: link ? link.rtt : 0,
          idle: link ? link.idle : 0,
          lag: link ? link.lag : 0,
          relay: link ? !!link.relayed : false,
          offerer: link ? !!link.offerer : false,
          backlog: link ? (link.backlog | 0) : 0,
          hist: link ? link.__pbHist : null,
        });
      }
    }

    let bad = 0, warn = 0;
    for (const p of peers) {
      if (p.state === 'failed') bad++;
      else if (p.state !== 'open' || p.idle > 3) warn++;
    }
    ui.dot.className = 'dot' + (bad ? ' bad' : warn ? ' warn' : '');
    ui.label.textContent = '联机增强' + (room ? ' · ' + room.code : '');

    const b = ui.body;
    b.textContent = '';

    if (!room) {
      b.append(h('p', { class: 'hint' }, '等待游戏房间接入（' + stats.discovery + '）。若一直未接入，当前版本可能不兼容。'));
      b.append(checks());
      b.append(logView());
      return;
    }

    b.append(row('房间', room.code + (room.isHost ? ' · 我是房主' : '') + ' · ' + (room.inRun ? '游戏中' : '大厅')));
    if (stats.poll) {
      const ok = stats.poll.status === 200;
      b.append(row('信令轮询', (ok ? '' : stats.poll.status + ' · ') + fmtMs(stats.poll.ms),
        !ok ? 'bad' : stats.poll.ms > 2500 ? 'wr' : 'ok'));
    }
    if (stats.clockSkew != null) {
      b.append(row('本机时钟', (stats.clockSkew > 0 ? '+' : '') + fmtMs(Math.abs(stats.clockSkew)),
        Math.abs(stats.clockSkew) > 5000 ? 'wr' : 'ok'));
    }
    if (stats.repairs || stats.rebuilds) {
      b.append(row('已抢修', stats.repairs + ' 次 / 重建 ' + stats.rebuilds + ' 条', 'wr'));
    }

    if (!peers.length) b.append(h('p', { class: 'hint' }, '房间里还没有队友。'));

    for (const p of peers) {
      const card = h('div', { class: 'peer' });
      const head = h('h4', {}, h('span', {}, p.name), h('span', { class: 'chip' }, 'slot ' + p.slot));
      if (p.state === 'open') head.append(h('span', { class: 'chip' + (p.relay ? ' relay' : '') }, p.relay ? '中继' : '直连'));
      head.append(h('span', { class: 'chip' }, p.state === 'missing' ? '等待建立' : p.offerer ? '我发起' : '对方发起'));
      card.append(head);
      card.append(row('链路', p.state === 'missing' ? '待建立（无连接对象）' : p.state, p.state === 'open' ? 'ok' : p.state === 'failed' ? 'bad' : 'wr'));
      if (p.state === 'open') {
        card.append(row('RTT', fmtMs(p.rtt), p.lag > 400 ? 'wr' : 'ok'));
        card.append(row('空闲', p.idle.toFixed(1) + ' 秒 / 9 秒', p.idle > 6 ? 'bad' : p.idle > 3 ? 'wr' : 'ok'));
        if (p.hist && p.hist.window.length >= 5) {
          const loss = Math.round(100 * p.hist.window.reduce((a, c) => a + c, 0) / p.hist.window.length);
          card.append(row('接收停顿', loss + ' %', loss > 20 ? 'bad' : loss > 5 ? 'wr' : 'ok'));
        }
        card.append(row('积压', Math.round(p.backlog / 1024) + ' KB / 16 KB',
          p.backlog > 12000 ? 'bad' : p.backlog > 4000 ? 'wr' : 'ok'));
        if (p.relay && p.hist && p.hist.relayJitter > 0) {
          const j = p.hist.relayJitter;
          card.append(row('中继抖动', j.toFixed(1) + ' 倍',
            j > 2 ? 'bad' : j > 1.5 ? 'wr' : 'ok'));
        }
      }
      if (p.hist && p.hist.repairs) card.append(row('已抢修', p.hist.repairs + ' 次', 'wr'));
      b.append(card);
    }

    // Show observed connection symptoms without claiming a network root cause.
    const shaky = peers.filter((p) => p.state === 'open' && p.relay && p.hist && p.hist.relayJitter > 1.5);
    const stuck = peers.filter((p) => p.state !== 'open');
    if (stuck.length) {
      b.append(h('p', { class: 'hint bad' },
        '有队友连不上。先让两人都点「刷新 TURN」再点「立即抢修」；还不行就换网络——'
        + '可以对照测试其他网络，记录恢复时间；网络切换不保证有效。'));
    } else if (shaky.length) {
      b.append(h('p', { class: 'hint wr' },
        '你们在走中继且抖动明显（' + shaky.map((p) => p.name).join('、') + '）。'
        + '中继会增加一段网络路径，但不一定是故障原因。可以对照测试其他网络。'));
    }

    const acts = h('div', { class: 'acts' });
    acts.append(h('button', { on: { click: () => repairNow(room) } }, '立即抢修'));
    acts.append(h('button', { on: { click: () => { room.mesh.tries.clear(); ev('info', '重连预算已清零'); } } }, '清预算'));
    acts.append(h('button', { on: { click: refreshIce } }, '刷新 TURN'));
    acts.append(h('button', { on: { click: copyDiag } }, '复制诊断'));
    b.append(acts);

    b.append(checks());
    b.append(logView());
    b.append(h('p', { class: 'hint' },
      '接收停顿是采样比例，不是丢包率；积压是本机发送端指标；中继不一定比直连差。'));
  }

  function checks() {
    const box = h('div', {});
    const mk = (key, text, title) => h('label', { title },
      h('input', {
        type: 'checkbox', checked: !!cfg[key],
        on: { change: (e) => { cfg[key] = e.target.checked; saveCfg(); ev('info', text + ' → ' + (cfg[key] ? '开' : '关')); } },
      }), h('span', {}, text));
    box.append(mk('autoRepair', '自动抢修断线', '链路失败时自动重建，不用手动找 Reintentar 按钮'));
    box.append(mk('dropIPv6', '过滤 IPv6（实验）', '只在怀疑 IPv6 路由故障时测试；也可能降低连通性'));
    box.append(mk('noRelayThrottle', '提高中继发送频率（实验）', '可能更连续，也可能加重拥塞；默认关闭'));
    box.append(mk('noLeaveOnHide', '跳过 pagehide 离房', '不阻止浏览器暂停后台页面，刷新或关闭时也可能延迟退房'));
    return box;
  }

  function logView() {
    if (!events.length) return h('div', {});
    const lg = h('div', { class: 'log' });
    lg.textContent = events.slice(-14).map((e) =>
      new Date(e.t).toTimeString().slice(0, 8) + '  ' + e.text).join('\n');
    return lg;
  }

  function repairNow(room) {
    if (disposed || !room?.alive) return;
    for (const member of room.others) {
      const id = member.id;
      const link = room.mesh.links.get(id);
      if (link && link.state !== 'failed' && link.state !== 'closed') continue;
      historyFor(room, id).repairs = 0;
      forceRebuild(room, id, '手动恢复');
    }
  }

  async function refreshIce() {
    try {
      const s = await fetchFreshIce();
      ev('info', 'TURN 凭证已刷新（' + s.length + ' 组）；已建立的链路需重建后才会用新凭证');
    } catch (e) {
      ev('warn', '刷新 TURN 失败：' + e.message);
    }
  }

  function diagnostics() {
    const room = stats.room;
    const selfSlot = room?.mesh.members.find(member => member.id === room.mesh.me)?.slot ?? null;
    const candidateTypes = (description) => {
      const counts = { host: 0, srflx: 0, relay: 0, prflx: 0 };
      for (const line of String(description?.sdp || '').split(/\r?\n/)) {
        if (!line.startsWith('a=candidate:')) continue;
        const type = line.match(/\btyp\s+(host|srflx|relay|prflx)\b/)?.[1];
        if (type) counts[type]++;
      }
      return counts;
    };
    return {
      version: '1.3.0-beta.2', time: new Date().toISOString(),
      adapter: 'pokebonk', discovery: stats.discovery,
      memberCount: room?.mesh.members.length ?? 0, selfSlot,
      inRun: !!room?.inRun, repairs: stats.repairs, rebuilds: stats.rebuilds,
      connectionsObserved: stats.rtcCount,
      poll: stats.poll ? { ms: stats.poll.ms, status: stats.poll.status } : null,
      peers: room ? room.others.map((member, index) => {
        const link = room.mesh.links.get(member.id), pc = link?.pc;
        return {
          peer: index + 1, slot: member.slot, state: link?.state ?? 'missing',
          expectedOfferer: selfSlot == null ? null : selfSlot > member.slot,
          offerer: link ? !!link.offerer : null,
          rtcState: pc?.connectionState ?? null, iceState: pc?.iceConnectionState ?? null,
          iceGatheringState: pc?.iceGatheringState ?? null, signalingState: pc?.signalingState ?? null,
          hasLocalDescription: !!pc?.localDescription, hasRemoteDescription: !!pc?.remoteDescription,
          localCandidates: candidateTypes(pc?.localDescription), remoteCandidates: candidateTypes(pc?.remoteDescription),
          controlChannel: link?.ctl?.readyState ?? null, snapshotChannel: link?.snap?.readyState ?? null,
          rttMs: link?.state === 'open' ? Math.round(link.rtt) : null,
          idleSeconds: link?.idle ?? null,
          relayed: link?.state === 'open' ? !!link.relayed : null, bufferedBytes: link?.backlog ?? null,
          stallSampleRatio: link?.__pbHist?.window.length
            ? link.__pbHist.window.reduce((sum, item) => sum + item, 0) / link.__pbHist.window.length : null,
        };
      }) : [],
    };
  }
  function copyDiag() {
    const txt = JSON.stringify(diagnostics(), null, 2);
    try {
      W.navigator.clipboard.writeText(txt).then(
        () => ev('info', '已复制脱敏诊断（不含房间码、姓名、地址或凭证）'),
        () => { console.log(txt); ev('warn', '复制失败，脱敏诊断已打印到控制台'); });
    } catch { console.log(txt); }
  }

  /* ================================================================ */
  /* 启动                                                              */
  /* ================================================================ */

  mainTimer = timers.setInterval(tick, 1000);
  const startupTimer = timers.setTimeout(tick, 500);
  cleanups.push(() => timers.clearTimeout(startupTimer));
  if (document.readyState === 'loading') {
    const onReady = () => { if (!disposed) tick(); };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
    cleanups.push(() => document.removeEventListener('DOMContentLoaded', onReady));
  }

  W.__pbCoopFix = {
    cfg,
    stats,
    events,
    save: saveCfg,
    repairNow: () => { if (stats.room) repairNow(stats.room); },
    refreshIce,
    diagnostics,
    attachRoom(room) {
      if (!isRoom(room) || !room.alive) throw new Error('不兼容的房间接口');
      pinnedRoom = room; tick();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.clearInterval(mainTimer);
      for (const restore of cleanups.reverse()) restore();
      for (const undo of roomHooks.values()) undo(); roomHooks.clear();
      for (const undo of pcCleanups.values()) undo(); pcCleanups.clear();
      peerHistories.clear();
      if (styleElement) styleElement.remove();
      stats.room = stats.mesh = stats.app = null;
      pinnedRoom = null;
      if (ui) { ui.root.remove(); ui = null; }
      if (W.fetch === patchedFetch) W.fetch = NativeFetch;
      if (W.RTCPeerConnection === patchedPC) W.RTCPeerConnection = NativePC;
      delete W.__pbCoopFix;
    },
  };
  if (document.readyState === 'complete') void discoverApp();
  log('loaded');
})();
