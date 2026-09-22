"use strict";
/* NBA 篮球经理 — 建队流程（模式选择 / 球队选择 / 建队信息 / 预算 / 选人 / 确认） */

/* ===== 常量 ===== */
/* 存档槽位：支持 3 个独立生涯存档 */
const SAVE_SLOT_COUNT = 3;
const SAVE_KEY_LEGACY = "nba_gm_save_v1";
function slotKey(s) { return "nba_gm_save_slot_" + s; }
function readSlot(s) { try { return JSON.parse(localStorage.getItem(slotKey(s)) || "null"); } catch (e) { return null; } }
function writeSlot(s, save) { localStorage.setItem(slotKey(s), JSON.stringify(save)); }
function deleteSlot(s) { localStorage.removeItem(slotKey(s)); }
function readAllSaves() { const arr = []; for (let s = 1; s <= SAVE_SLOT_COUNT; s++) arr.push({ slot: s, save: readSlot(s) }); return arr; }
/* 返回第一个空槽位号；满则返回 0 */
function firstFreeSlot() { for (let s = 1; s <= SAVE_SLOT_COUNT; s++) if (!readSlot(s)) return s; return 0; }
/* 旧版单存档（v1）一次性迁移到槽位 1 */
function migrateLegacySave() {
  try {
    const old = localStorage.getItem(SAVE_KEY_LEGACY);
    if (old) { if (!readSlot(1)) localStorage.setItem(slotKey(1), old); localStorage.removeItem(SAVE_KEY_LEGACY); }
  } catch (e) {}
}
const STANDARD_BUDGET = 115; // 接管现有球队时的标准工资空间（百万美元）

const CITY_CN = {
  ATL: "亚特兰大", BKN: "布鲁克林", BOS: "波士顿", CHA: "夏洛特", CHI: "芝加哥",
  CLE: "克利夫兰", DAL: "达拉斯", DEN: "丹佛", DET: "底特律", GSW: "金州",
  HOU: "休斯敦", IND: "印第安纳波利斯", LAC: "洛杉矶", LAL: "洛杉矶", MEM: "孟菲斯",
  MIA: "迈阿密", MIL: "密尔沃基", MIN: "明尼苏达", NOP: "新奥尔良", NYK: "纽约",
  OKC: "俄克拉荷马城", ORL: "奥兰多", PHI: "费城", PHX: "菲尼克斯", POR: "波特兰",
  SAC: "萨克拉门托", SAS: "圣安东尼奥", TOR: "多伦多", UTA: "盐湖城", WAS: "华盛顿"
};
const NAME_POOL = ["烈焰", "龙曜", "星港", "极光", "王朝", "雷霆", "猛獁", "翼龙", "黑潮", "天穹", "磐石", "皇冠", "飞鲨", "银狼"];
const CITY_POOL = ["上海", "北京", "深圳", "广州", "杭州", "成都", "武汉", "西安", "南京", "重庆", "青岛", "长沙", "苏州", "厦门"];
const ARENA_POOL = ["星穹球馆", "龙曜中心", "极光体育馆", "皇冠竞技场", "磐石中心", "天穹球馆", "凤凰巢", "海豚湾中心", "长江体育馆", "银河广场"];
/* 2026-27 NBA 现实工资帑（百万美元，NBA 官方 2026-06-30 公布）
   - SALARY_CAP    = $164.961M  工资帽（UFA 签约不可超；鸟权续约可超）
   - TAX_LINE      = $200.428M  奢侈税线（鸟权续约可超，仅警告需缴奢侈税）
   - FIRST_APRON   = $209.015M  第一土豪线（鸟权续约可超；硬帽仅在先签后换/中产特例触发）
*/
const SALARY_CAP = 165.0;
const TAX_LINE = 200.4;
const FIRST_APRON = 209.0;
/* 特例金额（2026-27 NBA 真实数据） */
const MLE_AMOUNT = 12.4;        /* 空间中产特例：非纳税人中产（使用后触发硬帽） */
const TAXPAYER_MLE = 5.3;       /* 纳税人中产特例：超帽球队可用（不触发硬帽，但需缴税） */
const BAE_AMOUNT = 4.5;         /* 双年特例：每两年可用一次（触发硬帽） */
const MLE_MAX_YEARS = 3;        /* 中产特例最多 3 年 */
const BAE_MAX_YEARS = 2;        /* 双年特例最多 2 年 */
/* 梦幻选秀：30 队蛇形选秀，每队选 FANTASY_ROUNDS 人（不考虑薪资，纯按能力选） */
const FANTASY_ROUNDS = 15;
/* 交易截止日：常规赛第 53 场结束后（82 场的 65%，对齐 NBA 现实 2 月中旬截止日） */
const TRADE_DEADLINE_GAME = 53;
/* 球市分级预算：大球市可挥金至第一奢侈税线，中球市到奢侈税线，小球市紧贴硬帽 */
const MARKET_PRESETS = [
  { key: "small",  label: "小球市", amount: SALARY_CAP,  cap: SALARY_CAP,  desc: "紧贴工资帽 · 营收有限" },
  { key: "medium", label: "中球市", amount: TAX_LINE,    cap: TAX_LINE,    desc: "触及奢侈税线 · 营收稳健" },
  { key: "large",  label: "大球市", amount: FIRST_APRON, cap: FIRST_APRON, desc: "挥金至第一奢侈税线 · 财力雄厚" }
];
/* 兼容字段：BUDGET_PRESETS 旧代码引用（仅用于自建模式选预算） */
const BUDGET_PRESETS = [
  { key: "small",  label: "小球市",   amount: SALARY_CAP,  desc: "精打细算 · 工资帽硬约束" },
  { key: "medium", label: "中球市",   amount: TAX_LINE,    desc: "中等预算 · 触及奢侈税线" },
  { key: "large",  label: "大球市",   amount: FIRST_APRON, desc: "挥金如土 · 第一奢侈税线" }
];
/* 取球队所在球市的预设（接管模式用） */
function presetForTeam(abbr) {
  const t = TEAMS.find(x => x.abbr === abbr);
  const mk = t ? (t.market || "small") : "small";
  return MARKET_PRESETS.find(p => p.key === mk) || MARKET_PRESETS[0];
}
/* 工资估算分档（百万美元/年），按 OVR 区间线性插值 + 基于 id 的确定性浮动。
   仅作为「查不到真实薪资」时的兜底（底薪边缘球员、未来生成新秀等）。 */
const SALARY_BANDS = [
  [95, 99, 46, 60], [90, 94, 36, 45], [85, 89, 26, 34], [80, 84, 16, 24],
  [75, 79, 9, 14], [70, 74, 5, 8], [65, 69, 2.5, 4.5], [60, 64, 1.2, 2.4], [0, 59, 0.8, 1.6]
];

/* ===== 真实薪资（data/salaries.js，NBA 2026-27 合同）===== */
/* 姓名归一化（见下方实现）：去重音、去标点、去世代后缀，用于跨数据源精确匹配。 */
function normPlayerName(n) {
  /* 归一化：小写、去重音、标点转空格分词，丢弃世代后缀（jr/sr/ii/iii/iv/v）后拼接。
     使 "Jokic/Jokić"、"Jimmy Butler III/Jimmy Butler"、"GG Jackson/GG Jackson II"、
     "A.J. Green/AJ Green" 等两侧写法差异归到同一键。 */
  const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  return String(n || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter(tok => !SUFFIX.has(tok))
    .join("");
}
/* 游戏球队缩写 → Basketball-Reference 合同页缩写（仅差异队需要映射） */
function gameToBBRefTeam(abbr) {
  return ({ BKN: "BRK", CHA: "CHO", PHX: "PHO" })[abbr] || abbr;
}
let _REAL_SAL_IDX = null;   // 数字 id -> {s, y}
let _REAL_SAL_NAME = null;  // 归一名 -> 单条记录 或 {_multi:{TEAM:rec}}
function buildRealSalaryIndex() {
  if (_REAL_SAL_NAME) return _REAL_SAL_NAME;
  const idx = new Map();
  if (typeof REAL_SALARIES === "undefined" || !Array.isArray(REAL_SALARIES)) { _REAL_SAL_NAME = idx; return idx; }
  for (const e of REAL_SALARIES) {
    const k = normPlayerName(e.n);
    if (!k) continue;
    if (!idx.has(k)) { idx.set(k, e); continue; }
    /* 同名冲突（转会悬而未决/数据重复）：转为按球队映射 */
    const prev = idx.get(k);
    if (prev && prev._multi) { prev.m[e.t] = e; }
    else { const m = {}; m[prev.t] = prev; m[e.t] = e; idx.set(k, { _multi: true, m }); }
  }
  _REAL_SAL_NAME = idx;
  /* 建立 数字 id -> 记录 的快速表（基于当前全局球员库；建队时球队归属即真实 2026-27 阵容） */
  const byId = new Map();
  for (const p of PLAYERS_RATED.players) {
    const rec = idx.get(normPlayerName(p.nameEn));
    if (!rec) continue;
    let r = rec;
    if (rec._multi) r = rec.m[gameToBBRefTeam(p.team)] || Object.values(rec.m)[0] || null;
    if (r) byId.set(p.id, r);
  }
  _REAL_SAL_IDX = byId;
  return idx;
}
/* 真实薪资（百万美元）。查不到返回 null。 */
function realSalaryForId(id) {
  buildRealSalaryIndex();
  const r = _REAL_SAL_IDX && _REAL_SAL_IDX.get(id);
  return r ? r.s : null;
}
/* 真实剩余合同年数。查不到返回 null。 */
function realYearsForId(id) {
  buildRealSalaryIndex();
  const r = _REAL_SAL_IDX && _REAL_SAL_IDX.get(id);
  return r ? r.y : null;
}

/* 备份球员原始球队（梦幻选秀会改写 p.team，需在重置/换档时还原） */
let _ORIG_TEAMS = null;
function origTeams() {
  if (!_ORIG_TEAMS) _ORIG_TEAMS = new Map(PLAYERS_RATED.players.map(p => [p.id, p.team]));
  return _ORIG_TEAMS;
}
/* 还原所有球员的原始球队归属（开启新生涯/切换存档前调用） */
function resetPlayerTeams() {
  const m = origTeams();
  PLAYERS_RATED.players.forEach(p => { const o = m.get(p.id); if (o) p.team = o; });
}

/* ===== 状态 ===== */
const state = {
  stack: [],
  screen: "start",
  mode: null,          // "existing" | "custom"
  saveSlot: null,      // 当前生涯所在的存档槽位（1-3）
  expansion: null,     // 扩张选秀状态（自建模式）：{ pool, selected:Set, teamsHit:Set }
  fantasy: null,       // 梦幻选秀状态（接管模式）：{ order, picks, round, pickNo, userTeam, done }
  takeMode: "direct",  // 接管模式："direct" 直接接管 / "fantasy" 梦幻选秀
  team: null,          // 接管模式: 球队缩写
  custom: { name: "", city: "", arena: "" },
  budget: 0,
  budgetKey: null,
  roster: new Map(),   // 自建模式: id -> player
  filter: { pos: "all", q: "", sort: "ovr" },
  renderedCount: 0,
  currentPlayerId: null
};

/* ===== 工具 ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function hash01(id, salt) {
  let h = ((id | 0) * 2654435761 + (salt | 0) * 40503) >>> 0;
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  return ((h >>> 3) % 1000) / 999;
}
function fmtM(v) { return "$" + (Math.round(v * 10) / 10) + "M"; }
function ovrClass(ovr) {
  return ovr >= 95 ? "ovr-95" : ovr >= 90 ? "ovr-90" : ovr >= 85 ? "ovr-85"
    : ovr >= 80 ? "ovr-80" : ovr >= 75 ? "ovr-75" : ovr >= 70 ? "ovr-70" : "ovr-low";
}
/* posClass 已移至 positions.js，支持新旧位置值（PG/SG/SF/PF/C + G/G-F/F/F-C/C） */
function estimateSalary(ovr, id) {
  /* 优先使用 NBA 2026-27 真实合同薪资；查不到再按 OVR 分档估算兜底 */
  const real = realSalaryForId(id);
  if (real != null) return real;
  for (const b of SALARY_BANDS) {
    if (ovr >= b[0] && ovr <= b[1]) {
      const t = (ovr - b[0]) / Math.max(1, b[1] - b[0]);
      let v = b[2] + t * (b[3] - b[2]);
      v *= 0.92 + hash01(id, 7) * 0.16;
      return Math.round(v * 10) / 10;
    }
  }
  return 1;
}
function playersByTeam(abbr) { return PLAYERS_RATED.players.filter(p => p.team === abbr); }
/* 清理运行时注入全局库的自定义球员（选秀新秀等）。
   开启新生涯时必须调用：上一次生涯的新秀留在 PLAYERS_RATED 全局库中且 team 已被设为选中球队，
   不清理的话，接管球队（playersByTeam 按 team 过滤）与自建选人池都会把旧新秀吸入新阵容。 */
function purgeRuntimePlayers() {
  const before = PLAYERS_RATED.players.length;
  PLAYERS_RATED.players = PLAYERS_RATED.players.filter(
    p => !p.isRookie && p.ratingSource !== "draft"
  );
  /* 联盟估算缓存基于旧库构建，直接作废，下次 leagueEst() 按需重建 */
  if (typeof LEAGUE_EST !== "undefined") LEAGUE_EST = null;
  /* 真实薪资索引同样基于球员库构建，一并作废，下次按需重建 */
  _REAL_SAL_IDX = null; _REAL_SAL_NAME = null;
  /* 还原球员原始球队归属（梦幻选秀会改写 p.team） */
  resetPlayerTeams();
  return before - PLAYERS_RATED.players.length;
}
/* 重置建队向导状态（模式/球队/自定义信息/预算/已选阵容/筛选器），避免上一次建队残留 */
function resetWizardState() {
  state.mode = null;
  state.team = null;
  state.expansion = null;
  state.fantasy = null;
  state.takeMode = "direct";
  state._fantasyAiRosters = null;
  state.custom = { name: "", city: "", arena: "" };
  state.budget = 0;
  state.budgetKey = null;
  state.roster = new Map();
  state.filter = { pos: "all", q: "", sort: "ovr" };
  state.renderedCount = 0;
  state.currentPlayerId = null;
}
function teamStrength(abbr) {
  const r = playersByTeam(abbr).sort((a, b) => b.ovr - a.ovr).slice(0, 8);
  return r.reduce((s, p) => s + p.ovr, 0) / Math.max(1, r.length);
}
function stars(strength) { return strength >= 88 ? 5 : strength >= 84 ? 4 : strength >= 79 ? 3 : 2; }
function teamLogoHtml(abbr) {
  return '<img src="https://res.nba.cn/media/img/teams/logos/' + abbr + '_logo.png" alt="" loading="lazy" ' +
    'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
    '<div class="logo-fb" style="display:none">' + esc(abbr) + '</div>';
}
function usedTotal() {
  let s = 0;
  state.roster.forEach(p => { s += estimateSalary(p.ovr, p.id); });
  return Math.round(s * 10) / 10;
}
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1900);
}
function readSave() {
  return readSlot(state.saveSlot || 1);
}

/* ===== 导航 ===== */
const RENDERERS = {};
function activate(name, keepScroll) {
  state.screen = name;
  $$(".screen").forEach(el => el.classList.add("hidden"));
  $("#screen-" + name).classList.remove("hidden");
  if (!keepScroll) window.scrollTo(0, 0);
  updateTopbar();
}
function go(name) { state.stack.push(state.screen); RENDERERS[name](); activate(name); }
function back() {
  const prev = state.stack.pop() || "start";
  RENDERERS[prev]();
  activate(prev);
}
function currentStep() {
  switch (state.screen) {
    case "team-select": return ["选择球队", 1, 2];
    case "create-info": return ["建队信息", 1, 3];
    case "budget": return ["资金预算", 2, 4];
    case "roster": return ["选拔阵容", 3, 4];
    case "expand": return ["扩张选秀", 2, 3];
    case "fantasy": return ["梦幻选秀", 2, 2];
    case "summary": return state.mode === "existing" ? ["确认球队", 2, 2] : ["确认建队", 3, 3];
    case "player": return ["球员详情", 1, 1];
    case "hub": return ["经理室", 1, 1];
    case "match": return ["比赛日", 1, 1];
    case "awards": return ["奖项追踪", 1, 1];
    case "retired": return ["退役球员", 1, 1];
    case "hof": return ["名人堂", 1, 1];
    case "freeagent": return ["自由市场", 1, 1];
    case "standings": return ["联盟排名", 1, 1];
    case "schedule": return ["赛程战报", 1, 1];
    case "seasonend": return ["赛季总结", 1, 1];
    case "trade": return ["交易中心", 1, 1];
    case "trade-search": return ["交易搜索", 1, 1];
    case "trade-deal": return ["交易谈判", 1, 1];
    case "extend": return ["提前续约", 1, 1];
    case "draft": return ["NBA 选秀", 1, 1];
    case "allstar-hub": return ["全明星周末", 1, 1];
    case "allstar-game": return ["全明星正赛", 1, 1];
    case "threept": return ["三分大赛", 1, 1];
    case "dunk": return ["扣篮大赛", 1, 1];
    default: return ["", 0, 1];
  }
}
function updateTopbar() {
  const [label, idx, total] = currentStep();
  $("#step-label").textContent = label;
  $("#step-fill").style.width = (idx / total * 100) + "%";
  $("#btn-back").style.visibility = (state.stack.length > 0 && state.screen !== "match") ? "visible" : "hidden";
}

/* ===== 开始页 ===== */
RENDERERS.start = function () {
  resetWizardState();
  resetPlayerTeams();   /* 还原梦幻选秀改写过的球队归属 */
  state.stack = [];
  migrateLegacySave(); /* 旧版单存档迁移到槽位 1 */
  const slots = readAllSaves();
  const slotCard = ({ slot, save }) => {
    if (!save) {
      return '<div class="save-slot empty" data-slot="' + slot + '">' +
        '  <div class="ss-head"><span class="ss-no">槽位 ' + slot + "</span><span class='ss-state'>空</span></div>" +
        '  <div class="ss-body">未使用的存档槽位</div>' +
        "</div>";
    }
    const rec = save.record || { w: 0, l: 0 };
    const season = save.seasonNo || 1;
    return '<div class="save-slot" data-slot="' + slot + '">' +
      '  <div class="ss-head"><span class="ss-no">槽位 ' + slot + "</span>" +
      '    <span class="ss-mode">' + (save.mode === "custom" ? "扩张球队" : "接管球队") + "</span></div>" +
      '  <div class="ss-team">' + esc(save.team.displayName || "球队") + "</div>" +
      '  <div class="ss-meta">第 ' + season + " 赛季 · " + (rec.w || 0) + "胜" + (rec.l || 0) + "负" +
      (save.teamOvr ? " · 总评 " + save.teamOvr : "") + "</div>" +
      '  <div class="ss-actions">' +
      '    <button class="btn btn-gold ss-continue" data-slot="' + slot + '">继续生涯</button>' +
      '    <button class="link-danger ss-delete" data-slot="' + slot + '">删除</button>' +
      "  </div>" +
      "</div>";
  };
  $("#screen-start").innerHTML =
    '<div class="hero">' +
    '  <div class="hero-logo">🏀</div>' +
    "  <h1>NBA 篮球经理</h1>" +
    '  <p class="sub">' + PLAYERS_RATED.count + " 名现役球员 · 30 支球队 · 2K27 能力值 · 最多 " + SAVE_SLOT_COUNT + " 个存档</p>" +
    "</div>" +
    '<div class="save-slots">' + slots.map(slotCard).join("") + "</div>" +
    '<div class="start-actions">' +
    '  <button class="btn btn-primary" id="btn-existing">接管现有球队</button>' +
    '  <button class="btn btn-outline" id="btn-custom">创建扩张球队</button>' +
    "</div>" +
    '<p class="foot-note">数据来源：NBA中国官方 · 能力值依据 2K27 官方榜单与 2025-26 赛季统计估算<br>赛季 ' + esc(PLAYERS_RATED.updatedAt || "") + "</p>";

  /* 开启新游戏：自动占用第一个空槽位，满则提示 */
  const startNew = (mode) => {
    const s = firstFreeSlot();
    if (!s) { toast("存档槽位已满（" + SAVE_SLOT_COUNT + " 个），请先删除一个存档"); return; }
    state.saveSlot = s;
    purgeRuntimePlayers(); resetWizardState();
    state.saveSlot = s; /* resetWizardState 不清槽位，但保险重设 */
    go(mode === "custom" ? "create-info" : "team-select");
  };
  $("#btn-existing").onclick = () => startNew("existing");
  $("#btn-custom").onclick = () => startNew("custom");
  $$("#screen-start .ss-continue").forEach(btn => {
    btn.onclick = () => {
      const s = Number(btn.dataset.slot);
      const save = readSlot(s);
      if (!save) return;
      state.saveSlot = s;
      purgeRuntimePlayers();
      restoreFromSave(save);
    };
  });
  $$("#screen-start .ss-delete").forEach(btn => {
    btn.onclick = () => {
      const s = Number(btn.dataset.slot);
      if (!confirm("确定删除槽位 " + s + " 的存档？此操作不可撤销。")) return;
      deleteSlot(s);
      if (state.saveSlot === s) { state.save = null; state.saveSlot = null; }
      LEAGUE_EST = null;
      toast("槽位 " + s + " 存档已删除");
      RENDERERS.start(); activate("start");
    };
  });
};

/* ===== 球队选择（接管模式） ===== */
RENDERERS["team-select"] = function () {
  state.mode = "existing";
  const teams = TEAMS.map(t => ({
    ...t, strength: teamStrength(t.abbr), count: playersByTeam(t.abbr).length
  })).sort((a, b) => b.strength - a.strength);
  const marketName = m => m === "large" ? "大球市" : m === "medium" ? "中球市" : "小球市";
  const marketClass = m => "mkt-" + (m || "small");
  const mode = state.takeMode || "direct";

  $("#screen-team-select").innerHTML =
    '<h2 class="screen-title">选择你的球队</h2>' +
    '<p class="screen-sub">接管一支 NBA 球队 · 球市决定预算上限（大球市 ' + fmtM(MARKET_PRESETS[2].amount) + ' / 中球市 ' + fmtM(MARKET_PRESETS[1].amount) + ' / 小球市 ' + fmtM(MARKET_PRESETS[0].amount) + '）</p>' +
    '<div class="mode-toggle">' +
    '  <button class="mt-btn' + (mode === "direct" ? " active" : "") + '" data-mode="direct">直接接管</button>' +
    '  <button class="mt-btn' + (mode === "fantasy" ? " active" : "") + '" data-mode="fantasy">梦幻选秀</button>' +
    "</div>" +
    (mode === "fantasy" ? '<p class="screen-sub" style="margin-top:0;color:#7dd3fc">所有球员清空重选 · 30 队随机蛇形顺位 · 纯按能力值选人 · 不考虑薪资</p>' : "") +
    '<div class="team-grid">' +
    teams.map(t =>
      '<div class="team-card ' + marketClass(t.market) + '" data-abbr="' + t.abbr + '">' +
      '  <div class="team-logo">' + teamLogoHtml(t.abbr) + "</div>" +
      '  <div class="team-name">' + esc(t.nameCn) + "</div>" +
      '  <div class="team-city">' + esc(CITY_CN[t.abbr] || t.cityEn) + "</div>" +
      '  <div class="team-meta">' + "★".repeat(stars(t.strength)) + " · " + t.count + "人 · 均" + t.strength.toFixed(1) + "</div>" +
      '  <div class="team-market">' + marketName(t.market) + " · " + fmtM(presetForTeam(t.abbr).amount) + "</div>" +
      "</div>"
    ).join("") +
    "</div>";

  $$("#screen-team-select .mt-btn").forEach(btn => {
    btn.onclick = () => { state.takeMode = btn.dataset.mode; RENDERERS["team-select"](); activate("team-select", true); };
  });
  $$("#screen-team-select .team-card").forEach(card => {
    card.onclick = () => {
      state.team = card.dataset.abbr;
      if (state.takeMode === "fantasy") { startFantasyDraft(state.team); go("fantasy"); }
      else { go("summary"); }
    };
  });
};

/* ===== 建队信息（自建模式） ===== */
RENDERERS["create-info"] = function () {
  state.mode = "custom";
  const c = state.custom;
  $("#screen-create-info").innerHTML =
    '<h2 class="screen-title">建立你的球队</h2>' +
    '<p class="screen-sub">从零开始，打造属于你的王朝</p>' +
    '<div class="form">' +
    '  <label class="field"><span>球队名称</span><div class="field-row">' +
    '    <input id="in-name" maxlength="8" placeholder="如：烈焰" value="' + esc(c.name) + '">' +
    '    <button class="dice" data-for="name" type="button">🎲</button></div></label>' +
    '  <label class="field"><span>所在城市</span><div class="field-row">' +
    '    <input id="in-city" maxlength="6" placeholder="如：上海" value="' + esc(c.city) + '">' +
    '    <button class="dice" data-for="city" type="button">🎲</button></div></label>' +
    '  <label class="field"><span>主场球馆</span><div class="field-row">' +
    '    <input id="in-arena" maxlength="12" placeholder="如：星穹球馆" value="' + esc(c.arena) + '">' +
    '    <button class="dice" data-for="arena" type="button">🎲</button></div></label>' +
    "</div>" +
    '<button class="btn btn-primary" id="btn-to-budget" style="margin-top:24px">下一步 · 扩张选秀</button>';

  $$("#screen-create-info .dice").forEach(btn => {
    btn.onclick = () => {
      const forWhat = btn.dataset.for;
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const val = forWhat === "name" ? pick(NAME_POOL) : forWhat === "city" ? pick(CITY_POOL) : pick(ARENA_POOL);
      state.custom[forWhat] = val;
      $("#in-" + forWhat).value = val;
    };
  });
  ["name", "city", "arena"].forEach(k => {
    $("#in-" + k).oninput = e => { state.custom[k] = e.target.value.trim(); };
  });
  $("#btn-to-budget").onclick = () => {
    if (!state.custom.name) {
      state.custom.name = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
      toast("已随机命名：" + state.custom.name);
    }
    if (!state.custom.city) state.custom.city = CITY_POOL[Math.floor(Math.random() * CITY_POOL.length)];
    if (!state.custom.arena) state.custom.arena = state.custom.city + "中心球馆";
    /* 自建球队：作为第 31 队加入联盟，通过扩张选秀组队 */
    go("expand");
  };
};

