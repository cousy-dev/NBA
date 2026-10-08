"use strict";
/* 虎扑 Shaper 云能力层 v2 —— 使用官方技能包 API
 *
 * 存储（colorbox-storage-set-value / colorbox-storage-get-value）：
 *   window.ColorboxAI.storage.setValue({ key: value })  → Promise<{ok,key?,keys?,size?}>
 *   window.ColorboxAI.storage.getValue(key?)            → Promise<value | {所有键值对}>
 *   约束：单次写入 ≤ 200KB；数据必须普通对象键值对；本地存档允许直接用 localStorage
 *
 * 云函数（colorbox-cloud-request）：
 *   window.ColorboxAI.cloud.request({ url, method, data, envId, auth })
 *     → Promise<{ statusCode, code?, message?, data? }>
 *   成功判断：statusCode === 200 && (code === 0 || code === 200)
 *   约束：禁止手写 fetch+Bearer；禁止 body 传 puid；普通虎扑业务用 ColorboxAI.request 不混用
 *
 * 登录（colorbox-cloud-auth）：
 *   window.ColorboxAI.cloud.auth({ envId }) → Promise<{ code, message }>
 *   code === 200 表示已登录
 *
 * 排行榜配置（act-cloudbase/frontend.md）：
 *   window.ACTIVITY_API_BASE = "https://<域名>/api"
 *   window.ACTIVITY_ENV_ID = "<EnvId>"
 *
 * 本地三级存储兜底（SKILL.md 明确允许）：localStorage → IndexedDB → 内存
 * app.js 通过 window.HupuCloud 调用，所有方法均有存在性守卫
 */
