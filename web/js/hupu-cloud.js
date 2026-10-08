"use strict";
/* 虎扑 Shaper 云能力层 —— 活动数据存储（云端KV）+ CloudBase 排行榜客户端
 *
 * 环境通道（发布页为 shell + iframe 结构，游戏跑在 __ai_app.html iframe 里）：
 *  A. frame —— 游戏位于 Shaper 发布页 iframe 内，通过 postMessage 协议
 *     colorbox-ai-bridge v1 与宿主 shell 通信（shell 已在宿主页实现转发）：
 *     - type "bridge.call"  payload:{payload:{method,data,successcb,errorcb}}
 *       → 回 "bridge.callback" payload:{callbackName,args:[res]}
 *       shell 会把 method 转发给原生 JSBridge：hupu.common.setValue / getValue
 *       （虎扑 App 内为云端 KV：项目隔离 + 多端自动同步；桌面浏览器 3s 超时返回 null）
 *     - type "storage.setValue"/"storage.getValue" payload:{key,value|callbackId}
 *       → 回 "storage.setValue.callback"/"storage.getValue.callback"
 *       shell 直接读写宿主页 localStorage（设备级兜底通道）
 *  B. host —— 游戏位于顶层窗口且存在 ColorboxAIHost.bridgeSend（平台预览等场景）
 *  C. none —— 普通浏览器（GitHub Pages / 本地 file://）：全部静默回退本地存储
 *
 * 本文件自包含，不依赖 app.js；app.js 通过 window.HupuCloud 调用并做存在性守卫。
 */