/* ===== 扩张选秀（自建球队作为第 31 队加入联盟） ===== */
RENDERERS.expand = function () {
  state.mode = "custom";
  if (!state.expansion) {
    state.expansion = {
      pool: buildExpansionPool(),
      selected: new Set(),
      teamsHit: new Set()
    };
  }
  const ex = state.expansion;
  if (!state.filter) state.filter = { pos: "all", q: "", sort: "ovr" };
  state.filter.pos = state.filter.pos || "all";
  state.filter.q = state.filter.q || "";
  const pickCount = ex.selected.size;
  const totalSal = Math.round(ex.pool.filter(x => ex.selected.has(x.p.id))
    .reduce((s, x) => s + estimateSalary(x.p.ovr, x.p.id), 0) * 10) / 10;
  const teamNameOf = abbr => { const t = TEAMS.find(x => x.abbr === abbr); return t ? t.nameCn : abbr; };
  const canConfirm = pickCount >= EXPANSION_PICK_MIN && pickCount <= EXPANSION_PICK_MAX;

  const card = (x) => {
    const p = x.p;
    const isSel = ex.selected.has(p.id);
    const teamBlocked = !isSel && ex.teamsHit.has(x.from);
    const sal = estimateSalary(p.ovr, p.id);
    return '<div class="exp-card' + (isSel ? " selected" : teamBlocked ? " blocked" : "") + '" data-id="' + p.id + '">' +
      '  <div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</div>" +
      '  <div class="exp-main">' +
      '    <div class="exp-name">' + esc(p.nameCn) + ' <span class="pos-chip ' + posClass(p.pos) + '">' + esc(posLabel(p)) + "</span></div>" +
      '    <div class="exp-meta">' + esc(teamNameOf(x.from)) + " · " + (p.age || "-") + "岁 · " + fmtM(sal) + "/年</div>" +
      "  </div>" +
      '  <div class="exp-act">' + (isSel ? '<span class="exp-tag sel">✓ 已选</span>' : teamBlocked ? '<span class="exp-tag locked">该队已流失1人</span>' : '<span class="exp-tag add">＋ 选择</span>') + "</div>" +
      "</div>";
  };

  const q = (state.filter.q || "").toLowerCase();
  const visible = ex.pool.filter(x => {
    if (state.filter.pos !== "all" && catOf(getPos(x.p).pos) !== state.filter.pos) return false;
    if (q && x.p.nameCn.toLowerCase().indexOf(q) < 0 && (x.p.nameEn || "").toLowerCase().indexOf(q) < 0) return false;
    return true;
  });

  $("#screen-expand").innerHTML =
    '<h2 class="screen-title">扩张选秀</h2>' +
    '<p class="screen-sub">你的球队将作为第 31 队加入联盟。规则：每支原球队最多保护 8 人（按能力自动保护），每队至少暴露 1 人，<b>每队最多流失 1 人</b>。你需挑选 <b>' + EXPANSION_PICK_MIN + "-" + EXPANSION_PICK_MAX + "</b> 名球员。</p>" +
    '<div class="exp-rules">' +
    '  <div class="er-pill">已选 <b>' + pickCount + "</b> / " + EXPANSION_PICK_MIN + "-" + EXPANSION_PICK_MAX + "</div>" +
    '  <div class="er-pill">覆盖球队 <b>' + ex.teamsHit.size + "</b> / 30</div>" +
    '  <div class="er-pill">已吸收合同 <b>' + fmtM(totalSal) + "</b>（扩张阶段不限工资帽）</div>" +
    "</div>" +
    '<div class="filters">' +
    '  <div class="pos-filter">' +
    '    <button data-pos="all"' + (state.filter.pos === "all" ? ' class="active"' : "") + ">全部</button>" +
    '    <button data-pos="G"' + (state.filter.pos === "G" ? ' class="active"' : "") + ">后卫</button>" +
    '    <button data-pos="F"' + (state.filter.pos === "F" ? ' class="active"' : "") + ">前锋</button>" +
    '    <button data-pos="C"' + (state.filter.pos === "C" ? ' class="active"' : "") + ">中锋</button>" +
    "  </div>" +
    "</div>" +
    '<input id="exp-search" placeholder="搜索球员姓名…" value="' + esc(state.filter.q || "") + '" />' +
    '<div class="exp-list">' + (visible.map(card).join("") || '<div class="empty-stats">没有符合条件的暴露球员</div>') + "</div>" +
    '<div class="exp-bottombar">' +
    '  <span class="exp-hint">已选 ' + pickCount + " 人（至少 " + EXPANSION_PICK_MIN + " 人，最多 " + EXPANSION_PICK_MAX + " 人）</span>" +
    '  <button class="btn btn-primary" id="btn-exp-confirm"' + (canConfirm ? "" : " disabled") + ">确认阵容 · 下一步</button>" +
    "</div>";

  $$("#screen-expand .pos-filter button").forEach(btn => {
    btn.onclick = () => { state.filter.pos = btn.dataset.pos; RENDERERS.expand(); activate("expand", true); };
  });
  $("#exp-search").oninput = e => { state.filter.q = e.target.value.trim(); clearTimeout(window._expTimer); window._expTimer = setTimeout(() => { RENDERERS.expand(); activate("expand", true); const el = $("#exp-search"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200); };
  $$("#screen-expand .exp-card").forEach(c => {
    c.onclick = () => {
      const id = Number(c.dataset.id);
      const item = ex.pool.find(x => x.p.id === id);
      if (!item) return;
      if (ex.selected.has(id)) {
        ex.selected.delete(id);
        /* 若这是该队唯一被选球员，解除该队锁定 */
        if (![...ex.selected].some(sid => ex.pool.find(y => y.p.id === sid)?.from === item.from)) ex.teamsHit.delete(item.from);
      } else {
        if (ex.teamsHit.has(item.from)) { toast(teamNameOf(item.from) + " 已流失 1 名球员，不可再选该队球员"); return; }
        if (ex.selected.size >= EXPANSION_PICK_MAX) { toast("最多挑选 " + EXPANSION_PICK_MAX + " 人"); return; }
        ex.selected.add(id);
        ex.teamsHit.add(item.from);
      }
      RENDERERS.expand(); activate("expand", true);
    };
  });
  $("#btn-exp-confirm").onclick = () => {
    if (ex.selected.size < EXPANSION_PICK_MIN) { toast("至少需要挑选 " + EXPANSION_PICK_MIN + " 名球员（当前 " + ex.selected.size + "）"); return; }
    if (ex.selected.size > EXPANSION_PICK_MAX) { toast("最多挑选 " + EXPANSION_PICK_MAX + " 名球员"); return; }
    /* 把选中球员填入向导阵容（供确认页与建队使用），并套用扩张特殊工资帽 */
    state.roster = new Map(ex.pool.filter(x => ex.selected.has(x.p.id)).map(x => [x.p.id, x.p]));
    state.budget = expansionBudget();
    state.budgetKey = "expansion";
    go("summary");
  };
};

/* ===== 梦幻选秀（接管模式：全联盟球员蛇形重选，不考虑薪资） ===== */
/* 初始化：随机 30 队蛇形顺位，用户队随机落位 */
function startFantasyDraft(userTeam) {
  origTeams();          /* 备份原始球队归属 */
  resetPlayerTeams();   /* 还原上一次生涯可能改写过的球队 */
  state.fantasy = {
    order: shuffleArr(TEAMS.map(t => t.abbr)),  /* 首轮顺位（奇数轮正向，偶数轮反向） */
    picks: [],        /* [{round, pickNo, team, playerId}] */
    round: 1,
    pickNo: 1,        /* 总顺位（从 1 开始） */
    userTeam,
    done: false
  };
}
/* 蛇形：第 round 轮第 pickInRound 顺位对应哪支队 */
function fantasyTeamAt(round, pickInRound) {
  const order = state.fantasy.order;
  if (round % 2 === 1) return order[pickInRound - 1];
  return order[order.length - pickInRound];
}
function fantasyPickedIds() { return new Set(state.fantasy.picks.map(p => p.playerId)); }
/* 可用球员（按 OVR 降序） */
function fantasyAvailable() {
  const picked = fantasyPickedIds();
  return PLAYERS_RATED.players.filter(p => !picked.has(p.id)).sort((a, b) => b.ovr - a.ovr);
}
/* AI 选人：前 3 中 70% 选最强、30% 随机，避免完全 predictable */
function aiFantasyPick() {
  const avail = fantasyAvailable();
  if (!avail.length) return null;
  const top = avail.slice(0, 3);
  return Math.random() < 0.7 ? top[0] : top[Math.floor(Math.random() * top.length)];
}
/* 执行一签 */
function fantasyDraftPick(playerId) {
  const f = state.fantasy;
  const pickInRound = ((f.pickNo - 1) % 30) + 1;
  const team = fantasyTeamAt(f.round, pickInRound);
  f.picks.push({ round: f.round, pickNo: f.pickNo, team, playerId });
  f.pickNo += 1;
  if (pickInRound === 30) f.round += 1;
  if (f.pickNo > 30 * FANTASY_ROUNDS) f.done = true;
}
function fantasyCurrentTeam() {
  const f = state.fantasy;
  const pickInRound = ((f.pickNo - 1) % 30) + 1;
  return fantasyTeamAt(f.round, pickInRound);
}
/* 模拟 AI 选人。stopBeforeUser=true 时到用户下一站停下；否则全部模拟完 */
function simulateFantasy(stopBeforeUser) {
  const f = state.fantasy;
  while (!f.done) {
    if (stopBeforeUser && fantasyCurrentTeam() === f.userTeam) break;
    const p = aiFantasyPick();
    if (!p) break;
    fantasyDraftPick(p.id);
  }
}
/* 完成选秀：构建各队阵容、改写球员归属、填入用户阵容 */
function finalizeFantasyDraft() {
  const f = state.fantasy;
  const teamRosters = {};
  TEAMS.forEach(t => { teamRosters[t.abbr] = []; });
  f.picks.forEach(pk => { teamRosters[pk.team].push(pk.playerId); });
  /* 改写球员球队归属（使 playersByTeam / 自由市场 / 交易逻辑正常） */
  const pById = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  f.picks.forEach(pk => { const p = pById.get(pk.playerId); if (p) p.team = pk.team; });
  /* 用户队阵容填入向导 */
  state.roster = new Map(
    teamRosters[f.userTeam].map(id => { const p = pById.get(id); return p ? [id, p] : null; }).filter(Boolean)
  );
  /* aiRosters 不含用户队（用户队用 save.roster，避免 doAging 重复处理） */
  delete teamRosters[f.userTeam];
  state._fantasyAiRosters = teamRosters;
  state.takeMode = "direct";
}

RENDERERS.fantasy = function () {
  const f = state.fantasy;
  if (!f) { go("team-select"); return; }
  const teamNameOf = abbr => { const t = TEAMS.find(x => x.abbr === abbr); return t ? t.nameCn : abbr; };
  const isUserTurn = !f.done && fantasyCurrentTeam() === f.userTeam;
  const avail = fantasyAvailable();
  const topAvail = avail.slice(0, 40);

  /* 我的签位预览：列出用户在每一轮的顺位 */
  const myPickInRound = r => {
    const idx = f.order.indexOf(f.userTeam) + 1;
    return r % 2 === 1 ? idx : (31 - idx);
  };

  /* 我的已选球员列表 */
  const myPicks = f.picks.filter(pk => pk.team === f.userTeam);
  const myPlayersHtml = myPicks
    .map(pk => {
      const p = PLAYERS_RATED.players.find(x => x.id === pk.playerId);
      if (!p) return "";
      return '<div class="r-row"><span class="r-idx">' + pk.round + "</span>" +
        '<div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</div>" +
        '<div class="r-main"><div class="r-name">' + esc(p.nameCn) + '</div>' +
        '<div class="r-meta"><span class="pos-chip ' + posClass(p.pos) + '">' + esc(posLabel(p)) + "</span> " + (p.age || "-") + "岁</div></div>" +
        '<div class="r-salary">R' + pk.round + "·" + pk.pickNo + "</div></div>";
    })
    .join("") || '<div class="empty-stats">还没有选择球员</div>';

  /* 选秀历史（最近 12 条） */
  const recent = f.picks.slice(-12).reverse();
  const historyHtml = recent.map(pk => {
    const p = PLAYERS_RATED.players.find(x => x.id === pk.playerId);
    const isMine = pk.team === f.userTeam;
    return '<div class="fan-pick' + (isMine ? " mine" : "") + '">' +
      '<span class="fp-no">R' + pk.round + "·" + pk.pickNo + "</span>" +
      '<span class="fp-team">' + esc(teamNameOf(pk.team)) + "</span>" +
      '<span class="fp-name">' + esc(p ? p.nameCn : "?") + "</span>" +
      '<span class="fp-ovr ' + ovrClass(p ? p.ovr : 60) + '">' + (p ? p.ovr : "-") + "</span>" +
      "</div>";
  }).join("") || '<div class="empty-stats">还没有选秀记录</div>';

  /* 首轮顺位展示 */
  const orderHtml = f.order.map((abbr, i) =>
    '<span class="fan-ord' + (abbr === f.userTeam ? " mine" : "") + '" title="' + esc(teamNameOf(abbr)) + '">' + (i + 1) + "." + abbr + "</span>"
  ).join("");

  let body;
  if (f.done) {
    const mine = myPicks.length;
    body = '<div class="fan-done">' +
      '<h3>选秀完成！</h3>' +
      '<p>你的球队 <b>' + esc(teamNameOf(f.userTeam)) + "</b> 共选得 <b>" + mine + "</b> 名球员。</p>" +
      '<div class="fan-actions">' +
      '  <button class="btn" id="btn-fan-mine">我的阵容 (' + mine + ")</button>" +
      '  <button class="btn btn-primary" id="btn-fan-confirm">确认阵容 · 开启生涯</button>' +
      "</div>" +
      "</div>";
  } else if (isUserTurn) {
    const pickInRound = ((f.pickNo - 1) % 30) + 1;
    const list = topAvail.map(p =>
      '<div class="exp-card" data-id="' + p.id + '">' +
      '  <div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</div>" +
      '  <div class="exp-main">' +
      '    <div class="exp-name">' + esc(p.nameCn) + ' <span class="pos-chip ' + posClass(p.pos) + '">' + esc(posLabel(p)) + "</span></div>" +
      '    <div class="exp-meta">' + esc(teamNameOf(p.team)) + " · " + (p.age || "-") + "岁</div>" +
      "  </div>" +
      '  <div class="exp-act"><span class="exp-tag add">＋ 选择</span></div>' +
      "</div>"
    ).join("");
    body = '<div class="fan-turn">' +
      '  <div class="fan-turn-hd"><b>轮到你了！</b> 第 ' + f.round + " 轮 · 第 " + pickInRound + " 顺位（总第 " + f.pickNo + " 签）</div>" +
      '  <div class="fan-actions">' +
      '    <button class="btn" id="btn-fan-mine">我的阵容 (' + myPicks.length + ")</button>" +
      '    <button class="btn" id="btn-fan-ai">AI 帮我选</button>' +
      '    <button class="btn" id="btn-fan-sim-rest">模拟剩余全部</button>' +
      "  </div>" +
      '  <div class="exp-list">' + list + "</div>" +
      "</div>";
  } else {
    const team = fantasyCurrentTeam();
    const pickInRound = ((f.pickNo - 1) % 30) + 1;
    body = '<div class="fan-turn">' +
      '  <div class="fan-turn-hd">等待 <b>' + esc(teamNameOf(team)) + "</b> 选择 · 第 " + f.round + " 轮 · 第 " + pickInRound + " 顺位</div>" +
      '  <div class="fan-actions">' +
      '    <button class="btn" id="btn-fan-mine">我的阵容 (' + myPicks.length + ")</button>" +
      '    <button class="btn btn-primary" id="btn-fan-sim-user">模拟到我的回合</button>' +
      '    <button class="btn" id="btn-fan-sim-rest">模拟剩余全部</button>' +
      "  </div>" +
      "</div>";
  }

  $("#screen-fantasy").innerHTML =
    '<h2 class="screen-title">梦幻选秀</h2>' +
    '<p class="screen-sub">所有 530 名球员清空重选 · 30 队随机蛇形顺位 · 纯按能力值选人 · 不考虑薪资 · 每队 ' + FANTASY_ROUNDS + " 人</p>" +
    '<div class="fan-round">' +
    '  <div class="er-pill">第 <b>' + (f.done ? FANTASY_ROUNDS : f.round) + "</b> / " + FANTASY_ROUNDS + " 轮</div>" +
    '  <div class="er-pill">已选 <b>' + f.picks.length + "</b> / " + (30 * FANTASY_ROUNDS) + "</div>" +
    '  <div class="er-pill">你的球队 <b>' + esc(teamNameOf(f.userTeam)) + "</b></div>" +
    '  <div class="er-pill">剩余球员 <b>' + avail.length + "</b></div>" +
    "</div>" +
    '<details class="fan-order"><summary>首轮顺位（点击展开）</summary><div class="fan-order-list">' + orderHtml + "</div></details>" +
    '<div class="fan-body">' +
    '  <div class="fan-main">' + body + "</div>" +
    '  <div class="fan-history"><h4>选秀记录</h4><div class="fan-history-list">' + historyHtml + "</div></div>" +
    "</div>" +
    (f.showMine ? '<div class="modal-overlay" id="fan-mine-overlay"><div class="modal-box">' +
      '<div class="modal-hd"><span>我的阵容（' + myPicks.length + "人）</span><button class='modal-close' id='btn-fan-mine-close'>✕</button></div>" +
      '<div class="modal-body"><div class="roster-table">' + myPlayersHtml + "</div></div>" +
      "</div></div>" : "");

  /* 事件绑定 */
  const mineBtn = $("#btn-fan-mine");
  if (mineBtn) mineBtn.onclick = () => { f.showMine = true; RENDERERS.fantasy(); activate("fantasy", true); };
  if (f.showMine) {
    $("#btn-fan-mine-close").onclick = () => { f.showMine = false; RENDERERS.fantasy(); activate("fantasy", true); };
    $("#fan-mine-overlay").onclick = e => { if (e.target.id === "fan-mine-overlay") { f.showMine = false; RENDERERS.fantasy(); activate("fantasy", true); } };
  }
  if (isUserTurn) {
    $$("#screen-fantasy .exp-card").forEach(c => {
      c.onclick = () => {
        fantasyDraftPick(Number(c.dataset.id));
        /* 自动模拟到用户下一回合 */
        simulateFantasy(true);
        RENDERERS.fantasy(); activate("fantasy", true);
      };
    });
    $("#btn-fan-ai").onclick = () => {
      const p = aiFantasyPick();
      if (p) { fantasyDraftPick(p.id); simulateFantasy(true); RENDERERS.fantasy(); activate("fantasy", true); }
    };
  }
  if (!f.done) {
    const simRest = $("#btn-fan-sim-rest");
    if (simRest) simRest.onclick = () => { simulateFantasy(false); RENDERERS.fantasy(); activate("fantasy", true); };
    const simUser = $("#btn-fan-sim-user");
    if (simUser) simUser.onclick = () => { simulateFantasy(true); RENDERERS.fantasy(); activate("fantasy", true); };
  }
  if (f.done) {
    $("#btn-fan-confirm").onclick = () => { finalizeFantasyDraft(); go("summary"); };
  }
};

/* ===== 预算（自建模式） ===== */
RENDERERS.budget = function () {
  $("#screen-budget").innerHTML =
    '<h2 class="screen-title">选择球市规模</h2>' +
    '<p class="screen-sub">工资帽 $' + SALARY_CAP + 'M · 奢侈税线 $' + TAX_LINE + 'M · 第一土豪线 $' + FIRST_APRON + 'M（2026-27 NBA 真实数据）</p>' +
    '<div class="budget-list">' +
    BUDGET_PRESETS.map(b =>
      '<div class="budget-card ' + (state.budgetKey === b.key ? "active" : "") + '" data-key="' + b.key + '">' +
      '  <div class="budget-amount">' + fmtM(b.amount) + "</div>" +
      '  <div class="budget-label">' + b.label + "</div>" +
      '  <div class="budget-desc">' + b.desc + "</div>" +
      "</div>"
    ).join("") +
    "</div>" +
    '<button class="btn btn-primary" id="btn-to-roster" ' + (state.budget ? "" : "disabled") + ">下一步 · 选拔阵容</button>";

  $$("#screen-budget .budget-card").forEach(card => {
    card.onclick = () => {
      state.budgetKey = card.dataset.key;
      state.budget = BUDGET_PRESETS.find(b => b.key === state.budgetKey).amount;
      $$("#screen-budget .budget-card").forEach(x => x.classList.remove("active"));
      card.classList.add("active");
      $("#btn-to-roster").disabled = false;
    };
  });
  $("#btn-to-roster").onclick = () => { state.roster.clear(); go("roster"); };
};

/* ===== 选人（自建模式） ===== */
let scrollBound = false;
RENDERERS.roster = function () {
  state.renderedCount = 0;
  $("#screen-roster").innerHTML =
    '<div class="roster-topbar">' +
    '  <div class="budget-line"><span>已用 <b id="used-amt">$0M</b></span>' +
    '  <span>剩余 <b id="left-amt">' + fmtM(state.budget) + '</b></span>' +
    '  <span>阵容 <b id="roster-count">0</b>/15</span></div>' +
    '  <div class="budget-bar"><div id="budget-fill"></div></div>' +
    '  <div class="chips" id="chips"></div>' +
    "</div>" +
    '<div class="filters">' +
    '  <div class="pos-filter">' +
    '    <button data-pos="all" class="active">全部</button>' +
    '    <button data-pos="G">后卫</button><button data-pos="F">前锋</button><button data-pos="C">中锋</button>' +
    "  </div>" +
    '  <select id="sort-sel"><option value="ovr">能力值</option><option value="salary">工资↑</option><option value="age">年龄↑</option></select>' +
    "</div>" +
    '<input id="search-in" placeholder="搜索球员姓名…" />' +
    '<div class="player-list" id="player-list"></div>' +
    '<div class="roster-bottombar"><button class="btn btn-primary" id="btn-confirm-roster">确认阵容</button></div>';

  $$("#screen-roster .pos-filter button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.pos === state.filter.pos);
    btn.onclick = () => {
      state.filter.pos = btn.dataset.pos;
      $$("#screen-roster .pos-filter button").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      resetList();
    };
  });
  $("#sort-sel").value = state.filter.sort;
  $("#sort-sel").onchange = e => { state.filter.sort = e.target.value; resetList(); };
  $("#search-in").value = state.filter.q;
  let searchTimer = null;
  $("#search-in").oninput = e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filter.q = e.target.value.trim(); resetList(); }, 200);
  };
  $("#btn-confirm-roster").onclick = confirmRoster;

  if (!scrollBound) { window.addEventListener("scroll", onScrollMore); scrollBound = true; }
  resetList();
  refreshRosterUI();
};
function resetList() { state.renderedCount = 0; $("#player-list").innerHTML = ""; renderMore(); }
function onScrollMore() {
  if (state.screen !== "roster") return;
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) renderMore();
}
function filteredPool() {
  const f = state.filter;
  const q = f.q.toLowerCase();
  let list = PLAYERS_RATED.players.filter(p => {
    if (f.pos !== "all") {
      const r = getPos(p);
      if (catOf(r.pos) !== f.pos && (!r.pos2 || catOf(r.pos2) !== f.pos)) return false;
    }
    if (q && p.nameCn.toLowerCase().indexOf(q) < 0 && p.nameEn.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (f.sort === "ovr") list = list.slice().sort((a, b) => b.ovr - a.ovr);
  else if (f.sort === "salary") list = list.slice().sort((a, b) => estimateSalary(a.ovr, a.id) - estimateSalary(b.ovr, b.id));
  else list = list.slice().sort((a, b) => (a.age || 99) - (b.age || 99));
  return list;
}
function renderMore() {
  const pool = filteredPool();
  const frag = [];
  const end = Math.min(state.renderedCount + 60, pool.length);
  for (let i = state.renderedCount; i < end; i++) frag.push(playerCardHtml(pool[i]));
  $("#player-list").insertAdjacentHTML("beforeend", frag.join(""));
  state.renderedCount = end;
  bindCards();
  updateCardStates();
}
function playerCardHtml(p) {
  const sal = estimateSalary(p.ovr, p.id);
  return (
    '<div class="player-card" data-id="' + p.id + '" data-sal="' + sal + '">' +
    '  <div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</div>" +
    '  <img class="p-avatar" src="' + esc(p.avatar || "") + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
    '  <div class="p-info">' +
    '    <div class="p-name">' + esc(p.nameCn) + "</div>" +
    '    <div class="p-meta"><span class="pos-chip ' + posClass(p.pos) + '">' + esc(posLabel(p)) + "</span>" +
    (p.age || "-") + "岁 · " + (p.heightCm || "-") + 'cm · ' + esc(p.team) + "</div>" +
    "  </div>" +
    '  <div class="p-right"><div class="p-salary">' + fmtM(sal) + '</div><div class="p-state">点击选择</div></div>' +
    '  <button class="p-info-btn" type="button" title="详情">ⓘ</button>' +
    "</div>"
  );
}
function bindCards() {
  $$("#player-list .player-card").forEach(card => {
    if (card._bound) return;
    card._bound = true;
    card.onclick = () => togglePlayer(Number(card.dataset.id));
    const ib = card.querySelector(".p-info-btn");
    if (ib) ib.onclick = e => { e.stopPropagation(); openPlayer(Number(card.dataset.id)); };
  });
}
function togglePlayer(id) {
  const p = PLAYERS_RATED.players.find(x => x.id === id);
  if (!p) return;
  if (state.roster.has(id)) {
    state.roster.delete(id);
  } else {
    if (state.roster.size >= 15) return toast("阵容最多 15 人");
    const sal = estimateSalary(p.ovr, p.id);
    if (usedTotal() + sal > state.budget) return toast("预算不足，无法签下该球员");
    state.roster.set(id, p);
  }
  refreshRosterUI();
}
function refreshRosterUI() {
  const used = usedTotal();
  const left = Math.round((state.budget - used) * 10) / 10;
  const usedEl = $("#used-amt"), leftEl = $("#left-amt"), cntEl = $("#roster-count"), fill = $("#budget-fill");
  if (!usedEl) return;
  usedEl.textContent = fmtM(used);
  leftEl.textContent = fmtM(left);
  leftEl.className = left < 0 ? "warn" : "";
  cntEl.textContent = state.roster.size;
  const pct = Math.min(100, used / state.budget * 100);
  fill.style.width = pct + "%";
  fill.className = left < 0 ? "over" : (pct >= 85 ? "warn" : "");

  /* 已选 chips */
  const chips = $("#chips");
  if (state.roster.size === 0) {
    chips.innerHTML = '<span class="chip-empty">从下方列表点选 13-15 名球员</span>';
  } else {
    chips.innerHTML = Array.from(state.roster.values()).map(p =>
      '<div class="chip" data-id="' + p.id + '"><img src="' + esc(p.avatar || "") + '" onerror="this.style.visibility=\'hidden\'">' +
      esc(p.nameCn) + '<span class="x">✕</span></div>'
    ).join("");
    $$("#chips .chip").forEach(chip => { chip.onclick = () => togglePlayer(Number(chip.dataset.id)); });
  }
  updateCardStates();
}
function updateCardStates() {
  const used = usedTotal();
  $$("#player-list .player-card").forEach(card => {
    const id = Number(card.dataset.id);
    const sal = parseFloat(card.dataset.sal);
    const selected = state.roster.has(id);
    const afford = selected || used + sal <= state.budget;
    card.classList.toggle("selected", selected);
    card.classList.toggle("disabled", !afford);
    card.querySelector(".p-state").textContent = selected ? "已选 ✓" : afford ? "点击选择" : "预算不足";
  });
}
function confirmRoster() {
  const n = state.roster.size;
  if (n < 13) return toast("至少需要 13 名球员（当前 " + n + "）");
  const cnt = { G: 0, F: 0, C: 0 };
  state.roster.forEach(p => {
    const r = getPos(p);
    cnt[catOf(r.pos)]++;
    if (r.pos2) cnt[catOf(r.pos2)]++;
  });
  if (usedTotal() > state.budget) return toast("总工资超出预算");
  if (cnt.G < 2) return toast("至少需要 2 名后卫");
  if (cnt.F < 2) return toast("至少需要 2 名前锋");
  if (cnt.C < 1) return toast("至少需要 1 名中锋");
  go("summary");
}

/* ===== 确认页 ===== */
function buildSummaryData() {
  if (state.mode === "existing") {
    const t = TEAMS.find(x => x.abbr === state.team);
    /* 梦幻选秀：使用 state.roster（已选阵容）；直接接管：用 playersByTeam 原阵容 */
    const rosterSrc = state.roster && state.roster.size
      ? Array.from(state.roster.values())
      : playersByTeam(state.team);
    const rosterArr = rosterSrc
      .map(p => ({ p, sal: estimateSalary(p.ovr, p.id) }))
      .sort((a, b) => b.p.ovr - a.p.ovr);
    return {
      abbr: state.team,
      displayName: t.nameCn,
      city: CITY_CN[state.team] || t.cityEn,
      arena: "",
      logoAbbr: state.team,
      rosterArr,
      budget: presetForTeam(state.team).amount,
      budgetLabel: presetForTeam(state.team).label + " · " + presetForTeam(state.team).desc
    };
  }
  const rosterArr = Array.from(state.roster.values())
    .map(p => ({ p, sal: estimateSalary(p.ovr, p.id) }))
    .sort((a, b) => b.p.ovr - a.p.ovr);
  const isExpansion = state.budgetKey === "expansion";
  return {
    abbr: null,
    displayName: state.custom.name + "队",
    city: state.custom.city,
    arena: state.custom.arena,
    logoAbbr: null,
    rosterArr,
    budget: state.budget,
    budgetLabel: isExpansion ? "扩张球队 · 特殊工资帽（可超帽吸收合同）"
      : state.budgetKey ? (BUDGET_PRESETS.find(b => b.key === state.budgetKey).label + " · 自建球队") : "自建球队预算"
  };
}
RENDERERS.summary = function () {
  const d = buildSummaryData();
  const total = Math.round(d.rosterArr.reduce((s, x) => s + x.sal, 0) * 10) / 10;
  const left = Math.round((d.budget - total) * 10) / 10;
  const top8 = d.rosterArr.slice(0, 8);
  const teamOvr = (top8.reduce((s, x) => s + x.p.ovr, 0) / top8.length).toFixed(1);

  $("#screen-summary").innerHTML =
    '<h2 class="screen-title">球队确认</h2>' +
    '<p class="screen-sub">检查你的球队，确认后正式开启经理生涯</p>' +
    '<div class="team-hero">' +
    '  <div class="team-hero-logo">' + (d.logoAbbr
      ? teamLogoHtml(d.logoAbbr)
      : '<div class="th-fb" style="background:linear-gradient(135deg,hsl(' + Math.floor(hash01(strHash(d.displayName), 1) * 360) + ',55%,38%),#141830)">🏀</div>') + "</div>" +
    '  <div><div class="th-name">' + esc(d.displayName) + "</div>" +
    '  <div class="th-sub">' + esc(d.city) + (d.arena ? " · " + esc(d.arena) : "") + "</div></div>" +
    '  <div class="th-ovr"><b>' + teamOvr + "</b><span>球队总评</span></div>" +
    "</div>" +
    '<div class="sum-stats">' +
    "  <div><b>" + d.rosterArr.length + "</b><span>球员</span></div>" +
    "  <div><b>" + fmtM(total) + "</b><span>总工资</span></div>" +
    "  <div><b>" + fmtM(Math.abs(left)) + (left < 0 ? " 超" : "") + "</b><span>" + d.budgetLabel + "</span></div>" +
    "</div>" +
    '<div class="roster-table">' +
    d.rosterArr.map((x, i) =>
      '<div class="r-row" data-id="' + x.p.id + '">' +
      '  <span class="r-idx">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '  <div class="r-main">' +
      '    <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + "</div>" +
      '    <div class="r-meta"><span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(posLabel(x.p)) + "</span> " + (x.p.age || "-") + "岁</div>" +
      "  </div>" +
      '  <div class="r-salary">' + fmtM(x.sal) + "</div>" +
      "</div>"
    ).join("") +
    "</div>" +
    '<button class="btn btn-primary" id="btn-save-game">确认 · 开启经理生涯</button>' +
    '<button class="link-danger" id="btn-restart">重新开始建队</button>';

  $$("#screen-summary .r-row").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });

  $("#btn-save-game").onclick = () => {
    const isExpansion = state.mode === "custom" && state.budgetKey === "expansion";
    const save = {
      version: 1,
      slot: state.saveSlot || 1,
      createdAt: new Date().toISOString(),
      mode: state.mode,
      team: {
        abbr: d.abbr, displayName: d.displayName, city: d.city,
        arena: d.arena, logoAbbr: d.logoAbbr
      },
      budget: d.budget,
      budgetLabel: d.budgetLabel,
      teamOvr: parseFloat(teamOvr),
      roster: d.rosterArr.map(x => ({ id: x.p.id, salary: x.sal, years: realYearsForId(x.p.id) })),
      /* 工资帽硬帽跟踪字段：
         hardCapped: 本队本赛季是否触发硬帽（先签后换/空间中产/双年特例）
         hardCapReason: 触发原因文案
         usedMLE: 已用空间中产特例（球员 id）
         usedTaxpayerMLE: 已用纳税人中产特例（球员 id）
         usedBAE: 已用双年产特例（球员 id，或上次使用赛季号）
         lastBAESeason: 上次使用双年特例的赛季号（每两年可用一次）
         all in one object: capStatus */
      capStatus: {
        hardCapped: false,
        hardCapReason: "",
        usedMLE: null,
        usedTaxpayerMLE: null,
        usedBAE: null,
        lastBAESeason: 0
      }
    };
    /* 扩张建队：记录被选走球员，原 30 队阵容移除他们，并给予选秀权优待 */
    if (isExpansion && state.expansion) {
      const selectedIds = new Set(state.expansion.selected);
      save.aiRosters = buildExpansionAiRosters(selectedIds);
      save.expansion = true;
      /* 前两次选秀（第2、3赛季）额外首轮签优待 */
      save.expansionBonusUntilSeason = 3;
    }
    /* 梦幻选秀：写入全部 30 队阵容 */
    if (state._fantasyAiRosters) {
      save.aiRosters = state._fantasyAiRosters;
      save.fantasy = true;
      state._fantasyAiRosters = null;
    }
    try {
      writeSave(save);
      toast("✓ 生涯已开启" + (isExpansion ? "（扩张选秀组队完成）" : ""));
      const s2 = migrateSave(readSlot(save.slot));
      state.save = s2;
      state.saveSlot = save.slot;
      RENDERERS.hub();
      state.stack = [];
      activate("hub");
    } catch (e) {
      toast("保存失败：" + e.message);
    }
  };
  $("#btn-restart").onclick = () => { RENDERERS.start(); activate("start"); };
};
/* ===== 球员详情 ===== */
const ATTR_LABELS = [["ins", "内线"], ["out", "投射"], ["org", "组织"], ["def", "防守"], ["reb", "篮板"], ["ath", "身体"]];
function barColor(v) {
  return v >= 90 ? "linear-gradient(90deg,#ffd700,#ff9500)"
    : v >= 80 ? "linear-gradient(90deg,#ff6b5e,#c22631)"
    : v >= 70 ? "#4f8ef7" : v >= 60 ? "#3fbf7f" : "#5a6480";
}
function openPlayer(id) { state.currentPlayerId = id; go("player"); }
RENDERERS.player = function () {
  const p0 = PLAYERS_RATED.players.find(x => x.id === state.currentPlayerId);
  if (!p0) { back(); return; }
  const p = state.save ? applyAdj(p0, state.save) : p0;
  const sal = estimateSalary(p.ovr, p.id);
  const onRoster = state.save ? state.save.roster.some(r => r.id === p.id)
    : (state.mode === "existing" && p.team === state.team) || state.roster.has(p.id);
  const ps = state.save && state.save.playerStats ? state.save.playerStats[p.id] : null;
  $("#screen-player").innerHTML =
    '<div class="pd-hero">' +
    '  <img class="pd-avatar" src="' + esc(p.avatar || "") + '" onerror="this.style.visibility=\'hidden\'">' +
    '  <div class="pd-main">' +
    '    <div class="pd-name">' + esc(p.nameCn) + '<span class="pd-tag">#' + esc(p.num || "-") + "</span></div>" +
    '    <div class="pd-en">' + esc(p.nameEn) + "</div>" +
    '    <div class="pd-meta"><span class="pos-chip ' + posClass(p.pos) + '">' + esc(posLabel(p)) + "</span>" +
    '      <span class="pd-tag">' + esc(p.team) + "</span>" +
    '      <span class="pd-tag ' + (p.ratingSource === "official" ? "gold" : "") + '">' + (p.ratingSource === "official" ? "2K27 官方" : "数据估算") + "</span></div>" +
    '    <div class="pd-meta">' +
    '      <span class="pd-tag">' + (p.age || "?") + "岁</span>" +
    '      <span class="pd-tag">' + (p.heightCm || "?") + 'cm</span>' +
    '      <span class="pd-tag">' + (p.weightKg || "?") + 'kg</span>' +
    '      <span class="pd-tag">' + (p.draftYear ? p.draftYear + "年选秀" : "落选秀") + "</span>" +
    '      <span class="pd-tag">' + getExpYears(p, state.save.seasonNo) + "年球龄</span></div>" +
    "  </div>" +
    '  <div class="pd-ovr"><div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</div><span>总评</span></div>" +
    "</div>" +
    '<div class="pd-card"><h3>能力属性</h3>' +
    ATTR_LABELS.map(a =>
      '<div class="attr-row"><span class="attr-label">' + a[1] + "</span>" +
      '<div class="attr-track"><div class="attr-fill" style="width:' + p.attrs[a[0]] + "%;background:" + barColor(p.attrs[a[0]]) + '"></div></div>' +
      '<span class="attr-val">' + p.attrs[a[0]] + "</span></div>"
    ).join("") +
    "</div>" +
    '<div class="pd-card"><h3>经理评价</h3><div class="mgr-grid">' +
    [["off", "进攻"], ["def", "防守"], ["sta", "体力"], ["twk", "团队"]].map(m =>
      "<div><b>" + p.mgr[m[0]] + "</b><span>" + m[1] + "</span></div>"
    ).join("") +
    "</div></div>" +
    /* 士气卡片 */
    (() => {
      const m = state.save ? moraleOf(state.save, p0.id) : DEFAULT_MORALE;
      const delta = moraleOvrDelta(m);
      return '<div class="pd-card"><h3>士气</h3>' +
        '<div class="morale-row"><div class="morale-bar"><div class="morale-fill" style="width:' + m + '%;background:' + moraleColor(m) + '"></div></div>' +
        '<span class="morale-val" style="color:' + moraleColor(m) + '">' + m + '</span></div>' +
        '<div class="morale-hint">' + moraleHint(m) + ' · 能力修正 ' + (delta >= 0 ? "+" : "") + delta + ' OVR</div></div>';
    })() +
    '<div class="pd-card"><h3>' + (p.stats ? p.stats.season : "2025-26") + ' 赛季数据</h3>' +
    (p.stats
      ? '<table class="stat-table">' +
        "<tr><th>场次</th><th>时间</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>失误</th><th>TS%</th></tr>" +
        "<tr><td>" + p.stats.g + "</td><td>" + p.stats.mpg + "</td><td><b>" + p.stats.ppg + "</b></td><td>" + p.stats.rpg + "</td><td>" + p.stats.apg + "</td><td>" + p.stats.spg + "</td><td>" + p.stats.bpg + "</td><td>" + p.stats.tov + "</td><td>" + (p.stats.ts ? (p.stats.ts * 100).toFixed(1) : "-") + "</td></tr>" +
        "</table>"
      : '<div class="empty-stats">暂无本赛季数据（新秀 / 伤缺）</div>') +
    "</div>" +
    (ps && ps.g > 0
      ? '<div class="pd-card"><h3>本赛季累计（' + ps.g + " 场）</h3>" +
        '<table class="stat-table"><tr><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>投篮</th><th>三分</th></tr>' +
        "<tr><td><b>" + (ps.pts / ps.g).toFixed(1) + "</b></td><td>" + (ps.reb / ps.g).toFixed(1) + "</td><td>" + (ps.ast / ps.g).toFixed(1) + "</td><td>" + (ps.stl / ps.g).toFixed(1) + "</td><td>" + (ps.blk / ps.g).toFixed(1) + "</td><td>" + (ps.fga ? Math.round(ps.fgm / ps.fga * 100) : 0) + "%</td><td>" + (ps.tpa ? Math.round(ps.tpm / ps.tpa * 100) : 0) + '%</td></tr></table></div>'
      : "") +
    /* 成长曲线图 */
    '<div class="pd-card"><h3>成长趋势预测</h3>' +
    '<canvas id="growth-chart" width="320" height="180"></canvas>' +
    '<div class="gc-legend"><span class="gc-cur">● 当前</span><span class="gc-fut">● 预测</span>' +
    (p.potential ? '<span class="gc-pot">潜力 ' + p.potential + '</span>' : '') + '</div></div>' +
    '<div class="pd-card"><h3>合同信息</h3>' +
    '<table class="stat-table"><tr><th>年薪</th><th>来源</th><th>阵容状态</th></tr>' +
    "<tr><td><b>" + fmtM(sal) + '</b></td><td>' + (p.ratingSource === "official" ? "官方评分定薪" : "数据模型定薪") + "</td><td>" +
    (onRoster ? '<span class="pd-tag gold">已在你的阵容</span>' : '<span class="pd-tag">自由市场</span>') + "</td></tr></table></div>";

  /* 绘制成长趋势图 */
  _drawGrowthChart(p, p0);
};

/* 预测球员成长曲线 */
function projectGrowth(p0, save) {
  const baseAge = p0.age || 24;
  const potential = p0.potential || Math.min(85, (p0.ovr || 70) + 8);
  const startOvr = (p0.ovr || 70) + ((save && save.ovrAdj) ? (save.ovrAdj[p0.id] || 0) : 0);
  const startAgeAdj = (save && save.ageAdj) ? (save.ageAdj[p0.id] || 0) : 0;
  const startAge = baseAge + startAgeAdj;

  const points = [{ age: startAge, ovr: startOvr }];
  let curOvr = startOvr;
  let id = p0.id;
  for (let age = startAge + 1; age <= 40; age++) {
    let delta;
    if (age <= 21) {
      const room = Math.max(0, potential - curOvr);
      delta = 1 + Math.round(hash01(id, 11) * 2);
      if (room > 10) delta += 1;
      if (room <= 0) delta = 0;
    } else if (age <= 24) {
      const room = Math.max(0, potential - curOvr);
      delta = Math.round(hash01(id, 12));
      if (room > 5) delta += 1;
      if (room <= 0) delta = 0;
    } else if (age <= 27) {
      delta = 0;
    } else if (age <= 30) {
      delta = -Math.round(hash01(id, 13));
    } else if (age <= 33) {
      delta = -1 - Math.round(hash01(id, 14));
    } else if (age <= 36) {
      delta = -2 - Math.round(hash01(id, 15));
    } else {
      delta = -3 - Math.round(hash01(id, 16) * 2);
    }
    curOvr = Math.max(40, Math.min(99, curOvr + delta));
    points.push({ age, ovr: curOvr });
  }
  return points;
}

/* 绘制成长曲线 Canvas */
function _drawGrowthChart(p, p0) {
  const cv = $("#growth-chart");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const save = state.save;
  const data = projectGrowth(p0, save);
  const curAge = (p0.age || 24) + (save && save.ageAdj ? (save.ageAdj[p0.id] || 0) : 0);

  /* 数据范围 */
  const minAge = Math.floor(data[0].age);
  const maxAge = 40;
  const minOvr = Math.max(40, Math.min(...data.map(d => d.ovr)) - 3);
  const maxOvr = Math.min(99, Math.max(...data.map(d => d.ovr)) + 3);
  const padL = 32, padR = 12, padT = 12, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const xOf = age => padL + (age - minAge) / (maxAge - minAge) * plotW;
  const yOf = ovr => padT + (1 - (ovr - minOvr) / (maxOvr - minOvr)) * plotH;

  ctx.clearRect(0, 0, W, H);

  /* 背景网格 */
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let a = Math.ceil(minAge); a <= maxAge; a += 2) {
    const x = xOf(a);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
  }
  for (let o = minOvr; o <= maxOvr; o += 5) {
    const y = yOf(o);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }

  /* 轴标签 */
  ctx.fillStyle = "#7a8294";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  for (let a = Math.ceil(minAge); a <= maxAge; a += 2) {
    ctx.fillText(a, xOf(a), H - 8);
  }
  ctx.textAlign = "right";
  for (let o = minOvr; o <= maxOvr; o += 10) {
    ctx.fillText(o, padL - 4, yOf(o) + 3);
  }

  /* 潜力参考线 */
  if (p0.potential) {
    const py = yOf(p0.potential);
    ctx.strokeStyle = "rgba(255,215,0,0.25)";
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(padL + plotW, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,215,0,0.5)";
    ctx.textAlign = "left";
    ctx.font = "8px sans-serif";
    ctx.fillText("潜力 " + p0.potential, padL + 4, py - 3);
  }

  /* 已过部分（实线） */
  const pastPts = data.filter(d => d.age <= curAge);
  const futPts = data.filter(d => d.age >= curAge);
  if (pastPts.length >= 2) {
    ctx.strokeStyle = "#3fbf7f";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pastPts.forEach((d, i) => { const x = xOf(d.age), y = yOf(d.ovr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  /* 未来部分（虚线） */
  if (futPts.length >= 2) {
    ctx.strokeStyle = "rgba(123,152,200,0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    futPts.forEach((d, i) => { const x = xOf(d.age), y = yOf(d.ovr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* 当前点 */
  const cx = xOf(curAge), cy = yOf(data[Math.max(0, data.findIndex(d => d.age >= curAge))].ovr);
  ctx.fillStyle = "#3fbf7f";
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#3fbf7f";
  ctx.textAlign = "center";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText(p.ovr, cx, cy - 8);
}
function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 7;
}

/* ===== 存档恢复 ===== */
function migrateSave(save) {
  if (!save.record) save.record = { w: 0, l: 0 };
  if (save.gameNo === undefined) save.gameNo = 0;
  if (save.seasonNo === undefined) save.seasonNo = 1;
  /* 旧档：字符串赛程 → 重新生成 82 场对象赛程，已打场次按战绩折算 */
  if (!save.schedule || (save.schedule.length && typeof save.schedule[0] === "string")) {
    const played = save.record.w + save.record.l;
    save.gameNo = played;
    save.schedule = makeSchedule(save);
  }
  if (!save.standings) {
    save.standings = initStandings(save);
    const my = save.team.abbr || "CUS";
    const r = save.standings[my];
    r.w += save.record.w; r.l += save.record.l;
    /* 旧档折算：给其他队补上近似场次数（平摊胜负），避免胜率失真 */
    const gp = save.gameNo;
    TEAMS.forEach(t => {
      if (t.abbr === my) return;
      const s = save.standings[t.abbr];
      const w = Math.round(gp * 0.5 * (0.4 + hash01(t.id, 21) * 0.2));
      s.w = w; s.l = Math.max(0, gp - w);
    });
  }
  if (!save.playerStats) save.playerStats = {};
  if (!save.history) save.history = [];
  /* 修复早期球员库的重复 id 问题：阵容按 id 去重（保留首个），避免交易人数/移除逻辑错乱 */
  if (save.roster) {
    const seenR = new Set();
    save.roster = save.roster.filter(r => {
      if (seenR.has(r.id)) return false;
      seenR.add(r.id);
      return true;
    });
  }
  if (save.aiRosters) {
    Object.keys(save.aiRosters).forEach(a => {
      const seenA = new Set();
      save.aiRosters[a] = save.aiRosters[a].filter(id => {
        if (seenA.has(id)) return false;
        seenA.add(id);
        return true;
      });
    });
  }
  save.ovrAdj = save.ovrAdj || {};
  save.ageAdj = save.ageAdj || {};
  save.morale = save.morale || {};
  Object.keys(save.standings).forEach(a => {
    if (save.standings[a].streak === undefined) save.standings[a].streak = 0;
  });
  /* 合同年限兜底：旧档无 years 则赋默认值；并补齐 NBA 规则合同字段（鸟权/选项/RFA 资格） */
  save.roster.forEach(r => {
    if (r.years === undefined || r.years === null) {
      /* 真实合同年限优先；查不到（生成新秀/边缘球员）再用确定性随机兜底 */
      const ry = realYearsForId(r.id);
      r.years = ry != null ? ry : 1 + Math.floor(hash01(r.id, 41) * 3);
    }
    if (r.birdYears === undefined) {
      /* 老档：按球员年龄推算连续效力年数（19 岁入行，封顶 5 年防过老球员获得顶鸟权） */
      const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
      const p0 = customById.get(r.id) || PLAYERS_RATED.players.find(x => x.id === r.id);
      const age = p0 ? ((p0.age || 24) + ((save.ageAdj || {})[r.id] || 0)) : 24;
      r.birdYears = Math.max(1, Math.min(Math.max(0, age - 19), 5));
    }
    if (r.optionType === undefined) r.optionType = null;
    if (r.optionYear === undefined) r.optionYear = 0;
    if (r.optionSalary === undefined) r.optionSalary = 0;
    if (r.isRookieScale === undefined) r.isRookieScale = false;
    if (r.signedVia === undefined) r.signedVia = "init";
  });
  /* 工资帽升级：旧档 budget ≤ 140 视为陈旧，按球市预设重新设定 */
  if (!save.budget || save.budget < SALARY_CAP - 1) {
    const preset = presetForTeam(myAbbr(save));
    save.budget = preset.amount;
    save.budgetLabel = preset.label + " · " + preset.desc;
  } else if (!save.budgetLabel) {
    save.budgetLabel = "球队预算";
  }
  /* 选秀权兜底：旧档无 draftPicks 则初始化 */
  if (!save.draftPicks || !save.draftPicks.length) {
    initDraftPicks(save);
  }
  /* 旧档兼容：休赛期选秀进行中却没有上赛季战绩快照（旧版 newSeason 未做快照、战绩已清零）时，
     按当前球队实力合成一份近似战绩（越弱战绩越差），使垫底队能拿到符合战绩的高顺位 */
  if (save.pendingDraft && !save.lastStandings) {
    const abbrs = TEAMS.map(t => t.abbr);
    const myAb = myAbbr(save);
    if (abbrs.indexOf(myAb) < 0) abbrs.push(myAb);
    const rows = abbrs.map(a => ({ a, str: strengthOf(save, a) })).sort((x, y) => x.str - y.str);
    const snap = {};
    rows.forEach((r, i) => {
      const w = Math.round(14 + i * (46 / Math.max(1, rows.length - 1)));
      snap[r.a] = { w, l: 82 - w };
    });
    save.lastStandings = snap;
  }
  /* 恢复自定义球员（新秀等）到运行时全局库 */
  if (save.customPlayers) {
    save.customPlayers.forEach(p => {
      if (!PLAYERS_RATED.players.find(x => x.id === p.id)) {
        PLAYERS_RATED.players.push(p);
        if (typeof LEAGUE_EST !== "undefined" && LEAGUE_EST) LEAGUE_EST.set(p.id, estStats(p));
      }
    });
  }
  return save;
}
function writeSave(save) {
  const s = save.slot || state.saveSlot || 1;
  save.slot = s;
  writeSlot(s, save);
}
/* 应用老化修正（ovr/属性等比缩放 + 年龄） */
function applyAdj(p0, save) {
  const oa = (save.ovrAdj && save.ovrAdj[p0.id]) || 0;
  const aa = (save.ageAdj && save.ageAdj[p0.id]) || 0;
  const ma = moraleOvrDelta(moraleOf(save, p0.id));
  const totalAdj = oa + ma;
  if (!totalAdj && !aa) return p0;
  const k = p0.ovr ? (p0.ovr + totalAdj) / p0.ovr : 1;
  const attrs = {}, mgr = {};
  Object.keys(p0.attrs).forEach(key => { attrs[key] = Math.max(20, Math.round(p0.attrs[key] * k)); });
  Object.keys(p0.mgr).forEach(key => { mgr[key] = Math.max(20, Math.round(p0.mgr[key] * k)); });
  return Object.assign({}, p0, { ovr: p0.ovr + totalAdj, age: (p0.age || 24) + aa, attrs, mgr });
}
function moraleColor(m) {
  if (m >= 90) return "#ffd700";
  if (m >= 80) return "#3fbf7f";
  if (m >= 60) return "#4f8ef7";
  if (m >= 40) return "#ffa94d";
  return "#ff6b5e";
}
function moraleHint(m) {
  if (m >= 90) return "状态爆棚";
  if (m >= 80) return "士气高涨";
  if (m >= 60) return "状态平稳";
  if (m >= 40) return "略显低落";
  if (m >= 20) return "士气低迷";
  return "严重不满";
}
function loadMyPlayers(save) {
  /* 优先从存档的自定义球员库查找（新秀等运行时生成的球员） */
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  return save.roster.map(r => {
    const p0 = customById.get(r.id) || byId.get(r.id);
    return p0 ? { p: applyAdj(p0, save), sal: r.salary } : null;
  }).filter(Boolean);
}
function teamLogo(abbr) { return abbr || null; }
function teamName(abbr) {
  if (state.save && abbr === myAbbr(state.save)) return state.save.team.displayName;
  const t = TEAMS.find(x => x.abbr === abbr);
  return t ? t.nameCn : abbr;
}
function confLabel(c) { return c === "E" ? "东部" : "西部"; }
/* 当前比赛信息（常规赛 / 季后赛 / 无） */
function currentGame(save) {
  if (save.playoffs && !save.playoffs.done) {
    /* 自愈：用户系列赛已结束但轮次未推进（遗留卡死）→ 结算 AI 系列赛并推进 */
    if (!save.playoffs.userSeries || save.playoffs.userSeries.done) {
      playoffProgress(save);
      writeSave(save);
    }
    if (save.playoffs.done || !save.playoffs.userSeries) return null;
    const gi = playoffGameInfo(save);
    return Object.assign({ playoff: true }, gi);
  }
  if (save.playoffs && save.playoffs.done) return null;
  if (save.gameNo >= save.schedule.length) return null;
  const s = save.schedule[save.gameNo];
  return { opp: s.opp, home: s.home, label: "常规赛 第" + (save.gameNo + 1) + " 场", playoff: false, seriesScore: null };
}
function restoreFromSave(save) {
  migrateSave(save);
  state.save = save;
  state.mode = save.mode;
  RENDERERS.hub();
  state.stack = [];
  activate("hub");
}

/* ===== 经理室 ===== */
RENDERERS.hub = function () {
  const save = state.save;
  if (!save) { RENDERERS.start(); activate("start"); return; }
  /* 自愈：休赛期选秀未完成（如刷新/中途退出），回到经理室时自动引导回选秀大会 */
  if (save.pendingDraft) {
    if (!state.draft || !state.draft.class_) {
      /* 优先用赛季中球探考察的新秀池，没有才临时生成 */
      const class_ = (save.upcomingDraft && save.upcomingDraft.length) ? save.upcomingDraft : genDraftClass(save);
      state.draft = { class_, pickOrder: null, currentIdx: 0, pickedIds: null, results: null, draftLog: null };
    }
    toast("休赛期选秀尚未完成，请先完成选秀");
    RENDERERS.draft();
    state.stack = [];
    activate("draft");
    return;
  }
  /* 赛季中：确保下一届新秀池已生成（球探功能依赖） */
  ensureUpcomingClass(save);
  const mine = loadMyPlayers(save);
  const top8 = mine.slice().sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 8);
  const ovr = (top8.reduce((s, x) => s + x.p.ovr, 0) / top8.length).toFixed(1);
  const total = Math.round(save.roster.reduce((s, r) => s + r.salary, 0) * 10) / 10;
  const my = myAbbr(save);
  const conf = confOf(my);
  const st = save.standings[my] || { w: 0, l: 0 };
  const myRank = confRanking(save, conf).find(r => r.abbr === my);

  /* 时间线视图：日期头 + 近期赛果 + 即将开赛 */
  const gi = currentGame(save);
  let gameHtml;
  /* 全明星周末待办：第42场已打完但全明星尚未举办 */
  const allStarPending = save.gameNo >= ALL_STAR_TRIGGER_GAME && save.gameNo < save.schedule.length &&
    (!save.allStar || !save.allStar.done || save.allStar.seasonNo !== save.seasonNo);
  if (allStarPending) {
    gameHtml = '<div class="next-game gold">' +
      '<div class="champ-line">🌟 全明星周末来了！</div>' +
      '<div class="ng-meta">赛季中旬休赛期 · 三分大赛 · 扣篮大赛 · 全明星正赛</div>' +
      '<button class="btn btn-primary" id="btn-allstar">前往全明星周末</button></div>';
  } else
  if (save.playoffs && save.playoffs.done) {
    const iWon = save.playoffs.champion === my;
    gameHtml = '<div class="next-game champ-banner' + (iWon ? " gold" : "") + '">' +
      '<div class="champ-line">' + (iWon ? "🏆 你夺得了总冠军！" : "🏆 总冠军：" + esc(teamName(save.playoffs.champion))) + "</div>" +
      '<div class="ng-meta">本赛季：' + esc(save.playoffs.userResult || "") + "</div>" +
      '<button class="btn btn-primary" id="btn-seasonend">查看赛季总结</button></div>';
  } else if (!gi) {
    if (save.playoffs && !save.playoffs.done) {
      gameHtml = '<div class="next-game"><div class="ng-label">你已被淘汰，关注剩余季后赛</div></div>';
    } else {
      gameHtml = '<div class="next-game"><div class="ng-label">暂无比赛安排</div></div>';
    }
  } else if (gi.playoff) {
    /* 季后赛保持原样式 */
    const oppStr = teamStrength(gi.opp).toFixed(1);
    const seriesTag = '<div class="ng-meta series-tag">系列赛 <b>' + gi.seriesScore[0] + " - " + gi.seriesScore[1] + "</b>（4 胜晋级）</div>";
    gameHtml = '<div class="next-game" id="hub-next">' +
      '<div class="ng-label">' + esc(gi.label) + " · " + (gi.home ? "主场" : "客场") + "</div>" +
      '<div class="ng-row">' +
      '    <div class="ng-team">' + (save.team.logoAbbr ? teamLogoHtml(save.team.logoAbbr) : '<div class="th-fb ng-fb">🏀</div>') + "<span>" + esc(save.team.displayName) + "</span></div>" +
      '    <div class="ng-vs">VS</div>' +
      '    <div class="ng-team">' + teamLogoHtml(gi.opp) + "<span>" + esc(teamName(gi.opp)) + "</span></div>" +
      "  </div>" + seriesTag +
      '<div class="ng-meta">对手实力 ' + oppStr + " · " + "★".repeat(stars(parseFloat(oppStr))) + "</div>" +
      '<div class="ng-btns"><button class="btn btn-primary" id="btn-play">开始比赛</button>' +
      '<button class="btn btn-outline" id="btn-quick">快速模拟</button>' +
      '<button class="btn btn-outline" id="btn-quick-round">模拟此轮</button></div>' +
      "</div>";
  } else {
    /* 常规赛：日历视图 + 下一场卡片 */
    const dates = buildSeasonDates(save);
    const total = save.schedule.length;
    const doneN = save.gameNo;
    /* 按 M-D 建比赛索引 */
    const gameByDate = {};
    dates.forEach((d, i) => {
      const pd = parseSeasonDate(d);
      if (!pd) return;
      const key = pd.month + "-" + pd.day;
      (gameByDate[key] = gameByDate[key] || []).push(i);
    });
    const curPD = parseSeasonDate(dates[doneN] || "");
    let viewYear, viewMonth;
    if (hubCalView) {
      viewYear = hubCalView.year;
      viewMonth = hubCalView.month;
    } else if (curPD) {
      viewMonth = curPD.month;
      viewYear = seasonYearForMonth(save, curPD.month);
    } else {
      viewMonth = 10;
      viewYear = SEASON_START_YEAR + save.seasonNo - 1;
    }
    const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay(); /* 0=周日 */
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const WEEKS = ["日", "一", "二", "三", "四", "五", "六"];
    let cells = "";
    for (let i = 0; i < firstDow; i++) cells += '<div class="hcal-cell hcal-empty"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const key = viewMonth + "-" + day;
      const gameIdxs = gameByDate[key] || [];
      const g0 = gameIdxs.length ? save.schedule[gameIdxs[0]] : null;
      let cellCls = "hcal-cell";
      let cellContent = '<div class="hcal-toprow"><span class="hcal-day">' + day + "</span>" +
        (g0 && !g0.home ? '<span class="hcal-away">客</span>' : "") + "</div>";
      if (g0) {
        const oppName = teamName(g0.opp);
        const gi = gameIdxs[0];
        if (g0.result) {
          const win = g0.result === "W";
          cellCls += win ? " win" : " loss";
          cellContent += '<div class="hcal-opp">' + esc(oppName) + "</div>" +
            '<div class="hcal-score">' + g0.score[0] + "-" + g0.score[1] + "</div>";
        } else if (gi === doneN) {
          cellCls += " next";
          cellContent += '<div class="hcal-opp">▶ ' + esc(oppName) + "</div>";
        } else {
          cellContent += '<div class="hcal-opp hcal-future">' + esc(oppName) + "</div>";
        }
      }
      const isToday = curPD && curPD.month === viewMonth && curPD.day === day;
      cells += '<div class="' + cellCls + (isToday ? " today" : "") + '"' +
        (g0 ? ' data-idx="' + gameIdxs[0] + '"' : "") + ">" + cellContent + "</div>";
    }
    /* 下一场预告卡片 */
    const oppStr = teamStrength(gi.opp).toFixed(1);
    const nextDate = dates[save.gameNo] || "";
    gameHtml =
      '<div class="hcal">' +
      '  <div class="hcal-nav">' +
      '    <button class="hcal-nav-btn" id="hcal-prev" aria-label="上个月">‹</button>' +
      '    <div class="hcal-title">' + viewYear + " 年 " + viewMonth + " 月</div>" +
      '    <button class="hcal-nav-btn" id="hcal-next" aria-label="下个月">›</button>' +
      '  </div>' +
      '  <div class="hcal-weekdays">' + WEEKS.map(w => '<div>' + w + '</div>').join("") + "</div>" +
      '  <div class="hcal-grid">' + cells + "</div>" +
      "</div>" +
      '<div class="next-game" id="hub-next">' +
      '  <div class="ng-label">' + esc(nextDate) + " · 第 " + (doneN + 1) + " 场 / " + total + " · " + (gi.home ? "主场" : "客场") + "</div>" +
      '  <div class="ng-row">' +
      '    <div class="ng-team">' + (save.team.logoAbbr ? teamLogoHtml(save.team.logoAbbr) : '<div class="th-fb ng-fb">🏀</div>') + "<span>" + esc(save.team.displayName) + "</span></div>" +
      '    <div class="ng-vs">VS</div>' +
      '    <div class="ng-team">' + teamLogoHtml(gi.opp) + "<span>" + esc(teamName(gi.opp)) + "</span></div>" +
      "  </div>" +
      '  <div class="ng-meta">对手实力 ' + oppStr + " · " + "★".repeat(stars(parseFloat(oppStr))) + "</div>" +
      '  <div class="ng-btns">' +
      '    <button class="btn btn-primary" id="btn-play">开始比赛</button>' +
      '    <button class="btn btn-outline" id="btn-quick">快速模拟</button>' +
      '    <button class="btn btn-outline" id="btn-quick-rest">模拟到季后赛</button>' +
      "  </div>" +
      "</div>";
  }

  /* 季后赛对阵图（嵌入经理室） */
  let bracketHtml = "";
  let bracketRefs = {};
  if (save.playoffs) {
    if (typeof syncUserSeries === "function") syncUserSeries(save);
    const bk = buildPlayoffBracket(save, playoffTab);
    bracketRefs = bk.seriesByRef;
    bracketHtml = '<div class="hub-bracket">' + bk.html + '</div>';
  }

  /* 队内得分领袖 */
  const leaders = mine.map(x => ({ x, ps: save.playerStats[x.p.id] }))
    .filter(o => o.ps && o.ps.g > 0)
    .sort((a, b) => b.ps.pts / b.ps.g - a.ps.pts / a.ps.g).slice(0, 3);
  const leadersHtml = leaders.length
    ? '<div class="hub-leaders">' +
      leaders.map((o, i) =>
        '<div class="r-row" data-id="' + o.x.p.id + '"><span class="r-idx">' + (i + 1) + "</span>" +
        '<div class="ovr-badge ' + ovrClass(o.x.p.ovr) + '">' + o.x.p.ovr + "</div>" +
        '<div class="r-main">' +
        '  <div class="r-name">' + esc(o.x.p.nameCn) + "</div>" +
        '  <div class="r-meta">' + o.ps.g + "场</div>" +
        "</div>" +
        '<div class="r-salary"><b>' + (o.ps.pts / o.ps.g).toFixed(1) + '</b><span>分</span></div>' +
        '<div class="r-salary"><b>' + (o.ps.reb / o.ps.g).toFixed(1) + '</b><span>板</span></div>' +
        '<div class="r-salary"><b>' + (o.ps.ast / o.ps.g).toFixed(1) + '</b><span>助</span></div>' +
        "</div>"
      ).join("") + "</div>"
    : '<div class="empty-stats">暂无本赛季数据</div>';

  /* 历史赛季 */
  const histHtml = (save.history && save.history.length)
    ? '<div class="roster-table">' +
      save.history.slice().reverse().map(h =>
        '<div class="r-row hist-row"><span class="r-idx">S' + h.seasonNo + "</span>" +
        '<div class="r-name">' + h.w + "-" + h.l + " · " + esc(h.result) +
        (h.champion === my ? ' <span class="starter gold">🏆夺冠</span>' : h.champion ? '<span class="r-meta">冠军 ' + esc(teamName(h.champion)) + "</span>" : "") +
        (h.fmvp ? ' <span class="r-meta">FMVP ' + esc(h.fmvp.name) + "</span>" : "") +
        (h.mvp ? ' <span class="r-meta">MVP ' + esc(h.mvp.name) + "</span>" : "") +
        "</div></div>"
      ).join("") + "</div>"
    : '<div class="empty-stats">暂无历史赛季记录</div>';

  /* 球队阵容 HTML */
  const rosterHtml = '<div class="roster-table" id="hub-roster">' +
    mine.sort((a, b) => b.p.ovr - a.p.ovr).map((x, i) => {
      const m = moraleOf(save, x.p.id);
      const inj = save.injuries && save.injuries[x.p.id];
      const injTag = inj ? '<span class="inj-chip">🩹' + inj.name + ' ' + inj.gamesLeft + '场</span>' : "";
      return '<div class="r-row' + (inj ? " r-injured" : "") + '" data-id="' + x.p.id + '">' +
        '  <span class="r-idx">' + (i + 1) + "</span>" +
        '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
        '  <div class="r-main">' +
        '    <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + injTag + "</div>" +
        '    <div class="r-meta"><span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(posLabel(x.p)) + "</span> " + (x.p.age || "-") + '岁 <span class="morale-chip" style="color:' + moraleColor(m) + '">士气' + m + '</span></div>' +
        "  </div>" +
        '  <div class="r-salary">' + fmtM(x.sal) + " · " + (save.roster.find(rr => rr.id === x.p.id) || {}).years + "年</div>" +
        "</div>";
    }).join("") +
    "</div>";

  /* 主内容区：根据 hubTab 决定显示哪个面板 */
  const overviewHtml = gameHtml + bracketHtml +
    '<h3 class="section-h">队内数据王</h3>' + leadersHtml;
  const rosterTabHtml = '<h3 class="section-h">球队阵容（' + mine.length + '人）</h3>' + rosterHtml;
  const historyTabHtml = '<h3 class="section-h">历史赛季</h3>' + histHtml;
  const tabContent = hubTab === "roster" ? rosterTabHtml
    : hubTab === "history" ? historyTabHtml
    : overviewHtml;

  $("#screen-hub").innerHTML =
    '<div class="team-hero">' +
    '  <div class="team-hero-logo">' + (save.team.logoAbbr
      ? teamLogoHtml(save.team.logoAbbr)
      : '<div class="th-fb" style="background:linear-gradient(135deg,hsl(' + Math.floor(hash01(strHash(save.team.displayName), 1) * 360) + ',55%,38%),#141830)">🏀</div>') + "</div>" +
    '  <div class="th-info"><div class="th-name">' + esc(save.team.displayName) + "</div>" +
    '  <div class="th-sub">' + esc(save.team.city) + (save.team.arena ? " · " + esc(save.team.arena) : "") + " · 第 " + save.seasonNo + " 赛季</div></div>" +
    '  <div class="th-stats">' +
    '    <div class="th-stat"><b>' + st.w + "-" + st.l + '</b><span>战绩</span></div>' +
    '    <div class="th-stat"><b>' + (myRank ? confLabel(conf) + myRank.seed : "-") + '</b><span>排名</span></div>' +
    '    <div class="th-stat"><b>' + ovr + '</b><span>总评</span></div>' +
    '    <div class="th-stat"><b>' + fmtM(total) + '</b><span>工资</span></div>' +
    "  </div>" +
    "</div>" +
    '<div class="hub-nav">' +
    '  <button class="mc-btn primary" id="btn-roster-list">球队名单</button>' +
    '  <button class="mc-btn" id="btn-standings">联盟排名</button>' +
    (save.tradeDeadlinePassed
      ? '<button class="mc-btn disabled" disabled>交易截止</button>'
      : '<button class="mc-btn" id="btn-trade">交易中心</button>' +
    '<button class="mc-btn" id="btn-trade-search">交易搜索</button>') +
    '<button class="mc-btn" id="btn-extend">提前续约</button>' +
    '<button class="mc-btn" id="btn-coach">教练战术</button>' +
    '<button class="mc-btn" id="btn-scout">球探中心</button>' +
    '<button class="mc-btn" id="btn-awards">奖项追踪</button>' +
    '<button class="mc-btn" id="btn-retired">退役球员</button>' +
    '<button class="mc-btn" id="btn-hof">名人堂</button>' +
    "</div>" +
    '<div class="hub-tabs">' +
    '  <button class="hub-tab' + (hubTab === "overview" ? " active" : "") + '" data-tab="overview">概览</button>' +
    '  <button class="hub-tab' + (hubTab === "roster" ? " active" : "") + '" data-tab="roster">阵容</button>' +
    '  <button class="hub-tab' + (hubTab === "history" ? " active" : "") + '" data-tab="history">历史</button>' +
    "</div>" +
    '<div class="hub-tab-body">' + tabContent + "</div>" +
    '<button class="link-danger" id="btn-quit">返回主菜单</button>';
  $$("#screen-hub .r-row[data-id]").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });
  const bp = $("#btn-play");
  if (bp) bp.onclick = () => startMatch(false);
  const bq = $("#btn-quick");
  if (bq) bq.onclick = quickSimGame;
  const bqRest = $("#btn-quick-rest");
  if (bqRest) bqRest.onclick = quickSimToPlayoffs;
  const bqRound = $("#btn-quick-round");
  if (bqRound) bqRound.onclick = quickSimRound;
  /* 全明星周末入口 */
  const bas = $("#btn-allstar");
  if (bas) bas.onclick = () => { ensureAllStar(save); go("allstar-hub"); };
  /* 球队名单按钮 → 切到阵容 tab */
  const brl = $("#btn-roster-list");
  if (brl) brl.onclick = () => { hubTab = "roster"; RENDERERS.hub(); };
  /* 主控台日历月份导航 */
  const hprev = $("#hcal-prev");
  if (hprev) hprev.onclick = () => {
    let y, m;
    if (hubCalView) { y = hubCalView.year; m = hubCalView.month; }
    else {
      const pd = parseSeasonDate(currentGameDate(save) || "");
      m = pd ? pd.month : 10;
      y = seasonYearForMonth(save, m);
    }
    m--; if (m < 1) { m = 12; y--; }
    hubCalView = { year: y, month: m };
    RENDERERS.hub();
  };
  const hnext = $("#hcal-next");
  if (hnext) hnext.onclick = () => {
    let y, m;
    if (hubCalView) { y = hubCalView.year; m = hubCalView.month; }
    else {
      const pd = parseSeasonDate(currentGameDate(save) || "");
      m = pd ? pd.month : 10;
      y = seasonYearForMonth(save, m);
    }
    m++; if (m > 12) { m = 1; y++; }
    hubCalView = { year: y, month: m };
    RENDERERS.hub();
  };
  /* 点击日历中的比赛 → 详情弹窗 */
  $$("#screen-hub .hcal-cell[data-idx]").forEach(el => {
    el.onclick = () => openScheduleModal(Number(el.dataset.idx));
  });
  const bs = $("#btn-standings");
  if (bs) bs.onclick = () => go("standings");
  const bt = $("#btn-trade");
  if (bt) bt.onclick = () => go("trade");
  const bts = $("#btn-trade-search");
  if (bts) bts.onclick = () => go("trade-search");
  const be = $("#btn-extend");
  if (be) be.onclick = () => go("extend");
  const ba = $("#btn-awards");
  if (ba) ba.onclick = () => go("awards");
  const bco = $("#btn-coach");
  if (bco) bco.onclick = () => go("coach");
  const bscout = $("#btn-scout");
  if (bscout) bscout.onclick = () => go("scout");
  const br = $("#btn-retired");
  if (br) br.onclick = () => go("retired");
  const bh = $("#btn-hof");
  if (bh) bh.onclick = () => go("hof");
  const bse = $("#btn-seasonend");
  if (bse) bse.onclick = () => go("seasonend");
  /* 经理室子tab切换 */
  $$("#screen-hub .hub-tab").forEach(tab => {
    tab.onclick = () => { hubTab = tab.dataset.tab; RENDERERS.hub(); };
  });
  /* 经理室季后赛对阵图交互 */
  $$("#screen-hub .po-tab").forEach(tab => {
    tab.onclick = () => { playoffTab = tab.dataset.tab; RENDERERS.hub(); };
  });
  /* 点击轮次标题 → 折叠/展开切换 */
  $$("#screen-hub .po-round-header[data-toggle]").forEach(h => {
    h.onclick = () => {
      const key = h.dataset.toggle;
      const cur = poCollapsed[key];
      poCollapsed[key] = cur === undefined ? true : !cur;
      RENDERERS.hub();
    };
  });
  $$("#screen-hub .br-series[data-ref]").forEach(card => {
    card.onclick = () => {
      const ser = bracketRefs[card.dataset.ref];
      if (ser) openSeriesModal(ser, card.dataset.round);
    };
  });
  $("#btn-quit").onclick = () => {
    /* 返回主菜单但保留存档（多槽位，删除在开始页单独操作） */
    if (state.save) writeSave(state.save);
    state.save = null;
    /* 清理运行时全局库：移除之前 push 进去的自定义球员（新秀等），恢复原始数据 */
    if (window._originalPlayers) {
      PLAYERS_RATED.players = window._originalPlayers.slice();
    }
    LEAGUE_EST = null; /* 重置联盟估算缓存 */
    toast("已返回主菜单（存档已保留）");
    RENDERERS.start(); activate("start");
  };
};

