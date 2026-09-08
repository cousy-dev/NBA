"use strict";
/* NBA 篮球经理 — 建队流程（模式选择 / 球队选择 / 建队信息 / 预算 / 选人 / 确认） */

/* ===== 常量 ===== */
const SAVE_KEY = "nba_gm_save_v1";
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
const BUDGET_PRESETS = [
  { key: "conservative", label: "保守市场", amount: 95, desc: "精打细算 · 挑战模式" },
  { key: "standard", label: "标准市场", amount: 115, desc: "均衡预算 · 推荐新手" },
  { key: "luxury", label: "豪华市场", amount: 135, desc: "挥金如土 · 即刻争冠" }
];
/* 工资估算分档（百万美元/年），按 OVR 区间线性插值 + 基于 id 的确定性浮动 */
const SALARY_BANDS = [
  [95, 99, 46, 60], [90, 94, 36, 45], [85, 89, 26, 34], [80, 84, 16, 24],
  [75, 79, 9, 14], [70, 74, 5, 8], [65, 69, 2.5, 4.5], [60, 64, 1.2, 2.4], [0, 59, 0.8, 1.6]
];

/* ===== 状态 ===== */
const state = {
  stack: [],
  screen: "start",
  mode: null,          // "existing" | "custom"
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
function posClass(pos) { return pos.indexOf("G") === 0 ? "pos-g" : pos.indexOf("F") === 0 ? "pos-f" : "pos-c"; }
function estimateSalary(ovr, id) {
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
  return before - PLAYERS_RATED.players.length;
}
/* 重置建队向导状态（模式/球队/自定义信息/预算/已选阵容/筛选器），避免上一次建队残留 */
function resetWizardState() {
  state.mode = null;
  state.team = null;
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
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { return null; }
}

/* ===== 导航 ===== */
const RENDERERS = {};
function activate(name) {
  state.screen = name;
  $$(".screen").forEach(el => el.classList.add("hidden"));
  $("#screen-" + name).classList.remove("hidden");
  window.scrollTo(0, 0);
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
    case "create-info": return ["建队信息", 1, 4];
    case "budget": return ["资金预算", 2, 4];
    case "roster": return ["选拔阵容", 3, 4];
    case "summary": return state.mode === "existing" ? ["确认球队", 2, 2] : ["确认建队", 4, 4];
    case "player": return ["球员详情", 1, 1];
    case "hub": return ["经理室", 1, 1];
    case "match": return ["比赛日", 1, 1];
    case "awards": return ["奖项追踪", 1, 1];
    case "freeagent": return ["自由市场", 1, 1];
    case "standings": return ["联盟排名", 1, 1];
    case "schedule": return ["赛程战报", 1, 1];
    case "seasonend": return ["赛季总结", 1, 1];
    case "trade": return ["交易中心", 1, 1];
    case "trade-deal": return ["交易谈判", 1, 1];
    case "draft": return ["NBA 选秀", 1, 1];
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
  state.stack = [];
  const save = readSave();
  $("#screen-start").innerHTML =
    '<div class="hero">' +
    '  <div class="hero-logo">🏀</div>' +
    "  <h1>NBA 篮球经理</h1>" +
    '  <p class="sub">' + PLAYERS_RATED.count + ' 名现役球员 · 30 支球队 · 2K27 能力值</p>' +
    "</div>" +
    '<div class="start-actions">' +
    '  <button class="btn btn-primary" id="btn-existing">接管现有球队</button>' +
    '  <button class="btn btn-outline" id="btn-custom">创建自定义球队</button>' +
    (save
      ? '<button class="btn btn-gold" id="btn-continue">继续生涯 · ' + esc(save.team.displayName) + "</button>" +
        '<button class="link-danger" id="btn-delsave">删除存档</button>'
      : "") +
    "</div>" +
    '<p class="foot-note">数据来源：NBA中国官方 · 能力值依据 2K27 官方榜单与 2025-26 赛季统计估算<br>赛季 ' + esc(PLAYERS_RATED.updatedAt || "") + "</p>";

  $("#btn-existing").onclick = () => { purgeRuntimePlayers(); resetWizardState(); go("team-select"); };
  $("#btn-custom").onclick = () => { purgeRuntimePlayers(); resetWizardState(); go("create-info"); };
  if (save) {
    $("#btn-continue").onclick = () => { restoreFromSave(save); };
    $("#btn-delsave").onclick = () => {
      localStorage.removeItem(SAVE_KEY);
      if (window._originalPlayers) PLAYERS_RATED.players = window._originalPlayers.slice();
      LEAGUE_EST = null;
      toast("存档已删除");
      RENDERERS.start(); activate("start");
    };
  }
};

/* ===== 球队选择（接管模式） ===== */
RENDERERS["team-select"] = function () {
  state.mode = "existing";
  const teams = TEAMS.map(t => ({
    ...t, strength: teamStrength(t.abbr), count: playersByTeam(t.abbr).length
  })).sort((a, b) => b.strength - a.strength);

  $("#screen-team-select").innerHTML =
    '<h2 class="screen-title">选择你的球队</h2>' +
    '<p class="screen-sub">接管一支 NBA 球队，继承现有完整阵容</p>' +
    '<div class="team-grid">' +
    teams.map(t =>
      '<div class="team-card" data-abbr="' + t.abbr + '">' +
      '  <div class="team-logo">' + teamLogoHtml(t.abbr) + "</div>" +
      '  <div class="team-name">' + esc(t.nameCn) + "</div>" +
      '  <div class="team-city">' + esc(CITY_CN[t.abbr] || t.cityEn) + "</div>" +
      '  <div class="team-meta">' + "★".repeat(stars(t.strength)) + " · " + t.count + "人 · 均" + t.strength.toFixed(1) + "</div>" +
      "</div>"
    ).join("") +
    "</div>";

  $$("#screen-team-select .team-card").forEach(card => {
    card.onclick = () => { state.team = card.dataset.abbr; go("summary"); };
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
    '<button class="btn btn-primary" id="btn-to-budget" style="margin-top:24px">下一步 · 设定预算</button>';

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
    go("budget");
  };
};

/* ===== 预算 ===== */
RENDERERS.budget = function () {
  $("#screen-budget").innerHTML =
    '<h2 class="screen-title">初始资金预算</h2>' +
    '<p class="screen-sub">决定建队时能花多少钱签球员（百万美元）</p>' +
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
    if (f.pos !== "all" && p.pos.indexOf(f.pos) === -1) return false;
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
    '    <div class="p-meta"><span class="pos-chip ' + posClass(p.pos) + '">' + esc(p.pos) + "</span>" +
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
    if (p.pos.indexOf("G") > -1) cnt.G++;
    if (p.pos.indexOf("F") > -1) cnt.F++;
    if (p.pos.indexOf("C") > -1) cnt.C++;
  });
  if (usedTotal() > state.budget) return toast("总工资超出预算");
  if (cnt.G < 2) return toast("至少需要 2 名后卫（含 G-F 双能位）");
  if (cnt.F < 2) return toast("至少需要 2 名前锋（含 F-C 摇摆人）");
  if (cnt.C < 1) return toast("至少需要 1 名中锋");
  go("summary");
}