const HupuCloud = (() => {
  const PROTOCOL = "colorbox-ai-bridge";
  const TIMEOUT = 4000;
  const SAVE_PREFIX = "nba_gm_slot_";      /* 云端存档键：nba_gm_slot_1..3（与本地槽位对应） */
  const BEST_KEY = "nba_gm_best";          /* 个人最佳战绩 */
  const BEST_LKEY = "nba_gm_best_local";   /* 本地镜像（无云时也有值） */

  let _env = "none";
  let _reqSeq = 0;
  let _user = null;              /* {uid, nick} | null */
  let _userTried = false;
  const _pending = new Map();    /* callbackId/callbackName -> {resolve, timer} */
  let _syncTimers = {};          /* slot -> debounce timer */
  let _cloudReadyWarned = false;

  /* ===== 环境检测 ===== */
  function detect() {
    try {
      if (window.parent && window.parent !== window) _env = "frame";
      else if (window.ColorboxAIHost && typeof window.ColorboxAIHost.bridgeSend === "function") _env = "host";
      else _env = "none";
    } catch (e) { _env = "none"; }
    return _env;
  }

  /* ===== iframe 通道：宿主回调监听 ===== */
  function initFrameListener() {
    window.addEventListener("message", ev => {
      const d = ev.data;
      if (!d || d.protocol !== PROTOCOL || d.direction !== "host-to-frame") return;
      const p = d.payload || {};
      /* bridge.call 的回调：callbackName 匹配 */
      if (d.type === "bridge.callback" && p.callbackName && _pending.has(p.callbackName)) {
        const entry = _pending.get(p.callbackName);
        clearTimeout(entry.timer);
        _pending.delete(p.callbackName);
        entry.resolve(p.args && p.args.length ? p.args[0] : null);
        return;
      }
      /* storage 代理通道回调：callbackId 匹配 */
      if ((d.type === "storage.getValue.callback" || d.type === "storage.setValue.callback") && p.callbackId && _pending.has(p.callbackId)) {
        const entry = _pending.get(p.callbackId);
        clearTimeout(entry.timer);
        _pending.delete(p.callbackId);
        entry.resolve(d.type === "storage.getValue.callback" ? p.value : p.ok);
      }
    });
  }

  function regPending(id, resolve, timeout) {
    const timer = setTimeout(() => {
      _pending.delete(id);
      resolve(null);
    }, timeout || TIMEOUT);
    _pending.set(id, { resolve, timer });
    return timer;
  }

  /* bridge.call：经 shell 转发到原生 JSBridge（App 内云端能力） */
  function bridgeCall(method, data) {
    if (_env !== "frame") return Promise.resolve(null);
    return new Promise(resolve => {
      const cb = "_hbc_" + Date.now() + "_" + (++_reqSeq);
      regPending(cb, resolve);
      try {
        window.parent.postMessage({
          protocol: PROTOCOL, version: 1, direction: "frame-to-host",
          type: "bridge.call",
          payload: { payload: { method, data: data || {}, successcb: cb, errorcb: cb } }
        }, "*");
      } catch (e) {
        clearTimeout(_pending.get(cb) && _pending.get(cb).timer);
        _pending.delete(cb);
        resolve(null);
      }
    });
  }

  /* storage 代理：宿主页 localStorage（设备级） */
  function frameStorage(type, extra) {
    return new Promise(resolve => {
      const cb = "_hbs_" + Date.now() + "_" + (++_reqSeq);
      regPending(cb, resolve);
      try {
        window.parent.postMessage({
          protocol: PROTOCOL, version: 1, direction: "frame-to-host",
          type, payload: Object.assign({ callbackId: cb }, extra || {})
        }, "*");
      } catch (e) {
        clearTimeout(_pending.get(cb) && _pending.get(cb).timer);
        _pending.delete(cb);
        resolve(null);
      }
    });
  }

  /* host 通道：顶层 ColorboxAIHost.bridgeSend */
  function hostCall(method, data) {
    return new Promise(resolve => {
      try {
        let done = false;
        const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, TIMEOUT);
        Promise.resolve(window.ColorboxAIHost.bridgeSend(method, data || {})).then(res => {
          if (done) return; done = true; clearTimeout(timer);
          const ok = !!res && (res.status === 200 || res.status === "200" || res.status === 0 || res.status === undefined);
          resolve(ok ? res : null);
        }).catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
      } catch (e) { resolve(null); }
    });
  }

  /* ===== 通用云端 KV（写入链：原生云端 KV + 宿主 localStorage 双写；读取链：原生优先） ===== */
  function cloudSetValue(key, value) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const jobs = [];
    if (_env === "frame") {
      jobs.push(bridgeCall("hupu.common.setValue", { key, value: str }).then(r => !!r));
      jobs.push(frameStorage("storage.setValue", { key, value: str }).then(r => !!r));
    } else if (_env === "host") {
      jobs.push(hostCall("hupu.common.setValue", { key, value: str }).then(r => !!r));
    } else {
      return Promise.resolve(false);
    }
    return Promise.all(jobs).then(rs => rs.some(Boolean));
  }

  function extractValue(res) {
    if (res == null) return null;
    if (typeof res === "string") { try { return JSON.parse(res); } catch (e) { return res; } }
    if (typeof res === "object") {
      const cand = res.data !== undefined ? res.data : (res.value !== undefined ? res.value : res.result);
      if (cand === undefined || cand === null) return null;
      if (typeof cand === "string") { try { return JSON.parse(cand); } catch (e) { return cand; } }
      return cand;
    }
    return null;
  }

  function cloudGetValue(key) {
    if (_env === "frame") {
      return bridgeCall("hupu.common.getValue", { key })
        .then(extractValue)
        .then(v => (v != null ? v : frameStorage("storage.getValue", { key }).then(extractValue)));
    }
    if (_env === "host") {
      return hostCall("hupu.common.getValue", { key }).then(extractValue);
    }
    return Promise.resolve(null);
  }

  /* ===== 用户身份（bridgeReady → nainfo） ===== */
  function fetchUser() {
    if (_userTried) return Promise.resolve(_user);
    _userTried = true;
    if (_env === "none") return Promise.resolve(null);
    const p = _env === "frame" ? bridgeCall("bridgeReady", {}) : hostCall("bridgeReady", {});
    return p.then(res => {
      const info = extractValue(res) || res;
      if (info && typeof info === "object") {
        const uid = info.uid || info.userId || info.puid || info.user_id || "";
        const nick = info.nickname || info.nick || info.userName || info.username || info.name || "";
        if (uid || nick) _user = { uid: String(uid), nick: String(nick) };
      }
      return _user;
    }).catch(() => null);
  }

  /* ===== 启动初始化 ===== */
  function init() {
    detect();
    if (_env === "frame") initFrameListener();
    if (_env !== "none") fetchUser();  /* 异步预取，不阻塞 */
    return _env;
  }

  /* ===== 存档云同步（由 app.js writeSave 触发，1.2s 去抖） ===== */
  function syncSave(slot, save) {
    if (_env === "none") return;
    clearTimeout(_syncTimers[slot]);
    _syncTimers[slot] = setTimeout(() => {
      try {
        save._cloudT = Date.now();
        cloudSetValue(SAVE_PREFIX + slot, JSON.stringify(save));
      } catch (e) {}
    }, 1200);
  }

  function deleteSave(slot) {
    /* 云端无删除通道：写一个空标记，恢复时识别为已删除 */
    if (_env === "none") return;
    clearTimeout(_syncTimers[slot]);
    cloudSetValue(SAVE_PREFIX + slot, JSON.stringify({ _deleted: true, t: Date.now() }));
  }

  /* 启动恢复：返回 {slot: save对象}，只包含需要写回本地的槽位。
     规则：本地无档 → 云端有效档直接恢复；本地有档 → 云端 _cloudT 更新超 5s 才采用（多端 newer wins） */
  function restoreSaves(localSlots) {
    if (_env === "none") return Promise.resolve({});
    const jobs = [1, 2, 3].map(s => cloudGetValue(SAVE_PREFIX + s).then(v => ({ s, v })));
    return Promise.all(jobs).then(list => {
      const out = {};
      list.forEach(({ s, v }) => {
        try {
          if (!v) return;
          const env = typeof v === "string" ? JSON.parse(v) : v;
          if (!env || env._deleted) return;
          const save = typeof env.data === "string" ? JSON.parse(env.data) : env.data;
          if (!save || !save.team) return;
          const local = localSlots[s];
          if (!local) { out[s] = save; return; }
          const lt = local._cloudT || 0;
          const ct = env.t || save._cloudT || 0;
          if (ct > lt + 5000) out[s] = save;
        } catch (e) {}
      });
      return out;
    }).catch(() => ({}));
  }

  /* ===== CloudBase 排行榜客户端（平台开通 act-cloudbase 后即插即用） ===== */
  function cloudAvailable() {
    const ok = !!(window.ColorboxAI && window.ColorboxAI.cloud &&
      typeof window.ColorboxAI.cloud.request === "function" &&
      (window.ACTIVITY_ENV_ID || "").length > 0);
    return ok;
  }

  function cloudRequest(cfg) {
    if (!cloudAvailable()) return Promise.resolve(null);
    try {
      return Promise.resolve(window.ColorboxAI.cloud.request(Object.assign(
        { auth: true, envId: window.ACTIVITY_ENV_ID }, cfg
      )));
    } catch (e) { return Promise.resolve(null); }
  }

  /* 赛季战绩上报：result = {score, season, w, l, titles, stage, teamName}
     1) 本地+云端 KV 记录个人最佳（取最高分）
     2) CloudBase 就绪时提交全服榜（POST /leaderboard/submit） */
  function reportResult(result) {
    if (!result || typeof result.score !== "number") return;
    /* 个人最佳 */
    const prev = readBest();
    if (!prev || result.score > prev.score) {
      const best = Object.assign({ updatedAt: Date.now(), nick: _user && _user.nick || "" }, result);
      try { localStorage.setItem(BEST_LKEY, JSON.stringify(best)); } catch (e) {}
      cloudSetValue(BEST_KEY, best);
    }
    /* 全服榜 */
    cloudRequest({
      url: (window.ACTIVITY_API_BASE || "") + "/leaderboard/submit",
      method: "POST",
      data: { score: Math.round(result.score), displayName: (_user && _user.nick) || result.teamName || "经理人" }
    }).then(resp => {
      if (!resp) return;
      if (resp.code !== 200 && resp.code !== 0 && !_cloudReadyWarned) {
        _cloudReadyWarned = true;
        console.warn("[HupuCloud] 排行榜提交失败:", resp.message);
      }
    });
  }

  function readBest() {
    try {
      const raw = localStorage.getItem(BEST_LKEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  /* 个人最佳（本地优先，云端补） */
  function getMyBest() {
    return new Promise(resolve => {
      const local = readBest();
      if (_env === "none") return resolve(local);
      cloudGetValue(BEST_KEY).then(v => {
        const cloud = v && typeof v === "object" && v.score != null ? v : null;
        if (cloud && (!local || cloud.score > local.score)) resolve(cloud);
        else resolve(local);
      });
    });
  }

  /* 全服榜：CloudBase 未就绪返回 null（UI 降级为个人战绩） */
  function fetchBoard() {
    return cloudRequest({
      url: (window.ACTIVITY_API_BASE || "") + "/leaderboard",
      method: "GET"
    }).then(resp => {
      if (!resp || (resp.code !== 200 && resp.code !== 0)) return null;
      return Array.isArray(resp.data) ? resp.data : null;
    });
  }

  function myRank() {
    return cloudRequest({
      url: (window.ACTIVITY_API_BASE || "") + "/leaderboard/me",
      method: "GET"
    }).then(resp => {
      if (!resp || (resp.code !== 200 && resp.code !== 0)) return null;
      return resp.data || null;
    });
  }

  return {
    init, detect, fetchUser,
    get env() { return _env; },
    getUser: () => _user,
    cloudAvailable,
    syncSave, deleteSave, restoreSaves,
    reportResult, getMyBest, fetchBoard, myRank,
    /* 供调试 */
    _cloudGetValue: cloudGetValue, _cloudSetValue: cloudSetValue
  };
})();
window.HupuCloud = HupuCloud;
/* 尽早初始化（不依赖 DOM），iframe 环境检测越早越好 */
HupuCloud.init();