/* ===== 比赛 ===== */
const DEF_LABELS = { man: "人盯人", zone: "联防", double: "包夹", press: "紧逼" };
const PACE_LABELS = { fast: "快攻", normal: "平衡", slow: "阵地" };
const FOCUS_LABELS = { inside: "内线强攻", balanced: "内外均衡", outside: "外线三分" };
state.match = { sim: null, timer: null, speed: 1, paused: true, over: false, feedCount: 0 };

/* 节次标签：Q1-Q4 / OT1-OTn（加时赛） */
function periodLabel(q) { return q <= 4 ? "Q" + q : "OT" + (q - 4); }
function buildSimFor(gi) {
  const save = state.save;
  /* 伤停球员不参赛 */
  const mine = loadMyPlayers(save).filter(x => !isInjured(save, x.p.id)).map(x => x.p);
  const oppT = TEAMS.find(x => x.abbr === gi.opp);
  const oppRoster = (save.aiRosters && save.aiRosters[gi.opp]) || playersByTeam(gi.opp).map(p => p.id);
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  const opp = oppRoster
    .filter(id => !isInjured(save, id))
    .map(id => { const p0 = customById.get(id) || byId.get(id); return p0 ? applyAdj(p0, save) : null; }).filter(Boolean);
  const home = { name: save.team.displayName, short: "", abbr: save.team.logoAbbr, players: mine };
  /* 教练设置：轮换覆盖 + 战术 */
  const ov = buildCoachOverride(save, mine);
  if (ov) home.rotationOverride = ov;
  const sim = new GameSim(
    home,
    { name: oppT.nameCn, short: "", abbr: gi.opp, players: opp }
  );
  const c = save.coach || {};
  if (c.pace) sim.setTactic(0, "pace", c.pace);
  if (c.def) sim.setTactic(0, "def", c.def);
  if (c.focus) sim.setTactic(0, "focus", c.focus);
  return sim;
}

