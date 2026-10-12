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
  const MAX_CLOUD_SIZE = 200000;           /* 200KB 单次写入限制（平台约束，按字节计） */
  const CHUNK_BYTES = 180 * 1024;          /* 分片目标大小（留 20KB 余量给 key/封装） */

  /* ===== 压缩工具：优先用浏览器原生 CompressionStream(deflate)，不支持时回退字段名短码 ===== */
  function hasCompressionStream() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  }
  /* 短码映射：把 JSON 中高频字段名替换成单字符，体积可减小 30-50%。
     用 \x01-\x1F 控制字符作为短码（JSON 字符串中不出现这些字符） */
  var SHORT_MAP = [
    ["nameCn","\x01"],["nameEn","\x02"],["attrs","\x03"],["mgr","\x04"],
    ["potential","\x05"],["collegeStats","\x06"],["heightCm","\x07"],["weightKg","\x08"],
    ["expYears","\x09"],["draftYear","\x0a"],["ratingSource","\x0b"],["isRookie","\x0c"],
    ["isLegend","\x0d"],["isCbaLegend","\x0e"],["displayName","\x0f"],["logoAbbr","\x10"],
    ["playerStats","\x11"],["careerStats","\x12"],["prevSeasonOvr","\x13"],["lastPlayoffs","\x14"],
    ["seasonDates","\x15"],["standings","\x16"],["schedule","\x17"],["aiRosters","\x18"],
    ["customPlayers","\x19"],["draftPicks","\x1a"],["playoffs","\x1b"],["honors","\x1c"],
    ["playerAccolades","\x1d"],["ovrAdj","\x1e"],["ageAdj","\x1f"]
  ];
  function _shortCompress(str) {
    var out = str;
    for (var i = 0; i < SHORT_MAP.length; i++) {
      out = out.split('"' + SHORT_MAP[i][0] + '"').join('"' + SHORT_MAP[i][1] + '"');
    }
    return out;
  }
  function _shortDecompress(str) {
    var out = str;
    for (var i = SHORT_MAP.length - 1; i >= 0; i--) {
      out = out.split('"' + SHORT_MAP[i][1] + '"').join('"' + SHORT_MAP[i][0] + '"');
    }
    return out;
  }
  /* 异步压缩：优先 deflate → base64，回退短码。返回 {data, method} */
  async function compressJson(jsonStr) {
    if (hasCompressionStream()) {
      try {
        var enc = new TextEncoder();
        var cs = new CompressionStream("deflate-raw");
        var writer = cs.writable.getWriter();
        writer.write(enc.encode(jsonStr));
        writer.close();
        var buf = await new Response(cs.readable).arrayBuffer();
        /* ArrayBuffer → base64 */
        var bytes = new Uint8Array(buf);
        var bin = "";
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        var b64 = btoa(bin);
        return { data: b64, method: "deflate" };
      } catch (e) { console.warn("[HupuCloud] deflate 压缩失败，回退短码:", e && e.message); }
    }
    return { data: _shortCompress(jsonStr), method: "short" };
  }
  /* 异步解压：根据 method 选择 */
  async function decompressData(data, method) {
    if (method === "deflate" && hasCompressionStream()) {
      try {
        var bin = atob(data);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var ds = new DecompressionStream("deflate-raw");
        var writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        var buf = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder().decode(buf);
      } catch (e) { console.warn("[HupuCloud] deflate 解压失败:", e && e.message); return null; }
    }
    return _shortDecompress(data);
  }

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
  /* 判定 setValue 返回值是否成功。
     注意：部分版本 SDK 成功时 resolve 无返回值（undefined）或只回 true，
     旧逻辑 !!(res && res.ok !== false) 会把 undefined 误判成失败。
     只有显式 ok:false / 明确错误码才算失败 */
  function isSetOk(res) {
    if (res === undefined || res === null || res === true) return true;
    if (typeof res === "object") {
      if (res.ok === false) return false;
      if (res.success === false) return false;
      if (res.code != null && res.code !== 0 && res.code !== 200 &&
          res.code !== "0" && res.code !== "200") return false;
      return true;
    }
    return !!res;
  }

  function cloudSetValue(key, value) {
    if (!hasCloudStorage()) return Promise.resolve(false);
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const byteLen = utf8Bytes(str).length;
    if (byteLen > MAX_CLOUD_SIZE) {
      console.warn("[HupuCloud] 单次写入超 200KB:", key, Math.round(byteLen / 1024) + "KB");
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(window.ColorboxAI.storage.setValue({ [key]: str }))
        .then(res => {
          const ok = isSetOk(res);
          if (!ok) console.warn("[HupuCloud] setValue 失败:", key, res);
          return ok;
        })
        .catch(err => { console.warn("[HupuCloud] setValue 异常:", key, err && err.message); return false; });
    } catch (e) { console.warn("[HupuCloud] setValue 同步异常:", key, e && e.message); return Promise.resolve(false); }
  }

  /* 原始字符串读取（不做 JSON.parse，供分片重组用，避免分片片段被误解析） */
  function cloudGetRaw(key) {
    if (!hasCloudStorage()) return Promise.resolve(null);
    try {
      return Promise.resolve(window.ColorboxAI.storage.getValue(key))
        .then(raw => {
          if (raw == null) return null;
          if (typeof raw === "string") return raw;
          /* 部分 SDK 把所有键值对包成对象返回 */
          if (typeof raw === "object" && raw[key] !== undefined) {
            const v = raw[key];
            return typeof v === "string" ? v : JSON.stringify(v);
          }
          return null;
        })
        .catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }

  function cloudGetValue(key) {
    return cloudGetRaw(key).then(str => {
      if (str == null) return null;
      try { return JSON.parse(str); } catch (e) { return str; }
    });
  }

  /* UTF-8 字节数与分片（200KB 是字节限制，中文字符占 3 字节，不能用 string.length） */
  function utf8Bytes(str) {
    try { return new TextEncoder().encode(str); }
    catch (e) {
      /* 极端老环境降级：ASCII 1 字节，其余按 3 字节估算 */
      const out = new Uint8Array(str.length * 3);
      return out;
    }
  }
  /* 按 UTF-8 字节切分，边界回退到 ASCII 字节（<0x80），绝不切断多字节字符；
     重组时直接字符串拼接即可 */
  function splitChunks(str) {
    const bytes = utf8Bytes(str);
    if (bytes.length <= CHUNK_BYTES) return [str];
    const decoder = new TextDecoder("utf-8");
    const chunks = [];
    let off = 0;
    while (off < bytes.length) {
      let end = Math.min(off + CHUNK_BYTES, bytes.length);
      if (end < bytes.length) {
        /* 多字节 UTF-8：续接字节 0x80-0xBF、首字节 ≥0xC0；回退到最近的 ASCII 字节切分 */
        while (end > off && bytes[end] >= 0x80) end--;
        if (end === off) end = Math.min(off + CHUNK_BYTES, bytes.length); /* 理论不可达的兜底 */
      }
      chunks.push(decoder.decode(bytes.subarray(off, end)));
      off = end;
    }
    return chunks;
  }

  function partsMetaKey(slot) { return SAVE_PREFIX + slot + "_parts"; }
  function partKey(slot, i) { return SAVE_PREFIX + slot + "_p" + i; }

  /* 分片写入：先顺序写全部数据片，最后写 meta 提交（读到 meta 才认为分片完整）。
     返回 {ok, reason, sizeKB, chunks} */
  async function writeSaveChunks(slot, json) {
    if (!hasCloudStorage()) return { ok: false, reason: "no-cloud" };
    const origKB = Math.round(utf8Bytes(json).length / 1024);
    /* 压缩：优先 deflate→base64，回退字段名短码 */
    const { data: compData, method } = await compressJson(json);
    const compKB = Math.round(utf8Bytes(compData).length / 1024);
    console.log("[HupuCloud] 存档压缩(" + method + "): " + origKB + "KB -> " + compKB + "KB");
    /* 分片：base64 是 ASCII，按字节切分 */
    const bytes = utf8Bytes(compData);
    const CHUNK_BYTES = 170 * 1024;
    const chunks = [];
    if (bytes.length <= CHUNK_BYTES) {
      chunks.push(compData);
    } else {
      /* 按字节边界切（base64 是 ASCII，不涉及多字节字符） */
      const decoder = new TextDecoder("utf-8");
      for (let off = 0; off < bytes.length; off += CHUNK_BYTES) {
        chunks.push(decoder.decode(bytes.subarray(off, off + CHUNK_BYTES)));
      }
    }
    try {
      /* 先读旧 meta，用于写完后清理多余分片 */
      const oldMeta = await cloudGetValue(partsMetaKey(slot));
      const oldN = (oldMeta && typeof oldMeta === "object" && oldMeta.n) || 0;
      for (let i = 0; i < chunks.length; i++) {
        const ok = await cloudSetValue(partKey(slot, i), chunks[i]);
        if (!ok) { console.warn("[HupuCloud] 分片写入失败:", slot, i + 1 + "/" + chunks.length, "字节:", utf8Bytes(chunks[i]).length); return { ok: false, reason: "api-fail", sizeKB: origKB, compKB, chunks: chunks.length }; }
      }
      /* meta 提交 */
      const meta = JSON.stringify({ v: 3, n: chunks.length, t: Date.now(), method, origKB, compKB });
      const metaOk = await cloudSetValue(partsMetaKey(slot), meta);
      if (!metaOk) return { ok: false, reason: "api-fail", sizeKB: origKB, compKB, chunks: chunks.length };
      /* 清理旧存档的多余分片 */
      for (let i = chunks.length; i < oldN; i++) {
        cloudSetValue(partKey(slot, i), "").catch(() => {});
      }
      console.log("[HupuCloud] 云端存档成功: 槽位" + slot + " " + origKB + "KB→" + compKB + "KB(" + method + ") / " + chunks.length + "片");
      return { ok: true, sizeKB: origKB, compKB, chunks: chunks.length };
    } catch (e) {
      console.warn("[HupuCloud] 分片写入异常:", e && e.message);
      return { ok: false, reason: "api-fail", sizeKB: origKB, compKB, chunks: chunks.length };
    }
  }

  /* 分片读取并重组；无分片 meta 时返回 null（交由调用方回退旧的单键格式） */
  async function readSaveChunks(slot) {
    try {
      const meta = await cloudGetValue(partsMetaKey(slot));
      if (!meta || typeof meta !== "object" || !meta.n || meta._deleted) return null;
      let buf = "";
      for (let i = 0; i < meta.n; i++) {
        const piece = await cloudGetRaw(partKey(slot, i));
        if (piece == null) { console.warn("[HupuCloud] 分片缺失:", slot, i); return null; }
        buf += piece;
      }
      /* v3 meta 标记了压缩方法 */
      const json = meta.method ? await decompressData(buf, meta.method) : buf;
      return JSON.parse(json);
    } catch (e) {
      console.warn("[HupuCloud] 分片重组失败:", slot, e && e.message);
      return null;
    }
  }

  /* ===== 存档云同步（由 app.js writeSave 触发，1.2s 去抖） ===== */
  function syncSave(slot, save) {
    if (!hasCloudStorage()) return;
    clearTimeout(_syncTimers[slot]);
    _syncTimers[slot] = setTimeout(() => {
      try {
        const json = JSON.stringify(_stripForCloud(save));
        writeSaveChunks(slot, json).then(r => {
          if (!r.ok) console.warn("[HupuCloud] 自动云同步失败:", slot, r.reason, r.sizeKB + "KB");
        });
      } catch (e) { console.warn("[HupuCloud] 自动云同步异常:", e && e.message); }
    }, 1200);
  }

  /* 立即同步（用户点击「存档」按钮时调用，跳过去抖）。
     云端同步前剥离比赛详情(box/quarters)以减小体积——这些仅用于本地日历弹窗，
     不影响恢复后游戏功能。返回 Promise<{ok, reason, sizeKB, chunks}> */
  function _stripForCloud(save) {
    /* 深拷贝后剥离，避免修改原对象的嵌套引用（否则本地存档也会丢 box/quarters） */
    const copy = JSON.parse(JSON.stringify(save));
    copy._cloudT = Date.now();
    /* 剥离比赛详情（最大体积来源）：保留result/score用于日历标记，删除box/quarters */
    if (copy.schedule) {
      copy.schedule = copy.schedule.map(g => {
        const s = { opp: g.opp, home: g.home, result: g.result, score: g.score };
        return s;
      });
    }
    /* 剥离季后赛单场详情（同理，保留系列赛结果） */
    if (copy.playoffs && copy.playoffs.rounds) {
      copy.playoffs.rounds.forEach(r => {
        (r.series || []).forEach(s => {
          (s.games || []).forEach(gm => { delete gm.box; });
        });
      });
      if (copy.playoffs.userSeries && copy.playoffs.userSeries.games) {
        copy.playoffs.userSeries.games.forEach(gm => { delete gm.box; });
      }
    }
    return copy;
  }
  function flushSyncSave(slot, save) {
    if (!hasCloudStorage()) return Promise.resolve({ ok: false, reason: "no-cloud" });
    clearTimeout(_syncTimers[slot]);
    try {
      const json = JSON.stringify(_stripForCloud(save));
      return writeSaveChunks(slot, json);
    } catch (e) {
      console.warn("[HupuCloud] 立即云同步异常:", e && e.message);
      return Promise.resolve({ ok: false, reason: "api-fail" });
    }
  }

  function deleteSave(slot) {
    if (!hasCloudStorage()) return;
    clearTimeout(_syncTimers[slot]);
    /* 旧单键格式墓碑 + 分片 meta 墓碑（分片内容由 meta 失效自然忽略） */
    cloudSetValue(SAVE_PREFIX + slot, JSON.stringify({ _deleted: true, t: Date.now() }));
    cloudSetValue(partsMetaKey(slot), JSON.stringify({ v: 1, _deleted: true, t: Date.now() }));
  }

  /* 启动恢复：返回 {slot: save对象}，只包含需要写回本地的槽位。
     读取顺序：分片存档（新版）→ 单键存档（旧版兼容）。
     规则：本地无档 → 云端有效档直接恢复；本地有档 → 云端 _cloudT 更新超 5s 才采用 */
  async function restoreSaves(localSlots) {
    if (!hasCloudStorage()) return {};
    const out = {};
    for (let s = 1; s <= 3; s++) {
      try {
        let save = await readSaveChunks(s);
        if (!save) {
          const v = await cloudGetValue(SAVE_PREFIX + s);
          if (v) save = typeof v === "string" ? JSON.parse(v) : v;
        }
        if (!save || save._deleted || !save.team) continue;
        const local = localSlots[s];
        if (!local) { out[s] = save; continue; }
        const lt = local._cloudT || 0;
        const ct = save._cloudT || 0;
        if (ct > lt + 5000) out[s] = save;
      } catch (e) {}
    }
    return out;
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

  /* ===== 社交分享（colorbox-social-share） =====
     window.ColorboxAI.social.share({title, link, text, imageUrl}) → Promise<void>
     老版本可能挂在 ColorboxAI.bridge.device.share */
  function hasSocialShare() {
    if (!window.ColorboxAI) return false;
    if (window.ColorboxAI.social && typeof window.ColorboxAI.social.share === "function") return true;
    if (window.ColorboxAI.bridge && window.ColorboxAI.bridge.device &&
        typeof window.ColorboxAI.bridge.device.share === "function") return true;
    return false;
  }

  async function share(params) {
    if (!hasSocialShare()) return false;
    if (!params || typeof params.title !== "string" || !params.title ||
        typeof params.link !== "string" || !/^https?:\/\//.test(params.link)) {
      console.warn("[HupuCloud] share 参数非法：title 必填，link 必须为 http/https 完整链接");
      return false;
    }
    const fn = (window.ColorboxAI.social && window.ColorboxAI.social.share) ||
               (window.ColorboxAI.bridge && window.ColorboxAI.bridge.device &&
                window.ColorboxAI.bridge.device.share);
    if (!fn) return false;
    try {
      await fn({
        title: params.title,
        link: params.link,
        text: params.text,
        imageUrl: params.imageUrl
      });
      return true;
    } catch (e) {
      console.warn("[HupuCloud] 分享失败:", e && e.message);
      return false;
    }
  }

  /* ===== 数据埋点（colorbox-track-report） =====
     window.ColorboxAI.track({act, blk, pos, label?, custom?}) → Promise<Response>
     act ∈ click/exposure/videoact；blk 必须 BMC001-BMC999 */
  function hasTrack() {
    return !!(window.ColorboxAI && typeof window.ColorboxAI.track === "function");
  }

  function track(params) {
    if (!hasTrack()) return false;
    if (!params || typeof params !== "object") return false;
    const act = params.act;
    if (act !== "click" && act !== "exposure" && act !== "videoact") {
      console.warn("[HupuCloud] track act 非法（必须 click/exposure/videoact）:", act);
      return false;
    }
    const blk = params.blk;
    if (!/^BMC[0-9]{3}$/.test(blk)) {
      console.warn("[HupuCloud] track blk 必须为 BMC001-BMC999 格式:", blk);
      return false;
    }
    try {
      const payload = { act, blk, pos: params.pos || "T1" };
      if (typeof params.label === "string" && params.label) payload.label = params.label;
      if (params.custom && typeof params.custom === "object") payload.custom = params.custom;
      return window.ColorboxAI.track(payload);
    } catch (e) {
      return false;
    }
  }

  /* ===== 用户反馈（user-feedback） =====
     使用固定公共反馈环境（与活动 CloudBase 解耦）
     applicationId 来自技能包根目录 activity.json: app_a8c082a249 */
  const FEEDBACK_API_BASE = "https://feedback-public-d8fnf79rd0e395c3-1252166086.ap-shanghai.app.tcloudbase.com/api";
  const FEEDBACK_ENV_ID = "feedback-public-d8fnf79rd0e395c3";
  const FEEDBACK_APP_ID = "app_a8c082a249";

  function hasFeedback() {
    return !!(window.ColorboxAI && window.ColorboxAI.cloud &&
      typeof window.ColorboxAI.cloud.request === "function" &&
      window.ColorboxAI.auth && typeof window.ColorboxAI.auth.getUserInfo === "function");
  }

  /* 提交反馈：返回 {ok, msg}；不记录正文/PUID/token */
  async function submitFeedback(rawContent) {
    if (!hasFeedback()) return { ok: false, msg: "当前环境不支持反馈" };
    const content = (rawContent || "").trim();
    const len = Array.from(content).length;
    if (len < 1 || len > 2000) {
      return { ok: false, msg: "请输入 1–2000 个字符的反馈内容" };
    }
    try {
      const userInfo = await window.ColorboxAI.auth.getUserInfo();
      if (!userInfo || userInfo.code !== 200 || !userInfo.data || userInfo.data.islogin !== 1) {
        return { ok: false, msg: "请先登录后再提交反馈" };
      }
      const data = { applicationId: FEEDBACK_APP_ID, content };
      const nickname = typeof userInfo.data.nickname === "string"
        ? userInfo.data.nickname.trim() : "";
      const avatarRaw =
        (typeof userInfo.data.avatar === "string" && userInfo.data.avatar.trim()) ||
        (typeof userInfo.data.userHeadUrl === "string" && userInfo.data.userHeadUrl.trim()) ||
        "";
      if (nickname) data.nickname = nickname;
      if (avatarRaw.startsWith("https://")) data.avatarUrl = avatarRaw;

      const response = await window.ColorboxAI.cloud.request({
        url: FEEDBACK_API_BASE + "/feedback",
        method: "POST",
        data,
        envId: FEEDBACK_ENV_ID,
        auth: true
      });

      if (response.statusCode === 201 && response.code === 0) return { ok: true };
      if (response.statusCode === 401) return { ok: false, msg: "登录状态已失效，请重新登录后提交" };
      if (response.statusCode === 413) return { ok: false, msg: "反馈内容过长，请精简后提交" };
      if (response.statusCode === 429) return { ok: false, msg: "提交过于频繁，请稍后再试" };
      if (response.statusCode === 400) return { ok: false, msg: response.message || "反馈内容不符合要求" };
      return { ok: false, msg: "提交结果暂不确定，请稍后在确认未成功后再试" };
    } catch (e) {
      return { ok: false, msg: "网络异常，请稍后再试" };
    }
  }

  /* ===== 冠军海报发帖（colorbox-result-poster-posting 复合技能） =====
     依赖：colorbox-oss-upload-file + colorbox-request-bbs-open-post-editor
     流程：Canvas Blob → OSS 上传取 downloadUrl → 唤起 BBS 发帖编辑器 */
  function hasOssUpload() {
    return !!(window.ColorboxAI && window.ColorboxAI.oss &&
      typeof window.ColorboxAI.oss.uploadFile === "function");
  }
  function hasBbsEditor() {
    return !!(window.ColorboxAI && window.ColorboxAI.request &&
      window.ColorboxAI.request.bbs && window.ColorboxAI.request.bbs.openPostEditor &&
      typeof window.ColorboxAI.request.bbs.openPostEditor === "function");
  }
  function hasPosterPosting() { return hasOssUpload() && hasBbsEditor(); }

  /* params: {blob, title, content, filename?}
     blob: Canvas toBlob 产出的 image/png Blob
     返回 {ok, stage, msg, imageUrl?} */
  async function postPoster(params) {
    if (!hasPosterPosting()) {
      return { ok: false, stage: "init", msg: "当前环境不支持海报发帖" };
    }
    const blob = params && params.blob;
    if (!blob || blob.size === 0) {
      return { ok: false, stage: "render", msg: "海报内容为空，请重试" };
    }
    /* 上传 OSS */
    let downloadUrl;
    try {
      const upRes = await window.ColorboxAI.oss.uploadFile({
        file: blob,
        filename: params.filename || ("nba_gm_" + Date.now() + ".png")
      });
      if (!upRes || !upRes.downloadUrl) {
        return { ok: false, stage: "upload", msg: "海报上传失败，请稍后重试" };
      }
      downloadUrl = upRes.downloadUrl;
    } catch (e) {
      return { ok: false, stage: "upload", msg: "海报上传异常" };
    }
    /* 唤起 BBS 发帖编辑器（专区/话题仅在 bbsTagId 非空时传） */
    try {
      const bbsParams = {
        title: params.title,
        content: params.content,
        imageUrl: downloadUrl
      };
      if (window.ColorboxAI.bbsConfig && typeof window.ColorboxAI.bbsConfig.get === "function") {
        const bbs = await window.ColorboxAI.bbsConfig.get();
        if (bbs && typeof bbs.bbsTagId === "string" && bbs.bbsTagId.trim() !== "") {
          bbsParams.topicId = bbs.bbsTopicId;
          bbsParams.tagId = bbs.bbsTagId;
          bbsParams.topicName = bbs.bbsTopicName;
          bbsParams.tagName = bbs.bbsTagName;
        }
      }
      const res = await window.ColorboxAI.request.bbs.openPostEditor(bbsParams);
      if (res && res.code === 200) return { ok: true, stage: "done", imageUrl: downloadUrl };
      return { ok: false, stage: "open", msg: (res && res.message) || "发帖编辑器唤起失败" };
    } catch (e) {
      return { ok: false, stage: "open", msg: "发帖编辑器异常" };
    }
  }

  /* ===== 激励广告（colorbox-vatask） =====
     window.ColorboxAI.vatask.completeRewardVideo() → 拉起视频，完播后服务端增加次数
     window.ColorboxAI.vatask.getActivityTaskState() → 查询剩余次数和任务状态
     约束：必须用户点击触发；禁止循环/轮询/自动重试；同时间只允许一个流程 */
  function hasAd() {
    return !!(window.ColorboxAI && window.ColorboxAI.vatask &&
      typeof window.ColorboxAI.vatask.completeRewardVideo === "function" &&
      typeof window.ColorboxAI.vatask.getActivityTaskState === "function");
  }

  /* 查询激励视频任务状态：返回 {available, rewardTask: {status, title}} 或 null
     rewardTask.status === "pending" 表示可看广告；"completed" 表示本周期已完成 */
  async function getAdTaskState() {
    if (!hasAd()) return null;
    try {
      const res = await window.ColorboxAI.vatask.getActivityTaskState();
      if (res.code !== 200 || !res.data) {
        console.warn("[HupuCloud] 广告任务状态查询失败:", res.message);
        return null;
      }
      const tasks = Array.isArray(res.data.tasks) ? res.data.tasks : [];
      const rewardTask = tasks.find(t => t.taskCode === "reward") || null;
      return {
        available: typeof res.data.availableChanceCount === "number" ? res.data.availableChanceCount : 0,
        rewardTask
      };
    } catch (e) {
      console.warn("[HupuCloud] 广告任务状态查询异常:", e && e.message);
      return null;
    }
  }

  /* 拉起激励视频：返回 {ok, msg}
     仅 code===200 且 data.rewarded===true 时 ok=true；禁止自行补发奖励 */
  async function completeRewardVideo() {
    if (!hasAd()) return { ok: false, msg: "当前环境不支持激励广告，请在虎扑 App 内打开" };
    try {
      const res = await window.ColorboxAI.vatask.completeRewardVideo();
      if (res.code === 200 && res.data && res.data.rewarded === true) {
        return { ok: true };
      }
      /* 常见失败原因：APP_REQUIRED(站外)/LOGIN_REQUIRED/UNAVAILABLE(已完成)/NOT_REWARDED(未完播) */
      return { ok: false, msg: res.message || "广告未完成" };
    } catch (e) {
      return { ok: false, msg: "广告调用异常" };
    }
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
    flushSyncSave,
    deleteSave,
    restoreSaves,
    reportResult,
    getMyBest,
    fetchBoard,
    myRank,
    /* 新增技能 */
    hasSocialShare,
    share,
    hasTrack,
    track,
    hasFeedback,
    submitFeedback,
    hasOssUpload,
    hasBbsEditor,
    hasPosterPosting,
    postPoster,
    /* 激励广告 */
    hasAd,
    getAdTaskState,
    completeRewardVideo,
    /* 供调试 */
    _cloudSetValue: cloudSetValue,
    _cloudGetValue: cloudGetValue,
    _ensureAuth: ensureAuth
  };
})();
window.HupuCloud = HupuCloud;