/* ===== 确认页 ===== */
function buildSummaryData() {
  if (state.mode === "existing") {
    const t = TEAMS.find(x => x.abbr === state.team);
    const rosterArr = playersByTeam(state.team)
      .map(p => ({ p, sal: estimateSalary(p.ovr, p.id) }))
      .sort((a, b) => b.p.ovr - a.p.ovr);
    return {
      abbr: state.team,
      displayName: t.nameCn,
      city: CITY_CN[state.team] || t.cityEn,
      arena: "",
      logoAbbr: state.team,
      rosterArr,
      budget: STANDARD_BUDGET,
      budgetLabel: "标准工资空间"
    };
  }
  const rosterArr = Array.from(state.roster.values())
    .map(p => ({ p, sal: estimateSalary(p.ovr, p.id) }))
    .sort((a, b) => b.p.ovr - a.p.ovr);
  return {
    abbr: null,
    displayName: state.custom.name + "队",
    city: state.custom.city,
    arena: state.custom.arena,
    logoAbbr: null,
    rosterArr,
    budget: state.budget,
    budgetLabel: "初始预算"
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
      '  <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + "</div>" +
      '  <div class="r-meta"><span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(x.p.pos) + "</span> " + (x.p.age || "-") + "岁</div>" +
      '  <div class="r-salary">' + fmtM(x.sal) + "</div>" +
      "</div>"
    ).join("") +
    "</div>" +
    '<button class="btn btn-primary" id="btn-save-game">确认 · 开启经理生涯</button>' +
    '<button class="link-danger" id="btn-restart">重新开始建队</button>';

  $$("#screen-summary .r-row").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });

  $("#btn-save-game").onclick = () => {
    const save = {
      version: 1,
      createdAt: new Date().toISOString(),
      mode: state.mode,
      team: {
        abbr: d.abbr, displayName: d.displayName, city: d.city,
        arena: d.arena, logoAbbr: d.logoAbbr
      },
      budget: d.budget,
      teamOvr: parseFloat(teamOvr),
      roster: d.rosterArr.map(x => ({ id: x.p.id, salary: x.sal }))
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      toast("✓ 生涯已开启");
      const s2 = migrateSave(JSON.parse(localStorage.getItem(SAVE_KEY)));
      state.save = s2;
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
    '    <div class="pd-meta"><span class="pos-chip ' + posClass(p.pos) + '">' + esc(p.pos) + "</span>" +
    '      <span class="pd-tag">' + esc(p.team) + "</span>" +
    '      <span class="pd-tag ' + (p.ratingSource === "official" ? "gold" : "") + '">' + (p.ratingSource === "official" ? "2K27 官方" : "数据估算") + "</span></div>" +
    '    <div class="pd-meta">' +
    '      <span class="pd-tag">' + (p.age || "?") + "岁</span>" +
    '      <span class="pd-tag">' + (p.heightCm || "?") + 'cm</span>' +
    '      <span class="pd-tag">' + (p.weightKg || "?") + 'kg</span>' +
    '      <span class="pd-tag">' + (p.draftYear ? p.draftYear + "年选秀" : "落选秀") + "</span>" +
    '      <span class="pd-tag">' + (p.expYears || 0) + "年球龄</span></div>" +
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
  save.ovrAdj = save.ovrAdj || {};
  save.ageAdj = save.ageAdj || {};
  save.morale = save.morale || {};
  Object.keys(save.standings).forEach(a => {
    if (save.standings[a].streak === undefined) save.standings[a].streak = 0;
  });
  /* 合同年限兜底：旧档无 years 则赋默认值；并补齐 NBA 规则合同字段（鸟权/选项/RFA 资格） */
  save.roster.forEach(r => {
    if (r.years === undefined) r.years = 1 + Math.floor(hash01(r.id, 41) * 3);
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
  /* 选秀权兜底：旧档无 draftPicks 则初始化 */
  if (!save.draftPicks || !save.draftPicks.length) {
    initDraftPicks(save);
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
function writeSave(save) { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
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
      state.draft = { class_: genDraftClass(save), order: null, pickedId: null, results: null, pickOrder: null };
    }
    toast("休赛期选秀尚未完成，请先完成选秀");
    RENDERERS.draft();
    state.stack = [];
    activate("draft");
    return;
  }
  const mine = loadMyPlayers(save);
  const top8 = mine.slice().sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 8);
  const ovr = (top8.reduce((s, x) => s + x.p.ovr, 0) / top8.length).toFixed(1);
  const total = Math.round(save.roster.reduce((s, r) => s + r.salary, 0) * 10) / 10;
  const my = myAbbr(save);
  const conf = confOf(my);
  const st = save.standings[my] || { w: 0, l: 0 };
  const myRank = confRanking(save, conf).find(r => r.abbr === my);

  /* 下一场比赛卡片 */
  const gi = currentGame(save);
  let gameHtml;
  if (save.playoffs && save.playoffs.done) {
    const iWon = save.playoffs.champion === my;
    gameHtml = '<div class="next-game champ-banner' + (iWon ? " gold" : "") + '">' +
      '<div class="champ-line">' + (iWon ? "🏆 你夺得了总冠军！" : "🏆 总冠军：" + esc(teamName(save.playoffs.champion))) + "</div>" +
      '<div class="ng-meta">本赛季：' + esc(save.playoffs.userResult || "") + "</div>" +
      '<button class="btn btn-primary" id="btn-seasonend">查看赛季总结</button></div>';
  } else if (!gi) {
    gameHtml = '<div class="next-game"><div class="ng-label">暂无比赛安排</div></div>';
  } else {
    const oppStr = teamStrength(gi.opp).toFixed(1);
    const seriesTag = gi.playoff ? '<div class="ng-meta series-tag">系列赛 <b>' + gi.seriesScore[0] + " - " + gi.seriesScore[1] + "</b>（4 胜晋级）</div>" : "";
    gameHtml = '<div class="next-game" id="hub-next">' +
      '<div class="ng-label">' + esc(gi.label) + " · " + (gi.home ? "主场" : "客场") + "</div>" +
      '<div class="ng-row">' +
      '    <div class="ng-team">' + (save.team.logoAbbr ? teamLogoHtml(save.team.logoAbbr) : '<div class="th-fb ng-fb">🏀</div>') + "<span>" + esc(save.team.displayName) + "</span></div>" +
      '    <div class="ng-vs">VS</div>' +
      '    <div class="ng-team">' + teamLogoHtml(gi.opp) + "<span>" + esc(teamName(gi.opp)) + "</span></div>" +
      "  </div>" + seriesTag +
      '<div class="ng-meta">对手实力 ' + oppStr + " · " + "★".repeat(stars(parseFloat(oppStr))) + "</div>" +
      '<div class="ng-btns"><button class="btn btn-primary" id="btn-play">开始比赛</button>' +
      '<button class="btn btn-outline" id="btn-quick">快速模拟</button></div>' +
      "</div>";
  }

  /* 队内得分领袖 */
  const leaders = mine.map(x => ({ x, ps: save.playerStats[x.p.id] }))
    .filter(o => o.ps && o.ps.g > 0)
    .sort((a, b) => b.ps.pts / b.ps.g - a.ps.pts / a.ps.g).slice(0, 3);
  const leadersHtml = leaders.length
    ? '<h3 class="section-h">队内数据王（本赛季）</h3><div class="roster-table">' +
      leaders.map((o, i) =>
        '<div class="r-row" data-id="' + o.x.p.id + '"><span class="r-idx">' + (i + 1) + "</span>" +
        '<div class="ovr-badge ' + ovrClass(o.x.p.ovr) + '">' + o.x.p.ovr + "</div>" +
        '<div class="r-name">' + esc(o.x.p.nameCn) + "</div>" +
        '<div class="r-meta">' + o.ps.g + "场</div>" +
        '<div class="r-salary"><b>' + (o.ps.pts / o.ps.g).toFixed(1) + '</b>分</div></div>'
      ).join("") + "</div>"
    : "";

  /* 历史赛季 */
  const histHtml = (save.history && save.history.length)
    ? '<h3 class="section-h">历史赛季</h3><div class="roster-table">' +
      save.history.slice().reverse().map(h =>
        '<div class="r-row hist-row"><span class="r-idx">S' + h.seasonNo + "</span>" +
        '<div class="r-name">' + h.w + "-" + h.l + " · " + esc(h.result) +
        (h.champion === my ? ' <span class="starter gold">🏆夺冠</span>' : h.champion ? '<span class="r-meta">冠军 ' + esc(teamName(h.champion)) + "</span>" : "") +
        (h.fmvp ? ' <span class="r-meta">FMVP ' + esc(h.fmvp.name) + "</span>" : "") +
        (h.mvp ? ' <span class="r-meta">MVP ' + esc(h.mvp.name) + "</span>" : "") +
        "</div></div>"
      ).join("") + "</div>"
    : "";

  $("#screen-hub").innerHTML =
    '<div class="team-hero">' +
    '  <div class="team-hero-logo">' + (save.team.logoAbbr
      ? teamLogoHtml(save.team.logoAbbr)
      : '<div class="th-fb" style="background:linear-gradient(135deg,hsl(' + Math.floor(hash01(strHash(save.team.displayName), 1) * 360) + ',55%,38%),#141830)">🏀</div>') + "</div>" +
    '  <div><div class="th-name">' + esc(save.team.displayName) + "</div>" +
    '  <div class="th-sub">' + esc(save.team.city) + (save.team.arena ? " · " + esc(save.team.arena) : "") + " · 第 " + save.seasonNo + " 赛季</div></div>" +
    '  <div class="th-ovr"><b>' + ovr + "</b><span>球队总评</span></div>" +
    "</div>" +
    '<div class="sum-stats">' +
    "  <div><b>" + st.w + "-" + st.l + '</b><span>战绩</span></div>' +
    "  <div><b>" + (myRank ? confLabel(conf) + myRank.seed : "-") + '</b><span>分部排名</span></div>' +
    "  <div><b>" + fmtM(total) + '</b><span>总工资</span></div>' +
    "  <div><b>" + mine.length + '</b><span>球员</span></div>' +
    "</div>" +
    '<div class="hub-nav"><button class="mc-btn" id="btn-standings">📊 联盟排名</button>' +
    '<button class="mc-btn" id="btn-schedule">📅 赛程战报</button>' +
    '<button class="mc-btn" id="btn-trade">🔄 交易中心</button>' +
    '<button class="mc-btn" id="btn-awards">🏆 奖项追踪</button></div>' +
    gameHtml + leadersHtml +
    '<h3 class="section-h">球队阵容</h3>' +
    '<div class="roster-table" id="hub-roster">' +
    mine.sort((a, b) => b.p.ovr - a.p.ovr).map((x, i) => {
      const m = moraleOf(save, x.p.id);
      return '<div class="r-row" data-id="' + x.p.id + '">' +
        '  <span class="r-idx">' + (i + 1) + "</span>" +
        '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
        '  <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + "</div>" +
        '  <div class="r-meta"><span class="pos-chip ' + posClass(x.p.pos) + '">' + esc(x.p.pos) + "</span> " + (x.p.age || "-") + '岁 <span class="morale-chip" style="color:' + moraleColor(m) + '">士气' + m + '</span></div>' +
        '  <div class="r-salary">' + fmtM(x.sal) + " · " + (save.roster.find(rr => rr.id === x.p.id) || {}).years + "年</div>" +
        "</div>";
    }).join("") +
    "</div>" + histHtml +
    '<button class="link-danger" id="btn-quit">重置生涯</button>';
  $$("#screen-hub .r-row[data-id]").forEach(row => { row.onclick = () => openPlayer(Number(row.dataset.id)); });
  const bp = $("#btn-play");
  if (bp) bp.onclick = () => startMatch(false);
  const bq = $("#btn-quick");
  if (bq) bq.onclick = quickSimGame;
  const bs = $("#btn-standings");
  if (bs) bs.onclick = () => go("standings");
  const bsc = $("#btn-schedule");
  if (bsc) bsc.onclick = () => go("schedule");
  const bt = $("#btn-trade");
  if (bt) bt.onclick = () => go("trade");
  const ba = $("#btn-awards");
  if (ba) ba.onclick = () => go("awards");
  const bse = $("#btn-seasonend");
  if (bse) bse.onclick = () => go("seasonend");
  $("#btn-quit").onclick = () => {
    localStorage.removeItem(SAVE_KEY);
    state.save = null;
    /* 清理运行时全局库：移除之前 push 进去的自定义球员（新秀等），恢复原始数据 */
    if (window._originalPlayers) {
      PLAYERS_RATED.players = window._originalPlayers.slice();
    }
    LEAGUE_EST = null; /* 重置联盟估算缓存 */
    toast("生涯已重置");
    RENDERERS.start(); activate("start");
  };
};

/* ===== 比赛 ===== */
const DEF_LABELS = { man: "人盯人", zone: "联防", double: "包夹", press: "紧逼" };
const PACE_LABELS = { fast: "快攻", normal: "平衡", slow: "阵地" };
state.match = { sim: null, timer: null, speed: 1, paused: true, over: false, feedCount: 0 };

function buildSimFor(gi) {
  const save = state.save;
  const mine = loadMyPlayers(save).map(x => x.p);
  const oppT = TEAMS.find(x => x.abbr === gi.opp);
  const oppRoster = (save.aiRosters && save.aiRosters[gi.opp]) || playersByTeam(gi.opp).map(p => p.id);
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  const opp = oppRoster.map(id => { const p0 = customById.get(id) || byId.get(id); return p0 ? applyAdj(p0, save) : null; }).filter(Boolean);
  return new GameSim(
    { name: save.team.displayName, short: "", abbr: save.team.logoAbbr, players: mine },
    { name: oppT.nameCn, short: "", abbr: gi.opp, players: opp }
  );
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
/* 快速模拟一场（hub 按钮 / 测试调用，无 DOM 依赖） */
function quickSimGame() {
  const save = state.save;
  const gi = currentGame(save);
  if (!gi) return;
  const sim = buildSimFor(gi);
  sim.skipToEnd();
  const sc = sim.score();
  const win = sc[0] > sc[1];
  completeGame(sim, win);
  toast((win ? "✓ 胜 " : "✗ 负 ") + sc[0] + " - " + sc[1] + " " + teamName(gi.opp));
  if (state._regularJustEnded) {
    state._regularJustEnded = false;
    RENDERERS["regular-end"]();
    state.stack = [];
    activate("regular-end");
    return;
  }
  if (save.playoffs && save.playoffs.done) { go("seasonend"); return; }
  RENDERERS.hub(); activate("hub");
}
/* 完场结算：数据累计 + 战绩/排名 + 联盟轮次 + 季后赛推进 */
function completeGame(sim, win) {
  const save = state.save;
  const my = myAbbr(save);
  sim.teams[0].box.forEach((b, id) => {
    const ps = save.playerStats[id] || (save.playerStats[id] = { g: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 });
    ps.g++; ps.pts += b.pts; ps.reb += b.reb; ps.ast += b.ast; ps.stl += b.stl; ps.blk += b.blk; ps.tov += b.tov;
    ps.fgm += b.fgm; ps.fga += b.fga; ps.tpm += b.tpm; ps.tpa += b.tpa; ps.ftm += b.ftm; ps.fta += b.fta;
  });
  updateMoraleAfterGame(save, sim, win);
  if (save.playoffs && !save.playoffs.done) {
    const ser = save.playoffs.userSeries;
    if (ser) { if (win) ser.wa++; else ser.wb++; }
    playoffProgress(save);
  } else if (!save.playoffs) {
    const g = save.schedule[save.gameNo];
    if (g) { g.result = win ? "W" : "L"; g.score = sim.score().slice(); }
    if (win) { save.record.w++; save.standings[my].w++; } else { save.record.l++; save.standings[my].l++; }
    save.gameNo++;
    simLeagueRound(save);
    if (save.gameNo >= save.schedule.length) {
      buildPlayoffs(save);
      state._regularJustEnded = true;
    }
  }
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
  $("#m-clock").textContent = "Q" + m.sim.q + " " + Math.floor(clock / 60) + ":" + String(Math.floor(clock % 60)).padStart(2, "0");
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
  let poHtml = "";
  if (save.playoffs) {
    const ps = save.playoffs;
    poHtml = '<h3 class="section-h">季后赛对阵</h3>';
    for (let r = 0; r <= ps.round && ps.rounds[r]; r++) {
      const rd = ps.rounds[r];
      poHtml += '<div class="po-round">' + esc(rd.name) + "</div>";
      rd.E.concat(rd.W).forEach(s => {
        const myInv = s.a === myAbbr(save) || s.b === myAbbr(save);
        poHtml += '<div class="po-ser' + (myInv ? " me" : "") + (s.done && s.winner === myAbbr(save) ? " won" : "") + '">' +
          esc(teamName(s.a)) + " <b>" + s.wa + " - " + s.wb + "</b> " + esc(teamName(s.b)) +
          (s.done ? '<span class="po-adv">' + esc(teamName(s.winner)) + " 晋级</span>" : "") +
          (myInv && !s.done ? '<span class="po-adv">你的系列赛</span>' : "") + "</div>";
      });
    }
    if (ps.done) poHtml += '<div class="champ-line">🏆 总冠军：' + esc(teamName(ps.champion)) + "</div>";
  }
  $("#screen-schedule").innerHTML =
    '<h2 class="screen-title">赛程战报</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季 · 常规赛 " + GAMES_PER_SEASON + " 场</p>" +
    poHtml +
    '<h3 class="section-h">常规赛</h3>' +
    '<div class="sch-list">' +
    save.schedule.map((g, i) => {
      const logo = '<img src="https://res.nba.cn/media/img/teams/logos/' + g.opp + '_logo.png" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
      if (g.result) {
        const win = g.result === "W";
        return '<div class="sch-row ' + (win ? "win" : "lose") + '">' +
          '<span class="sch-idx">' + (i + 1) + "</span>" +
          '<span class="sch-team">' + logo + esc(teamName(g.opp)) + "</span>" +
          '<span class="sch-home">' + (g.home ? "主" : "客") + "</span>" +
          '<span class="sch-score">' + (g.score ? g.score[0] + " - " + g.score[1] : "") + "</span>" +
          '<span class="sch-badge ' + (win ? "b-win" : "b-lose") + '">' + (win ? "胜" : "负") + "</span></div>";
      }
      const isNext = i === save.gameNo;
      return '<div class="sch-row future' + (isNext ? " next" : "") + '">' +
        '<span class="sch-idx">' + (i + 1) + "</span>" +
        '<span class="sch-team">' + logo + esc(teamName(g.opp)) + "</span>" +
        '<span class="sch-home">' + (g.home ? "主" : "客") + "</span>" +
        '<span class="sch-score"></span>' +
        '<span class="sch-badge">' + (isNext ? "下一场" : "未赛") + "</span></div>";
    }).join("") +
    "</div>";
};

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

  $("#screen-awards").innerHTML =
    '<h2 class="screen-title">🏆 奖项追踪</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + ' 赛季 · 已打 ' + gp + ' 场 · 实时排名</p>' +
    '<div class="aw-tabs" id="aw-tabs">' +
    '  <button class="aw-tab active" data-tab="mvp">MVP</button>' +
    '  <button class="aw-tab" data-tab="dpoy">DPOY</button>' +
    '  <button class="aw-tab" data-tab="6th">第六人</button>' +
    '  <button class="aw-tab" data-tab="pts">得分王</button>' +
    '  <button class="aw-tab" data-tab="ast">助攻王</button>' +
    '  <button class="aw-tab" data-tab="reb">篮板王</button>' +
    "</div>" +
    '<div class="aw-panel" id="aw-panel">' +
    '  <div class="aw-list">' + mvpRows + "</div>" +
    "</div>";

  const panels = { mvp: mvpRows, dpoy: dpoyRows, "6th": sixthRows, pts: scoringRows, ast: assistRows, reb: reboundRows };
  const labels = {
    mvp: "MVP 候选（综合得分+篮板+助攻+胜率）",
    dpoy: "最佳防守（抢断+盖帽+防守属性）",
    "6th": "最佳第六人（替补得分+助攻）",
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
  const awardRow = (icon, c, highlight, statFmt) => {
    if (!c) return '<div class="aw-row"><span class="aw-rank">' + icon + '</span><div class="aw-name">暂无数据</div></div>';
    const statTxt = statFmt ? statFmt(c.st) : (c.st ? c.st.ppg.toFixed(1) + "分 " + c.st.rpg.toFixed(1) + "板 " + c.st.apg.toFixed(1) + "助" : (c.v ? c.v.toFixed(1) + "分/场" : ""));
    return '<div class="aw-row' + (highlight ? " me" : "") + '"><span class="aw-rank">' + icon + "</span>" +
      '<div class="aw-name">' + esc(c.p.nameCn) + '<span class="aw-team">' + esc(teamName(c.p.team)) + "</span></div>" +
      '<div class="aw-line">' + (statTxt || "") + "</div></div>";
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
    '<div class="se-card"><h3>🏆 年度奖项</h3>' +
    awardRow("MVP", mvp, true) +
    awardRow("DPOY", dpoy, false, dpoyFmt) +
    awardRow("6MOY", sixth, false, sixthFmt) +
    awardRow("得分王", scoring) +
    awardRow("助攻王", assists) +
    awardRow("篮板王", rebounds) +
    "</div>" +
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
  const ps = save.playoffs;
  const my = myAbbr(save);
  const st = save.standings[my] || { w: 0, l: 0 };
  const myRank = confRanking(save, confOf(my)).find(r => r.abbr === my);
  const awards = seasonAwards(save);
  const iChamp = ps && ps.champion === my;
  const awardWinners = [
    { icon: "MVP", c: awards.mvp[0], highlight: true, fmt: null },
    { icon: "DPOY", c: awards.dpoy[0], fmt: st => st ? st.spg.toFixed(1) + "断 " + st.bpg.toFixed(1) + "帽" : "" },
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
  $("#screen-seasonend").innerHTML =
    '<h2 class="screen-title">赛季总结</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季 · 常规赛 " + st.w + "-" + st.l +
    (myRank ? " · " + confLabel(confOf(my)) + "第" + myRank.seed + "位" : "") + "</p>" +
    '<div class="se-card' + (iChamp ? " gold" : "") + '">' +
    '<div class="champ-line">' + (iChamp ? "🏆 恭喜！你夺得了总冠军" : "🏆 总冠军：" + esc(teamName(ps ? ps.champion : null))) + "</div>" +
    '<div class="ng-meta">你的季后赛结果：' + esc(ps ? (ps.userResult || "未进季后赛") : "未进季后赛") + "</div></div>" +
    (awards.fmvp ? '<div class="se-card gold"><h3>🏀 总决赛 MVP</h3>' +
      '<div class="aw-row me"><span class="aw-rank">FMVP</span>' +
      '<div class="aw-name">' + esc(awards.fmvp.p.nameCn) + '<span class="aw-team">' + esc(teamName(awards.fmvp.p.team)) + "</span></div>" +
      '<div class="aw-line">' + awards.fmvp.st.ppg.toFixed(1) + "分 " + awards.fmvp.st.rpg.toFixed(1) + "板 " + awards.fmvp.st.apg.toFixed(1) + "助" + "</div></div></div>" : "") +
    '<div class="se-card"><h3>🏆 年度奖项获奖人</h3>' + winnerRows + "</div>" +
    '<button class="btn btn-primary" id="btn-newseason">开启第 ' + (save.seasonNo + 1) + " 赛季</button>" +
    '<button class="btn btn-outline" id="se-hub">返回经理室</button>';
  $("#btn-newseason").onclick = () => {
    newSeason(save);
    initDraftPicks(save);  /* 生成新赛季选秀权 */
    writeSave(save);
    if (save.pendingDraft) {
      save.pendingDraft = false;
      state.draft = { class_: genDraftClass(save), order: null, pickedId: null, results: null };
      go("draft");
    } else {
      toast("第 " + save.seasonNo + " 赛季开始！");
      RENDERERS.hub(); state.stack = []; activate("hub");
    }
  };
  $("#se-hub").onclick = () => { RENDERERS.hub(); state.stack = []; activate("hub"); };
};

/* ===== 交易中心 ===== */
state.trade = { aiTeam: null, myPicks: [], aiPicks: [], myDraftPicks: [], aiDraftPicks: [], result: null };
RENDERERS.trade = function () {
  const save = state.save;
  const my = myAbbr(save);
  const others = TEAMS.filter(t => t.abbr !== my).map(t => ({
    ...t, str: teamStrength(t.abbr), val: teamStrength(t.abbr).toFixed(1)
  })).sort((a, b) => b.str - a.str);
  $("#screen-trade").innerHTML =
    '<h2 class="screen-title">交易中心</h2>' +
    '<p class="screen-sub">选择交易对象，发起球员交换谈判</p>' +
    '<div class="trade-team-grid">' +
    others.map(t =>
      '<div class="trade-team-card" data-abbr="' + t.abbr + '">' +
      '  <div class="trade-team-logo">' + teamLogoHtml(t.abbr) + "</div>" +
      '  <div class="trade-team-name">' + esc(t.nameCn) + "</div>" +
      '  <div class="trade-team-str">★' + stars(t.str) + " · " + t.val + "</div>" +
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
RENDERERS["trade-deal"] = function () {
  const save = state.save;
  const aiTeam = state.trade.aiTeam;
  const aiT = TEAMS.find(t => t.abbr === aiTeam);
  const mine = loadMyPlayers(save).map(x => ({ p: x.p, sal: x.sal }));
  const tradable = getTradable(aiTeam).map(p => ({ p, sal: estimateSalary(p.ovr, p.id) }));
  const myPicks = state.trade.myPicks;
  const aiPicks = state.trade.aiPicks;
  const myDPicks = state.trade.myDraftPicks;
  const aiDPicks = state.trade.aiDraftPicks;
  /* 选秀权数据 */
  const myPickPool = getTeamPicks(save, myAbbr(save));
  const aiPickPool = getTeamPicks(save, aiTeam);
  /* 总价值 = 球员 + 选秀权 */
  const myVal = myPicks.reduce((s, x) => s + tradeValue(x.p, x.sal), 0) + myDPicks.reduce((s, pk) => s + pickValue(pk), 0);
  const aiVal = aiPicks.reduce((s, x) => s + tradeValue(x.p, x.sal), 0) + aiDPicks.reduce((s, pk) => s + pickValue(pk), 0);
  const result = state.trade.result;
  const mySal = myPicks.reduce((s, x) => s + x.sal, 0);
  const aiSal = aiPicks.reduce((s, x) => s + x.sal, 0);
  const hasOffer = (myPicks.length + myDPicks.length) && (aiPicks.length + aiDPicks.length);

  const pickList = (arr, side) =>
    arr.length ? arr.map(x =>
      '<div class="trade-pick">' +
      '<div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '<div class="tp-name">' + esc(x.p.nameCn) + "</div>" +
      '<div class="tp-meta">' + esc(x.p.pos) + " · " + (x.p.age || "-") + "岁 · " + fmtM(x.sal) + "</div>" +
      '<div class="tp-val">价值 ' + tradeValue(x.p, x.sal) + "</div>" +
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
    '  <div class="td-center"><div class="td-val">' + myVal + " vs " + aiVal + '</div><div class="td-sal">' + fmtM(mySal) + " ↔ " + fmtM(aiSal) + "</div></div>" +
    '  <div class="td-side">' + teamLogoHtml(aiTeam) + "<div><b>" + esc(aiT.nameCn) + "</b><span>对方</span></div></div>" +
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
      '<div class="tr-meta">' + esc(x.p.pos) + " · " + fmtM(x.sal) + "</div>" +
      '<div class="tr-val">价值 ' + tradeValue(x.p, x.sal) + "</div></div>"
    ).join("") + "</div>" +
    '  <div class="tr-sec"><h3 class="tc-h">' + esc(aiT.nameCn) + ' 阵容</h3>' +
    tradable.map(x =>
      '<div class="tr-row' + (aiPicks.find(p => p.p.id === x.p.id) ? " picked" : "") + '" data-id="' + x.p.id + '" data-side="ai">' +
      '<div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '<div class="tr-name">' + esc(x.p.nameCn) + '</div>' +
      '<div class="tr-meta">' + esc(x.p.pos) + " · " + fmtM(x.sal) + "</div>" +
      '<div class="tr-val">价值 ' + tradeValue(x.p, x.sal) + "</div></div>"
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
  $$("#screen-trade-deal .tr-row:not(.dp-row)").forEach(row => {
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

/* ===== NBA 选秀 ===== */
state.draft = { class_: null, order: null, pickedId: null, results: null };
RENDERERS.draft = function () {
  const save = state.save;
  const d = state.draft;
  if (!d.class_) { d.class_ = genDraftClass(save); d.pickedId = null; d.results = null; }
  /* 用 computePickOrder 获取交易后的真实顺位 */
  if (!d.pickOrder) d.pickOrder = computePickOrder(save);
  const po = d.pickOrder;
  const my = myAbbr(save);
  const myPickInfo = po.find(p => p.team === my && p.round === 1);
  const myPick = myPickInfo ? myPickInfo.pick : 15;
  const myPickIdx = myPick - 1;
  const top = d.class_.slice(0, 20);

  $("#screen-draft").innerHTML =
    '<h2 class="screen-title">NBA 选秀大会</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季选秀 · 你的顺位：第 " + myPick + " 顺位</p>" +
    (d.pickedId ? '<div class="draft-picked-banner">已选择：' + esc((d.class_.find(r => r.id === d.pickedId) || {}).nameCn || "") +
      ' <span class="dpb-hint">点击该球员可取消，点击其他球员可更换</span>' +
      '<button class="btn btn-primary" id="btn-draft-confirm">确认选秀结果</button></div>' : '<div class="draft-hint">从下方新秀中选择一位（你的顺位前可选）</div>') +
    '<div class="draft-list">' +
    top.map((r, i) =>
      '<div class="draft-row' + (d.pickedId === r.id ? " picked" : "") + '" data-id="' + r.id + '">' +
      '  <span class="dr-rank">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(r.ovr) + '">' + r.ovr + "</div>" +
      '  <div class="dr-info">' +
      '    <div class="dr-name">' + esc(r.nameCn) + ' <span class="pos-chip ' + posClass(r.pos) + '">' + esc(r.pos) + "</span></div>" +
      '    <div class="dr-meta">' + r.age + "岁 · 潜力 " + r.potential + " · " + esc(r.pos) + "</div>" +
      "  </div>" +
      '  <div class="dr-pot"><span class="pot-label">潜力</span><span class="pot-val ' + (r.potential >= 88 ? "hi" : r.potential >= 80 ? "mid" : "lo") + '">' + r.potential + "</span></div>" +
      "</div>"
    ).join("") +
    "</div>" +
    (d.pickedId ? "" : '<button class="btn btn-outline" id="btn-skip-draft">跳过选秀（AI 自动选择）</button>');
  $$("#screen-draft .draft-row").forEach(row => {
    row.onclick = () => {
      const id = Number(row.dataset.id);
      if (d.pickedId === id) {
        d.pickedId = null;  /* 取消选择 */
      } else {
        d.pickedId = id;    /* 选择/切换 */
      }
      RENDERERS.draft();
    };
  });
  const bSkip = $("#btn-skip-draft");
  if (bSkip) bSkip.onclick = () => {
    const available = d.class_.filter(r => !d.pickedId || r.id !== d.pickedId);
    d.pickedId = available[0] ? available[0].id : d.class_[0].id;
    RENDERERS.draft();
  };
  const bConf = $("#btn-draft-confirm");
  if (bConf) bConf.onclick = () => {
    /* 用 computePickOrder 获取真实顺位（含交易后变化） */
    const order = d.pickOrder.map(p => p.team);
    const myIdx = d.pickOrder.findIndex(p => p.team === myAbbr(save) && p.round === 1);
    d.results = runDraft(save, d.pickedId, d.class_, order, myIdx);
    save.pendingDraft = false;
    writeSave(save);
    const myRookie = d.results.find(r => r.abbr === myAbbr(save));
    toast("选秀完成！" + (myRookie ? "你选了 " + myRookie.rookie.nameCn : ""));
    RENDERERS["draft-result"]();
    state.stack = [];
    activate("draft-result");
  };
};

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