/* 教练轮换覆盖：由 save.coach.roles 构建 { rotationIds, starters, targetMin }，无有效设置返回 null */
function buildCoachOverride(save, players) {
  const c = save.coach;
  if (!c || !c.roles) return null;
  const ids = players.map(p => p.id);
  const roleOf = id => c.roles[id] || "auto";
  const starters = ids.filter(id => roleOf(id) === "starter");
  if (starters.length !== 5) return null;   /* 首发必须恰好 5 人，否则交回引擎自动安排 */
  const sixth = ids.filter(id => roleOf(id) === "sixth");
  /* 其余按 OVR 排序作为轮换/板凳，弃用球员不进轮换 */
  const benchPool = ids
    .filter(id => !starters.includes(id) && roleOf(id) !== "dnp")
    .sort((a, b) => {
      const pa = players.find(p => p.id === a), pb = players.find(p => p.id === b.id);
      return (pb ? pb.ovr : 0) - (pa ? pa.ovr : 0);
    });
  /* 第六人排板凳首位 */
  const orderedBench = [];
  if (sixth.length && benchPool.includes(sixth[0])) orderedBench.push(sixth[0]);
  benchPool.forEach(id => { if (!orderedBench.includes(id)) orderedBench.push(id); });
  const rotationIds = starters.concat(orderedBench.slice(0, 5));
  /* 目标分钟：5 首发 33 分钟，第六人 27，其余 18/14/9/5（合计约 240 分钟） */
  const benchMin = [27, 18, 14, 9, 5];
  const targetMin = {};
  starters.forEach(id => { targetMin[id] = 33; });
  orderedBench.slice(0, 5).forEach((id, i) => { targetMin[id] = benchMin[i]; });
  return { rotationIds, starters, targetMin };
}
function startMatch(quick) {
  const save = state.save;
  const gi = currentGame(save);
  if (!gi) return;
  const sim = buildSimFor(gi);
  state.match = { sim, timer: null, speed: 1, paused: true, over: false, feedCount: 0, gi };
  RENDERERS.match();
  activate("match");
  $("#m-round").textContent = gi.label + " · " + (gi.home ? "主场" : "客场");
  renderMatchBoard();
  pushFeed({ t: "period", text: "—— 比赛开始 · 第1节 ——", score: [0, 0] }, true);
  if (quick) {
    sim.skipToEnd();
    state.match.over = true;
    drainFeed();
    renderMatchBoard();
    showPost();
  } else {
    toast("提示：暂停中可调整战术与换人");
  }
}
/* ===== 比赛模拟动画 =====
   单场快速模拟：弹出 overlay，逐节揭示比分（Q1→Q2→Q3→Q4→全场） */
function quickSimGame() {
  const save = state.save;
  const gi = currentGame(save);
  if (!gi) return;
  runSimAnimation(save, 1, { single: true });
}

/* 模拟到季后赛：自动模拟剩余所有常规赛，每场带过渡动画 */
function quickSimToPlayoffs() {
  const save = state.save;
  const remaining = save.schedule.length - save.gameNo;
  if (remaining <= 0) { toast("常规赛已结束"); return; }
  runSimAnimation(save, remaining, { single: false, mode: "regular" });
}

/* 模拟此轮：自动模拟当前季后赛系列赛剩余比赛（直至某方 4 胜） */
function quickSimRound() {
  const save = state.save;
  const ps = save.playoffs;
  if (!ps || ps.done || !ps.userSeries) { toast("当前无进行中的系列赛"); return; }
  const ser = ps.userSeries;
  if (ser.done) { toast("当前系列赛已结束"); return; }
  /* 剩余最多场次：7 场制，减去已打场数 */
  const maxGames = 7 - (ser.wa + ser.wb);
  runSimAnimation(save, maxGames, {
    single: false,
    mode: "round",
    stopCheck: () => ser.done
  });
}

/* 动画核心：逐场模拟，每场逐节揭示比分
   totalGames: 要模拟的总场数
   opts.single: true=单场（结束后停留更久），false=批量（自动推进） */
function runSimAnimation(save, totalGames, opts) {
  opts = opts || {};
  /* 关闭旧 overlay */
  const old = $("#sim-anim");
  if (old) old.remove();

  const myName = save.team.displayName;
  const myLogo = save.team.logoAbbr ? teamLogoHtml(save.team.logoAbbr) : '<div class="th-fb">🏀</div>';
  let wins = 0, losses = 0, idx = 0, stopped = false, instantSkip = false;
  const recent = []; /* 最近赛果 [{opp, win, sc}] */

  const ov = document.createElement("div");
  ov.id = "sim-anim";
  ov.className = "sim-anim-overlay";
  ov.innerHTML =
    '<div class="sim-anim-box">' +
      '<div class="sa-header">' +
        '<div class="sa-title">比赛模拟中</div>' +
        '<div class="sa-progress"><b id="sa-idx">0</b> / ' + totalGames + ' 场</div>' +
        '<div class="sa-record"><span class="sa-w">胜 <b id="sa-wins">0</b></span><span class="sa-l">负 <b id="sa-losses">0</b></span></div>' +
      '</div>' +
      '<div class="sa-stage" id="sa-stage">' +
        '<div class="sa-series" id="sa-series"></div>' +
        '<div class="sa-teams">' +
          '<div class="sa-team home">' + myLogo + '<span>' + esc(myName) + '</span></div>' +
          '<div class="sa-vs">VS</div>' +
          '<div class="sa-team away" id="sa-opp"><span>对手</span></div>' +
        '</div>' +
        '<div class="sa-score" id="sa-score">' +
          '<span class="sa-s-home" id="sa-sh">0</span>' +
          '<span class="sa-dash">-</span>' +
          '<span class="sa-s-away" id="sa-sa">0</span>' +
        '</div>' +
        '<div class="sa-quarters" id="sa-quarters"></div>' +
        '<div class="sa-result" id="sa-result"></div>' +
      '</div>' +
      '<div class="sa-recent" id="sa-recent"></div>' +
      '<div class="sa-actions">' +
        (opts.single ? "" : '<button class="btn btn-outline sa-skip" id="sa-skip">⏩ 立即完成剩余</button>') +
        '<button class="btn btn-outline sa-stop" id="sa-stop">' + (opts.single ? "关闭" : "停止模拟") + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  const $id = id => document.getElementById(id);
  const stage = $id("sa-stage");
  const oppEl = $id("sa-opp");
  const shEl = $id("sa-sh");
  const saEl = $id("sa-sa");
  const quartersEl = $id("sa-quarters");
  let qEls = [];
  const resultEl = $id("sa-result");
  const idxEl = $id("sa-idx");
  const winsEl = $id("sa-wins");
  const lossesEl = $id("sa-losses");
  const recentEl = $id("sa-recent");
  const seriesEl = $id("sa-series");
  const titleEl = ov.querySelector(".sa-title");

  function closeOverlay() {
    ov.classList.add("closing");
    setTimeout(() => ov.remove(), 250);
  }

  function finishAll() {
    closeOverlay();
    /* 全明星周末触发：跳转到全明星中心 */
    if (state._allStarPending) {
      state._allStarPending = false;
      ensureAllStar(save);
      go("allstar-hub");
      return;
    }
    /* 结算跳转 */
    if (state._regularJustEnded) {
      state._regularJustEnded = false;
      RENDERERS["regular-end"]();
      state.stack = [];
      activate("regular-end");
      return;
    }
    if (save.playoffs && save.playoffs.done) { go("seasonend"); return; }
    RENDERERS.hub(); activate("hub", true);
  }

  /* 立即跳过：无动画模拟剩余所有场
     - 常规赛模式：到达季后赛即止
     - 系列赛模式：该轮系列赛分出胜负即止 */
  function skipRest() {
    instantSkip = true;
    while (idx < totalGames) {
      const r = simulateOne(save);
      if (!r) break;
      if (opts.mode === "regular" && r.playoff) break;
      idx++;
      if (r.win) wins++; else losses++;
      recent.push(r);
      if (recent.length > 8) recent.shift();
      if (opts.mode === "round" && opts.stopCheck && opts.stopCheck()) break;
      /* 全明星周末触发：暂停批量模拟 */
      if (state._allStarPending) break;
    }
    finishAll();
  }

  $id("sa-stop").onclick = () => {
    stopped = true;
    /* 停止时不关闭，让当前场动画跑完后退出 */
    if (instantSkip) return;
    closeOverlay();
    if (state._allStarPending) {
      state._allStarPending = false;
      ensureAllStar(save);
      go("allstar-hub");
      return;
    }
    if (state._regularJustEnded) {
      state._regularJustEnded = false;
      RENDERERS["regular-end"]();
      state.stack = [];
      activate("regular-end");
    } else if (save.playoffs && save.playoffs.done) {
      go("seasonend");
    } else {
      RENDERERS.hub(); activate("hub", true);
    }
  };
  const skipBtn = $id("sa-skip");
  if (skipBtn) skipBtn.onclick = skipRest;

  /* 数字滚动动画：从 start → end，duration ms */
  function countUp(el, start, end, duration) {
    const t0 = Date.now();
    function tick() {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const v = Math.round(start + (end - start) * t);
      el.textContent = v;
      if (t < 1) requestAnimationFrame(tick);
    }
    tick();
  }

  /* 模拟一场并返回结果（常规赛+季后赛通用；批量模式遇季后赛由调用方停止） */
  function simulateOne(sv) {
    const gi = currentGame(sv);
    if (!gi) return null;
    const sim = buildSimFor(gi);
    sim.skipToEnd();
    const sc = sim.score();
    const win = sc[0] > sc[1];
    completeGame(sim, win);
    /* 季后赛：赛后读取更新后的系列赛大比分 */
    let postScore = null;
    if (gi.playoff && sv.playoffs && sv.playoffs.userSeries) {
      postScore = [sv.playoffs.userSeries.wa, sv.playoffs.userSeries.wb];
    }
    return {
      opp: gi.opp, home: gi.home, win, sc,
      playoff: !!gi.playoff,
      seriesScore: gi.seriesScore || null,
      postSeriesScore: postScore,
      label: gi.label || "",
      quarters: sim.quarterScores || [[sc[0], sc[1]]]
    };
  }

  /* 跑一场的动画流程：显示对手 → Q1→Q4 逐节亮分 → 胜负停留 → 下一场 */
  function playNextGame() {
    if (stopped || idx >= totalGames) { finishAll(); return; }
    const r = simulateOne(save);
    if (!r) { finishAll(); return; }
    /* 常规赛批量模式（模拟到季后赛）到达季后赛即止 */
    if (!opts.single && opts.mode === "regular" && r.playoff) { finishAll(); return; }
    /* 系列赛模式：若该场后系列赛已结束，仍播完本场动画再退出 */
    const seriesDone = opts.mode === "round" && opts.stopCheck && opts.stopCheck();
    idx++;
    if (r.win) wins++; else losses++;
    recent.push({ opp: r.opp, win: r.win, sc: r.sc });
    if (recent.length > 8) recent.shift();

    /* 更新顶部信息 */
    idxEl.textContent = idx;
    winsEl.textContent = wins;
    lossesEl.textContent = losses;
    resultEl.textContent = "";
    resultEl.className = "sa-result";
    oppEl.innerHTML = teamLogoHtml(r.opp) + "<span>" + esc(teamName(r.opp)) + "</span>";
    stage.classList.remove("win", "loss", "series-clinched");
    /* 季后赛：显示系列赛比分与轮次标签（优先用赛后大比分） */
    if (r.playoff) {
      titleEl.textContent = "季后赛模拟中";
      const ss = r.postSeriesScore || r.seriesScore;
      const clinched = seriesDone ? ' <span class="sa-clinched">' +
        (ss && ss[0] === 4 ? "🎉 晋级下一轮" : "系列赛结束") + "</span>" : "";
      seriesEl.innerHTML = esc(r.label || "季后赛") + ' · 系列赛 <b>' +
        ss[0] + " - " + ss[1] + '</b> <small>（4 胜晋级）</small>' + clinched;
      seriesEl.style.display = "";
    } else {
      titleEl.textContent = "比赛模拟中";
      seriesEl.innerHTML = esc(r.label || ("常规赛 第 " + (save.gameNo) + " 场"));
      seriesEl.style.display = "";
    }

    /* 重置比分，按本场节数动态生成节次芯片（Q1-Q4 + 加时 OT1...） */
    shEl.textContent = "0"; saEl.textContent = "0";
    quartersEl.innerHTML = r.quarters.map((_, qi) =>
      '<span class="sa-q' + (qi >= 4 ? " ot" : "") + '" data-q="' + (qi + 1) + '">' +
      (qi < 4 ? "Q" + (qi + 1) : "OT" + (qi - 3)) + '</span>'
    ).join("");
    qEls = quartersEl.querySelectorAll(".sa-q");

    /* 逐节揭示：quarters 为累计比分 */
    const qs = r.quarters;
    let qIdx = 0;
    const Q_DELAY = opts.single ? 380 : 320; /* 每节间隔 ms */

    function revealQuarter() {
      if (instantSkip) return;
      if (qIdx >= qs.length) {
        /* 全场结束：显示胜负（加时赛标注） */
        stage.classList.add(r.win ? "win" : "loss");
        if (seriesDone) stage.classList.add("series-clinched");
        const otTag = qs.length > 4 ? "（加时" + (qs.length - 4) + "）" : "";
        resultEl.textContent = r.win ? "✓ 胜利" + otTag : "✗ 失利" + otTag;
        resultEl.classList.add(r.win ? "win" : "loss");
        /* 更新最近赛果 */
        renderRecent();
        /* 单场/系列赛终结停留久一点，批量自动推进 */
        const wait = (opts.single || seriesDone) ? 1100 : 650;
        setTimeout(() => {
          if (idx >= totalGames || state._regularJustEnded || state._allStarPending || seriesDone) finishAll();
          else playNextGame();
        }, wait);
        return;
      }
      /* 高亮当前节 */
      if (qEls[qIdx]) qEls[qIdx].classList.add("cur");
      const prev = qIdx > 0 ? qs[qIdx - 1] : [0, 0];
      const cur = qs[qIdx];
      countUp(shEl, prev[0], cur[0], Q_DELAY - 60);
      countUp(saEl, prev[1], cur[1], Q_DELAY - 60);
      setTimeout(() => {
        if (qEls[qIdx]) { qEls[qIdx].classList.remove("cur"); qEls[qIdx].classList.add("on"); }
        qIdx++;
        revealQuarter();
      }, Q_DELAY);
    }
    /* 显示对手后短暂停留再开始揭分 */
    setTimeout(revealQuarter, 220);
  }

  function renderRecent() {
    recentEl.innerHTML = recent.slice().reverse().map(x =>
      '<span class="sr-chip ' + (x.win ? "w" : "l") + '">' +
      (x.win ? "W " : "L ") + x.sc[0] + "-" + x.sc[1] + " " + esc(teamName(x.opp)) +
      '</span>'
    ).join("");
  }

  /* 启动 */
  playNextGame();
}
/* 完场结算：数据累计 + 战绩/排名 + 联盟轮次 + 季后赛推进 + 伤病 */
function completeGame(sim, win) {
  const save = state.save;
  const my = myAbbr(save);
  sim.teams[0].box.forEach((b, id) => {
    const ps = save.playerStats[id] || (save.playerStats[id] = { g: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 });
    ps.g++; ps.pts += b.pts; ps.reb += b.reb; ps.ast += b.ast; ps.stl += b.stl; ps.blk += b.blk; ps.tov += b.tov;
    ps.fgm += b.fgm; ps.fga += b.fga; ps.tpm += b.tpm; ps.tpa += b.tpa; ps.ftm += b.ftm; ps.fta += b.fta;
  });
  updateMoraleAfterGame(save, sim, win);
  /* 伤病：先恢复已有伤病，再随机新伤病 */
  const recovered = tickInjuries(save);
  const playedIds = [];
  sim.teams.forEach(t => t.box.forEach((_, id) => playedIds.push(id)));
  rollInjuries(save, playedIds);
  /* 提示伤病信息 */
  if (save.injuryLog && save.injuryLog.length) {
    const last = save.injuryLog[save.injuryLog.length - 1];
    toast("🩹 " + last.name + " " + last.injury + "，预计缺阵 " + last.games + " 场");
  }
  recovered.forEach(r => toast("✓ " + r.name + " 伤愈复出"));
  /* 提取双方球员技术统计（常规赛/季后赛通用） */
  const extractBox = side => side.all.map(p => {
    const b = side.box.get(p.id);
    return b ? { id: p.id, name: p.nameCn, pts: b.pts, reb: b.reb, ast: b.ast, stl: b.stl, blk: b.blk, tov: b.tov, fgm: b.fgm, fga: b.fga, tpm: b.tpm, tpa: b.tpa, ftm: b.ftm, fta: b.fta } : null;
  }).filter(x => x && (x.pts || x.reb || x.ast || x.stl || x.blk));
  if (save.playoffs && !save.playoffs.done) {
    const ser = save.playoffs.userSeries;
    if (ser) {
      if (!ser.games) ser.games = [];
      const sc = sim.score();
      /* 归一化：用户恒为 a 侧，比分存 [myScore, oppScore]，aWin 表示用户赢 */
      ser.games.push({ score: [sc[0], sc[1]], aWin: win, box: { my: extractBox(sim.teams[0]), opp: extractBox(sim.teams[1]) } });
      if (win) ser.wa++; else ser.wb++;
    }
    playoffProgress(save);
  } else if (!save.playoffs) {
    const g = save.schedule[save.gameNo];
    if (g) {
      g.result = win ? "W" : "L"; g.score = sim.score().slice();
      /* 存储每节累计比分，用于赛程点阵详情 */
      g.quarters = (sim.quarterScores || []).map(s => s.slice());
      g.box = { my: extractBox(sim.teams[0]), opp: extractBox(sim.teams[1]) };
    }
    if (win) { save.record.w++; save.standings[my].w++; } else { save.record.l++; save.standings[my].l++; }
    save.gameNo++;
    /* 交易截止日：第 53 场结束后禁用交易（约赛季 65%，对齐 NBA 现实 2 月中旬） */
    if (save.gameNo === TRADE_DEADLINE_GAME && !save.tradeDeadlinePassed) {
      save.tradeDeadlinePassed = true;
      toast("🚫 交易截止日已过，本赛季不再允许交易");
    }
    simLeagueRound(save);
    /* 全明星周末：第 42 场打完后触发（赛季中旬，对应 7 天 gap） */
    if (save.gameNo === ALL_STAR_TRIGGER_GAME && (!save.allStar || !save.allStar.done || save.allStar.seasonNo !== save.seasonNo)) {
      state._allStarPending = true;
    }
    if (save.gameNo >= save.schedule.length) {
      buildPlayoffs(save);
      state._regularJustEnded = true;
    }
  }
  /* 球探考察随比赛推进 */
  tickScouting(save);
  writeSave(save);
}
RENDERERS.match = function () {
  const sim = state.match.sim;
  $("#screen-match").innerHTML =
    '<div class="m-round" id="m-round"></div>' +
    '<div class="m-scoreboard">' +
    '  <div class="m-team"><div class="m-logo" id="m-logo0"></div><div class="m-name" id="m-name0"></div></div>' +
    '  <div class="m-center"><div class="m-score" id="m-score">0 - 0</div>' +
    '  <div class="m-clock" id="m-clock">Q1 12:00</div></div>' +
    '  <div class="m-team"><div class="m-logo" id="m-logo1"></div><div class="m-name" id="m-name1"></div></div>' +
    "</div>" +
    '<div class="m-controls">' +
    '  <button class="mc-btn" id="mc-play">▶ 开球</button>' +
    '  <button class="mc-btn" id="mc-speed">速度 x1</button>' +
    '  <button class="mc-btn gold" id="mc-timeout">暂停 4</button>' +
    '  <button class="mc-btn" id="mc-sub">换人</button>' +
    '  <button class="mc-btn" id="mc-stats">📊 实时数据</button>' +
    "</div>" +
    '<div class="m-tactics">' +
    '  <label>防守 <select id="m-def">' +
    Object.keys(DEF_LABELS).map(k => '<option value="' + k + '">' + DEF_LABELS[k] + "</option>").join("") +
    "  </select></label>" +
    '  <label>节奏 <select id="m-pace">' +
    Object.keys(PACE_LABELS).map(k => '<option value="' + k + '">' + PACE_LABELS[k] + "</option>").join("") +
    "  </select></label>" +
    '  <button class="mc-btn small" id="mc-skip">跳过 ▶▶</button>' +
    "</div>" +
    '<div class="m-feed" id="m-feed"></div>' +
    '<div class="m-modal hidden" id="m-submodal">' +
    '  <div class="m-modal-box">' +
    '    <h3>换人（各点选一名）</h3>' +
    '    <div class="m-sub-cols">' +
    '      <div><b>场上</b><div id="sub-court"></div></div>' +
    '      <div><b>替补</b><div id="sub-bench"></div></div>' +
    "    </div>" +
    '    <div class="m-modal-actions"><button class="btn btn-outline" id="sub-cancel">关闭</button>' +
    '    <button class="btn btn-primary" id="sub-do" disabled>确认换人</button></div>' +
    "  </div>" +
    "</div>" +
    '<div class="m-modal hidden" id="m-statsmodal">' +
    '  <div class="m-modal-box m-stats-box">' +
    '    <h3>📊 实时数据</h3>' +
    '    <div id="stats-body"></div>' +
    '    <div class="m-modal-actions"><button class="btn btn-outline" id="stats-close">关闭</button>' +
    '    <button class="btn btn-primary" id="stats-refresh">🔄 刷新</button></div>' +
    "  </div>" +
    "</div>";
  const save = state.save;
  $("#m-name0").textContent = save.team.displayName;
  $("#m-name1").textContent = sim.teams[1].info.name;
  $("#m-logo0").innerHTML = save.team.logoAbbr ? teamLogoHtml(save.team.logoAbbr) : "🏀";
  $("#m-logo1").innerHTML = teamLogoHtml(sim.teams[1].info.abbr);

  $("#mc-play").onclick = togglePause;
  $("#mc-speed").onclick = () => {
    const m = state.match;
    m.speed = m.speed === 1 ? 2 : m.speed === 2 ? 4 : 1;
    $("#mc-speed").textContent = "速度 x" + m.speed;
    if (!m.paused) { stopTimer(); startTimer(); }
  };
  $("#mc-timeout").onclick = () => {
    const m = state.match;
    if (m.over) return;
    if (m.sim.timeout(0)) {
      setPause(true);
      pushFeed({ t: "timeout", text: "【战术暂停】你叫了暂停，重整士气（剩 " + m.sim.teams[0].timeouts + " 次）" });
      renderMatchBoard();
    } else toast("暂停次数已用完");
  };
  $("#mc-sub").onclick = () => { if (!state.match.over) { setPause(true); openSubModal(); } };
  $("#mc-stats").onclick = () => { setPause(true); openStatsModal(); };
  $("#mc-skip").onclick = () => {
    const m = state.match;
    if (m.over) return;
    stopTimer();
    pushFeed({ t: "period", text: "—— 快进中 ——" });
    m.sim.skipToEnd();
    m.over = true;
    drainFeed();
    renderMatchBoard();
    showPost();
  };
  $("#m-def").onchange = e => { sim.setTactic(0, "def", e.target.value); pushFeed({ t: "tac", text: "【战术】防守切换为 " + DEF_LABELS[e.target.value] }); };
  $("#m-pace").onchange = e => { sim.setTactic(0, "pace", e.target.value); pushFeed({ t: "tac", text: "【战术】节奏切换为 " + PACE_LABELS[e.target.value] }); };
  $("#sub-cancel").onclick = () => $("#m-submodal").classList.add("hidden");
  $("#sub-do").onclick = doSub;
  $("#stats-close").onclick = () => $("#m-statsmodal").classList.add("hidden");
  $("#stats-refresh").onclick = () => renderStatsBody();
  $("#m-statsmodal").onclick = e => { if (e.target.id === "m-statsmodal") $("#m-statsmodal").classList.add("hidden"); };
  setPause(true);
};
let subSel = { out: null, in: null };
function openSubModal() {
  subSel = { out: null, in: null };
  const sim = state.match.sim;
  const mine = sim.teams[0];
  const render = (arr, el, kind) => {
    el.innerHTML = arr.map(id => {
      const p = sim._p(mine, id);
      const e = Math.round(mine.energy.get(id));
      return '<div class="sub-row ' + (kind) + '" data-id="' + id + '"><span class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + "</span>" +
        '<span class="sub-name">' + esc(p.nameCn) + '</span><span class="sub-e e' + (e >= 70 ? "hi" : e >= 45 ? "mid" : "lo") + '">' + e + "%</span></div>";
    }).join("");
    $$((kind === "court" ? "#sub-court " : "#sub-bench ") + ".sub-row").forEach(row => {
      row.onclick = () => {
        $$((kind === "court" ? "#sub-court " : "#sub-bench ") + ".sub-row").forEach(x => x.classList.remove("sel"));
        row.classList.add("sel");
        subSel[kind === "court" ? "out" : "in"] = Number(row.dataset.id);
        $("#sub-do").disabled = !(subSel.out && subSel.in);
      };
    });
  };
  render(mine.court, $("#sub-court"), "court");
  render(mine.all.filter(p => !mine.court.includes(p.id)).map(p => p.id), $("#sub-bench"), "bench");
  $("#m-submodal").classList.remove("hidden");
}
function doSub() {
  const sim = state.match.sim;
  if (sim.sub(0, subSel.out, subSel.in)) {
    pushFeed({ t: "sub", text: "【换人】" + sim._p(sim.teams[0], subSel.in).nameCn + " 上场，" + sim._p(sim.teams[0], subSel.out).nameCn + " 下场" });
    $("#m-submodal").classList.add("hidden");
  }
}
/* ===== 实时数据弹窗：双方球员 box score ===== */
function openStatsModal() { renderStatsBody(); $("#m-statsmodal").classList.remove("hidden"); }
function renderStatsBody() {
  const sim = state.match && state.match.sim;
  if (!sim) return;
  const fmtMin = sec => Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  const HEAD = '<div class="box-h"><span class="bx-name">球员</span><span>MIN</span><span>PTS</span><span>REB</span><span>AST</span><span>STL</span><span>BLK</span><span>TOV</span><span>FG</span><span>3PT</span><span>FT</span></div>';
  const renderSide = (side, label) => {
    const rows = side.all.map(p => {
      const b = side.box.get(p.id) || { pts:0,reb:0,ast:0,stl:0,blk:0,tov:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,sec:0 };
      const starter = side.court.includes(p.id);
      return '<div class="box-row' + (starter ? " starter" : "") + '">' +
        '<span class="bx-name">' + esc(p.nameCn) + (starter ? ' <i class="bx-st">首</i>' : "") + '</span>' +
        '<span>' + fmtMin(b.sec) + '</span>' +
        '<span><b>' + b.pts + '</b></span>' +
        '<span>' + b.reb + '</span>' +
        '<span>' + b.ast + '</span>' +
        '<span>' + b.stl + '</span>' +
        '<span>' + b.blk + '</span>' +
        '<span>' + b.tov + '</span>' +
        '<span>' + b.fgm + '-' + b.fga + '</span>' +
        '<span>' + b.tpm + '-' + b.tpa + '</span>' +
        '<span>' + b.ftm + '-' + b.fta + '</span>' +
      '</div>';
    }).join("");
    return '<div class="box-team"><h4>' + esc(label) + '</h4>' + HEAD + rows + '</div>';
  };
  const sc = sim.score();
  const body =
    '<div class="box-score-summary">' + esc(sim.teams[0].info.name) + ' <b>' + sc[0] + '</b> : <b>' + sc[1] + '</b> ' + esc(sim.teams[1].info.name) + ' · ' + periodLabel(sim.q) + ' ' + Math.max(0, Math.floor(sim.clock / 60)) + ":" + String(Math.floor(Math.max(0, sim.clock) % 60)).padStart(2, "0") + '</div>' +
    renderSide(sim.teams[0], sim.teams[0].info.name) +
    renderSide(sim.teams[1], sim.teams[1].info.name);
  $("#stats-body").innerHTML = body;
}
function startTimer() {
  const m = state.match;
  m.timer = setInterval(matchTick, 950 / m.speed);
}
function stopTimer() { clearInterval(state.match.timer); state.match.timer = null; }
function togglePause() {
  const m = state.match;
  if (m.over) return;
  setPause(!m.paused);
}
function setPause(p) {
  const m = state.match;
  m.paused = p;
  $("#mc-play").textContent = p ? "▶ 继续" : "⏸ 暂停";
  if (p) stopTimer(); else if (!m.over) startTimer();
}
function matchTick() {
  const m = state.match;
  if (m.over) { stopTimer(); return; }
  const res = m.sim.next();
  res.events.forEach(ev => pushFeed(ev, true));
  renderMatchBoard();
  if (res.over) { m.over = true; stopTimer(); setPause(true); showPost(); }
}
function renderMatchBoard() {
  const m = state.match;
  if (!m.sim) return;
  const sc = m.sim.score();
  $("#m-score").textContent = sc[0] + " - " + sc[1];
  const clock = Math.max(0, m.sim.clock);
  $("#m-clock").textContent = periodLabel(m.sim.q) + " " + Math.floor(clock / 60) + ":" + String(Math.floor(clock % 60)).padStart(2, "0");
  $("#mc-timeout").textContent = "暂停 " + m.sim.teams[0].timeouts;
}
const FEED_ICONS = { score: "🏀", miss: "✗", reb: "↺", to: "⚠", ft: "🎯", blk: "🛡", sub: "⇄", period: "⏱", timeout: "T", tac: "📋", final: "🏁" };
function pushFeed(ev, board) {
  const feed = $("#m-feed");
  if (!feed) return;
  const cls = ev.t === "score" || ev.t === "ft" ? "good" : ev.t === "period" || ev.t === "final" ? "sep" : ev.t === "to" || ev.t === "blk" ? "warn" : "dim";
  const mine = ev.side === 0;
  const scoreHtml = board && ev.score ? '<span class="f-score">' + ev.score[0] + "-" + ev.score[1] + "</span>"
    : board && (ev.t === "score" || ev.t === "ft") ? '<span class="f-score">' + state.match.sim.score()[0] + "-" + state.match.sim.score()[1] + "</span>" : "";
  feed.insertAdjacentHTML("afterbegin",
    '<div class="feed-item ' + cls + (ev.t === "score" && mine ? " mine" : "") + '">' +
    '<span class="f-icon">' + (FEED_ICONS[ev.t] || "·") + "</span>" +
    '<span class="f-text">' + esc(ev.text) + "</span>" + scoreHtml + "</div>");
  while (feed.children.length > 90) feed.removeChild(feed.lastChild);
  if (board) renderMatchBoard();
}
function drainFeed() {
  /* 快进后只保留关键事件摘要 */
  const feed = $("#m-feed");
  const sim = state.match.sim;
  const sc = sim.score();
  feed.innerHTML = "";
  pushFeed({ t: "final", text: "全场比赛结束：" + sim.teams[0].info.name + " " + sc[0] + " - " + sc[1] + " " + sim.teams[1].info.name });
}
/* ===== 赛后统计 ===== */
function boxRows(side) {
  const rows = side.rotation.map(id => {
    const p = side.all.find(x => x.id === id);
    return p ? { p, b: side.box.get(id) } : null;
  }).filter(Boolean);
  return rows.sort((a, b) => b.b.pts - a.b.pts || b.b.reb - a.b.reb);
}
function boxTable(side) {
  return '<table class="stat-table box-table">' +
    "<tr><th>球员</th><th>时间</th><th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>失误</th><th>投篮</th><th>三分</th><th>罚球</th></tr>" +
    boxRows(side).map(x =>
      "<tr><td class='b-name'>" + esc(x.p.nameCn) + "</td><td>" + minsStrOf(side, x.p.id) + "</td><td><b>" + x.b.pts + "</b></td><td>" + x.b.reb + "</td><td>" + x.b.ast + "</td><td>" + x.b.stl + "</td><td>" + x.b.blk + "</td><td>" + x.b.tov + "</td><td>" + x.b.fgm + "/" + x.b.fga + "</td><td>" + x.b.tpm + "/" + x.b.tpa + "</td><td>" + x.b.ftm + "/" + x.b.fta + "</td></tr>"
    ).join("") + "</table>";
}
function minsStrOf(side, id) {
  const sec = side.box.get(id).sec;
  return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
}
function showPost() {
  const sim = state.match.sim;
  const sc = sim.score();
  const win = sim.winner === 0;
  const mvp = sim.mvp();
  $("#m-score").textContent = sc[0] + " - " + sc[1];
  $("#m-clock").textContent = "终场";
  const el = document.createElement("div");
  el.className = "m-post";
  el.innerHTML =
    '<div class="mp-banner ' + (win ? "win" : "lose") + '">' + (win ? "🏆 比赛胜利" : "💔 比赛失利") + "</div>" +
    '<div class="mp-mvp">全场最佳：<b>' + esc(mvp.p.nameCn) + "</b>（" + mvp.box.pts + "分 " + mvp.box.reb + "板 " + mvp.box.ast + "助）</div>" +
    '<div class="mp-tabs"><button class="mp-tab active" data-side="0">我方</button><button class="mp-tab" data-side="1">对手</button></div>' +
    '<div id="mp-box">' + boxTable(sim.teams[0]) + "</div>" +
    '<button class="btn btn-primary" id="mp-back">返回经理室</button>';
  $("#screen-match").appendChild(el);
  el.querySelectorAll(".mp-tab").forEach(tab => {
    tab.onclick = () => {
      el.querySelectorAll(".mp-tab").forEach(x => x.classList.remove("active"));
      tab.classList.add("active");
      $("#mp-box").innerHTML = boxTable(sim.teams[Number(tab.dataset.side)]);
    };
  });
  $("#mp-back").onclick = () => {
    completeGame(sim, win);
    el.remove();
    state.match.sim = null;
    if (state._allStarPending) {
      state._allStarPending = false;
      ensureAllStar(state.save);
      go("allstar-hub");
      return;
    }
    if (state._regularJustEnded) {
      state._regularJustEnded = false;
      RENDERERS["regular-end"]();
      state.stack = [];
      activate("regular-end");
      return;
    }
    if (state.save.playoffs && state.save.playoffs.done) { go("seasonend"); return; }
    RENDERERS.hub();
    state.stack = [];
    activate("hub");
  };
}