const HupuCloud = (() => {
  const SAVE_PREFIX = "nba_gm_slot_";      /* 云端存档键：nba_gm_slot_1..3 */
  const BEST_KEY = "nba_gm_best";          /* 个人最佳战绩 */
  const BEST_LKEY = "nba_gm_best_local";   /* 本地镜像（无云时也有值） */
  const MAX_CLOUD_SIZE = 200000;           /* 200KB 单次写入限制 */

  let _syncTimers = {};          /* slot -> debounce timer */
  let _cloudWarned = false;       /* 防止重复 warn */
  let _authChecked = false;      /* 登录状态缓存 */

  /* ===== 环境检测（基于功能而非通道） ===== */
  function hasCloudStorage() {
    return !!(window.ColorboxAI && window.ColorboxAI.storage &&
      typeof window.ColorboxAI.storage.setValue === "function" &&
      typeof window.ColorboxAI.storage.getValue === "function");
  }

  function hasCloudRequest() {
    return !!(window.ColorboxAI && window.ColorboxAI.cloud &&
      typeof window.ColorboxAI.cloud.request === "function" &&
      (window.ACTIVITY_API_BASE || "").length > 0 &&
      (window.ACTIVITY_ENV_ID || "").length > 0);
  }

  /* 兼容 app.js 的 env 属性：有云能力返回 "cloud"，否则 "none" */
  function getEnv() {
    return (hasCloudStorage() || hasCloudRequest()) ? "cloud" : "none";
  }

  /* ===== 云存储 ===== */
  function cloudSetValue(key, value) {
    if (!hasCloudStorage()) return Promise.resolve(false);
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (str.length > MAX_CLOUD_SIZE) {
      console.warn("[HupuCloud] 存档超 200KB 跳过云写:", Math.round(str.length / 1024) + "KB");
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(window.ColorboxAI.storage.setValue({ [key]: str }))
        .then(res => !!(res && res.ok !== false))
        .catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  }

  function cloudGetValue(key) {
    if (!hasCloudStorage()) return Promise.resolve(null);
    try {
      return Promise.resolve(window.ColorboxAI.storage.getValue(key))
        .then(raw => {
          if (raw == null) return null;
          if (typeof raw === "string") {
            try { return JSON.parse(raw); } catch (e) { return raw; }
          }
          /* 对象可能包含嵌套 JSON 字符串 */
          if (typeof raw === "object" && raw[key] !== undefined) {
            const v = raw[key];
            if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return v; } }
            return v;
          }
          return raw;
        })
        .catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }

  /* ===== 存档云同步（由 app.js writeSave 触发，1.2s 去抖） ===== */
  function syncSave(slot, save) {
    if (!hasCloudStorage()) return;
    clearTimeout(_syncTimers[slot]);
    _syncTimers[slot] = setTimeout(() => {
      try {
        const copy = Object.assign({}, save, { _cloudT: Date.now() });
        const json = JSON.stringify(copy);
        if (json.length > MAX_CLOUD_SIZE) {
          console.warn("[HupuCloud] 存档超 200KB 跳过云同步:", Math.round(json.length / 1024) + "KB");
          return;
        }
        cloudSetValue(SAVE_PREFIX + slot, json);
      } catch (e) {}
    }, 1200);
  }

  function deleteSave(slot) {
    if (!hasCloudStorage()) return;
    clearTimeout(_syncTimers[slot]);
    cloudSetValue(SAVE_PREFIX + slot, JSON.stringify({ _deleted: true, t: Date.now() }));
  }

  /* 启动恢复：返回 {slot: save对象}，只包含需要写回本地的槽位。
     规则：本地无档 → 云端有效档直接恢复；本地有档 → 云端 _cloudT 更新超 5s 才采用 */
  function restoreSaves(localSlots) {
    if (!hasCloudStorage()) return Promise.resolve({});
    const jobs = [1, 2, 3].map(s => cloudGetValue(SAVE_PREFIX + s).then(v => ({ s, v })));
    return Promise.all(jobs).then(list => {
      const out = {};
      list.forEach(({ s, v }) => {
        try {
          if (!v) return;
          const save = typeof v === "string" ? JSON.parse(v) : v;
          if (!save || save._deleted) return;
          if (!save.team) return;
          const local = localSlots[s];
          if (!local) { out[s] = save; return; }
          const lt = local._cloudT || 0;
          const ct = save._cloudT || 0;
          if (ct > lt + 5000) out[s] = save;
        } catch (e) {}
      });
      return out;
    }).catch(() => ({}));
  }

  /* ===== CloudBase 排行榜客户端 ===== */
  /* 排行榜是否可用：需要 cloud.request + ACTIVITY_API_BASE + ACTIVITY_ENV_ID */
  function cloudAvailable() {
    return hasCloudRequest();
  }

  /* 登录检查：cloud.auth({envId}) → code===200 表示已登录；缓存结果 */
  async function ensureAuth() {
    if (!hasCloudRequest()) return false;
    if (_authChecked) return true;
    try {
      const auth = await window.ColorboxAI.cloud.auth({ envId: window.ACTIVITY_ENV_ID });
      if (!auth || auth.code !== 200) {
        if (!_cloudWarned) {
          _cloudWarned = true;
          console.warn("[HupuCloud] 登录失败:", auth && auth.message);
        }
        return false;
      }
      _authChecked = true;
      return true;
    } catch (e) {
      if (!_cloudWarned) {
        _cloudWarned = true;
        console.warn("[HupuCloud] 登录异常:", e && e.message);
      }
      return false;
    }
  }

  /* 统一 cloud.request 封装：先 ensureAuth，再请求，检查 statusCode+code */
  async function cloudRequest(cfg) {
    if (!hasCloudRequest()) return null;
    const ok = await ensureAuth();
    if (!ok) return null;
    try {
      const response = await window.ColorboxAI.cloud.request(Object.assign(
        { auth: true, envId: window.ACTIVITY_ENV_ID }, cfg
      ));
      /* 401 表示登录态过期，重置缓存让下次重新登录 */
      if (response.statusCode === 401) {
        _authChecked = false;
        return null;
      }
      /* 成功：statusCode===200 且 code===0（CloudBase 后端约定）或 code===200（兼容旧版） */
      if (response.statusCode !== 200 || (response.code !== 0 && response.code !== 200)) {
        if (!_cloudWarned) {
          _cloudWarned = true;
          console.warn("[HupuCloud] 云请求失败:", response.statusCode, response.code, response.message);
        }
        return null;
      }
      return response;
    } catch (e) {
      if (!_cloudWarned) {
        _cloudWarned = true;
        console.warn("[HupuCloud] 云请求异常:", e && e.message);
      }
      return null;
    }
  }

  /* 赛季战绩上报：result = {score, season, w, l, titles, stage, stageLabel, teamName}
     1) 本地+云端 KV 记录个人最佳（取最高分）
     2) CloudBase 就绪时提交全服榜（POST /leaderboard/submit） */
  function reportResult(result) {
    if (!result || typeof result.score !== "number") return;
    /* 个人最佳（本地镜像 + 云端 KV） */
    const prev = readBest();
    if (!prev || result.score > prev.score) {
      const best = Object.assign({ updatedAt: Date.now() }, result);
      try { localStorage.setItem(BEST_LKEY, JSON.stringify(best)); } catch (e) {}
      if (hasCloudStorage()) cloudSetValue(BEST_KEY, best);
    }
    /* 全服榜提交 */
    if (hasCloudRequest()) {
      cloudRequest({
        url: window.ACTIVITY_API_BASE + "/leaderboard/submit",
        method: "POST",
        data: {
          score: Math.round(result.score),
          displayName: result.teamName || "经理人"
        }
      }).then(resp => {
        if (!resp) console.warn("[HupuCloud] 排行榜提交失败");
      });
    }
  }

  function readBest() {
    try {
      const raw = localStorage.getItem(BEST_LKEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  /* 个人最佳（本地优先，云端补） */
  async function getMyBest() {
    const local = readBest();
    if (!hasCloudStorage()) return local;
    try {
      const cloud = await cloudGetValue(BEST_KEY);
      if (cloud && typeof cloud === "object" && cloud.score != null) {
        if (!local || cloud.score > local.score) return cloud;
      }
      return local;
    } catch (e) {
      return local;
    }
  }

  /* 全服榜：CloudBase 未就绪返回 null（UI 降级为个人战绩） */
  async function fetchBoard() {
    if (!hasCloudRequest()) return null;
    const resp = await cloudRequest({
      url: window.ACTIVITY_API_BASE + "/leaderboard",
      method: "GET"
    });
    if (!resp) return null;
    return Array.isArray(resp.data) ? resp.data : null;
  }

  /* 我的排名 */
  async function myRank() {
    if (!hasCloudRequest()) return null;
    const resp = await cloudRequest({
      url: window.ACTIVITY_API_BASE + "/leaderboard/me",
      method: "GET"
    });
    if (!resp) return null;
    return resp.data || null;
  }

  /* 兼容旧版 init 调用（无操作，SDK 就绪即用） */
  function init() { return getEnv(); }

  return {
    init,
    get env() { return getEnv(); },
    hasCloudStorage,
    hasCloudRequest,
    cloudAvailable,
    syncSave,
    deleteSave,
    restoreSaves,
    reportResult,
    getMyBest,
    fetchBoard,
    myRank,
    /* 供调试 */
    _cloudSetValue: cloudSetValue,
    _cloudGetValue: cloudGetValue,
    _ensureAuth: ensureAuth
  };
})();
window.HupuCloud = HupuCloud;