/* ===== 全明星周末 ===== */
RENDERERS["allstar-hub"] = function () {
  const save = state.save;
  const as = ensureAllStar(save);
  const card = (key, icon, title, desc, result) => {
    const done = !!result;
    return '<button class="as-card' + (done ? " done" : "") + '" id="as-go-' + key + '">' +
      '<div class="as-icon">' + icon + '</div>' +
      '<div class="as-body"><div class="as-title">' + title + '</div>' +
      '<div class="as-desc">' + desc + '</div>' +
      (done ? '<div class="as-result">' + result + '</div>' : '<div class="as-cta">▶ 开始</div>') + '</div>' +
      '<div class="as-status">' + (done ? "✓" : "○") + '</div></button>';
  };
  let cards = "";
  cards += card("game", "🏀", "全明星正赛", "东部 vs 西部 · 东西部各12人对抗", as.game ? (as.game.mvp ? "MVP: " + esc(as.game.mvp.name) + " " + as.game.mvp.pts + "分" : "已完赛") : null);
  cards += card("threept", "🎯", "三分大赛", "8人单淘汰 · 25球决胜", as.threePt ? (as.threePt.winner ? "冠军: " + esc(as.threePt.winner.name) : "已完赛") : null);
  cards += card("dunk", "💥", "扣篮大赛", "4人2轮 · 5评委打分", as.dunk ? (as.dunk.winner ? "冠军: " + esc(as.dunk.winner.name) : "已完赛") : null);
  const allDone = as.game && as.threePt && as.dunk;
  $("#screen-allstar-hub").innerHTML =
    '<h2 class="screen-title">🌟 全明星周末</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + ' 赛季 · 赛季中旬休赛期</p>' +
    '<div class="as-cards">' + cards + '</div>' +
    (allDone ?
      '<button class="btn btn-primary" id="as-finish">完成全明星周末</button>' :
      '<button class="btn btn-outline" id="as-skip-all">⏩ 一键模拟全部</button>') +
    '<button class="btn btn-outline" id="as-back">返回经理室</button>';
  $("#as-go-game").onclick = () => { if (!as.game) { as.game = simAllStarGame(save, as.rosters); writeSave(save); } go("allstar-game"); };
  $("#as-go-threept").onclick = () => { if (!as.threePt) { as.threePt = simThreePoint(save, threePtCandidates(save)); writeSave(save); } go("threept"); };
  $("#as-go-dunk").onclick = () => { if (!as.dunk) { as.dunk = simDunk(save, dunkCandidates(save)); writeSave(save); } go("dunk"); };
  if (allDone) {
    $("#as-finish").onclick = () => {
      as.done = true;
      writeSave(save);
      toast("🌟 全明星周末结束！" + (as.game && as.game.mvp ? " MVP: " + as.game.mvp.name : ""));
      RENDERERS.hub();
      state.stack = [];
      activate("hub");
    };
  } else {
    $("#as-skip-all").onclick = () => {
      if (!as.game) { as.game = simAllStarGame(save, as.rosters); }
      if (!as.threePt) { as.threePt = simThreePoint(save, threePtCandidates(save)); }
      if (!as.dunk) { as.dunk = simDunk(save, dunkCandidates(save)); }
      as.done = true;
      writeSave(save);
      toast("🌟 全明星周末一键完成！" + (as.game && as.game.mvp ? " MVP: " + as.game.mvp.name : ""));
      RENDERERS.hub();
      state.stack = [];
      activate("hub");
    };
  }
  $("#as-back").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
};

RENDERERS["allstar-game"] = function () {
  const save = state.save;
  const as = save.allStar;
  const g = as && as.game;
  if (!g) { back(); return; }
  const rosterRows = (list) => list.map((p, i) => {
    const box = g.box[list === g.box.east ? "east" : "west"][i];
    if (!box) return "";
    return '<div class="tm-row' + (box.isMine ? " me" : "") + (p.isStarter ? "" : " sub-row") + '">' +
      '<span class="tm-pos">' + (p.isStarter ? "首" : "替") + '</span>' +
      '<div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + '</div>' +
      '<div class="tm-main"><div class="tm-name">' + esc(p.p.nameCn) + '</div>' +
      '<div class="tm-sub"><span class="tm-team">' + esc(teamName(p.team)) + '</span>' +
      '<span class="tm-stats">' + box.pts + '分 ' + box.reb + '板 ' + box.ast + '助</span></div></div></div>';
  }).join("");
  const eastWin = g.winner === "E";
  $("#screen-allstar-game").innerHTML =
    '<h2 class="screen-title">🏀 全明星正赛</h2>' +
    (g.mvp ? '<div class="se-card gold"><h3>🌟 全明星 MVP</h3>' +
      '<div class="aw-row me"><span class="aw-rank">MVP</span>' +
      '<div class="aw-name">' + esc(g.mvp.name) + '<span class="aw-team">' + esc(teamName(g.mvp.team)) + '</span></div>' +
      '<div class="aw-line">' + g.mvp.pts + '分 ' + g.mvp.reb + '板 ' + g.mvp.ast + '助</div></div></div>' : "") +
    '<div class="as-scoreboard">' +
      '<div class="as-team' + (eastWin ? " winner" : "") + '"><div class="as-team-name">东部</div><div class="as-team-score">' + g.eastScore + '</div></div>' +
      '<div class="as-vs">VS</div>' +
      '<div class="as-team' + (!eastWin ? " winner" : "") + '"><div class="as-team-name">西部</div><div class="as-team-score">' + g.westScore + '</div></div>' +
    '</div>' +
    '<div class="as-rosters"><div class="as-col"><h3>东部</h3>' + rosterRows(as.rosters.east) + '</div>' +
    '<div class="as-col"><h3>西部</h3>' + rosterRows(as.rosters.west) + '</div></div>' +
    '<button class="btn btn-outline" id="asg-back">返回</button>';
  $("#asg-back").onclick = back;
};

RENDERERS["threept"] = function () {
  const save = state.save;
  const t = save.allStar && save.allStar.threePt;
  if (!t) { back(); return; }
  const roundHtml = t.rounds.map(r => {
    const matchups = r.matchups.map(m => {
      const aWin = m.winnerId === m.a.id;
      return '<div class="tp-matchup">' +
        '<div class="tp-player' + (aWin ? " win" : "") + (m.a.isMine ? " me" : "") + '">' +
          '<span class="tp-name">' + esc(m.a.name) + '</span>' +
          '<span class="tp-score">' + m.a.score + '/25</span></div>' +
        '<div class="tp-player' + (!aWin ? " win" : "") + (m.b.isMine ? " me" : "") + '">' +
          '<span class="tp-name">' + esc(m.b.name) + '</span>' +
          '<span class="tp-score">' + m.b.score + '/25</span></div>' +
      '</div>';
    }).join("");
    return '<div class="tp-round"><h3>' + r.round + '</h3><div class="tp-matchups">' + matchups + '</div></div>';
  }).join("");
  $("#screen-threept").innerHTML =
    '<h2 class="screen-title">🎯 三分大赛</h2>' +
    (t.winner ? '<div class="se-card gold"><h3>🏆 三分大赛冠军</h3>' +
      '<div class="aw-row' + (t.winner.isMine ? " me" : "") + '"><span class="aw-rank">1st</span>' +
      '<div class="aw-name">' + esc(t.winner.name) + '<span class="aw-team">' + esc(teamName(t.winner.team)) + '</span></div></div></div>' : "") +
    roundHtml +
    '<button class="btn btn-outline" id="tp-back">返回</button>';
  $("#tp-back").onclick = back;
};

RENDERERS["dunk"] = function () {
  const save = state.save;
  const d = save.allStar && save.allStar.dunk;
  if (!d) { back(); return; }
  const roundHtml = d.rounds.map(r => {
    const rows = r.scores.map(s => {
      const advanced = r.advanceIds.includes(s.id);
      return '<div class="dk-row' + (advanced ? " win" : "") + (s.isMine ? " me" : "") + '">' +
        '<div class="dk-name">' + esc(s.name) + '<span class="dk-team">' + esc(teamName(s.team)) + '</span></div>' +
        '<div class="dk-dunks"><span class="dk-dunk">D1: ' + s.dunk1 + '</span><span class="dk-dunk">D2: ' + s.dunk2 + '</span></div>' +
        '<div class="dk-total">' + s.total + '</div>' +
        '<div class="dk-badge">' + (advanced ? "晋级" : "淘汰") + '</div></div>';
    }).join("");
    return '<div class="dk-round"><h3>' + r.round + '</h3>' + rows + '</div>';
  }).join("");
  $("#screen-dunk").innerHTML =
    '<h2 class="screen-title">💥 扣篮大赛</h2>' +
    (d.winner ? '<div class="se-card gold"><h3>🏆 扣篮大赛冠军</h3>' +
      '<div class="aw-row' + (d.winner.isMine ? " me" : "") + '"><span class="aw-rank">1st</span>' +
      '<div class="aw-name">' + esc(d.winner.name) + '<span class="aw-team">' + esc(teamName(d.winner.team)) + '</span></div></div></div>' : "") +
    roundHtml +
    '<button class="btn btn-outline" id="dk-back">返回</button>';
  $("#dk-back").onclick = back;
};

/* ===== 联盟排名 ===== */
RENDERERS.standings = function () {
  const save = state.save;
  const my = myAbbr(save);
  const defConf = confOf(my);
  const render = conf => {
    const list = confRanking(save, conf);
    return '<table class="stand-table">' +
      "<tr><th>#</th><th>球队</th><th>胜</th><th>负</th><th>胜率</th></tr>" +
      list.map(r =>
        '<tr class="' + (r.abbr === my ? "me" : "") + '">' +
        "<td>" + r.seed + "</td>" +
        '<td class="st-team"><span class="st-logo">' + teamLogoHtml(r.abbr) + "</span>" + esc(teamName(r.abbr)) + "</td>" +
        "<td>" + r.w + "</td><td>" + r.l + "</td><td>" + (r.pct * 100).toFixed(1) + "%</td></tr>"
      ).join("") + "</table>";
  };
  $("#screen-standings").innerHTML =
    '<h2 class="screen-title">联盟排名</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季 · 按胜率排序 · 高亮为你的球队</p>" +
    '<div class="conf-tabs">' +
    '  <button class="mp-tab' + (defConf === "E" ? " active" : "") + '" data-c="E">东部</button>' +
    '  <button class="mp-tab' + (defConf === "W" ? " active" : "") + '" data-c="W">西部</button>' +
    "</div>" +
    '<div id="stand-body">' + render(defConf) + "</div>";
  $$("#screen-standings .mp-tab").forEach(t => {
    t.onclick = () => {
      $$("#screen-standings .mp-tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("#stand-body").innerHTML = render(t.dataset.c);
    };
  });
};

/* ===== 赛程战报 ===== */
RENDERERS.schedule = function () {
  const save = state.save;
  const my = myAbbr(save);
  let poHtml = "";
  if (save.playoffs) {
    const ps = save.playoffs;
    poHtml = '<h3 class="section-h">季后赛对阵</h3>';
    for (let r = 0; r <= ps.round && ps.rounds[r]; r++) {
      const rd = ps.rounds[r];
      poHtml += '<div class="po-round">' + esc(rd.name) + "</div>";
      rd.E.concat(rd.W).forEach(s => {
        const myInv = s.a === my || s.b === my;
        poHtml += '<div class="po-ser' + (myInv ? " me" : "") + (s.done && s.winner === my ? " won" : "") + '">' +
          esc(teamName(s.a)) + " <b>" + s.wa + " - " + s.wb + "</b> " + esc(teamName(s.b)) +
          (s.done ? '<span class="po-adv">' + esc(teamName(s.winner)) + " 晋级</span>" : "") +
          (myInv && !s.done ? '<span class="po-adv">你的系列赛</span>' : "") + "</div>";
      });
    }
    if (ps.done) poHtml += '<div class="champ-line">🏆 总冠军：' + esc(teamName(ps.champion)) + "</div>";
  }
  /* 常规赛战绩摘要 */
  const st = save.standings[my] || { w: 0, l: 0 };
  const gp = st.w + st.l;
  const pct = gp ? ((st.w / gp) * 100).toFixed(1) : "0.0";
  let streak = 0, streakType = null;
  for (let i = save.gameNo - 1; i >= 0; i--) {
    const g = save.schedule[i];
    if (!g || !g.result) break;
    const t = g.result === "W" ? "W" : "L";
    if (streakType === null) streakType = t;
    if (t === streakType) streak++; else break;
  }
  const streakText = streak ? (streakType === "W" ? "连胜 " + streak : "连败 " + streak) : "-";

  /* ===== 月历视图 ===== */
  const dates = (save.seasonDates && save.seasonDates[save.seasonNo]) ? save.seasonDates[save.seasonNo] : [];
  /* 把每场比赛按 M-D 建索引 */
  const gameByDate = {};
  dates.forEach((d, i) => {
    const pd = parseSeasonDate(d);
    if (!pd) return;
    const key = pd.month + "-" + pd.day;
    (gameByDate[key] = gameByDate[key] || []).push(i);
  });

  /* 当前比赛日期 */
  const curIdx = Math.min(save.gameNo, (dates.length || 1) - 1);
  const curDateStr = dates[curIdx] || "";
  const curPD = parseSeasonDate(curDateStr);

  /* 决定当前查看的月份 */
  let viewYear, viewMonth;
  if (scheduleCalView) {
    viewYear = scheduleCalView.year;
    viewMonth = scheduleCalView.month;
  } else if (curPD) {
    viewMonth = curPD.month;
    viewYear = seasonYearForMonth(save, curPD.month);
  } else {
    viewMonth = 10;
    viewYear = SEASON_START_YEAR + save.seasonNo - 1;
  }

  /* 生成日历单元格 */
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay(); /* 0=周日 */
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const WEEKS = ["日", "一", "二", "三", "四", "五", "六"];
  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const key = viewMonth + "-" + day;
    const gameIdxs = gameByDate[key] || [];
    let gameHtml = "";
    gameIdxs.forEach(gi => {
      const g = save.schedule[gi];
      if (!g) return;
      let cls = "cal-game";
      const prefix = g.home ? "vs" : "@";
      const opp = teamName(g.opp);
      if (g.result) {
        cls += g.result === "W" ? " win" : " loss";
        gameHtml += '<div class="' + cls + '" data-idx="' + gi + '">' +
          '<div class="cal-game-opp">' + prefix + " " + esc(opp) + '</div>' +
          '<div class="cal-game-score">' + g.score[0] + "-" + g.score[1] + '</div></div>';
      } else if (gi === save.gameNo) {
        cls += " next";
        gameHtml += '<div class="' + cls + '" data-idx="' + gi + '">▶ ' + prefix + " " + esc(opp) + '</div>';
      } else {
        cls += " future";
        gameHtml += '<div class="' + cls + '" data-idx="' + gi + '">' + prefix + " " + esc(opp) + '</div>';
      }
    });
    const isToday = curPD && curPD.month === viewMonth && curPD.day === day;
    cells += '<div class="cal-cell' + (isToday ? " today" : "") + '">' +
      '<div class="cal-day">' + day + '</div>' + gameHtml + '</div>';
  }

  const noDates = dates.length === 0;

  $("#screen-schedule").innerHTML =
    '<h2 class="screen-title">赛程战报</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季 · 常规赛 " + GAMES_PER_SEASON + " 场</p>" +
    poHtml +
    '<div class="sch-summary">' +
    '  <div class="sch-sum-item"><b>' + st.w + '-' + st.l + '</b><span>战绩</span></div>' +
    '  <div class="sch-sum-item"><b>' + pct + '%</b><span>胜率</span></div>' +
    '  <div class="sch-sum-item"><b>' + gp + '/' + save.schedule.length + '</b><span>已赛</span></div>' +
    '  <div class="sch-sum-item"><b>' + streakText + '</b><span>近期</span></div>' +
    '</div>' +
    (noDates ? '<div class="empty-stats">当前存档缺少赛程日期，请开新档以启用日历视图</div>' :
    '<div class="cal">' +
    '  <div class="cal-nav">' +
    '    <button class="cal-nav-btn" id="cal-prev" aria-label="上个月">‹</button>' +
    '    <div class="cal-title">' + viewYear + " 年 " + viewMonth + " 月</div>" +
    '    <button class="cal-nav-btn" id="cal-next" aria-label="下个月">›</button>' +
    '  </div>' +
    '  <div class="cal-weekdays">' + WEEKS.map(w => '<div>' + w + '</div>').join("") + '</div>' +
    '  <div class="cal-grid">' + cells + '</div>' +
    '  <div class="cal-legend">' +
    '    <span class="cal-leg-item"><i class="cal-leg-dot win"></i>胜</span>' +
    '    <span class="cal-leg-item"><i class="cal-leg-dot loss"></i>负</span>' +
    '    <span class="cal-leg-item"><i class="cal-leg-dot next"></i>下一场</span>' +
    '    <span class="cal-leg-item"><i class="cal-leg-dot future"></i>未赛</span>' +
    '  </div>' +
    '  <button class="cal-today-btn" id="cal-today">📍 回到当前比赛</button>' +
    '</div>') +
    '<div id="sch-modal" class="sch-modal" style="display:none">' +
    '  <div class="sch-modal-mask"></div>' +
    '  <div class="sch-modal-body" id="sch-modal-body"></div>' +
    '</div>';

  if (noDates) return;

  /* 月份导航 */
  $("#cal-prev").onclick = () => {
    let m = viewMonth - 1, y = viewYear;
    if (m < 1) { m = 12; y--; }
    scheduleCalView = { year: y, month: m };
    RENDERERS.schedule();
  };
  $("#cal-next").onclick = () => {
    let m = viewMonth + 1, y = viewYear;
    if (m > 12) { m = 1; y++; }
    scheduleCalView = { year: y, month: m };
    RENDERERS.schedule();
  };
  $("#cal-today").onclick = () => {
    scheduleCalView = null;
    RENDERERS.schedule();
  };

  /* 点击比赛格 → 详情弹窗 */
  $$("#screen-schedule .cal-game[data-idx]").forEach(el => {
    el.onclick = () => openScheduleModal(Number(el.dataset.idx));
  });
};

/* 赛程详情弹窗（含 Q1-Q4 节比分） */
function openScheduleModal(i) {
  const save = state.save;
  const g = save.schedule[i];
  if (!g) return;
  /* 确保弹窗 DOM 存在（经理室日历也会调用，赛程页可能未渲染） */
  let modal = document.getElementById("sch-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "sch-modal";
    modal.className = "sch-modal";
    modal.innerHTML = '<div class="sch-modal-mask"></div><div class="sch-modal-body" id="sch-modal-body"></div>';
    document.body.appendChild(modal);
  }
  const body = document.getElementById("sch-modal-body");
  const dates = save.seasonDates && save.seasonDates[save.seasonNo];
  const d = dates ? dates[i] : "";
  const win = g.result === "W";
  let qRows = "";
  if (g.quarters && g.quarters.length) {
    let prev = [0, 0];
    qRows = g.quarters.map((qs, qi) => {
      const single = [qs[0] - prev[0], qs[1] - prev[1]];
      prev = qs.slice();
      const label = qi < 4 ? "Q" + (qi + 1) : "OT" + (qi - 3);
      const otCls = qi >= 4 ? ' class="sch-q-ot"' : "";
      return '<tr' + otCls + '><td class="sch-q-label">' + label + '</td><td>' + single[0] + '</td><td>' + single[1] + '</td></tr>';
    }).join("");
  }
  /* 球员数据（双方技术统计） */
  let boxHtml = "";
  if (g.box && (g.box.my.length || g.box.opp.length)) {
    const renderTeam = (list, label) => {
      if (!list.length) return "";
      const rows = list.slice().sort((a, b) => b.pts - a.pts).map(p =>
        '<tr><td>' + esc(p.name) + '</td><td>' + p.pts + '</td><td>' + p.reb + '</td><td>' + p.ast + '</td><td>' + p.stl + '</td><td>' + p.blk + '</td></tr>'
      ).join("");
      return '<div class="sch-box-team"><div class="sch-box-label">' + esc(label) + '</div>' +
        '<table class="sch-box-table"><colgroup><col class="player"><col><col><col><col><col></colgroup><thead><tr><th>球员</th><th>分</th><th>板</th><th>助</th><th>断</th><th>帽</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    };
    boxHtml = '<div class="sch-box">' + renderTeam(g.box.my, save.team.displayName) + renderTeam(g.box.opp, teamName(g.opp)) + '</div>';
  }
  body.innerHTML =
    '<div class="sch-modal-head">' +
    '  <div class="sch-modal-date">' + esc(d) + '</div>' +
    '  <div class="sch-modal-game">第 ' + (i + 1) + ' 场 · ' + (g.home ? "主场" : "客场") + '</div>' +
    '</div>' +
    '<div class="sch-modal-teams">' +
    '  <div class="sch-modal-team">' +
    '    <div class="sch-modal-name">' + esc(save.team.displayName) + '</div>' +
    '    <div class="sch-modal-score' + (win ? " win" : " loss") + '">' + (g.score ? g.score[0] : "-") + '</div>' +
    '  </div>' +
    '  <div class="sch-modal-vs">VS</div>' +
    '  <div class="sch-modal-team">' +
    '    <div class="sch-modal-name">' + esc(teamName(g.opp)) + '</div>' +
    '    <div class="sch-modal-score' + (win ? " loss" : " win") + '">' + (g.score ? g.score[1] : "-") + '</div>' +
    '  </div>' +
    '</div>' +
    (qRows ? '<table class="sch-q-table"><thead><tr><th></th><th>我</th><th>对手</th></tr></thead><tbody>' + qRows +
      '<tr class="sch-q-total"><td>合计</td><td><b>' + (g.score ? g.score[0] : "-") + '</b></td><td><b>' + (g.score ? g.score[1] : "-") + '</b></td></tr></tbody></table>' : "") +
    boxHtml +
    '<div class="sch-modal-result ' + (win ? "win" : "loss") + '">' + (g.result ? (win ? "🎉 胜利" : "😞 失利") : "⏳ 未开赛") + '</div>' +
    '<button class="btn btn-outline" id="sch-modal-close">关闭</button>';
  modal.style.display = "flex";
  $("#sch-modal-close").onclick = () => { modal.style.display = "none"; };
  modal.querySelector(".sch-modal-mask").onclick = () => { modal.style.display = "none"; };
}

/* 季后赛系列赛详情弹窗：每场比分 + 球员数据 */
function openSeriesModal(ser, roundName) {
  if (!ser) return;
  const save = state.save;
  let modal = document.getElementById("sch-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "sch-modal";
    modal.className = "sch-modal";
    modal.innerHTML = '<div class="sch-modal-mask"></div><div class="sch-modal-body" id="sch-modal-body"></div>';
    document.body.appendChild(modal);
  }
  const body = document.getElementById("sch-modal-body");
  const aName = teamName(ser.a), bName = teamName(ser.b);
  const aWin = ser.winner === ser.a, bWin = ser.winner === ser.b;
  const games = ser.games || [];
  /* 每场比分列表 */
  let gameRows = "";
  if (games.length) {
    gameRows = games.map((gm, i) => {
      const sa = gm.score[0], sb = gm.score[1];
      const aTook = gm.aWin;
      return '<div class="po-game-row" data-gi="' + i + '">' +
        '<span class="po-game-no">G' + (i + 1) + '</span>' +
        '<span class="po-game-team' + (aTook ? " win" : "") + '">' + esc(aName) + '</span>' +
        '<span class="po-game-score' + (aTook ? " win" : "") + '">' + sa + '</span>' +
        '<span class="po-game-dash">-</span>' +
        '<span class="po-game-score' + (!aTook ? " win" : "") + '">' + sb + '</span>' +
        '<span class="po-game-team' + (!aTook ? " win" : "") + '">' + esc(bName) + '</span>' +
        (gm.box ? '<span class="po-game-detail">▸</span>' : '') +
        '</div>';
    }).join("");
  } else {
    gameRows = '<div class="po-empty">该系列赛暂无比赛记录</div>';
  }
  /* 总比分 */
  const totalHtml = '<div class="po-total">' +
    '<div class="po-total-team' + (aWin ? " win" : "") + '">' + esc(aName) + '<b>' + ser.wa + '</b></div>' +
    '<div class="po-total-vs">VS</div>' +
    '<div class="po-total-team' + (bWin ? " win" : "") + '"><b>' + ser.wb + '</b>' + esc(bName) + '</div>' +
    '</div>';
  body.innerHTML =
    '<div class="sch-modal-head">' +
    '  <div class="sch-modal-date">' + esc(roundName || "季后赛") + '</div>' +
    '  <div class="sch-modal-game">' + (ser.done ? "系列赛已结束" : "进行中") + '</div>' +
    '</div>' +
    totalHtml +
    '<div class="po-games">' + gameRows + '</div>' +
    '<div id="po-box-area"></div>' +
    '<button class="btn btn-outline" id="sch-modal-close">关闭</button>';
  modal.style.display = "flex";
  $("#sch-modal-close").onclick = () => { modal.style.display = "none"; };
  modal.querySelector(".sch-modal-mask").onclick = () => { modal.style.display = "none"; };
  /* 点击某场比赛 → 展开球员数据 */
  $$(".po-game-row[data-gi]").forEach(row => {
    row.onclick = () => {
      const gi = Number(row.dataset.gi);
      const gm = games[gi];
      if (!gm || !gm.box) return;
      const renderTeam = (list, label) => {
        if (!list.length) return "";
        const rows = list.slice().sort((a, b) => b.pts - a.pts).map(p =>
          '<tr><td>' + esc(p.name) + '</td><td>' + p.pts + '</td><td>' + p.reb + '</td><td>' + p.ast + '</td><td>' + p.stl + '</td><td>' + p.blk + '</td></tr>'
        ).join("");
        return '<div class="sch-box-team"><div class="sch-box-label">' + esc(label) + '</div>' +
          '<table class="sch-box-table"><colgroup><col class="player"><col><col><col><col><col></colgroup><thead><tr><th>球员</th><th>分</th><th>板</th><th>助</th><th>断</th><th>帽</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      };
      const my = myAbbr(save);
      const myLabel = (ser.a === my || ser.b === my) ? save.team.displayName : aName;
      const oppLabel = bName;
      document.getElementById("po-box-area").innerHTML = '<div class="sch-box">' +
        renderTeam(gm.box.my, myLabel) + renderTeam(gm.box.opp, oppLabel) + '</div>';
    };
  });
}

/* 赛程日历当前查看的月份（跨渲染保留） */
let scheduleCalView = null;
/* 主控台日历当前查看的月份（跨渲染保留） */
let hubCalView = null;
/* 季后赛页面当前查看的轮次标签 */
let playoffTab = "bracket";
/* 经理室子tab：overview / roster / history */
let hubTab = "overview";
/* 季后赛对阵图每轮折叠状态：{ "r0": true, "r1": false } —— true=折叠 / false=展开；未定义时走默认（已完成且早于当前轮=折叠） */
let poCollapsed = {};

/* ===== 奖项追踪排行 ===== */
RENDERERS.awards = function () {
  const save = state.save;
  if (!save) { back(); return; }
  const ranks = liveAwardRanks(save);
  const my = myAbbr(save);
  const gp = ranks.gp;

  const rankRow = (c, i, metric, fmt) =>
    '<div class="aw-row' + (c.mine ? " me" : "") + '" data-id="' + c.p.id + '">' +
    '  <span class="aw-rank">' + (i + 1) + "</span>" +
    '  <div class="ovr-badge ' + ovrClass(c.p.ovr) + '">' + c.p.ovr + "</div>" +
    '  <div class="aw-name">' + esc(c.p.nameCn) +
    '    <span class="aw-team">' + esc(teamName(c.p.team)) + (c.mine ? " · 你" : "") + "</span></div>" +
    '  <div class="aw-val">' + fmt(metric) + "</div></div>";

  const mvpRows = ranks.mvpTop.map((c, i) => rankRow(c, i, c.mvp, v => v.toFixed(1))).join("");
  const dpoyRows = ranks.dpoyTop.map((c, i) => rankRow(c, i, c.dpoy, v => v.toFixed(1))).join("");
  const scoringRows = ranks.scoringTop.map((c, i) => rankRow(c, i, c.st.ppg, v => v.toFixed(1) + "分")).join("");
  const assistRows = ranks.assistTop.map((c, i) => rankRow(c, i, c.st.apg, v => v.toFixed(1) + "助")).join("");
  const reboundRows = ranks.reboundTop.map((c, i) => rankRow(c, i, c.st.rpg, v => v.toFixed(1) + "板")).join("");
  const sixthRows = ranks.sixthTop.length
    ? ranks.sixthTop.map((c, i) => rankRow(c, i, c.sixth, v => v.toFixed(1))).join("")
    : '<div class="empty-stats">暂无替补球员数据（需打 5 场以上）</div>';
  const rookieRows = ranks.rookieTop.length
    ? ranks.rookieTop.map((c, i) => rankRow(c, i, c.mvp, v => v.toFixed(1))).join("")
    : '<div class="empty-stats">暂无新秀赛季数据</div>';

  $("#screen-awards").innerHTML =
    '<h2 class="screen-title">奖项追踪</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + ' 赛季 · 已打 ' + gp + ' 场 · 实时排名</p>' +
    '<div class="aw-tabs" id="aw-tabs">' +
    '  <button class="aw-tab active" data-tab="mvp">MVP</button>' +
    '  <button class="aw-tab" data-tab="dpoy">DPOY</button>' +
    '  <button class="aw-tab" data-tab="6th">第六人</button>' +
    '  <button class="aw-tab" data-tab="rookie">最佳新秀</button>' +
    '  <button class="aw-tab" data-tab="pts">得分王</button>' +
    '  <button class="aw-tab" data-tab="ast">助攻王</button>' +
    '  <button class="aw-tab" data-tab="reb">篮板王</button>' +
    "</div>" +
    '<div class="aw-panel" id="aw-panel">' +
    '  <div class="aw-list">' + mvpRows + "</div>" +
    "</div>";

  const panels = { mvp: mvpRows, dpoy: dpoyRows, "6th": sixthRows, rookie: rookieRows, pts: scoringRows, ast: assistRows, reb: reboundRows };
  const labels = {
    mvp: "MVP 候选（综合得分+篮板+助攻+胜率）",
    dpoy: "最佳防守（抢断+盖帽+防守属性）",
    "6th": "最佳第六人（替补得分+助攻）",
    rookie: "最佳新秀（新秀球员综合分）",
    pts: "得分王（场均得分）",
    ast: "助攻王（场均助攻）",
    reb: "篮板王（场均篮板）"
  };
  $$("#aw-tabs .aw-tab").forEach(tab => {
    tab.onclick = () => {
      $$("#aw-tabs .aw-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const key = tab.dataset.tab;
      $("#aw-panel").innerHTML = '<div class="aw-list">' + panels[key] + "</div>";
      $$("#screen-awards .aw-row[data-id]").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });
    };
  });
  $$("#screen-awards .aw-row[data-id]").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });
};

/* ===== 退役球员 ===== */
RENDERERS.retired = function () {
  const save = state.save;
  if (!save) { back(); return; }
  const retired = getRetiredPlayers(save);
  const hofCount = (save.hof || []).length;
  $("#screen-retired").innerHTML =
    '<h2 class="screen-title">退役球员</h2>' +
    '<p class="screen-sub">共 ' + retired.length + ' 人退役 · 名人堂 ' + hofCount + ' 人</p>' +
    (retired.length === 0
      ? '<div class="empty-stats">暂无退役球员</div>'
      : '<div class="roster-table">' + retired.map(r => {
        const accBadges = [];
        if (r.acc.mvp) accBadges.push('<span class="acc-badge acc-mvp">MVP×' + r.acc.mvp + '</span>');
        if (r.acc.fmvp) accBadges.push('<span class="acc-badge acc-fmvp">FMVP×' + r.acc.fmvp + '</span>');
        if (r.acc.champ) accBadges.push('<span class="acc-badge acc-champ">总冠军×' + r.acc.champ + '</span>');
        if (r.acc.allNBA) accBadges.push('<span class="acc-badge acc-allnba">最佳阵容×' + r.acc.allNBA + '</span>');
        if (r.acc.dpoy) accBadges.push('<span class="acc-badge acc-dpoy">DPOY×' + r.acc.dpoy + '</span>');
        const status = r.inHOF
          ? '<span class="hof-status hof-in">名人堂</span>'
          : r.isRejected
            ? '<span class="hof-status hof-out">未入选</span>'
            : r.eligible
              ? '<span class="hof-status hof-pending">候选中</span>'
              : '<span class="hof-status hof-wait">等待资格</span>';
        return '<div class="r-row' + (r.inHOF ? " r-hof" : "") + '" data-id="' + r.id + '">' +
          '  <span class="r-idx">' + r.peakOvr + '</span>' +
          '  <div class="r-main">' +
          '    <div class="r-name">' + esc(r.name) + status + '</div>' +
          '    <div class="r-meta"><span class="pos-chip ' + posClass(r.pos) + '">' + esc(posLabel(r.p)) + '</span> ' + r.age + '岁 · ' + r.expYears + '年球龄 · ' + esc(teamName(r.team)) + '</div>' +
          '    <div class="r-acc">' + (accBadges.length ? accBadges.join("") : '<span class="acc-none">无重大荣誉</span>') + '</div>' +
          '  </div>' +
          '  <div class="r-hof-score">评分 ' + r.score + '</div>' +
          '</div>';
      }).join("") + '</div>') +
    '<button class="btn btn-outline" id="ret-back">返回经理室</button>';
  $("#ret-back").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
  $$("#screen-retired .r-row[data-id]").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });
};

/* ===== 名人堂 ===== */
RENDERERS.hof = function () {
  const save = state.save;
  if (!save) { back(); return; }
  /* 兼容旧存档：HOF 条目无 career 字段时，从 careerStats + playerStats 实时合并 */
  const liveCareer = (h) => {
    if (h.career) return h.career;
    const car = (save.careerStats && save.careerStats[h.id]) || {};
    const cur = (save.playerStats && save.playerStats[h.id]) || {};
    const g = (car.g || 0) + (cur.g || 0);
    const pts = (car.pts || 0) + (cur.pts || 0);
    const reb = (car.reb || 0) + (cur.reb || 0);
    const ast = (car.ast || 0) + (cur.ast || 0);
    const stl = (car.stl || 0) + (cur.stl || 0);
    const blk = (car.blk || 0) + (cur.blk || 0);
    const fgm = (car.fgm || 0) + (cur.fgm || 0);
    const fga = (car.fga || 0) + (cur.fga || 0);
    const tpm = (car.tpm || 0) + (cur.tpm || 0);
    const tpa = (car.tpa || 0) + (cur.tpa || 0);
    const ftm = (car.ftm || 0) + (cur.ftm || 0);
    const fta = (car.fta || 0) + (cur.fta || 0);
    return {
      g, pts, reb, ast, stl, blk, fgm, fga, tpm, tpa, ftm, fta,
      seasons: (car.seasons || 0) + (cur.g ? 1 : 0),
      ppg: g ? +(pts / g).toFixed(1) : 0,
      rpg: g ? +(reb / g).toFixed(1) : 0,
      apg: g ? +(ast / g).toFixed(1) : 0,
      fg: fga ? Math.round(fgm / fga * 100) : 0,
      tp: tpa ? Math.round(tpm / tpa * 100) : 0,
      ft: fta ? Math.round(ftm / fta * 100) : 0
    };
  };
  const hof = (save.hof || []).slice().sort((a, b) => b.score - a.score);
  const fmt = n => (n || 0).toLocaleString();
  $("#screen-hof").innerHTML =
    '<h2 class="screen-title">奈史密斯名人堂</h2>' +
    '<p class="screen-sub">共 ' + hof.length + ' 位入选者 · 按名人堂评分排序</p>' +
    (hof.length === 0
      ? '<div class="empty-stats">暂无名人堂球员<br><small>球员退役满 1 赛季后，评分 ≥ 50 或拥有 MVP+总冠军者将自动入选</small></div>'
      : '<div class="hof-list">' + hof.map((h, i) => {
        const c = liveCareer(h);
        const acc = h.acc || {};
        const p0 = PLAYERS_RATED.players.find(x => x.id === h.id);
        const avatar = p0 && p0.avatar ? p0.avatar : "";
        const accBadges = [];
        if (acc.mvp) accBadges.push('<span class="acc-badge acc-mvp">MVP ×' + acc.mvp + '</span>');
        if (acc.fmvp) accBadges.push('<span class="acc-badge acc-fmvp">FMVP ×' + acc.fmvp + '</span>');
        if (acc.champ) accBadges.push('<span class="acc-badge acc-champ">总冠军 ×' + acc.champ + '</span>');
        if (acc.allNBA) accBadges.push('<span class="acc-badge acc-allnba">最佳阵容 ×' + acc.allNBA + '</span>');
        if (acc.dpoy) accBadges.push('<span class="acc-badge acc-dpoy">DPOY ×' + acc.dpoy + '</span>');
        if (acc.scoring) accBadges.push('<span class="acc-badge acc-scoring">得分王 ×' + acc.scoring + '</span>');
        if (acc.assists) accBadges.push('<span class="acc-badge acc-scoring">助攻王 ×' + acc.assists + '</span>');
        if (acc.rebounds) accBadges.push('<span class="acc-badge acc-scoring">篮板王 ×' + acc.rebounds + '</span>');
        if (acc.allDef) accBadges.push('<span class="acc-badge acc-dpoy">最佳防守 ×' + acc.allDef + '</span>');
        if (acc.allRookie) accBadges.push('<span class="acc-badge acc-allnba">最佳新秀 ×' + acc.allRookie + '</span>');
        return '<div class="hof-card" data-id="' + h.id + '">' +
          '  <div class="hof-rank">#' + (i + 1) + '</div>' +
          '  <div class="hof-head">' +
          '    <div class="hof-avatar">' + (avatar
              ? '<img src="' + esc(avatar) + '" onerror="this.style.visibility=\'hidden\'">'
              : '<div class="hof-avatar-fb">' + esc((h.name || "?").charAt(0)) + '</div>') + '</div>' +
          '    <div class="hof-title">' +
          '      <div class="hof-name">' + esc(h.name) + '</div>' +
          '      <div class="hof-meta"><span class="pos-chip ' + posClass(h.pos) + '">' + esc(h.pos) + '</span>' +
          '        <span>' + (h.expYears || 0) + '年球龄</span>' +
          '        <span>' + (h.age || 0) + '岁退役</span>' +
          '        <span>· ' + esc(teamName(h.team)) + '</span></div>' +
          '      <div class="hof-badges">' + (accBadges.length ? accBadges.join("") : '<span class="acc-none">无重大荣誉</span>') + '</div>' +
          '    </div>' +
          '    <div class="hof-ovr"><div class="ovr-badge ' + ovrClass(h.peakOvr) + '">' + h.peakOvr + '</div><span>巅峰总评</span></div>' +
          '    <div class="hof-score"><b>' + h.score + '</b><span>HOF 评分</span></div>' +
          '  </div>' +
          '  <div class="hof-induct">第 ' + h.seasonNo + ' 赛季入选</div>' +
          '  <div class="hof-stats">' +
          '    <h4>生涯数据 <small>' + (c.seasons || 0) + ' 个赛季 · ' + fmt(c.g) + ' 场</small></h4>' +
          '    <table class="stat-table hof-table"><tr>' +
          '      <th>得分</th><th>篮板</th><th>助攻</th><th>抢断</th><th>盖帽</th><th>投篮%</th><th>三分%</th><th>罚球%</th></tr><tr>' +
          '      <td><b>' + (c.ppg || 0) + '</b><small>PPG</small></td>' +
          '      <td><b>' + (c.rpg || 0) + '</b><small>RPG</small></td>' +
          '      <td><b>' + (c.apg || 0) + '</b><small>APG</small></td>' +
          '      <td>' + (c.g ? (c.stl / c.g).toFixed(1) : "0") + '<small>SPG</small></td>' +
          '      <td>' + (c.g ? (c.blk / c.g).toFixed(1) : "0") + '<small>BPG</small></td>' +
          '      <td>' + (c.fg || 0) + '%<small>FG</small></td>' +
          '      <td>' + (c.tp || 0) + '%<small>3P</small></td>' +
          '      <td>' + (c.ft || 0) + '%<small>FT</small></td>' +
          '    </tr></table>' +
          '    <table class="stat-table hof-table hof-totals"><tr>' +
          '      <th>累计得分</th><th>累计篮板</th><th>累计助攻</th><th>累计抢断</th><th>累计盖帽</th></tr><tr>' +
          '      <td><b>' + fmt(c.pts) + '</b></td>' +
          '      <td><b>' + fmt(c.reb) + '</b></td>' +
          '      <td><b>' + fmt(c.ast) + '</b></td>' +
          '      <td>' + fmt(c.stl) + '</td>' +
          '      <td>' + fmt(c.blk) + '</td>' +
          '    </tr></table>' +
          '  </div>' +
          '</div>';
      }).join("") + '</div>') +
    '<button class="btn btn-outline" id="hof-back">返回经理室</button>';
  $("#hof-back").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
  $$("#screen-hof .hof-card[data-id]").forEach(card => { card.onclick = () => openPlayer(Number(card.dataset.id)); });
};

/* ===== 季后赛对阵图共享渲染（经理室 & 对阵图页共用） ===== */
function buildPlayoffBracket(save, viewMode) {
  const ps = save.playoffs;
  if (!ps) return { html: "", seriesByRef: {} };
  const my = myAbbr(save);
  const teamShort = abbr => { const t = TEAMS.find(x => x.abbr === abbr); return t ? t.nameCn : abbr; };
  const logo = abbr => abbr ? teamLogoHtml(abbr) : "";
  const rounds = ps.rounds;
  const seriesCard = (s, isUserInvolved, ref, roundName) => {
    if (!s) return '<div class="br-empty"></div>';
    const aWin = s.winner === s.a, bWin = s.winner === s.b;
    const userA = s.a === my, userB = s.b === my;
    const myWon = s.done && s.winner === my;
    const myLost = s.done && (s.a === my || s.b === my) && s.winner !== my;
    const isUserActive = !s.done && isUserInvolved && ps.userSeries === s;
    /* 有比赛数据或已完成的卡片显示"点击查看"提示 */
    const hasGames = (s.games && s.games.length > 0) || s.done || !s.done;
    const hintHtml = hasGames ? '<div class="br-hint">▸ 点击查看详情</div>' : "";
    return '<div class="br-series br-clickable' + (isUserInvolved ? " mine" : "") + (myWon ? " won" : "") + (myLost ? " lost" : "") + (s.done ? " done" : "") + (isUserActive ? " active" : "") + '"' +
      ' data-ref="' + (ref || "") + '" data-round="' + esc(roundName || "") + '">' +
      '<div class="br-team' + (aWin ? " adv" : "") + (userA ? " me" : "") + '">' +
        '<span class="br-seed">' + (s.seedA || "") + '</span>' +
        '<span class="br-logo">' + logo(s.a) + '</span>' +
        '<span class="br-tname">' + esc(teamShort(s.a)) + '</span>' +
        '<span class="br-score' + (aWin ? " win" : "") + '">' + (s.wa || 0) + '</span>' +
      '</div>' +
      '<div class="br-team' + (bWin ? " adv" : "") + (userB ? " me" : "") + '">' +
        '<span class="br-seed">' + (s.seedB || "") + '</span>' +
        '<span class="br-logo">' + logo(s.b) + '</span>' +
        '<span class="br-tname">' + esc(teamShort(s.b)) + '</span>' +
        '<span class="br-score' + (bWin ? " win" : "") + '">' + (s.wb || 0) + '</span>' +
      '</div>' +
      hintHtml +
      '</div>';
  };
  /* 轮次切换标签 */
  const tabDefs = [
    { key: "bracket", label: "对阵图" },
    { key: "r0", label: rounds[0] ? rounds[0].name : "首轮" },
    { key: "r1", label: rounds[1] ? rounds[1].name : "半决赛" },
    { key: "r2", label: rounds[2] ? rounds[2].name : "分区决赛" },
    { key: "r3", label: rounds[3] ? rounds[3].name : "总决赛" }
  ];
  const tabsHtml = '<div class="po-tabs">' + tabDefs.map(t =>
    '<button class="po-tab' + (playoffTab === t.key ? " active" : "") + '" data-tab="' + t.key + '">' + t.label + '</button>'
  ).join("") + '</div>';
  /* ref → 系列赛查找表 */
  const seriesByRef = {};
  rounds.forEach((rnd, ri) => {
    if (!rnd) return;
    ["E", "W"].forEach(c => { (rnd[c] || []).forEach((s, si) => { seriesByRef["r" + ri + "-" + c + "-" + si] = s; }); });
  });
  const userInSeries = s => s && (s.a === my || s.b === my);
  /* 单轮视图 */
  let roundViewHtml = "";
  if (viewMode !== "bracket") {
    const ri = Number(viewMode[1]);
    const rnd = rounds[ri];
    if (rnd) {
      const list = (rnd.E || []).concat(rnd.W || []);
      roundViewHtml = '<div class="po-round-grid">' + list.map((s, i) => {
        const conf = i < (rnd.E || []).length ? "E" : "W";
        const idx = i < (rnd.E || []).length ? i : i - (rnd.E || []).length;
        return seriesCard(s, userInSeries(s), "r" + ri + "-" + conf + "-" + idx, rnd.name);
      }).join("") + '</div>';
    } else {
      roundViewHtml = '<div class="po-empty">该轮尚未开始</div>';
    }
  }
  /* 纵向分组视图：每轮一个 section，东/西分区标标签 */
  /* 计算"当前轮"=最早含未完成系列赛的轮次；若全部完成则=最后一轮 */
  const roundAllDone = rnd => {
    if (!rnd) return true;
    const list = (rnd.E || []).concat(rnd.W || []);
    return list.every(s => !s || s.done);
  };
  let currentRoundIdx = -1;
  for (let i = 0; i < rounds.length; i++) {
    if (!rounds[i]) continue;
    if (!roundAllDone(rounds[i])) { currentRoundIdx = i; break; }
  }
  if (currentRoundIdx === -1) {
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i] && ((rounds[i].E || []).length || (rounds[i].W || []).length)) { currentRoundIdx = i; break; }
    }
  }
  /* 一轮是否应折叠：季后赛未结束 + 该轮已全部完成 + 早于当前轮 + 用户未手动展开 */
  const shouldCollapse = (ri) => {
    if (poCollapsed["r" + ri] !== undefined) return poCollapsed["r" + ri];
    if (ps.done) return false;             // 季后赛已结束 → 全展开回顾
    if (ri >= currentRoundIdx) return false; // 当前轮及未开始轮 → 展开
    return roundAllDone(rounds[ri]);        // 之前轮且已结束 → 默认折叠
  };
  const mainHtml = viewMode === "bracket"
    ? (() => {
        let h = '<div class="po-vertical">';
        rounds.forEach((rnd, ri) => {
          if (!rnd) return;
          const eList = rnd.E || [], wList = rnd.W || [];
          if (!eList.length && !wList.length) return;
          const collapsed = shouldCollapse(ri);
          /* 统计本轮获胜者用于折叠时预览 */
          const allSeries = eList.concat(wList).filter(s => s && s.done);
          const winners = allSeries.map(s => teamShort(s.winner)).join(" · ");
          const doneCount = allSeries.length;
          const totalCount = eList.length + wList.length;
          h += '<div class="po-round-section' + (collapsed ? " collapsed" : "") + '" data-round-idx="r' + ri + '">';
          h += '<div class="po-round-header' + (collapsed ? " collapsed" : "") + '" data-toggle="r' + ri + '">';
          h += '<span class="po-round-name">' + esc(rnd.name) + '</span>';
          if (collapsed) {
            h += '<span class="po-round-meta">' + doneCount + '/' + totalCount + ' 已完成</span>';
            if (winners) h += '<span class="po-round-winners">' + esc(winners) + '</span>';
            h += '<span class="po-collapse-hint">▸ 展开查看</span>';
          } else {
            h += '<span class="po-collapse-hint">▾ 点击折叠</span>';
          }
          h += '</div>';
          if (!collapsed) {
            if (eList.length) {
              h += '<div class="po-conf-label">东部</div>';
              h += '<div class="po-round-grid">';
              eList.forEach((s, i) => { h += seriesCard(s, userInSeries(s), "r" + ri + "-E-" + i, rnd.name); });
              h += '</div>';
            }
            if (wList.length) {
              h += '<div class="po-conf-label">西部</div>';
              h += '<div class="po-round-grid">';
              wList.forEach((s, i) => { h += seriesCard(s, userInSeries(s), "r" + ri + "-W-" + i, rnd.name); });
              h += '</div>';
            }
          }
          h += '</div>';
        });
        if (ps.done && ps.champion) {
          h += '<div class="po-round-section po-champ-section">';
          h += '<div class="br-champion' + (ps.champion === my ? " mine" : "") + '">';
          h += '<span class="br-trophy">🏆</span>';
          h += '<span class="br-logo">' + logo(ps.champion) + '</span>';
          h += '<span class="br-tname">' + esc(teamShort(ps.champion)) + '</span>';
          h += '<span class="br-clabel">' + (ps.champion === my ? "你夺冠了！" : "总冠军") + '</span>';
          h += '</div></div>';
        }
        h += '</div>';
        return h;
      })()
    : roundViewHtml;
  return { html: tabsHtml + mainHtml, seriesByRef };
}

/* ===== 季后赛树状对阵图 ===== */
RENDERERS.playoff = function () {
  const save = state.save;
  if (!save || !save.playoffs) { back(); return; }
  if (typeof syncUserSeries === "function") syncUserSeries(save);
  const ps = save.playoffs;
  const my = myAbbr(save);
  const teamShort = abbr => { const t = TEAMS.find(x => x.abbr === abbr); return t ? t.nameCn : abbr; };
  const curRound = ps.round;
  const rounds = ps.rounds;
  const curRoundName = ps.done ? "季后赛已结束" : (rounds[curRound] ? rounds[curRound].name + " 进行中" : "季后赛");
  let userSeriesHtml = "";
  if (ps.userSeries && !ps.userSeries.done) {
    const opp = ps.userSeries.a === my ? ps.userSeries.b : ps.userSeries.a;
    const myWins = ps.userSeries.a === my ? ps.userSeries.wa : ps.userSeries.wb;
    const oppWins = ps.userSeries.a === my ? ps.userSeries.wb : ps.userSeries.wa;
    userSeriesHtml = '<div class="br-user-series">你的系列赛 vs ' + esc(teamShort(opp)) +
      ' · 当前 <b>' + myWins + '-' + oppWins + '</b>（4 胜晋级）' +
      (ps.userSeries.userHigher ? ' · 你有主场优势' : '') + '</div>';
  } else if (ps.userResult) {
    userSeriesHtml = '<div class="br-user-series">本赛季季后赛结果：' + esc(ps.userResult) + '</div>';
  }
  const bracket = buildPlayoffBracket(save, playoffTab);
  $("#screen-playoff").innerHTML =
    '<h2 class="screen-title">季后赛对阵图</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + ' 赛季 · ' + curRoundName + '</p>' +
    userSeriesHtml +
    bracket.html +
    '<div class="br-legend">' +
      '<span class="lg-item"><span class="lg-dot me"></span>你的球队</span>' +
      '<span class="lg-item"><span class="lg-dot won"></span>系列赛获胜</span>' +
      '<span class="lg-item"><span class="lg-dot lost"></span>系列赛失利</span>' +
      '<span class="lg-item"><span class="lg-dot pending"></span>未开始/进行中</span>' +
    '</div>' +
    '<button class="btn btn-outline" id="po-back">返回</button>';
  /* 轮次标签切换 */
  $$("#screen-playoff .po-tab").forEach(tab => {
    tab.onclick = () => { playoffTab = tab.dataset.tab; RENDERERS.playoff(); };
  });
  /* 点击轮次标题 → 折叠/展开切换 */
  $$("#screen-playoff .po-round-header[data-toggle]").forEach(h => {
    h.onclick = () => {
      const key = h.dataset.toggle;
      const cur = poCollapsed[key];
      poCollapsed[key] = cur === undefined ? true : !cur;
      RENDERERS.playoff();
    };
  });
  /* 系列赛卡片点击 → 查看每场比分 */
  $$("#screen-playoff .br-series[data-ref]").forEach(card => {
    card.onclick = () => {
      const ser = bracket.seriesByRef[card.dataset.ref];
      if (ser) openSeriesModal(ser, card.dataset.round);
    };
  });
  $("#po-back").onclick = () => back();
};

/* ===== 常规赛结束总结（季后赛入口 / 赛季结束入口 + 奖项公布） ===== */
RENDERERS["regular-end"] = function () {
  const save = state.save;
  const my = myAbbr(save);
  const st = save.standings[my] || { w: 0, l: 0 };
  const conf = confOf(my);
  const myRank = confRanking(save, conf).find(r => r.abbr === my);
  const madePlayoffs = !!(save.playoffs && save.playoffs.userSeries) || (save.playoffs && save.playoffs.userResult && save.playoffs.userResult !== "未进季后赛");
  const awards = seasonAwards(save);
  /* 奖项获奖人 */
  const mvp = awards.mvp[0] || null;
  const dpoy = awards.dpoy[0] || null;
  const sixth = awards.sixth;
  const scoring = awards.scoring;
  const assists = awards.assists;
  const rebounds = awards.rebounds;
  const bestRookie = awards.bestRookie;
  const awardRow = (icon, c, highlight, statFmt) => {
    if (!c) return '<div class="aw-row"><span class="aw-rank">' + icon + '</span><div class="aw-name">暂无数据</div></div>';
    const statTxt = statFmt ? statFmt(c.st) : (c.st ? c.st.ppg.toFixed(1) + "分 " + c.st.rpg.toFixed(1) + "板 " + c.st.apg.toFixed(1) + "助" : (c.v ? c.v.toFixed(1) + "分/场" : ""));
    return '<div class="aw-row' + (highlight ? " me" : "") + '"><span class="aw-rank">' + icon + "</span>" +
      '<div class="aw-name">' + esc(c.p.nameCn) + '<span class="aw-team">' + esc(teamName(c.p.team)) + "</span></div>" +
      '<div class="aw-line">' + (statTxt || "") + "</div></div>";
  };
  const POS_LABEL = ["G", "G", "F", "F", "C"];
  const teamCard = (title, members) => {
    if (!members || members.length === 0) return "";
    const rows = members.map((m, i) => {
      const st = m.st || {};
      const statLine = '<span class="tm-stats">' +
        (st.ppg != null ? st.ppg.toFixed(1) + "分" : "-") + " " +
        (st.rpg != null ? st.rpg.toFixed(1) + "板" : "-") + " " +
        (st.apg != null ? st.apg.toFixed(1) + "助" : "-") +
        (st.spg != null && st.bpg != null ? " · " + st.spg.toFixed(1) + "断 " + st.bpg.toFixed(1) + "帽" : "") +
        "</span>";
      return '<div class="tm-row' + (m.mine ? " me" : "") + '">' +
        '<span class="tm-pos">' + POS_LABEL[i % POS_LABEL.length] + '</span>' +
        '<div class="ovr-badge ' + ovrClass(m.p.ovr) + '">' + m.p.ovr + '</div>' +
        '<div class="tm-main">' +
        '<div class="tm-name">' + esc(m.p.nameCn) + '</div>' +
        '<div class="tm-sub"><span class="tm-team">' + esc(teamName(m.p.team)) + '</span>' + statLine + '</div>' +
        '</div>' +
        '</div>';
    }).join("");
    return '<div class="se-card tm-group"><h3>' + title + '</h3>' + rows + '</div>';
  };
  const dpoyFmt = st => st ? st.spg.toFixed(1) + "断 " + st.bpg.toFixed(1) + "帽" : "";
  const sixthFmt = st => st ? st.ppg.toFixed(1) + "分 " + st.rpg.toFixed(1) + "板 " + st.apg.toFixed(1) + "助" : "";
  $("#screen-regular-end").innerHTML =
    '<h2 class="screen-title">常规赛结束</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季常规赛 · 战绩 " + st.w + "-" + st.l +
    (myRank ? " · " + confLabel(conf) + "第" + myRank.seed + "位" : "") + "</p>" +
    '<div class="se-card' + (madePlayoffs ? " gold" : "") + '">' +
    '<div class="champ-line">' + (madePlayoffs ? "🏀 恭喜！你的球队进入季后赛！" : "赛季结束，你的球队未进入季后赛") + "</div>" +
    '<div class="ng-meta">' + esc(confLabel(conf)) + "排名：第 " + (myRank ? myRank.seed : "?") + " 位 · 胜率 " + (st.w + st.l ? ((st.w / (st.w + st.l)) * 100).toFixed(1) : "0") + "%</div></div>" +
    '<div class="se-card"><h3>年度个人奖项</h3>' +
    awardRow("MVP", mvp, true) +
    awardRow("DPOY", dpoy, false, dpoyFmt) +
    awardRow("ROY", bestRookie, false) +
    awardRow("6MOY", sixth, false, sixthFmt) +
    awardRow("得分王", scoring) +
    awardRow("助攻王", assists) +
    awardRow("篮板王", rebounds) +
    "</div>" +
    '<h3 class="section-h">最佳阵容</h3>' +
    teamCard("最佳阵容 一阵", awards.allNBA1) +
    teamCard("最佳阵容 二阵", awards.allNBA2) +
    teamCard("最佳阵容 三阵", awards.allNBA3) +
    '<h3 class="section-h">最佳防守阵容</h3>' +
    teamCard("最佳防守 一阵", awards.allDef1) +
    teamCard("最佳防守 二阵", awards.allDef2) +
    '<h3 class="section-h">最佳新秀阵容</h3>' +
    teamCard("最佳新秀 一阵", awards.allRookie1) +
    teamCard("最佳新秀 二阵", awards.allRookie2) +
    (madePlayoffs
      ? '<button class="btn btn-primary" id="btn-to-playoffs">进入季后赛</button>'
      : '<button class="btn btn-primary" id="btn-to-seasonend">查看赛季总结</button>') +
    '<button class="btn btn-outline" id="re-hub">返回经理室</button>';
  const btnPO = $("#btn-to-playoffs");
  if (btnPO) btnPO.onclick = () => {
    toast("季后赛开始！");
    RENDERERS.hub();
    state.stack = [];
    activate("hub");
  };
  const btnSE = $("#btn-to-seasonend");
  if (btnSE) btnSE.onclick = () => {
    go("seasonend");
  };
  $("#re-hub").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
};

/* ===== 赛季总结 ===== */
RENDERERS.seasonend = function () {
  const save = state.save;
  /* 休赛期：重置交易截止日，允许休赛期交易 */
  if (save.tradeDeadlinePassed) {
    save.tradeDeadlinePassed = false;
    writeSave(save);
  }
  const ps = save.playoffs;
  const my = myAbbr(save);
  const st = save.standings[my] || { w: 0, l: 0 };
  const myRank = confRanking(save, confOf(my)).find(r => r.abbr === my);
  const awards = seasonAwards(save);
  const iChamp = ps && ps.champion === my;
  const awardWinners = [
    { icon: "MVP", c: awards.mvp[0], highlight: true, fmt: null },
    { icon: "DPOY", c: awards.dpoy[0], fmt: st => st ? st.spg.toFixed(1) + "断 " + st.bpg.toFixed(1) + "帽" : "" },
    { icon: "ROY", c: awards.bestRookie, fmt: null },
    { icon: "6MOY", c: awards.sixth, fmt: st => st ? st.ppg.toFixed(1) + "分 " + st.rpg.toFixed(1) + "板 " + st.apg.toFixed(1) + "助" : "" },
    { icon: "得分王", c: awards.scoring, fmt: null },
    { icon: "助攻王", c: awards.assists, fmt: null },
    { icon: "篮板王", c: awards.rebounds, fmt: null }
  ];
  const winnerRows = awardWinners.map(w => {
    if (!w.c) return '<div class="aw-row"><span class="aw-rank">' + w.icon + '</span><div class="aw-name">暂无数据</div></div>';
    const statTxt = w.fmt ? w.fmt(w.c.st) : (w.c.st ? w.c.st.ppg.toFixed(1) + "分 " + w.c.st.rpg.toFixed(1) + "板 " + w.c.st.apg.toFixed(1) + "助" : (w.c.v ? w.c.v.toFixed(1) + "分/场" : ""));
    return '<div class="aw-row' + (w.highlight ? " me" : "") + '"><span class="aw-rank">' + w.icon + "</span>" +
      '<div class="aw-name">' + esc(w.c.p.nameCn) + '<span class="aw-team">' + esc(teamName(w.c.p.team)) + "</span></div>" +
      '<div class="aw-line">' + (statTxt || "") + "</div></div>";
  }).join("");
  /* 位置标签：2G 2F 1C */
  const POS_LABEL = ["G", "G", "F", "F", "C"];
  const teamCard = (title, members) => {
    if (!members || members.length === 0) return "";
    const rows = members.map((m, i) => {
      const st = m.st || {};
      const statLine = '<span class="tm-stats">' +
        (st.ppg != null ? st.ppg.toFixed(1) + "分" : "-") + " " +
        (st.rpg != null ? st.rpg.toFixed(1) + "板" : "-") + " " +
        (st.apg != null ? st.apg.toFixed(1) + "助" : "-") +
        (st.spg != null && st.bpg != null ? " · " + st.spg.toFixed(1) + "断 " + st.bpg.toFixed(1) + "帽" : "") +
        "</span>";
      return '<div class="tm-row' + (m.mine ? " me" : "") + '">' +
        '<span class="tm-pos">' + POS_LABEL[i % POS_LABEL.length] + '</span>' +
        '<div class="ovr-badge ' + ovrClass(m.p.ovr) + '">' + m.p.ovr + '</div>' +
        '<div class="tm-main">' +
        '  <div class="tm-name">' + esc(m.p.nameCn) + '</div>' +
        '  <div class="tm-sub"><span class="tm-team">' + esc(teamName(m.p.team)) + '</span>' + statLine + '</div>' +
        "</div>" +
        '</div>';
    }).join("");
    return '<div class="se-card tm-group"><h3>' + title + '</h3>' + rows + '</div>';
  };
  $("#screen-seasonend").innerHTML =
    '<h2 class="screen-title">赛季总结</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季 · 常规赛 " + st.w + "-" + st.l +
    (myRank ? " · " + confLabel(confOf(my)) + "第" + myRank.seed + "位" : "") + "</p>" +
    '<div class="se-card' + (iChamp ? " gold" : "") + '">' +
    '<div class="champ-line">' + (iChamp ? "🏆 恭喜！你夺得了总冠军" : "🏆 总冠军：" + esc(teamName(ps ? ps.champion : null))) + "</div>" +
    '<div class="ng-meta">你的季后赛结果：' + esc(ps ? (ps.userResult || "未进季后赛") : "未进季后赛") + "</div></div>" +
    (awards.fmvp ? '<div class="se-card gold"><h3>FMVP · 总决赛 MVP</h3>' +
      '<div class="aw-row me"><span class="aw-rank">FMVP</span>' +
      '<div class="aw-name">' + esc(awards.fmvp.p.nameCn) + '<span class="aw-team">' + esc(teamName(awards.fmvp.p.team)) + "</span></div>" +
      '<div class="aw-line">' + awards.fmvp.st.ppg.toFixed(1) + "分 " + awards.fmvp.st.rpg.toFixed(1) + "板 " + awards.fmvp.st.apg.toFixed(1) + "助" + "</div></div></div>" : "") +
    '<div class="se-card"><h3>🏆 年度个人奖项</h3>' + winnerRows + "</div>" +
    '<h3 class="section-h">最佳阵容</h3>' +
    teamCard("最佳阵容 一阵", awards.allNBA1, "1") +
    teamCard("最佳阵容 二阵", awards.allNBA2, "2") +
    teamCard("最佳阵容 三阵", awards.allNBA3, "3") +
    '<h3 class="section-h">最佳防守阵容</h3>' +
    teamCard("最佳防守 一阵", awards.allDef1, "1") +
    teamCard("最佳防守 二阵", awards.allDef2, "2") +
    '<h3 class="section-h">最佳新秀阵容</h3>' +
    teamCard("最佳新秀 一阵", awards.allRookie1, "1") +
    teamCard("最佳新秀 二阵", awards.allRookie2, "2") +
    '<button class="btn btn-primary" id="btn-newseason">开启第 ' + (save.seasonNo + 1) + " 赛季</button>" +
    '<button class="btn btn-outline" id="btn-se-trade">休赛期交易</button>' +
    '<button class="btn btn-outline" id="se-hub">返回经理室</button>';
  $("#btn-newseason").onclick = () => {
    newSeason(save);
    initDraftPicks(save);  /* 生成新赛季选秀权 */
    writeSave(save);
    /* 退役提示 */
    if (save.retireLog && save.retireLog.length) {
      const names = save.retireLog.map(r => r.name + "(" + r.age + "岁/" + r.ovr + ")").join("、");
      toast("👋 退役：" + names);
    }
    /* 名人堂入选提示 */
    if (save.hofNewInductees && save.hofNewInductees.length) {
      const names = save.hofNewInductees.map(h => h.name).join("、");
      toast("名人堂入选：" + names);
    }
    if (save.pendingDraft) {
      save.pendingDraft = false;
      /* 使用赛季中球探考察的新秀池，缺失时临时生成 */
      const class_ = (save.upcomingDraft && save.upcomingDraft.length) ? save.upcomingDraft : genDraftClass(save);
      state.draft = { class_, pickOrder: null, currentIdx: 0, pickedIds: null, results: null, draftLog: null };
      go("draft");
    } else {
      toast("第 " + save.seasonNo + " 赛季开始！");
      RENDERERS.hub(); state.stack = []; activate("hub");
    }
  };
  $("#se-hub").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
  const seTrade = $("#btn-se-trade");
  if (seTrade) seTrade.onclick = () => go("trade");
};

/* ===== 交易中心 ===== */
state.trade = { aiTeam: null, myPicks: [], aiPicks: [], myDraftPicks: [], aiDraftPicks: [], result: null };
RENDERERS.trade = function () {
  const save = state.save;
  /* 守卫：交易截止日已过则禁止进入交易 */
  if (save.tradeDeadlinePassed) {
    toast("🚫 交易截止日已过，本赛季不再允许交易");
    RENDERERS.hub(); state.stack = []; activate("hub");
    return;
  }
  const my = myAbbr(save);
  const others = TEAMS.filter(t => t.abbr !== my).map(t => ({
    ...t, str: teamStrength(t.abbr), val: teamStrength(t.abbr).toFixed(1),
    status: teamStatus(save, t.abbr)
  })).sort((a, b) => b.str - a.str);
  const statusBadgeHtml = (s) => {
    const cls = s === "contending" ? "badge-contend" : s === "tanking" ? "badge-tank" : "badge-rebuild";
    const txt = s === "contending" ? "争冠中" : s === "tanking" ? "摆烂中" : "补强中";
    return '<span class="team-status ' + cls + '">' + txt + "</span>";
  };
  $("#screen-trade").innerHTML =
    '<h2 class="screen-title">交易中心</h2>' +
    '<p class="screen-sub">选择交易对象，发起球员交换谈判 · 状态影响交易意愿</p>' +
    '<div class="trade-team-grid">' +
    others.map(t =>
      '<div class="trade-team-card" data-abbr="' + t.abbr + '">' +
      '  <div class="trade-team-logo">' + teamLogoHtml(t.abbr) + "</div>" +
      '  <div class="trade-team-name">' + esc(t.nameCn) + "</div>" +
      '  <div class="trade-team-str">★' + stars(t.str) + " · " + t.val + "</div>" +
      statusBadgeHtml(t.status) +
      "</div>"
    ).join("") +
    "</div>";
  $$("#screen-trade .trade-team-card").forEach(card => {
    card.onclick = () => {
      state.trade.aiTeam = card.dataset.abbr;
      state.trade.myPicks = [];
      state.trade.aiPicks = [];
      state.trade.myDraftPicks = [];
      state.trade.aiDraftPicks = [];
      state.trade.result = null;
      go("trade-deal");
    };
  });
};

/* ===== 交易谈判 ===== */
/* 生成球员价值徽章：彩色数值 + 星级 + 悬停明细 */
function valBadgeHtml(p, salary, ctx) {
  const d = tradeValueDetail(p, salary, ctx);
  const t = valueTier(d.value);
  const stars = "★".repeat(t.stars) + '<span class="v-star-off">★</span>'.repeat(5 - t.stars);
  const bd = d.breakdown;
  const tip =
    '<div class="vtip-title">' + esc(p.nameCn) + ' · 价值 ' + d.value + '</div>' +
    '<div class="vtip-row"><span>基础(OVR)</span><b>+' + bd.base + '</b></div>' +
    (bd.age ? '<div class="vtip-row"><span>年龄</span><b class="' + (bd.age >= 0 ? "pos" : "neg") + '">' + (bd.age >= 0 ? "+" : "") + bd.age + '</b></div>' : "") +
    (bd.position ? '<div class="vtip-row"><span>位置稀缺</span><b class="pos">+' + bd.position + '</b></div>' : "") +
    (bd.salary ? '<div class="vtip-row"><span>合同性价比</span><b class="' + (bd.salary >= 0 ? "pos" : "neg") + '">' + (bd.salary >= 0 ? "+" : "") + bd.salary + '</b></div>' : "") +
    (bd.rookie ? '<div class="vtip-row"><span>新秀合同</span><b class="pos">+' + bd.rookie + '</b></div>' : "") +
    (bd.contractYears != null ? '<div class="vtip-row"><span>剩余年限</span><b class="' + (bd.contractYears >= 0 ? "pos" : "neg") + '">' + (bd.contractYears >= 0 ? "+" : "") + bd.contractYears + '</b></div>' : "") +
    (bd.potential != null ? '<div class="vtip-row"><span>潜力</span><b class="pos">+' + bd.potential + '</b></div>' : "") +
    (bd.morale != null ? '<div class="vtip-row"><span>士气</span><b class="' + (bd.morale >= 0 ? "pos" : "neg") + '">' + (bd.morale >= 0 ? "+" : "") + bd.morale + '</b></div>' : "") +
    (bd.birdRights != null ? '<div class="vtip-row"><span>鸟权</span><b class="' + (bd.birdRights >= 0 ? "pos" : "neg") + '">' + (bd.birdRights >= 0 ? "+" : "") + bd.birdRights + '</b></div>' : "") +
    (bd.teamNeed != null ? '<div class="vtip-row"><span>球队需求</span><b class="' + (bd.teamNeed >= 0 ? "pos" : "neg") + '">' + (bd.teamNeed >= 0 ? "+" : "") + bd.teamNeed + '</b></div>' : "");
  return '<span class="val-badge ' + t.color + '">' + d.value + ' ' + stars + '<span class="vtip">' + tip + '</span></span>';
}

RENDERERS["trade-deal"] = function () {
  const save = state.save;
  const aiTeam = state.trade.aiTeam;
  const aiT = TEAMS.find(t => t.abbr === aiTeam);
  const myAbbrCode = myAbbr(save);
  const mine = loadMyPlayers(save).map(x => {
    const entry = save.roster.find(r => r.id === x.p.id) || {};
    return {
      p: x.p, sal: x.sal,
      ctx: {
        years: entry.years || 0, morale: moraleOf(save, x.p.id),
        potential: x.p.potential, birdYears: entry.birdYears || 0,
        needBonus: positionNeedBonus(save, myAbbrCode, x.p.pos)
      }
    };
  });
  /* AI 球员显示「我方需求加成」：我队缺什么位置，对方那个位置球员就更值钱 */
  const tradable = getTradable(aiTeam, save).map(x => ({
    p: x.p, sal: estimateSalary(x.p.ovr, x.p.id), untouchable: !!x.untouchable,
    ctx: {
      years: 2, potential: x.p.potential, birdYears: 0,
      needBonus: positionNeedBonus(save, myAbbrCode, x.p.pos)
    }
  }));
  const myPicks = state.trade.myPicks;
  const aiPicks = state.trade.aiPicks;
  const myDPicks = state.trade.myDraftPicks;
  const aiDPicks = state.trade.aiDraftPicks;
  /* 选秀权数据 */
  const myPickPool = getTeamPicks(save, myAbbr(save));
  const aiPickPool = getTeamPicks(save, aiTeam);
  /* 包裹总价值（边际递减）：头牌足额、添头大幅折价，与 AI 评估口径一致 */
  const myVal = Math.round(packagedValue(myPicks, myDPicks, x => tradeValue(x.p, x.sal, x.ctx)));
  const aiVal = Math.round(packagedValue(aiPicks, aiDPicks, x => tradeValue(x.p, x.sal, x.ctx)));
  const result = state.trade.result;
  const mySal = myPicks.reduce((s, x) => s + x.sal, 0);
  const aiSal = aiPicks.reduce((s, x) => s + x.sal, 0);
  const hasOffer = (myPicks.length + myDPicks.length) && (aiPicks.length + aiDPicks.length);

  /* 实时薪资配平指示器（双方视角） */
  let matchHtml = "";
  if (myPicks.length || aiPicks.length) {
    const myPayroll0 = save.roster.reduce((s, r) => s + (r.salary || 0), 0);
    const fin0 = aiTeamFinances(save, aiTeam);
    const uOk = salaryMatchOk(mySal, aiSal, myPayroll0 - mySal);
    const aOk = salaryMatchOk(aiSal, mySal, fin0.payroll - aiSal);
    const pill = (ok, label, detail) =>
      '<span class="td-match ' + (ok ? "ok" : "bad") + '">' + (ok ? "✓" : "✗") + " " + label +
      (detail ? '<small>' + detail + "</small>" : "") + "</span>";
    const uDetail = uOk.ok ? "" : "上限 " + fmtM(uOk.max);
    const aDetail = aOk.ok ? "" : "上限 " + fmtM(aOk.max);
    matchHtml = '<div class="td-match-row">' +
      pill(uOk.ok, "你方配平", uDetail) + pill(aOk.ok, "对方配平", aDetail) + "</div>";
  }

  const pickList = (arr, side) =>
    arr.length ? arr.map(x =>
      '<div class="trade-pick">' +
      '<div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '<div class="tp-name">' + esc(x.p.nameCn) + "</div>" +
      '<div class="tp-meta">' + esc(posLabel(x.p)) + " · " + (x.p.age || "-") + "岁 · " + fmtM(x.sal) + "</div>" +
      '<div class="tp-val">' + valBadgeHtml(x.p, x.sal, x.ctx) + "</div>" +
      '<button class="tp-remove" data-side="' + side + '" data-id="' + x.p.id + '">✕</button></div>'
    ).join("") : "";
  const draftPickList = (arr, side) =>
    arr.length ? arr.map((pk, i) =>
      '<div class="trade-pick draft-pick-item">' +
      '<div class="dp-icon">🏀</div>' +
      '<div class="tp-name">' + (pk.round === 1 ? "首轮" : "次轮") + " #" + (pk.pick || "?") + "</div>" +
      '<div class="tp-meta">原属 ' + esc(teamName(pk.originalTeam)) + "</div>" +
      '<div class="tp-val">价值 ' + pickValue(pk) + "</div>" +
      '<button class="tp-remove" data-side="' + side + '" data-dpick="' + i + '">✕</button></div>'
    ).join("") : "";

  $("#screen-trade-deal").innerHTML =
    '<h2 class="screen-title">交易谈判</h2>' +
    '<div class="trade-deal-header">' +
    '  <div class="td-side">' + teamLogoHtml(myAbbr(save)) + "<div><b>" + esc(save.team.displayName) + "</b><span>你方</span></div></div>" +
    '  <div class="td-center"><div class="td-val">' + myVal + " vs " + aiVal + '<small>包裹价值 · 添头边际递减</small></div><div class="td-sal">' + fmtM(mySal) + " ↔ " + fmtM(aiSal) + "</div>" + matchHtml + "</div>" +
    '  <div class="td-side">' + teamLogoHtml(aiTeam) + "<div><b>" + esc(aiT.nameCn) + "</b><span>对方 · " + (STATUS_LABELS[teamStatus(save, aiTeam)] || "") + "</span></div></div>" +
    "</div>" +
    (result ? '<div class="trade-result ' + (result.accept ? "accept" : "reject") + '">' +
      '<div class="tr-icon">' + (result.accept ? "✓" : "✗") + "</div>" +
      '<div class="tr-text">' + esc(result.reason) + "</div>" +
      (result.counter ? '<button class="btn btn-outline" id="btn-counter">接受还价</button><button class="btn btn-link" id="btn-reject">拒绝</button>' : "") +
      (result.accept ? '<button class="btn btn-primary" id="btn-confirm">确认交易</button>' : "") +
      "</div>" : "") +
    '<div class="trade-cols">' +
    '  <div class="trade-col"><h3 class="tc-h">你方出让</h3>' + pickList(myPicks, "my") + draftPickList(myDPicks, "my") + (hasOffer ? "" : '<div class="trade-empty">选择球员或选秀权</div>') + "</div>" +
    '  <div class="trade-col"><h3 class="tc-h">对方出让</h3>' + pickList(aiPicks, "ai") + draftPickList(aiDPicks, "ai") + "</div>" +
    "</div>" +
    '<div class="trade-actions">' +
    '  <button class="btn btn-primary" id="btn-propose" ' + (hasOffer ? "" : "disabled") + '>发起报价</button>' +
    '  <button class="btn btn-outline" id="btn-back-trade">返回</button>' +
    "</div>" +
    '<div class="trade-rosters">' +
    '  <div class="tr-sec"><h3 class="tc-h">你的阵容</h3>' +
    mine.sort((a, b) => b.p.ovr - a.p.ovr).map(x =>
      '<div class="tr-row' + (myPicks.find(p => p.p.id === x.p.id) ? " picked" : "") + '" data-id="' + x.p.id + '" data-side="my">' +
      '<div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '<div class="tr-name">' + esc(x.p.nameCn) + '</div>' +
      '<div class="tr-meta">' + esc(posLabel(x.p)) + " · " + fmtM(x.sal) + "</div>" +
      '<div class="tr-val">' + valBadgeHtml(x.p, x.sal, x.ctx) + "</div></div>"
    ).join("") + "</div>" +
    '  <div class="tr-sec"><h3 class="tc-h">' + esc(aiT.nameCn) + ' 阵容</h3>' +
    tradable.map(x =>
      '<div class="tr-row' + (x.untouchable ? " untouchable" : "") + (aiPicks.find(p => p.p.id === x.p.id) ? " picked" : "") + '" data-id="' + x.p.id + '" data-side="ai">' +
      '<div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '<div class="tr-name">' + esc(x.p.nameCn) + (x.untouchable ? ' <span class="tr-lock">非卖品</span>' : "") + '</div>' +
      '<div class="tr-meta">' + esc(posLabel(x.p)) + " · " + fmtM(x.sal) + "</div>" +
      '<div class="tr-val">' + (x.untouchable ? '<span class="val-badge t6">非卖品</span>' : valBadgeHtml(x.p, x.sal, x.ctx)) + "</div></div>"
    ).join("") + "</div>" +
    "</div>" +
    /* 选秀权区域 */
    '<div class="trade-rosters">' +
    '  <div class="tr-sec"><h3 class="tc-h">你的选秀权</h3>' +
    (myPickPool.length ? myPickPool.map(pk => {
      const est = estimatePickPosition(save, pk);
      const picked = myDPicks.find(d => d.originalTeam === pk.originalTeam && d.round === pk.round);
      return '<div class="tr-row dp-row' + (picked ? " picked" : "") + '" data-round="' + pk.round + '" data-orig="' + pk.originalTeam + '" data-side="my">' +
        '<div class="dp-icon">🏀</div>' +
        '<div class="tr-name">' + (pk.round === 1 ? "首轮" : "次轮") + " #" + est + '</div>' +
        '<div class="tr-meta">原属 ' + esc(teamName(pk.originalTeam)) + "</div>" +
        '<div class="tr-val">价值 ' + pickValue({ round: pk.round, pick: est }) + "</div></div>";
    }).join("") : '<div class="trade-empty">无可用选秀权</div>') + "</div>" +
    '  <div class="tr-sec"><h3 class="tc-h">' + esc(aiT.nameCn) + ' 选秀权</h3>' +
    (aiPickPool.length ? aiPickPool.map(pk => {
      const est = estimatePickPosition(save, pk);
      const picked = aiDPicks.find(d => d.originalTeam === pk.originalTeam && d.round === pk.round);
      return '<div class="tr-row dp-row' + (picked ? " picked" : "") + '" data-round="' + pk.round + '" data-orig="' + pk.originalTeam + '" data-side="ai">' +
        '<div class="dp-icon">🏀</div>' +
        '<div class="tr-name">' + (pk.round === 1 ? "首轮" : "次轮") + " #" + est + '</div>' +
        '<div class="tr-meta">原属 ' + esc(teamName(pk.originalTeam)) + "</div>" +
        '<div class="tr-val">价值 ' + pickValue({ round: pk.round, pick: est }) + "</div></div>";
    }).join("") : '<div class="trade-empty">无可用选秀权</div>') + "</div>" +
    "</div>";

  /* 球员选择 */
  $$("#screen-trade-deal .tr-row:not(.dp-row):not(.untouchable)").forEach(row => {
    row.onclick = () => {
      const id = Number(row.dataset.id);
      const side = row.dataset.side;
      const picks = side === "my" ? state.trade.myPicks : state.trade.aiPicks;
      const pool = side === "my" ? mine : tradable;
      const existing = picks.findIndex(x => x.p.id === id);
      if (existing >= 0) picks.splice(existing, 1);
      else { const x = pool.find(p => p.p.id === id); if (x) picks.push(x); }
      state.trade.result = null;
      RENDERERS["trade-deal"]();
    };
  });
  /* 选秀权选择 */
  $$("#screen-trade-deal .dp-row").forEach(row => {
    row.onclick = () => {
      const side = row.dataset.side;
      const round = Number(row.dataset.round);
      const orig = row.dataset.orig;
      const dPicks = side === "my" ? state.trade.myDraftPicks : state.trade.aiDraftPicks;
      const pool = side === "my" ? myPickPool : aiPickPool;
      const existing = dPicks.findIndex(pk => pk.originalTeam === orig && pk.round === round);
      if (existing >= 0) dPicks.splice(existing, 1);
      else { const pk = pool.find(p => p.originalTeam === orig && p.round === round); if (pk) dPicks.push(pk); }
      state.trade.result = null;
      RENDERERS["trade-deal"]();
    };
  });
  /* 移除按钮（球员） */
  $$("#screen-trade-deal .tp-remove[data-id]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const side = btn.dataset.side;
      const picks = side === "my" ? state.trade.myPicks : state.trade.aiPicks;
      const idx = picks.findIndex(x => x.p.id === id);
      if (idx >= 0) picks.splice(idx, 1);
      state.trade.result = null;
      RENDERERS["trade-deal"]();
    };
  });
  /* 移除按钮（选秀权） */
  $$("#screen-trade-deal .tp-remove[data-dpick]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const side = btn.dataset.side;
      const idx = Number(btn.dataset.dpick);
      const dPicks = side === "my" ? state.trade.myDraftPicks : state.trade.aiDraftPicks;
      if (idx >= 0 && idx < dPicks.length) dPicks.splice(idx, 1);
      state.trade.result = null;
      RENDERERS["trade-deal"]();
    };
  });
  const bp = $("#btn-propose");
  if (bp) bp.onclick = () => {
    const res = aiEvaluateTrade(save, aiTeam, myPicks, aiPicks, myDPicks, aiDPicks);
    state.trade.result = res;
    RENDERERS["trade-deal"]();
  };
  const bc = $("#btn-counter");
  if (bc) bc.onclick = () => {
    if (state.trade.result && state.trade.result.counter) {
      const c = state.trade.result.counter;
      const idx = aiPicks.findIndex(x => x.p.id === c.out.p.id);
      if (idx >= 0) aiPicks.splice(idx, 1, c.in);
      else aiPicks.push(c.in);
      state.trade.result = null;
      const res = aiEvaluateTrade(save, aiTeam, myPicks, aiPicks, myDPicks, aiDPicks);
      state.trade.result = res;
      RENDERERS["trade-deal"]();
    }
  };
  const br = $("#btn-reject");
  if (br) br.onclick = () => { state.trade.result = null; RENDERERS["trade-deal"](); };
  const bconf = $("#btn-confirm");
  if (bconf) bconf.onclick = () => {
    executeTrade(save, myAbbr(save), myPicks.map(x => x.p.id), aiPicks.map(x => x.p.id), aiTeam, myDPicks, aiDPicks);
    toast("交易完成！");
    state.stack = [];
    RENDERERS.hub(); activate("hub");
  };
  $("#btn-back-trade").onclick = () => back();
};

/* ===== 交易搜索器 ===== */
state.tradeSearch = { offers: [], filter: "all", posFilter: "all", openPlayer: null };
RENDERERS["trade-search"] = function () {
  const save = state.save;
  if (save.tradeDeadlinePassed) {
    toast("交易截止日已过");
    RENDERERS.hub(); state.stack = []; activate("hub");
    return;
  }
  /* 搜索或使用缓存 */
  if (!state.tradeSearch.offers.length) {
    state.tradeSearch.offers = searchTradeOffers(save);
  }
  const offers = state.tradeSearch.offers;
  const filter = state.tradeSearch.filter;
  const posFilter = state.tradeSearch.posFilter;
  let filtered = filter === "all" ? offers : offers.filter(o => o.rating === filter);
  /* 位置筛选：按 AI 球员位置过滤 */
  const posCount = { G: 0, F: 0, C: 0 };
  offers.forEach(o => { const c = catOf(o.aiPlayer.pos); if (c) posCount[c]++; });
  if (posFilter !== "all") {
    filtered = filtered.filter(o => catOf(o.aiPlayer.pos) === posFilter);
  }
  /* 按用户球员分组 */
  const byPlayer = {};
  filtered.forEach(o => {
    const k = o.myPlayer.id;
    (byPlayer[k] = byPlayer[k] || []).push(o);
  });
  const playerIds = Object.keys(byPlayer).map(Number);
  /* 按该球员的最佳报价评级排序 */
  playerIds.sort((a, b) => {
    const ra = byPlayer[a][0].rating === "steal" ? 0 : byPlayer[a][0].rating === "good" ? 1 : 2;
    const rb = byPlayer[b][0].rating === "steal" ? 0 : byPlayer[b][0].rating === "good" ? 1 : 2;
    return ra - rb;
  });
  const openId = state.tradeSearch.openPlayer;
  $("#screen-trade-search").innerHTML =
    '<h2 class="screen-title">交易搜索器</h2>' +
    '<p class="screen-sub">扫描全联盟 29 队，找到 AI 会接受的 1v1 交易方案</p>' +
    '<div class="ts-tabs">' +
    '  <button class="ts-tab' + (filter === "all" ? " active" : "") + '" data-f="all">全部 (' + offers.length + ')</button>' +
    '  <button class="ts-tab' + (filter === "steal" ? " active" : "") + '" data-f="steal">超值 (' + offers.filter(o => o.rating === "steal").length + ')</button>' +
    '  <button class="ts-tab' + (filter === "good" ? " active" : "") + '" data-f="good">公道 (' + offers.filter(o => o.rating === "good").length + ')</button>' +
    '  <button class="ts-tab' + (filter === "fair" ? " active" : "") + '" data-f="fair">可接受 (' + offers.filter(o => o.rating === "fair").length + ')</button>' +
    '</div>' +
    '<div class="ts-tabs ts-pos-tabs">' +
    '  <button class="ts-tab' + (posFilter === "all" ? " active" : "") + '" data-pf="all">全部位置</button>' +
    '  <button class="ts-tab' + (posFilter === "G" ? " active" : "") + '" data-pf="G">后卫 (' + posCount.G + ')</button>' +
    '  <button class="ts-tab' + (posFilter === "F" ? " active" : "") + '" data-pf="F">前锋 (' + posCount.F + ')</button>' +
    '  <button class="ts-tab' + (posFilter === "C" ? " active" : "") + '" data-pf="C">中锋 (' + posCount.C + ')</button>' +
    '</div>' +
    (playerIds.length === 0
      ? '<div class="empty-stats">暂无符合的交易方案</div>'
      : playerIds.map(pid => {
        const list = byPlayer[pid];
        const p = list[0].myPlayer;
        const isOpen = openId === pid;
        const stealN = list.filter(o => o.rating === "steal").length;
        const goodN = list.filter(o => o.rating === "good").length;
        const tags = [];
        if (stealN) tags.push('<span class="ts-count ts-tag-steal">超值' + stealN + '</span>');
        if (goodN) tags.push('<span class="ts-count ts-tag-good">公道' + goodN + '</span>');
        if (list.length - stealN - goodN > 0) tags.push('<span class="ts-count ts-tag-fair">其他' + (list.length - stealN - goodN) + '</span>');
        return '<div class="ts-player-group' + (isOpen ? " open" : "") + '">' +
          '<div class="ts-player-header" data-pid="' + pid + '">' +
          '  <div class="ovr-badge ' + ovrClass(p.ovr) + '">' + p.ovr + '</div>' +
          '  <div class="ts-player-name">' + esc(p.nameCn) + '</div>' +
          '  <div class="ts-player-count">' + list.length + ' 条报价</div>' +
          '  <div class="ts-player-tags">' + tags.join("") + '</div>' +
          '  <span class="ts-chevron">' + (isOpen ? "▾" : "▸") + '</span>' +
          '</div>' +
          (isOpen
            ? '<div class="ts-offer-list">' + list.map(o => {
              const myT = valueTier(o.myVal);
              const aiT = valueTier(o.aiVal);
              return '<div class="ts-offer ts-' + o.rating + '" data-my="' + o.myPlayer.id + '" data-ai="' + o.aiPlayer.id + '" data-team="' + o.aiTeam + '">' +
                '<div class="ts-side ts-theirs">' +
                '  <div class="ovr-badge ' + ovrClass(o.aiPlayer.ovr) + '">' + o.aiPlayer.ovr + '</div>' +
                '  <div class="ts-name">' + esc(o.aiPlayer.nameCn) + '</div>' +
                '  <div class="ts-val ' + aiT.color + '">★' + aiT.stars + ' (' + o.aiVal + ')</div>' +
                '  <div class="ts-team">' + esc(teamName(o.aiTeam)) + '</div>' +
                '</div>' +
                '<div class="ts-tag ts-tag-' + o.rating + '">' + o.ratingLabel + '</div>' +
                '</div>';
            }).join("") + '</div>'
            : "") +
          '</div>';
      }).join("")) +
    '<button class="btn btn-outline" id="ts-refresh">🔄 刷新搜索</button>' +
    '<button class="btn btn-outline" id="ts-back">返回经理室</button>';
  $("#ts-back").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
  $("#ts-refresh").onclick = () => {
    state.tradeSearch.offers = [];
    state.tradeSearch.openPlayer = null;
    toast("正在扫描全联盟...");
    state.tradeSearch.offers = searchTradeOffers(save);
    RENDERERS["trade-search"]();
  };
  $$("#screen-trade-search .ts-tab[data-f]").forEach(tab => {
    tab.onclick = () => {
      state.tradeSearch.filter = tab.dataset.f;
      state.tradeSearch.openPlayer = null;
      RENDERERS["trade-search"]();
    };
  });
  $$("#screen-trade-search .ts-tab[data-pf]").forEach(tab => {
    tab.onclick = () => {
      state.tradeSearch.posFilter = tab.dataset.pf;
      state.tradeSearch.openPlayer = null;
      RENDERERS["trade-search"]();
    };
  });
  $$("#screen-trade-search .ts-player-header").forEach(header => {
    header.onclick = () => {
      const pid = Number(header.dataset.pid);
      state.tradeSearch.openPlayer = (state.tradeSearch.openPlayer === pid) ? null : pid;
      RENDERERS["trade-search"]();
    };
  });
  $$("#screen-trade-search .ts-offer").forEach(card => {
    card.onclick = () => {
      const myId = Number(card.dataset.my);
      const aiId = Number(card.dataset.ai);
      const aiTeam = card.dataset.team;
      /* 跳转到交易谈判页，预填球员 */
      state.trade.aiTeam = aiTeam;
      state.trade.myPicks = [];
      state.trade.aiPicks = [];
      state.trade.myDraftPicks = [];
      state.trade.aiDraftPicks = [];
      state.trade.result = null;
      /* 预选 */
      const mine = loadMyPlayers(save);
      const mp = mine.find(x => x.p.id === myId);
      if (mp) state.trade.myPicks.push(mp);
      const aiPlayers = getTradable(aiTeam, state.save);
      const ap = aiPlayers.find(x => x.p.id === aiId);
      if (ap) state.trade.aiPicks.push(ap);
      go("trade-deal");
    };
  });
};

/* ===== 教练：轮换 + 战术 ===== */
const COACH_ROLES = [
  { key: "starter", label: "首发", max: 5 },
  { key: "sixth", label: "第六人", max: 1 },
  { key: "rotation", label: "轮换" },
  { key: "dnp", label: "弃用" }
];
RENDERERS.coach = function () {
  const save = state.save;
  if (!save.coach) save.coach = { roles: {}, pace: "normal", focus: "balanced", def: "man" };
  const c = save.coach;
  const mine = loadMyPlayers(save).sort((a, b) => b.p.ovr - a.p.ovr);
  const roleOf = id => c.roles[id] || "auto";
  const count = k => mine.filter(x => roleOf(x.p.id) === k).length;

  const sel = (labels, cur) => Object.keys(labels).map(k =>
    '<option value="' + k + '"' + (cur === k ? " selected" : "") + ">" + labels[k] + "</option>").join("");

  $("#screen-coach").innerHTML =
    '<h2 class="screen-title">教练战术台</h2>' +
    '<p class="screen-sub">设置轮换与战术，将直接影响每场比赛的结果（含快速模拟）</p>' +
    '<div class="coach-tactics card-box">' +
    '  <h3 class="section-h">比赛战术</h3>' +
    '  <div class="ct-grid">' +
    '    <label>进攻节奏<select id="ct-pace">' + sel(PACE_LABELS, c.pace) + "</select></label>" +
    '    <label>进攻重心<select id="ct-focus">' + sel(FOCUS_LABELS, c.focus) + "</select></label>" +
    '    <label>防守策略<select id="ct-def">' + sel(DEF_LABELS, c.def) + "</select></label>" +
    "  </div>" +
    '  <div class="ct-hint">快攻节奏更快回合多但失误略增；外线战术多投三分、内线战术强攻篮下；联防克制三分、包夹针对球星、紧逼造失误但漏篮板。</div>' +
    "</div>" +
    '<div class="card-box">' +
    '  <h3 class="section-h">轮换设置 · 首发 <b id="ct-n-starter">' + count("starter") + '</b>/5 · 第六人 <b id="ct-n-sixth">' + count("sixth") + '</b>/1</h3>' +
    '  <div class="roster-table" id="coach-roster">' +
    mine.map(x => {
      const role = roleOf(x.p.id);
      return '<div class="r-row" data-id="' + x.p.id + '">' +
        '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
        '  <div class="r-main">' +
        '    <div class="r-name">' + esc(x.p.nameCn) + "</div>" +
        '    <div class="r-meta"><span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(posLabel(x.p)) + "</span> " + (x.p.age || "-") + "岁</div>" +
        "  </div>" +
        '  <div class="coach-roles">' +
        COACH_ROLES.map(r =>
          '<button class="cr-btn' + (role === r.key ? " active" : "") + '" data-id="' + x.p.id + '" data-role="' + r.key + '">' + r.label + "</button>"
        ).join("") +
        "  </div>" +
        "</div>";
    }).join("") +
    "</div>" +
    '<button class="btn btn-primary" id="btn-coach-save">保存教练设置</button>' +
    ' <button class="btn btn-outline" id="btn-coach-auto">按能力自动安排</button>' +
    "</div>";

  /* 角色点击：首发/第六人有数量上限，超出则忽略并提示 */
  $$("#screen-coach .cr-btn").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const role = btn.dataset.role;
      const cur = roleOf(id);
      if (cur === role) { delete c.roles[id]; }
      else {
        if (role === "starter" && count("starter") >= 5 && cur !== "starter") { toast("首发最多 5 人"); return; }
        if (role === "sixth" && count("sixth") >= 1 && cur !== "sixth") { toast("第六人最多 1 人"); return; }
        c.roles[id] = role;
      }
      RENDERERS.coach(); activate("coach", true);
    };
  });
  $("#btn-coach-save").onclick = () => {
    if (count("starter") !== 5) { toast("请先安排恰好 5 名首发（当前 " + count("starter") + " 人）"); return; }
    c.pace = $("#ct-pace").value;
    c.focus = $("#ct-focus").value;
    c.def = $("#ct-def").value;
    writeSave(save);
    toast("✓ 教练设置已保存，下一场比赛生效");
  };
  $("#btn-coach-auto").onclick = () => {
    c.roles = {};
    const sorted = loadMyPlayers(save).sort((a, b) => b.p.ovr - a.p.ovr);
    sorted.slice(0, 5).forEach(x => { c.roles[x.p.id] = "starter"; });
    if (sorted[5]) c.roles[sorted[5].p.id] = "sixth";
    RENDERERS.coach(); activate("coach", true);
    toast("已按能力值自动安排轮换");
  };
};

/* ===== 球探系统 ===== */
const SCOUT_CONCURRENT = 2;   /* 同时在外考察的球探人数 */
const SCOUT_GAMES = 10;       /* 一份球探报告需要的比赛场次 */

/* 确保新赛季的待选新秀池存在（选秀后清空，下赛季重新生成） */
function ensureUpcomingClass(save) {
  if (!save.upcomingDraft) {
    save.upcomingDraft = genDraftClass(save);
    writeSave(save);
  }
  if (!save.scouting) save.scouting = { active: [], done: {} };
  return save.upcomingDraft;
}

/* 球探报告：基于真实能力加噪声，确定性（同一名新秀报告稳定） */
function genScoutReport(r) {
  const rnd1 = hash01(r.id, 707), rnd2 = hash01(r.id, 708);
  const ovrEst = Math.round(r.ovr + (rnd1 - 0.5) * 8);
  const potEst = Math.round((r.potential || r.ovr) + (rnd2 - 0.5) * 12);
  const grade = v => v >= 93 ? "S" : v >= 87 ? "A" : v >= 79 ? "B" : v >= 68 ? "C" : "D";
  const ATTR_CN = { ins: "内线终结", out: "外线投射", org: "组织策应", def: "防守", reb: "篮板", ath: "运动能力" };
  const a = r.attrs || {};
  const sorted = Object.keys(ATTR_CN).sort((x, y) => (a[y] || 0) - (a[x] || 0));
  const strengths = sorted.slice(0, 2).map(k => ATTR_CN[k]);
  const weak = ATTR_CN[sorted[sorted.length - 1]];
  const slot = potEst >= 86 ? "乐透区" : potEst >= 76 ? "首轮行情" : potEst >= 66 ? "首轮末/次轮" : "次轮行情";
  return {
    ovrLow: Math.max(50, ovrEst - 3), ovrHigh: ovrEst + 3,
    potGrade: grade(potEst), strengths, weak, slot
  };
}

/* 每场比赛后推进球探考察进度（completeGame 中调用） */
function tickScouting(save) {
  const sc = save.scouting;
  if (!sc) return;
  let changed = false;
  sc.active = sc.active.filter(job => {
    job.gamesLeft -= 1;
    if (job.gamesLeft <= 0) {
      const r = save.upcomingDraft && save.upcomingDraft.find(x => x.id === job.id);
      if (r) { sc.done[job.id] = genScoutReport(r); changed = true; }
      return false;
    }
    changed = true;
    return true;
  });
  if (changed) writeSave(save);
}

RENDERERS.scout = function () {
  const save = state.save;
  const cls = ensureUpcomingClass(save);
  const sc = save.scouting;
  const reportOf = id => sc.done[id] || null;
  const activeOf = id => sc.active.find(j => j.id === id);

  const rows = cls.map((r, i) => {
    const rep = reportOf(r.id);
    const job = activeOf(r.id);
    const cs = r.collegeStats || {};
    let status;
    if (rep) {
      status = '<div class="sr-report">' +
        '  <div class="srr-grades"><span class="srr-pill">评分 ' + rep.ovrLow + "~" + rep.ovrHigh + '</span>' +
        '  <span class="srr-pill pot">潜力 ' + rep.potGrade + '</span>' +
        '  <span class="srr-pill">' + rep.slot + "</span></div>" +
        '  <div class="srr-tags"><span class="srr-tag up">优势：' + rep.strengths.join("、") + '</span>' +
        '  <span class="srr-tag down">短板：' + rep.weak + "</span></div>" +
        "</div>";
    } else if (job) {
      status = '<div class="sr-scouting">🔭 考察中… 还需 <b>' + job.gamesLeft + "</b> 场比赛</div>";
    } else {
      status = '<button class="btn btn-outline srr-send" data-id="' + r.id + '"' +
        (sc.active.length >= SCOUT_CONCURRENT ? " disabled" : "") + ">" +
        (sc.active.length >= SCOUT_CONCURRENT ? "球探已满" : "派球探考察（" + SCOUT_GAMES + "场）") + "</button>";
    }
    return '<div class="scout-row' + (rep ? " reported" : "") + '">' +
      '  <div class="scout-head">' +
      '    <span class="dr-rank">' + (i + 1) + "</span>" +
      '    <span class="dr-name">' + esc(r.nameCn) + ' <span class="pos-chip ' + posClass(r.pos) + '">' + esc(posLabel(r)) + "</span></span>" +
      '    <span class="dr-age">' + r.age + "岁 · " + (r.heightCm || 198) + "cm · " + esc(cs.college || "") + "</span>" +
      "  </div>" +
      '  <div class="dr-cstats">' +
      '    <span class="cs-stat"><b>' + (cs.ppg || 0).toFixed(1) + "</b><i>分</i></span>" +
      '    <span class="cs-stat"><b>' + (cs.rpg || 0).toFixed(1) + "</b><i>板</i></span>" +
      '    <span class="cs-stat"><b>' + (cs.apg || 0).toFixed(1) + "</b><i>助</i></span>" +
      '    <span class="cs-stat"><b>' + (cs.tpPct || 0).toFixed(1) + "%</b><i>3P%</i></span>" +
      "  </div>" + status +
      "</div>";
  }).join("");

  $("#screen-scout").innerHTML =
    '<h2 class="screen-title">球探中心</h2>' +
    '<p class="screen-sub">下一届新秀正在大学/海外联赛征战 · 派球探实地考察可获得评分与潜力报告</p>' +
    '<div class="fan-round">' +
    '  <div class="er-pill">待选新秀 <b>' + cls.length + "</b> 人</div>" +
    '  <div class="er-pill">球探在外 <b>' + sc.active.length + "</b> / " + SCOUT_CONCURRENT + "</div>" +
    '  <div class="er-pill">已出报告 <b>' + Object.keys(sc.done).length + "</b> 份</div>" +
    "</div>" +
    '<div class="scout-list">' + rows + "</div>";

  $$("#screen-scout .srr-send").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      if (sc.active.length >= SCOUT_CONCURRENT || sc.active.some(j => j.id === id) || sc.done[id]) return;
      sc.active.push({ id, gamesLeft: SCOUT_GAMES });
      writeSave(save);
      toast("🔭 球探已出发，" + SCOUT_GAMES + " 场比赛后出报告");
      RENDERERS.scout(); activate("scout", true);
    };
  });
};

/* ===== NBA 选秀 ===== */
/* 回合制交互式选秀：用户在属于自己的每个选秀签位上各选一次新秀，
   其余 AI 签位可手动「AI 自动选人」逐支触发，也可「跳到我的下一顺位」自动模拟。
   选秀权可通过交易获得多个，因此用户可能有多次选人机会。 */
state.draft = { class_: null, pickOrder: null, currentIdx: 0, pickedIds: null, results: null, draftLog: null };
RENDERERS.draft = function () {
  const save = state.save;
  const d = state.draft;
  const my = myAbbr(save);
  if (!d.class_) { d.class_ = (save.upcomingDraft && save.upcomingDraft.length) ? save.upcomingDraft : genDraftClass(save); d.results = null; }
  if (!d.pickOrder) {
    d.pickOrder = computePickOrder(save);
    d.currentIdx = 0;
    d.pickedIds = new Set();
    d.results = [];
    d.draftLog = [];
  }
  const po = d.pickOrder;

  /* 已完成 → 直接进结果页 */
  if (d.results && d.results.length >= po.length) { finishDraft(save, d); return; }
  /* 用户在本届选秀中没有任何签位 → 自动模拟全部 */
  const userIndices = po.map((p, i) => p.team === my ? i : -1).filter(i => i >= 0);
  if (!userIndices.length) {
    autoRunRemaining(save, d.class_, po, 0, d.pickedIds, {}, d.results);
    finishDraft(save, d);
    toast("本届选秀你没有选秀权，AI 已自动完成全部选秀");
    return;
  }
  /* 全部签位走完 → 结算 */
  if (d.currentIdx >= po.length) { finishDraft(save, d); return; }

  const cur = po[d.currentIdx];
  const isMyTurn = cur.team === my;
  const avail = d.class_.filter(r => !d.pickedIds.has(r.id));
  /* 位置筛选 */
  d.posFilter = d.posFilter || "all";
  const posCount = { G: 0, F: 0, C: 0 };
  avail.forEach(r => { const c = catOf(r.pos); if (c) posCount[c]++; });
  const availFiltered = d.posFilter === "all" ? avail : avail.filter(r => catOf(r.pos) === d.posFilter);
  const logRows = d.draftLog.slice(-10).reverse();
  const SHOW = 30;

  /* 乐透抽签结果展示（仅首轮第 1-4 顺位） */
  const lotteryBanner = (() => {
    const lr = save.lotteryResult;
    if (!lr || !lr.length) return "";
    return '<div class="lottery-banner">' +
      '<div class="lottery-title">🎲 乐透抽签结果</div>' +
      '<div class="lottery-results">' +
      lr.map(l => '<div class="lottery-pick' + (l.team === my ? " me" : "") + '">' +
        '<span class="lp-pick">#<b>' + l.pick + '</b></span>' +
        '<span class="lp-team">' + esc(teamName(l.team)) + '</span>' +
        (l.odds ? '<span class="lp-odds">' + l.odds.toFixed(1) + '%</span>' : '') +
        '</div>').join("") +
      '</div></div>';
  })();

  $("#screen-draft").innerHTML =
    '<h2 class="screen-title">NBA 选秀大会</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季选秀 · 第 " + cur.pick + " 顺位 / 共 " + po.length + " · 进度 " + d.currentIdx + "/" + po.length + "</p>" +
    lotteryBanner +
    '<div class="draft-otc' + (isMyTurn ? " me" : "") + '">' +
      (isMyTurn ? '🎯 轮到你了！第 ' + cur.pick + " 顺位（" + (cur.round === 1 ? "首轮" : "次轮") + "）· 从下方选择一名新秀"
                : '⏳ 第 ' + cur.pick + " 顺位 · " + esc(teamName(cur.team)) + " 正在选秀（" + (cur.round === 1 ? "首轮" : "次轮") + "）") +
    "</div>" +
    /* 用户选秀权进度 */
    '<div class="draft-my-picks">' + userIndices.map(i => {
      const pk = po[i];
      const done = i < d.currentIdx;
      const isCur = i === d.currentIdx;
      return '<span class="dmp-chip' + (done ? " done" : "") + (isCur ? " cur" : "") + '">' +
        (done ? "✓ " : isCur ? "▶ " : "○ ") + "第" + pk.pick + "顺位(" + (pk.round === 1 ? "首轮" : "次轮") + ")</span>";
    }).join("") + "</div>" +
    (isMyTurn
      ? '<div class="draft-hint">从下方新秀中选择一位 · 能力值和潜力将在选秀后揭晓</div>'
      : '<div class="draft-ai-actions">' +
          '<button class="btn btn-primary" id="btn-ai-pick">▶ AI 自动选人</button>' +
          '<button class="btn btn-outline" id="btn-ai-skip-me">⏩ 跳到我的下一顺位</button>' +
          '<button class="btn btn-outline" id="btn-ai-skip-all">⏭ 跳过剩余选秀</button>' +
        "</div>") +
    '<div class="ts-tabs draft-pos-tabs">' +
    '  <button class="ts-tab' + (d.posFilter === "all" ? " active" : "") + '" data-dpf="all">全部 (' + avail.length + ')</button>' +
    '  <button class="ts-tab' + (d.posFilter === "G" ? " active" : "") + '" data-dpf="G">后卫 (' + posCount.G + ')</button>' +
    '  <button class="ts-tab' + (d.posFilter === "F" ? " active" : "") + '" data-dpf="F">前锋 (' + posCount.F + ')</button>' +
    '  <button class="ts-tab' + (d.posFilter === "C" ? " active" : "") + '" data-dpf="C">中锋 (' + posCount.C + ')</button>' +
    '</div>' +
    '<div class="draft-list">' +
    availFiltered.slice(0, SHOW).map((r, i) => {
      const cs = r.collegeStats || {};
      /* 球探情报：赛季中考察的报告在选秀时展示 */
      const rep = save.scouting && save.scouting.done[r.id];
      const job = save.scouting && save.scouting.active.find(j => j.id === r.id);
      let intel = "";
      if (rep) {
        intel = '<div class="dr-intel">' +
          '<span class="srr-pill">评分 ' + rep.ovrLow + "~" + rep.ovrHigh + '</span>' +
          '<span class="srr-pill pot">潜力 ' + rep.potGrade + '</span>' +
          '<span class="srr-pill">' + rep.slot + "</span>" +
          '<span class="srr-tag up">' + rep.strengths.join("·") + '</span>' +
          '<span class="srr-tag down">短板:' + rep.weak + "</span>" +
          "</div>";
      } else if (job) {
        intel = '<div class="dr-intel muted">🔭 考察未完成（差 ' + job.gamesLeft + ' 场）</div>';
      }
      return '<div class="draft-row' + (isMyTurn ? " selectable" : " locked") + (rep ? " has-intel" : "") + '" data-id="' + r.id + '">' +
      '  <span class="dr-rank">' + (i + 1) + "</span>" +
      '  <div class="dr-info">' +
      '    <div class="dr-name">' + esc(r.nameCn) + ' <span class="pos-chip ' + posClass(r.pos) + '">' + esc(posLabel(r)) + "</span>" +
      '      <span class="dr-age">' + r.age + "岁 · " + (r.heightCm || 198) + "cm</span></div>" +
      '    <div class="dr-college">' + esc(cs.college || "大学") + "</div>" +
      '    <div class="dr-cstats">' +
      '      <span class="cs-stat"><b>' + (cs.ppg || 0).toFixed(1) + "</b><i>分</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.rpg || 0).toFixed(1) + "</b><i>板</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.apg || 0).toFixed(1) + "</b><i>助</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.spg || 0).toFixed(1) + "</b><i>断</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.bpg || 0).toFixed(1) + "</b><i>帽</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.fgPct || 0).toFixed(1) + "%</b><i>FG%</i></span>" +
      '      <span class="cs-stat"><b>' + (cs.tpPct || 0).toFixed(1) + "%</b><i>3P%</i></span>" +
      "    </div>" +
      intel +
      "  </div>" +
      "</div>";
    }).join("") +
    (availFiltered.length > SHOW ? '<div class="draft-more-hint">…还有 ' + (availFiltered.length - SHOW) + " 名新秀（潜力更低）</div>" : "") +
    "</div>" +
    (logRows.length ? '<div class="draft-log"><h3>📋 选秀动态</h3>' +
      logRows.map(l =>
        '<div class="dl-row' + (l.isUser ? " me" : "") + '"><span class="dl-pick">#' + l.pick + "</span>" +
        '<span class="dl-team">' + esc(teamName(l.abbr)) + "</span>" +
        '<span class="dl-name">' + esc(l.rookieName) + "</span>" +
        (l.isUser ? '<span class="dl-tag">你</span>' : "") + "</div>"
      ).join("") + "</div>" : "");

  /* 用户回合：点击新秀选人 */
  if (isMyTurn) {
    $$("#screen-draft .ts-tab[data-dpf]").forEach(tab => {
      tab.onclick = () => { d.posFilter = tab.dataset.dpf; RENDERERS.draft(); };
    });
    $$("#screen-draft .draft-row.selectable").forEach(row => {
      row.onclick = () => {
        const id = Number(row.dataset.id);
        const rookie = d.class_.find(r => r.id === id);
        if (!rookie || d.pickedIds.has(id)) return;
        d.pickedIds.add(id);
        processPick(save, rookie, my, cur.pick, d.results);
        d.draftLog.push({ pick: cur.pick, abbr: my, rookieName: rookie.nameCn, isUser: true });
        d.currentIdx++;
        writeSave(save);
        toast("第 " + cur.pick + " 顺位选中：" + rookie.nameCn);
        RENDERERS.draft();
      };
    });
    return;
  }
  /* AI 回合：位置筛选仍可用 */
  $$("#screen-draft .ts-tab[data-dpf]").forEach(tab => {
    tab.onclick = () => { d.posFilter = tab.dataset.dpf; RENDERERS.draft(); };
  });
  /* AI 回合：单次自动选人 */
  const bAi = $("#btn-ai-pick");
  if (bAi) bAi.onclick = () => {
    const rookie = aiPickRookie(d.class_, save, cur.team, d.pickedIds);
    if (!rookie) { d.currentIdx = po.length; RENDERERS.draft(); return; }
    d.pickedIds.add(rookie.id);
    processPick(save, rookie, cur.team, cur.pick, d.results);
    d.draftLog.push({ pick: cur.pick, abbr: cur.team, rookieName: rookie.nameCn, isUser: false });
    d.currentIdx++;
    RENDERERS.draft();
  };
  /* AI 回合：自动模拟到用户的下一签位 */
  const bSkipMe = $("#btn-ai-skip-me");
  if (bSkipMe) bSkipMe.onclick = () => {
    while (d.currentIdx < po.length && po[d.currentIdx].team !== my) {
      const c = po[d.currentIdx];
      const rookie = aiPickRookie(d.class_, save, c.team, d.pickedIds);
      if (!rookie) { d.currentIdx = po.length; break; }
      d.pickedIds.add(rookie.id);
      processPick(save, rookie, c.team, c.pick, d.results);
      d.draftLog.push({ pick: c.pick, abbr: c.team, rookieName: rookie.nameCn, isUser: false });
      d.currentIdx++;
    }
    RENDERERS.draft();
  };
  /* AI 回合：跳过剩余全部选秀（用户的后续签位也由 AI 代选） */
  const bSkipAll = $("#btn-ai-skip-all");
  if (bSkipAll) bSkipAll.onclick = () => {
    autoRunRemaining(save, d.class_, po, d.currentIdx, d.pickedIds, {}, d.results);
    d.currentIdx = po.length;
    finishDraft(save, d);
  };
};

/* 选秀结算：写入存档并跳转结果页 */
function finishDraft(save, d) {
  save.draftResults = d.results;
  save.pendingDraft = false;
  /* 新秀池已用完，清空球探状态；进入新赛季后 hub 会生成下一届新秀池 */
  save.upcomingDraft = null;
  save.scouting = null;
  writeSave(save);
  const my = myAbbr(save);
  const myRookie = (d.results || []).find(r => r.abbr === my);
  toast("选秀完成！" + (myRookie ? "你选了 " + myRookie.rookie.nameCn : "本届无选秀权"));
  RENDERERS["draft-result"]();
  state.stack = [];
  activate("draft-result");
}

/* ===== 选秀结果 ===== */
RENDERERS["draft-result"] = function () {
  const save = state.save;
  const d = state.draft;
  const results = d.results || save.draftResults || [];
  const my = myAbbr(save);
  const myPicks = results.filter(r => r.abbr === my);
  /* 首轮顺位数量：接管模式 30，自建队(CUS)参赛时 31 */
  const firstRoundCount = (d.pickOrder || []).filter(p => p.round === 1).length || 30;
  const firstRound = results.filter(r => r.pick <= firstRoundCount);

  $("#screen-draft-result").innerHTML =
    '<h2 class="screen-title">选秀结果</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季选秀大会 · " + results.length + " 人被选中</p>" +
    (myPicks.length ? '<div class="se-card gold"><h3>🎯 你的新秀</h3>' +
      myPicks.map(r =>
        '<div class="aw-row me"><span class="aw-rank">' + r.pick + "</span>" +
        '<div class="aw-name">' + esc(r.rookie.nameCn) + '<span class="aw-team">第' + r.pick + "顺位</span></div>" +
        '<div class="aw-line">OVR ' + r.rookie.ovr + " · 潜力 " + r.rookie.potential + " · " + esc(r.rookie.pos) + "</div></div>"
      ).join("") + "</div>" : "") +
    '<div class="se-card"><h3>📋 首轮选秀结果</h3>' +
    firstRound.map(r =>
      '<div class="aw-row' + (r.abbr === my ? " me" : "") + '"><span class="aw-rank">' + r.pick + "</span>" +
      '<div class="aw-name">' + esc(r.rookie.nameCn) + '<span class="aw-team">' + esc(teamName(r.abbr)) + "</span></div>" +
      '<div class="aw-line">OVR ' + r.rookie.ovr + " · 潜力 " + r.rookie.potential + "</div></div>"
    ).join("") + "</div>" +
    '<button class="btn btn-primary" id="btn-draft-done">进入自由市场</button>';
  $("#btn-draft-done").onclick = () => {
    decrementContracts(save);
    if (!save.faPool) save.faPool = [];
    RENDERERS.freeagent();
    state.stack = []; activate("freeagent");
  };
};

/* ===== 赛季中提前续约 ===== */
RENDERERS.extend = function () {
  const save = state.save;
  const my = myAbbr(save);
  const mine = loadMyPlayers(save);
  /* 资格：普通球员剩余年限 ≤ 2；球星（OVR ≥ 88）适用指定老将条款，剩余 ≤ 3 年也可续约 */
  const eligible = mine.filter(x => {
    const entry = save.roster.find(r => r.id === x.p.id);
    if (!entry) return false;
    const maxYears = x.p.ovr >= 88 ? 3 : 2;
    return entry.years <= maxYears;
  }).sort((a, b) => b.p.ovr - a.p.ovr);
  /* 计算总薪资用于工资帽提示 */
  const total = Math.round(save.roster.reduce((s, r) => s + r.salary, 0) * 10) / 10;

  $("#screen-extend").innerHTML =
    '<h2 class="screen-title">提前续约</h2>' +
    '<p class="screen-sub">剩余 ≤ 2 年球员可提前续约 · 球星 OVR ≥ 88 适用指定老将条款（剩余 ≤ 3 年） · 当前薪资总额 ' + fmtM(total) + ' · 鸟权续约可超工资帽（超奢侈税线仅警告）</p>' +
    (eligible.length
      ? '<div class="ext-list">' + eligible.map(x => {
          const entry = save.roster.find(r => r.id === x.p.id) || {};
          const level = birdRightsLevel(entry.birdYears || 0);
          const levelLabel = level ? birdLabel(level) : "无鸟权";
          const isDVE = x.p.ovr >= 88 && (entry.years || 0) === 3;  /* 指定老将条款标记 */
          const [minY, maxY] = level ? birdYearsRange(level) : [1, 5];
          const maxSal = level ? maxSalaryByBird(x.p.ovr, x.p.id, level) : 0;
          const defSal = Math.round(estimateSalary(x.p.ovr, x.p.id) * 10) / 10;
          const defYears = Math.min(maxY, Math.max(minY, 3));
          const morale = moraleOf(save, x.p.id);
          const mCls = morale >= 80 ? "hi" : morale >= 50 ? "mid" : "lo";
          return '<div class="ext-row' + (isDVE ? " dve" : "") + '" data-id="' + x.p.id + '">' +
            '<div class="ext-head">' +
            '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + '</div>' +
            '  <div class="ext-name">' + esc(x.p.nameCn) + ' <span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(posLabel(x.p)) + '</span>' + (isDVE ? ' <span class="dve-badge">DVE</span>' : '') + '</div>' +
            '  <div class="ext-sal-chip"><b>' + fmtM(entry.salary) + '</b><span>当前年薪</span></div>' +
            '</div>' +
            '<div class="ext-info">' +
            '  <span class="ext-tag">剩 ' + (entry.years || 0) + '年</span>' +
            '  <span class="ext-tag ext-bird' + (level ? " has" : " none") + '">' + levelLabel + '</span>' +
            '  <span class="ext-tag">士气 <b class="ext-morale m' + mCls + '">' + morale + '</b></span>' +
            '</div>' +
            (level
              ? '<div class="ext-form">' +
                '  <label class="ext-field"><span>年限</span>' +
                '    <div class="ext-input-wrap"><input type="number" class="ext-input ext-years" min="' + minY + '" max="' + maxY + '" value="' + defYears + '" />' +
                '    <small>' + minY + '-' + maxY + ' 年</small></div>' +
                '  </label>' +
                '  <label class="ext-field"><span>年薪 (M)</span>' +
                '    <div class="ext-input-wrap"><input type="number" class="ext-input ext-salary" step="0.1" min="0.5" max="' + maxSal + '" value="' + defSal + '" />' +
                '    <small>上限 ' + fmtM(maxSal) + '</small></div>' +
                '  </label>' +
                '  <div class="ext-accept" id="ext-acc-' + x.p.id + '"></div>' +
                '  <button class="btn btn-primary ext-submit" data-id="' + x.p.id + '">续约</button>' +
                '</div>'
              : '<div class="ext-no-bird">无鸟权，不可提前续约（需本赛季末进入自由市场流程）</div>') +
          '</div>';
        }).join("") + '</div>'
      : '<div class="ext-empty">当前阵容无符合提前续约条件的球员（剩余合同均 > 2 年）</div>') +
    '<button class="btn btn-outline" id="ext-back">返回经理室</button>';
  $("#ext-back").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
  /* 实时刷新接受度指示器 + 奢侈税超线提示（鸟权可超帽，仅警告） */
  const refreshAccept = (row) => {
    const id = Number(row.dataset.id);
    const years = parseInt(row.querySelector(".ext-years").value, 10);
    const salary = parseFloat(row.querySelector(".ext-salary").value);
    const accEl = row.querySelector(".ext-accept");
    if (!accEl || isNaN(years) || isNaN(salary)) { if (accEl) accEl.textContent = ""; return; }
    const acc = extensionAcceptance(save, id, salary, years);
    const cls = acc.accept ? "ok" : acc.chance >= 30 ? "maybe" : "no";
    /* 续约后预测总薪资 = 当前总额 - 现合同薪 + 新合同薪 */
    const curEntry = save.roster.find(r => r.id === id);
    const projectedTotal = total - (curEntry ? curEntry.salary : 0) + salary;
    const warn = taxWarning(projectedTotal);
    accEl.className = "ext-accept " + cls + (warn ? " tax-warn" : "");
    accEl.innerHTML = '<span class="ext-acc-val">' + acc.chance + '%</span><span class="ext-acc-label">接受度</span>' + (warn ? '<span class="ext-acc-warn">' + warn + '</span>' : "");
    accEl.title = acc.reason + (warn ? "\n" + warn : "");
  };
  $$("#screen-extend .ext-row").forEach(row => {
    const accEl = row.querySelector(".ext-accept");
    if (!accEl) return;
    row.querySelector(".ext-years").oninput = () => refreshAccept(row);
    row.querySelector(".ext-salary").oninput = () => refreshAccept(row);
    refreshAccept(row);  /* 初始化一次 */
  });
  $$("#screen-extend .ext-submit").forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest(".ext-row");
      const id = Number(btn.dataset.id);
      const years = parseInt(row.querySelector(".ext-years").value, 10);
      const salary = parseFloat(row.querySelector(".ext-salary").value);
      if (isNaN(years) || isNaN(salary)) { toast("请输入有效的年限和薪资"); return; }
      if (extendContract(save, id, years, salary)) {
        RENDERERS.extend();
      }
    };
  });
};

document.addEventListener("DOMContentLoaded", () => {
  $("#btn-back").onclick = back;
  if (!window.TEAMS || !window.PLAYERS_RATED || !PLAYERS_RATED.players) {
    document.body.innerHTML = '<div class="load-err">数据文件加载失败<br>请确认 web/data/ 目录完整后刷新页面</div>';
    return;
  }
  /* 快照原始球员列表，重置生涯时恢复 */
  window._originalPlayers = PLAYERS_RATED.players.slice();
  RENDERERS.start();
  activate("start");
});
