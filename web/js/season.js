"use strict";
/* 赛季系统 —— 赛程 / 联盟AI模拟 / 排名 / 季后赛 / 奖项 / 老化 / 伤病（纯逻辑，无 DOM） */

/* ===== 东西部（静态映射，自定义队归西部） ===== */
const CONF_EAST = ["ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"];
const CONF_WEST = ["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA"];
function confOf(abbr) { return CONF_EAST.includes(abbr) ? "E" : "W"; }
const ROUND_NAMES = ["季后赛首轮", "分区半决赛", "分区决赛", "总决赛"];
const GAMES_PER_SEASON = 82;

/* ===== 工具 ===== */
function shuffleArr(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function myAbbr(save) { return save.team.abbr || "CUS"; }

/* 游戏的基准年份：第 1 赛季 = 2026 年 */
const BASE_GAME_YEAR = 2026;
/* 动态球龄：draftYear 已知时精确计算，否则根据年龄估算（球员默认 20 岁进联盟）。
   好处：不依赖数据文件硬编码的 expYears，赛季推进时 seasonNo++ 自动增长。 */
function getExpYears(p, seasonNo) {
  if (!p) return 0;
  const sn = seasonNo || 1;
  if (p.draftYear && p.draftYear > 1980) {
    const gameYear = BASE_GAME_YEAR + sn - 1;
    return Math.max(0, gameYear - p.draftYear - 1);
  }
  /* 无 draftYear：落选秀 / 自由球员，按 20 岁进联盟估算 */
  if (p.age) return Math.max(0, p.age - 20);
  return 0;
}
/* 新秀判断：仅进入联盟的第一个赛季。
   优先用 draftSeason（processPick 设定的权威赛季号），
   其次用 draftYear（数据文件中真实 NBA 球员的选秀年），
   最后用 isRookie 兜底（仅限无 draftYear 的旧自定义球员）。
   不能只靠 isRookie —— 该标记永久为 true，会导致传奇新秀年年入选新秀阵 */
function isRookiePlayer(p, seasonNo) {
  if (!p) return false;
  const sn = seasonNo || 1;
  /* 自定义新秀：draftSeason 精确到赛季号，不受 genDraftClass 调用时机影响 */
  if (p.draftSeason) return p.draftSeason === sn;
  /* 数据文件球员：按选秀年判断 */
  if (p.draftYear && p.draftYear > 1980) {
    const gameYear = BASE_GAME_YEAR + sn - 1;
    return gameYear <= p.draftYear;
  }
  /* 旧档兼容 */
  return !!p.isRookie;
}

/* ===== 赛程生成：82 场，每对手主客各一次 + 24 场随机 ===== */
function makeSchedule(save) {
  const pool = TEAMS.map(t => t.abbr).filter(a => a !== myAbbr(save));
  const list = [];
  pool.forEach(a => { list.push({ opp: a, home: true, result: null, score: null }); list.push({ opp: a, home: false, result: null, score: null }); });
  for (let i = 0; i < 24; i++) list.push({ opp: pool[Math.floor(Math.random() * pool.length)], home: Math.random() < 0.5, result: null, score: null });
  return shuffleArr(list);
}

/* ===== 日期系统（真实 NBA 节奏） ===== */
/* NBA 常规赛每队 82 场 ≈ 175 天（10月22日 → 4月15日）
   真实休息间隔分布：
   - 背靠背（1 天休息）：~5% ≈ 4 次/赛季
   - 2 天休息：~60% ≈ 49 次
   - 3 天休息：~25% ≈ 20 次
   - 4-7 天休息：~10% ≈ 9 次（含全明星周末 7 天）
   全明星周末固定在第 40-44 场之间，强制 7 天 gap */
function buildSeasonDates(save) {
  if (save.seasonDates && save.seasonDates[save.seasonNo]) return save.seasonDates[save.seasonNo];
  const N = save.schedule.length;
  /* 第 1 场日期固定 10月22日 */
  let month = 10, day = 22;
  const dates = [formatDate(month, day)];
  /* 先生成 N-1 个 gap */
  const gaps = [];
  /* 全明星周末：第 42 场之后 = gap[41]（0-indexed 第 41 个 gap，即第 42→43 场之间） */
  const ASB = 41; /* 在这位置强制 7 天休息 */
  /* 计划：4 次背靠背 + 49 次 2 天 + 20 次 3 天 + 8 次 4-7 天 = 81 gap */
  const plan = [];
  /* 背靠背（gap=1）：4 次 */
  for (let i = 0; i < 4; i++) plan.push(1);
  /* 2 天：49 次 */
  for (let i = 0; i < 49; i++) plan.push(2);
  /* 3 天：20 次 */
  for (let i = 0; i < 20; i++) plan.push(3);
  /* 4-6 天：7 次（随机） */
  for (let i = 0; i < 7; i++) plan.push(4 + Math.floor(Math.random() * 3));
  /* 洗牌打乱分布 */
  shuffleArr(plan);
  /* 把全明星 7 天 gap 放到 ASB 位置（如果 plan 长度不够就补） */
  while (plan.length < N - 1) plan.push(2);
  plan[ASB] = 7; /* 全明星周 */
  /* 生成所有日期 */
  for (let i = 0; i < N - 1; i++) {
    const gap = plan[i];
    [month, day] = addDays(month, day, gap);
    dates.push(formatDate(month, day));
  }
  save.seasonDates = save.seasonDates || {};
  save.seasonDates[save.seasonNo] = dates;
  return dates;
}
function addDays(m, d, n) {
  const daysIn = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let i = 0; i < n; i++) {
    d++;
    if (d > daysIn[m - 1]) { d = 1; m = (m % 12) + 1; }
  }
  return [m, d];
}
function formatDate(m, d) {
  return m + "月" + d + "日";
}
/* 赛季起始年份：第 1 赛季 = 2026-27 赛季（10月开打） */
const SEASON_START_YEAR = 2026;
/* 解析 "M月D日" 字符串 */
function parseSeasonDate(s) {
  const m = String(s || "").match(/^(\d+)月(\d+)日$/);
  return m ? { month: Number(m[1]), day: Number(m[2]) } : null;
}
/* 根据月份推算该场比赛所在的公历年（10-12月=赛季元年，1-4月=次年） */
function seasonYearForMonth(save, month) {
  const base = SEASON_START_YEAR + save.seasonNo - 1;
  return month >= 10 ? base : base + 1;
}
/* 当前比赛日期（save.gameNo 是第几场，0-indexed） */
function currentGameDate(save) {
  if (save.playoffs && save.playoffs.games) return null; /* 季后赛不用 */
  const dates = buildSeasonDates(save);
  return dates[save.gameNo] || dates[dates.length - 1] || null;
}
/* 已完场的日期 + 即将开赛的日期 */
function recentGameDates(save, count) {
  const dates = buildSeasonDates(save);
  const done = dates.slice(Math.max(0, save.gameNo - count), save.gameNo);
  const upcoming = dates.slice(save.gameNo, save.gameNo + count);
  return { done, upcoming };
}

/* ===== 排名初始化（30 队，自定义队占西部一席） ===== */
function initStandings(save) {
  const st = {};
  TEAMS.forEach(t => { st[t.abbr] = { w: 0, l: 0, streak: 0 }; });
  st[myAbbr(save)] = { w: 0, l: 0, streak: 0 };
  return st;
}

/* ===== 球队战力（含老化 + 士气 + 阵容变动） ===== */
/* AI 队阵容查找缓存：避免每次 strengthOf 都重建 Map */
let _AI_STR_CACHE = null;
let _AI_STR_CACHE_KEY = null;
function aiStrengthOf(save, abbr) {
  /* 获取实际阵容（优先 save.aiRosters，回退到数据文件并排除退役球员） */
  let ids = [];
  if (save.aiRosters && save.aiRosters[abbr]) {
    ids = save.aiRosters[abbr];
  } else {
    ids = playersByTeam(abbr)
      .filter(p => !save.retired || !save.retired[p.id])
      .map(p => p.id);
  }
  if (!ids.length) return 70;
  /* 构建查找表（按需缓存） */
  const cacheKey = (save.customPlayers ? save.customPlayers.length : 0) + "_" + PLAYERS_RATED.players.length;
  if (_AI_STR_CACHE_KEY !== cacheKey) {
    _AI_STR_CACHE = new Map();
    (save.customPlayers || []).forEach(p => _AI_STR_CACHE.set(p.id, p));
    PLAYERS_RATED.players.forEach(p => { if (!_AI_STR_CACHE.has(p.id)) _AI_STR_CACHE.set(p.id, p); });
    _AI_STR_CACHE_KEY = cacheKey;
  }
  /* 计算每个球员当前 OVR（含老化 + 士气），取 top8 */
  const ovrs = [];
  for (const id of ids) {
    const p0 = _AI_STR_CACHE.get(id);
    if (!p0) continue;
    const ovrAdj = (save.ovrAdj && save.ovrAdj[id]) || 0;
    const mDelta = moraleOvrDelta(moraleOf(save, id));
    ovrs.push((p0.ovr || 70) + ovrAdj + mDelta);
  }
  if (!ovrs.length) return 70;
  ovrs.sort((a, b) => b - a);
  const top8 = ovrs.slice(0, 8);
  return top8.reduce((s, v) => s + v, 0) / top8.length;
}
function strengthOf(save, abbr) {
  if (abbr === myAbbr(save)) {
    const mine = loadMyPlayers(save);
    const top8 = mine.slice().sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 8);
    return top8.reduce((s, x) => s + x.p.ovr, 0) / Math.max(1, top8.length);
  }
  return aiStrengthOf(save, abbr);
}
/* Elo 式胜率：主场 +1（真实 NBA 主场胜率约 58-60%），除数 5（差距更敏感） */
function winProb(strA, strB, homeA) {
  return 1 / (1 + Math.pow(10, (strB - strA - (homeA ? 1 : -1)) / 5));
}

/* ===== 联盟一轮：其余 29 队随机配对打 14 场，1 队轮空 ===== */
function simLeagueRound(save) {
  const others = TEAMS.map(t => t.abbr).filter(a => a !== myAbbr(save));
  shuffleArr(others);
  const playedPairs = [];
  for (let i = 0; i + 1 < others.length; i += 2) {
    const A = others[i], B = others[i + 1];
    /* 每场发挥波动：小幅正态(±1.5) + 8%概率球员爆发/低迷(±3)。
       波动不能太大，否则弱队频繁爆冷 → 全联盟战绩挤在中段、摆烂队过多 */
    const formA = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5
      + (Math.random() < 0.08 ? (Math.random() < 0.5 ? 3 : -3) : 0);
    const formB = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5
      + (Math.random() < 0.08 ? (Math.random() < 0.5 ? 3 : -3) : 0);
    const p = winProb(strengthOf(save, A) + formA, strengthOf(save, B) + formB, true);
    const aWon = Math.random() < p;
    if (aWon) { save.standings[A].w++; save.standings[B].l++; }
    else { save.standings[B].w++; save.standings[A].l++; }
    applyStreak(save, A, aWon);
    applyStreak(save, B, !aWon);
    updateAIMorale(save, A, aWon);
    updateAIMorale(save, B, !aWon);
    playedPairs.push([A, B]);
  }
  /* AI 球员伤病恢复 */
  tickInjuries(save);
  /* AI 球员随机伤病：处理本轮出场的队 */
  playedPairs.forEach(([a, b]) => {
    [a, b].forEach(abbr => {
      const ids = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
      rollInjuries(save, ids);
    });
  });
}

/* ===== 排名榜：分部排序（胜率→战力），含种子序号 ===== */
function confRanking(save, conf) {
  const list = Object.keys(save.standings).filter(a => confOf(a) === conf).map(a => {
    const s = save.standings[a];
    const gp = s.w + s.l;
    return { abbr: a, w: s.w, l: s.l, pct: gp ? s.w / gp : 0, str: strengthOf(save, a) };
  });
  list.sort((x, y) => y.pct - x.pct || y.str - x.str);
  list.forEach((r, i) => { r.seed = i + 1; });
  return list;
}

/* ===== 联盟球员数据估算（确定性，用于奖项竞争） ===== */
let LEAGUE_EST = null;
function estStats(p) {
  const per = Math.max(0, (p.ovr - 55) / 42);
  /* 按具体位置（PG/SG/SF/PF/C）的数据基线，兼容旧位置值经 getPos 派生 */
  const dp = getPos(p).pos;
  const posR = { PG: 2.2, SG: 3.0, SF: 5.2, PF: 7.2, C: 9.4 };
  const posA = { PG: 6.2, SG: 4.4, SF: 2.8, PF: 2.0, C: 1.6 };
  const isC = dp === "C";
  /* 得分：分档曲线，star 球员 25-30 分 */
  let ppg;
  if (p.ovr >= 93) ppg = 24 + (p.ovr - 93) * 1.5;
  else if (p.ovr >= 88) ppg = 16 + (p.ovr - 88) * 1.6;
  else if (p.ovr >= 83) ppg = 10 + (p.ovr - 83) * 1.2;
  else if (p.ovr >= 78) ppg = 6 + (p.ovr - 78) * 0.8;
  else if (p.ovr >= 73) ppg = 3 + (p.ovr - 73) * 0.6;
  else ppg = 1.5 + Math.max(0, p.ovr - 68) * 0.3;
  ppg *= (0.85 + hash01(p.id, 1) * 0.3);
  return {
    ppg: Math.max(1.5, ppg),
    rpg: (posR[dp] || 5) * (0.7 + per * 0.6) * (0.85 + hash01(p.id, 2) * 0.3),
    apg: (posA[dp] || 3) * (0.7 + per * 0.6) * (0.85 + hash01(p.id, 3) * 0.3),
    spg: (0.5 + per * 1.3) * (0.8 + hash01(p.id, 4) * 0.4),
    bpg: (isC ? 0.3 + per * 1.8 : 0.1 + per * 0.6) * (0.8 + hash01(p.id, 5) * 0.4)
  };
}
function leagueEst() {
  if (!LEAGUE_EST) {
    LEAGUE_EST = new Map();
    PLAYERS_RATED.players.forEach(p => LEAGUE_EST.set(p.id, estStats(p)));
  }
  return LEAGUE_EST;
}

/* 球员当赛季快照：基础 OVR + 老化修正（ovrAdj），属性等比缩放。
   不含士气（士气是单场波动，奖项评估看整季真实水平）。
   成长/衰退中的球员（尤其潜力 99 的传奇新秀）奖项界面必须用此快照，
   否则 OVR 和估算数据永远停留在新秀年 */
function curSeasonPlayer(p0, save) {
  const oa = (save.ovrAdj && save.ovrAdj[p0.id]) || 0;
  if (!oa) return p0;
  const baseOvr = p0.ovr || 70;
  const k = (baseOvr + oa) / baseOvr;
  const scale = obj => {
    if (!obj) return obj;
    const out = {};
    Object.keys(obj).forEach(key => { out[key] = Math.max(20, Math.round(obj[key] * k)); });
    return out;
  };
  return Object.assign({}, p0, { ovr: baseOvr + oa, attrs: scale(p0.attrs), mgr: scale(p0.mgr) });
}
/* 当赛季估算数据：有老化修正则按当前 OVR 重算，否则用缓存 */
function curEstStats(p0, pCur, est) {
  return pCur === p0 ? est.get(p0.id) : estStats(pCur);
}

/* 按球队状态+顺位调整的新秀估算数据
   estStats 纯 OVR 估算：OVR 76 状元仅 4.8 分，但摆烂队状元获大量出手+上场时间，
   实际应 15+ 分。adjEstStats 在 estStats 基础上乘使用率倍率，仅对当赛季新秀生效。 */
function adjEstStats(p, save, teamAbbr, base) {
  const sn = save.seasonNo || 1;
  const rookie = p.draftSeason ? p.draftSeason === sn : !!p.isRookie;
  /* DEBUG: 所有球员都打印，确认函数被调用 + 新秀检测 */
  if (p.nameCn && (p.nameCn.indexOf("迪班萨") >= 0 || (p.pick && p.pick <= 5) || p.isRookie || p.draftSeason)) {
    console.log("[adjEstStats]", p.nameCn, "| rookie=", rookie, "| draftSeason=", p.draftSeason, "| seasonNo=", sn, "| pick=", p.pick, "| teamAbbr=", teamAbbr, "| ovr=", p.ovr, "| isRookie标记=", p.isRookie, "| base.ppg=", base.ppg);
  }
  if (!rookie) return base;
  /* 球队胜率：当前战绩≥10场用当前，否则回退上赛季 */
  let winPct = 0.5;
  if (teamAbbr && save.standings && save.standings[teamAbbr]) {
    const st = save.standings[teamAbbr];
    const gp = st.w + st.l;
    if (gp >= 10) winPct = st.w / gp;
    else if (save.lastSeason && save.lastSeason[teamAbbr]) {
      const rec = save.lastSeason[teamAbbr];
      const tot = (rec.wins || 0) + (rec.losses || 0);
      if (tot > 0) winPct = rec.wins / tot;
    }
  }
  /* 球队状态分层：1=摆烂(<35%) 2=重建(35-45%) 3=边缘(45-60%) 4=争冠(>60%)
     扩张队(seasonNo<=save.expansionBonusUntilSeason)始终视为摆烂重建 */
  let tier;
  const isExpansion = save.expansion && save.seasonNo <= (save.expansionBonusUntilSeason || 3);
  if (isExpansion) tier = 1;
  else tier = winPct < 0.35 ? 1 : (winPct < 0.45 ? 2 : (winPct > 0.60 ? 4 : 3));
  /* 顺位/潜力使用率倍率（模拟更多出手和上场时间） */
  const pick = p.pick || 0;
  const pot = p.potential || 0;
  let pf;
  if (pick > 0) {
    if (pick <= 5) pf = 3.0;        /* 状元~前5 */
    else if (pick <= 14) pf = 2.5;  /* 乐透 */
    else if (pick <= 30) pf = 2.0;   /* 首轮 */
    else pf = 1.5;                    /* 二轮 */
  } else if (pot >= 92) pf = 3.0;
  else if (pot >= 85) pf = 2.5;
  else if (pot >= 78) pf = 2.0;
  else pf = 1.5;
  /* 传奇新秀始终高使用率（pickRotation 已给 32+ 分钟） */
  if (p.isLegend) pf = Math.max(pf, 2.8);
  /* 球队状态修正：摆烂队全力培养，争冠队新秀坐板凳 */
  let mult;
  if (tier === 1) mult = pf;                              /* 摆烂：完整加成 */
  else if (tier === 2) mult = 1 + (pf - 1) * 0.7;         /* 重建：70% */
  else if (tier === 4) mult = p.isLegend ? 2.5 : 0.7;    /* 争冠：传奇仍高，其他减 */
  else mult = 1 + (pf - 1) * 0.3;                         /* 边缘：30% */
  /* 上限：低 OVR 新秀数据不超过球星水平 */
  const cap = p.ovr >= 85 ? 30 : p.ovr >= 78 ? 25 : 20;
  return {
    ppg: Math.min(cap, Math.max(1.5, base.ppg * mult)),
    rpg: base.rpg * (1 + (mult - 1) * 0.3),
    apg: base.apg * (1 + (mult - 1) * 0.4),
    spg: base.spg * mult,
    bpg: base.bpg * mult
  };
}

/* 构建 playerId → teamAbbr 反查表（含用户队+AI队） */
function buildPlayerTeamMap(save) {
  const m = new Map();
  const my = myAbbr(save);
  save.roster.forEach(r => m.set(r.id, my));
  if (save.aiRosters) {
    Object.keys(save.aiRosters).forEach(abbr => {
      save.aiRosters[abbr].forEach(id => m.set(id, abbr));
    });
  }
  /* DEBUG: 扩张队自定义球员 */
  if (save.customPlayers && save.customPlayers.length) {
    save.customPlayers.forEach(cp => {
      const abbr = m.get(cp.id);
      if (cp.pick || cp.draftSeason) {
        console.log("[buildPlayerTeamMap] 自定义新秀:", cp.nameCn, "pick=", cp.pick, "draftSeason=", cp.draftSeason, "teamAbbr=", abbr, "p.team=", cp.team);
      }
    });
  }
  return m;
}

/* ===== 赛季中实时奖项排行 ===== */
function liveAwardRanks(save) {
  const real = save.playerStats || {};
  const myIds = new Set(save.roster.map(r => r.id));
  const est = leagueEst();
  const my = myAbbr(save);
  const gp = save.gameNo || 0;
  const teamMap = buildPlayerTeamMap(save);
  /* 用户队替补识别（OVR 前 5 为首发） */
  const mineSorted = loadMyPlayers(save).slice().sort((a, b) => b.p.ovr - a.p.ovr);
  const starterIds = new Set(mineSorted.slice(0, 5).map(x => x.p.id));

  const candidates = PLAYERS_RATED.players.map(p0 => {
    const p = curSeasonPlayer(p0, save);
    let st = adjEstStats(p, save, teamMap.get(p.id), curEstStats(p0, p, est));
    const rs = real[p.id];
    const isMine = myIds.has(p.id);
    /* 用户球员有真实数据且打了足够场次，用真实数据 */
    if (rs && rs.g >= 5 && isMine) {
      st = { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g };
    }
    const teamAbbr = teamMap.get(p.id) || p.team;
    const teamSt = save.standings[teamAbbr];
    let winPct = 0.45;
    if (teamSt) { const t = teamSt.w + teamSt.l; if (t) winPct = teamSt.w / t; }
    const mvp = st.ppg + st.rpg * 1.2 + st.apg * 1.5 + winPct * 10;
    const dpoy = (st.spg * 2 + st.bpg * 2.2) + (p.attrs ? p.attrs.def * 0.25 : p.ovr * 0.2);
    const isSixth = isMine && !starterIds.has(p.id);
    const sixth = isSixth ? st.ppg + st.apg * 0.5 : 0;
    const realGP = rs ? rs.g : 0;
    return { p, st, mvp, dpoy, sixth, mine: isMine, winPct, realGP, teamAbbr: teamMap.get(p.id) || p.team };
  });

  const mvpTop = candidates.slice().sort((a, b) => b.mvp - a.mvp).slice(0, 10);
  const dpoyTop = candidates.slice().sort((a, b) => b.dpoy - a.dpoy).slice(0, 10);
  const sixthTop = candidates.filter(c => c.sixth > 0).sort((a, b) => b.sixth - a.sixth).slice(0, 5);
  /* 得分王 */
  const scoringTop = candidates.slice().sort((a, b) => b.st.ppg - a.st.ppg).slice(0, 10);
  /* 助攻王 */
  const assistTop = candidates.slice().sort((a, b) => b.st.apg - a.st.apg).slice(0, 10);
  /* 篮板王 */
  const reboundTop = candidates.slice().sort((a, b) => b.st.rpg - a.st.rpg).slice(0, 10);
  /* 最佳新秀实时榜（expYears === 0） */
  const rookieTop = candidates.filter(c => isRookiePlayer(c.p, save.seasonNo))
    .sort((a, b) => b.mvp - a.mvp).slice(0, 10);

  return { mvpTop, dpoyTop, sixthTop, scoringTop, assistTop, reboundTop, rookieTop, gp };
}

/* ===== 奖项：MVP / DPOY（联盟榜 + 用户真实数据覆盖） ===== */
function seasonAwards(save) {
  const real = save.playerStats || {};
  const myIds = new Set(save.roster.map(r => r.id));
  const est = leagueEst();
  const teamMap = buildPlayerTeamMap(save);
  console.log("[seasonAwards] called, seasonNo=", save.seasonNo, "total players=", PLAYERS_RATED.players.length);
  const candidates = PLAYERS_RATED.players.map(p0 => {
    const p = curSeasonPlayer(p0, save);
    let st = adjEstStats(p, save, teamMap.get(p.id), curEstStats(p0, p, est));
    const rs = real[p.id];
    if (rs && rs.g >= 20 && myIds.has(p.id)) {
      st = { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g };
    }
    let winPct = 0.45;
    const teamAbbr = teamMap.get(p.id) || p.team;
    const teamSt = save.standings[teamAbbr];
    if (teamSt) { const gp = teamSt.w + teamSt.l; if (gp) winPct = teamSt.w / gp; }
    return { p, st, mvp: st.ppg + st.rpg * 1.2 + st.apg * 1.5 + winPct * 10, dpoy: (st.spg * 2 + st.bpg * 2.2) + (p.attrs ? p.attrs.def : p.ovr * 0.3) * 0.25, mine: myIds.has(p.id), teamAbbr: teamMap.get(p.id) || p.team };
  });
  const mvp = candidates.slice().sort((a, b) => b.mvp - a.mvp).slice(0, 5);
  const dpoy = candidates.slice().sort((a, b) => b.dpoy - a.dpoy).slice(0, 3);
  /* 得分王 / 助攻王 / 篮板王 */
  const scoring = candidates.slice().sort((a, b) => b.st.ppg - a.st.ppg)[0] || null;
  const assists = candidates.slice().sort((a, b) => b.st.apg - a.st.apg)[0] || null;
  const rebounds = candidates.slice().sort((a, b) => b.st.rpg - a.st.rpg)[0] || null;
  /* 第六人：全联盟各队替补中得分最高者（非首发5人之外） */
  /* 超级第六人 = 能力强但被放替补的球员，上场时间不少、得分高 */
  const allRosters = {};
  TEAMS.forEach(t => {
    allRosters[t.abbr] = (save.aiRosters && save.aiRosters[t.abbr]) || playersByTeam(t.abbr).map(p => p.id);
  });
  const myAbbrLocal = myAbbr(save);
  if (!allRosters[myAbbrLocal]) allRosters[myAbbrLocal] = save.roster.map(r => r.id);
  const sixthCandidates = [];
  Object.keys(allRosters).forEach(abbr => {
    const ids = allRosters[abbr];
    /* 该队得分前5为首发，其余为替补 */
    const sortedByPts = ids.slice().sort((a, b) => avgPts(real, b) - avgPts(real, a));
    const starterIds = sortedByPts.slice(0, 5);
    sortedByPts.slice(5).forEach(id => {
      const p0 = PLAYERS_RATED.players.find(x => x.id === id);
      if (!p0) return;
      const p = curSeasonPlayer(p0, save);
      const rs = real[id];
      const st = rs && rs.g ? { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g } : adjEstStats(p, save, abbr, curEstStats(p0, p, est));
      if (!st) return;
      sixthCandidates.push({ p, st, mine: myIds.has(id), teamAbbr: abbr });
    });
  });
  const sixth = sixthCandidates.sort((a, b) => b.st.ppg - a.st.ppg)[0] || null;

  /* ===== 最佳阵容：一二三阵，每阵 2G 2F 1C =====
     评分用 mvp 综合分；不足人数时按分数 top 补 */
  const pickByPos = (pools, counts) => {
    const picked = [];
    Object.keys(pools).forEach(pos => {
      pools[pos].slice(0, counts[pos]).forEach(c => picked.push(c));
    });
    if (picked.length < Object.values(counts).reduce((a, b) => a + b, 0)) {
      /* 位置不够，补未入选的高分者 */
      candidates.slice().sort((a, b) => b.mvp - a.mvp).forEach(c => {
        if (picked.length >= Object.values(counts).reduce((a, b) => a + b, 0)) return;
        if (!picked.some(x => x.p.id === c.p.id)) picked.push(c);
      });
    }
    return picked;
  };
  /* 位置分池：G/F/C 各按指定分数排序 */
  const byCat = scoreKey => {
    const g = candidates.filter(c => catOf(c.p.pos) === "G").sort((a, b) => b[scoreKey] - a[scoreKey]);
    const f = candidates.filter(c => catOf(c.p.pos) === "F").sort((a, b) => b[scoreKey] - a[scoreKey]);
    const c = candidates.filter(c => catOf(c.p.pos) === "C").sort((a, b) => b[scoreKey] - a[scoreKey]);
    return { g, f, c };
  };
  const poolNBA = byCat("mvp");
  const allNBA1 = pickByPos(poolNBA, { g: 2, f: 2, c: 1 });
  const allNBA2 = pickByPos(
    { g: poolNBA.g.slice(2), f: poolNBA.f.slice(2), c: poolNBA.c.slice(1) }, { g: 2, f: 2, c: 1 }
  );
  const allNBA3 = pickByPos(
    { g: poolNBA.g.slice(4), f: poolNBA.f.slice(4), c: poolNBA.c.slice(2) }, { g: 2, f: 2, c: 1 }
  );

  /* 最佳防守：一二阵，每阵 2G 2F 1C */
  const poolDef = byCat("dpoy");
  const allDef1 = pickByPos(poolDef, { g: 2, f: 2, c: 1 });
  const allDef2 = pickByPos(
    { g: poolDef.g.slice(2), f: poolDef.f.slice(2), c: poolDef.c.slice(1) }, { g: 2, f: 2, c: 1 }
  );

  /* 最佳新秀 & 新秀一二阵：expYears === 0 */
  const rookCands = candidates.filter(c => isRookiePlayer(c.p, save.seasonNo));
  const rookPool = {
    g: rookCands.filter(c => catOf(c.p.pos) === "G").sort((a, b) => b.mvp - a.mvp),
    f: rookCands.filter(c => catOf(c.p.pos) === "F").sort((a, b) => b.mvp - a.mvp),
    c: rookCands.filter(c => catOf(c.p.pos) === "C").sort((a, b) => b.mvp - a.mvp)
  };
  const allRookie1 = pickByPos(rookPool, { g: 2, f: 2, c: 1 });
  const allRookie2 = pickByPos(
    { g: rookPool.g.slice(2), f: rookPool.f.slice(2), c: rookPool.c.slice(1) }, { g: 2, f: 2, c: 1 }
  );
  const bestRookie = rookCands.slice().sort((a, b) => b.mvp - a.mvp)[0] || null;

  /* FMVP：总决赛最有价值球员，总冠军队中综合表现最佳者 */
  let fmvp = null;
  if (save.playoffs && save.playoffs.done && save.playoffs.champion) {
    const champAbbr = save.playoffs.champion;
    const champIds = (save.aiRosters && save.aiRosters[champAbbr]) || playersByTeam(champAbbr).map(p => p.id);
    fmvp = champIds.map(id => {
      const p0 = PLAYERS_RATED.players.find(x => x.id === id);
      if (!p0) return null;
      const p = curSeasonPlayer(p0, save);
      const rs = real[id];
      const st = rs && rs.g ? { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g } : adjEstStats(p, save, champAbbr, curEstStats(p0, p, est));
      if (!st) return null;
      const score = st.ppg * 1.0 + st.rpg * 0.7 + st.apg * 0.8 + (st.spg + st.bpg) * 1.5;
      const mine = myIds.has(id);
      return { p, st, score, mine, teamAbbr: champAbbr };
    }).filter(x => x).sort((a, b) => b.score - a.score)[0] || null;
  }

  return { mvp, dpoy, sixth, scoring, assists, rebounds, fmvp,
    bestRookie, allNBA1, allNBA2, allNBA3, allDef1, allDef2, allRookie1, allRookie2 };
}
function avgPts(real, id) { const r = real[id]; return r && r.g ? r.pts / r.g : 0; }

/* ===== 赛季荣誉持久化 ===== */
/* 将本赛季本队获得的荣誉保存到 save.honors（带去重，同赛季只保存一次） */
function saveSeasonHonors(save, awards) {
  if (!save.honors) save.honors = [];
  if (save.honors.some(h => h.season === save.seasonNo)) return;
  const my = myAbbr(save);
  const list = [];
  /* 球队荣誉：总冠军 + 季后赛成绩 */
  if (save.playoffs) {
    if (save.playoffs.champion === my)
      list.push({ season: save.seasonNo, cat: "team", type: "champion", label: "总冠军" });
    const ur = save.playoffs.userResult;
    if (ur && ur !== "夺冠" && ur !== "未进季后赛")
      list.push({ season: save.seasonNo, cat: "team", type: "playoff", label: ur });
  }
  /* 球员个人荣誉 */
  const add = (type, label, c) => {
    if (c && c.mine)
      list.push({ season: save.seasonNo, cat: "player", type, label, playerId: c.p.id, name: c.p.nameCn });
  };
  add("MVP", "MVP", awards.mvp[0]);
  add("DPOY", "最佳防守球员", awards.dpoy[0]);
  add("ROY", "最佳新秀", awards.bestRookie);
  add("6MOY", "最佳第六人", awards.sixth);
  add("scoring", "得分王", awards.scoring);
  add("assists", "助攻王", awards.assists);
  add("rebounds", "篮板王", awards.rebounds);
  add("FMVP", "总决赛MVP", awards.fmvp);
  awards.allNBA1.forEach(c => add("AllNBA1", "最佳阵容一阵", c));
  awards.allNBA2.forEach(c => add("AllNBA2", "最佳阵容二阵", c));
  awards.allNBA3.forEach(c => add("AllNBA3", "最佳阵容三阵", c));
  awards.allDef1.forEach(c => add("AllDef1", "最佳防守一阵", c));
  awards.allDef2.forEach(c => add("AllDef2", "最佳防守二阵", c));
  awards.allRookie1.forEach(c => add("AllRookie1", "最佳新秀一阵", c));
  awards.allRookie2.forEach(c => add("AllRookie2", "最佳新秀二阵", c));
  save.honors.push(...list);
}

/* ===== 季后赛 ===== */
function buildPlayoffs(save) {
  const mk = list => {
    const series = [];
    const pairs = [[0, 7], [3, 4], [2, 5], [1, 6]]; // 1v8 4v5 3v6 2v7
    pairs.forEach(([hi, lo]) => series.push({
      a: list[hi].abbr, b: list[lo].abbr, seedA: list[hi].seed, seedB: list[lo].seed,
      wa: 0, wb: 0, done: false, winner: null, games: []
    }));
    return series;
  };
  save.playoffs = {
    rounds: [
      { name: ROUND_NAMES[0], E: mk(confRanking(save, "E")), W: mk(confRanking(save, "W")) },
      null, null, null
    ],
    round: 0, done: false, champion: null, userResult: null
  };
  syncUserSeries(save);
  if (!save.playoffs.userSeries) { save.playoffs.userResult = "未进季后赛"; finishAllAI(save); }
}
/* 用户恒为 a 侧（归一化），便于主场/比分方向统一 */
function syncUserSeries(save) {
  const ps = save.playoffs;
  ps.userSeries = findUserSeries(save);
  if (ps.userSeries) {
    const ser = ps.userSeries, my = myAbbr(save);
    if (ser.b === my) {
      [ser.a, ser.b] = [ser.b, ser.a];
      [ser.wa, ser.wb] = [ser.wb, ser.wa];
      const s = ser.seedA; ser.seedA = ser.seedB; ser.seedB = s;
    }
    ser.userHigher = ser.seedA <= ser.seedB;
  }
}
function findUserSeries(save) {
  const ps = save.playoffs;
  if (!ps || ps.done) return null;
  const my = myAbbr(save);
  const cur = ps.rounds[ps.round];
  if (!cur) return null;
  return cur.E.concat(cur.W).find(s => !s.done && (s.a === my || s.b === my)) || null;
}
/* AI 系列赛逐场模拟（一次只模拟一场，与用户节奏同步） */
const SERIES_HOME_PATTERN = [1, 1, 0, 0, 1, 0, 1]; /* 2-2-1-1-1，a 为高位种子 */
function simOneSeriesGame(ser, save) {
  if (ser.done) return;
  if (!ser.games) ser.games = [];
  const g = ser.wa + ser.wb; /* 当前已赛场次 */
  if (g >= 7) return;
  const sA = strengthOf(save, ser.a), sB = strengthOf(save, ser.b);
  /* 每场发挥波动：小幅正态(±1.5) + 8%概率球员爆发/低迷(±3) */
  const formA = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5
    + (Math.random() < 0.08 ? (Math.random() < 0.5 ? 3 : -3) : 0);
  const formB = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5
    + (Math.random() < 0.08 ? (Math.random() < 0.5 ? 3 : -3) : 0);
  const home = SERIES_HOME_PATTERN[g] === 1;
  const aWins = Math.random() < winProb(sA + formA, sB + formB, home);
  if (aWins) ser.wa++; else ser.wb++;
  ser.games.push({ home: home, score: simGameScore(sA + formA, sB + formB, aWins), aWin: aWins });
  if (ser.wa >= 4 || ser.wb >= 4) { ser.done = true; ser.winner = ser.wa >= 4 ? ser.a : ser.b; }
}
/* AI 系列赛整场快进（仅用于 finishAllAI 用户缺席时） */
function resolveSeriesAI(ser, save) {
  if (!ser.games) ser.games = [];
  while (!ser.done && ser.wa + ser.wb < 7) simOneSeriesGame(ser, save);
}
function winnerSeed(ser) { return ser.winner === ser.a ? ser.seedA : ser.seedB; }
function mkSer(s1, s2) {
  return { a: s1.winner, b: s2.winner, seedA: winnerSeed(s1), seedB: winnerSeed(s2), wa: 0, wb: 0, done: false, winner: null, games: [] };
}
/* AI 单场比分模拟：基于两队实力生成合理分数 */
function simGameScore(sA, sB, aWins) {
  const base = 108 + (sA + sB) * 0.25;
  const diff = (sA - sB) * 1.2 + (aWins ? 4 : -4);
  const a = Math.round(base + diff / 2 + (Math.random() - 0.5) * 14);
  const b = Math.round(base - diff / 2 + (Math.random() - 0.5) * 14);
  return aWins ? [Math.max(a, b + 1), Math.min(b, a - 1)] : [Math.min(a, b - 1), Math.max(b, a + 1)];
}
/* 该轮全部系列结束 → 生成下一轮；总决赛结束 → 冠军 */
function advancePlayoffs(save) {
  const ps = save.playoffs;
  const cur = ps.rounds[ps.round];
  cur.E.concat(cur.W).forEach(s => { if (!s.done) resolveSeriesAI(s, save); });
  if (ps.round === 3) {
    ps.champion = cur.E[0].winner;
    ps.done = true;
    if (ps.champion === myAbbr(save)) ps.userResult = "夺冠";
    else if (!ps.userResult) ps.userResult = "总决赛失利";
    return;
  }
  let next;
  if (ps.round < 2) { /* 首轮→半决赛 / 半决赛→分区决赛：分部内相邻配对 */
    const pairIn = list => {
      const out = [];
      for (let i = 0; i + 1 < list.length; i += 2) out.push(mkSer(list[i], list[i + 1]));
      return out;
    };
    next = { name: ROUND_NAMES[ps.round + 1], E: pairIn(cur.E), W: pairIn(cur.W) };
  } else { /* 分区决赛 → 总决赛：东胜者 vs 西胜者 */
    next = { name: ROUND_NAMES[3], E: [mkSer(cur.E[0], cur.W[0])], W: [] };
  }
  ps.rounds[ps.round + 1] = next;
  ps.round++;
  syncUserSeries(save);
  /* 用户已淘汰/缺席时不再自动模拟剩余轮次 —— 改由经理室「模拟剩余季后赛」按钮手动触发 */
}
/* 用户已淘汰/缺席：AI 一路模拟到冠军（防死循环保护） */
function finishAllAI(save) {
  const ps = save.playoffs;
  let guard = 0;
  while (!ps.done && guard++ < 8) {
    syncUserSeries(save);
    if (ps.userSeries && !ps.userSeries.done) break;
    advancePlayoffs(save);
  }
}
/* 用户系列赛一局结束后的推进入口 */
function playoffProgress(save) {
  const ps = save.playoffs;
  if (ps.done) return;
  syncUserSeries(save);
  const ser = ps.userSeries;
  if (ser && (ser.wa >= 4 || ser.wb >= 4)) {
    ser.done = true;
    ser.winner = ser.wa >= 4 ? ser.a : ser.b;
    if (ser.winner !== myAbbr(save)) ps.userResult = ROUND_NAMES[ps.round] + "出局";
  }
  const cur = ps.rounds[ps.round];
  if (!cur) return;
  /* 逐场模拟同轮剩余 AI 系列赛（与用户节奏同步，每场只推进1场） */
  cur.E.concat(cur.W).forEach(s => { if (!s.done && s !== ps.userSeries) simOneSeriesGame(s, save); });
  /* 如果用户系列赛已结束但其他 AI 系列赛未完，逐场快进剩余 AI */
  if (ser && ser.done) {
    while (!cur.E.concat(cur.W).every(s => s.done)) {
      cur.E.concat(cur.W).forEach(s => { if (!s.done && s !== ser) simOneSeriesGame(s, save); });
    }
  }
  if (cur.E.concat(cur.W).every(s => s.done)) advancePlayoffs(save);
  else syncUserSeries(save);
}
/* 用户季后赛下一位对手信息 */
function playoffGameInfo(save) {
  const ps = save.playoffs;
  const ser = ps.userSeries;
  const g = ser.wa + ser.wb + 1;
  const pat = ser.userHigher ? [1, 1, 0, 0, 1, 0, 1] : [0, 0, 1, 1, 0, 1, 0];
  return {
    opp: ser.b,   // 归一化后用户恒为 a
    home: pat[Math.min(g - 1, 6)] === 1,
    label: "季后赛 · " + ps.rounds[ps.round].name + " G" + g,
    seriesScore: [ser.wa, ser.wb]
  };
}

/* ===== 球员成长/衰退系统 ===== */
/* 每赛季开始时：年轻球员按潜力成长，老将按年龄衰退 */
/* ovrAdj[id] 累计 OVR 变化, ageAdj[id] 累计年龄增长 */
function doAging(save) {
  save.ovrAdj = save.ovrAdj || {};
  save.ageAdj = save.ageAdj || {};
  /* 构建所有球员的查找表（含自定义新秀） */
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  const findPlayer = id => customMap.get(id) || ratedMap.get(id);

  /* 处理用户阵容 */
  save.roster.forEach(r => { _agePlayer(save, r.id, findPlayer); });
  /* 处理 AI 队阵容 */
  if (save.aiRosters) {
    Object.keys(save.aiRosters).forEach(abbr => {
      (save.aiRosters[abbr] || []).forEach(id => { _agePlayer(save, id, findPlayer); });
    });
  }
  /* 处理所有其他球员（没被交易的） */
  TEAMS.forEach(t => {
    if (save.aiRosters && save.aiRosters[t.abbr]) return; /* 已处理 */
    playersByTeam(t.abbr).forEach(p => { _agePlayer(save, p.id, findPlayer); });
  });
  /* 士气向中性回归 10% */
  if (save.morale) {
    Object.keys(save.morale).forEach(id => {
      const m = save.morale[id];
      save.morale[id] = Math.round(m + (DEFAULT_MORALE - m) * 0.1);
    });
  }
  /* 退役判定 */
  save.retired = save.retired || {};
  save.retireLog = [];
  const allIds = new Set();
  save.roster.forEach(r => allIds.add(r.id));
  if (save.aiRosters) Object.values(save.aiRosters).forEach(arr => (arr || []).forEach(id => allIds.add(id)));
  TEAMS.forEach(t => {
    if (save.aiRosters && save.aiRosters[t.abbr]) return;
    playersByTeam(t.abbr).forEach(p => allIds.add(p.id));
  });
  allIds.forEach(id => {
    if (save.retired[id]) return;
    const p = findPlayer(id);
    if (!p) return;
    const adjAge = (p.age || 24) + (save.ageAdj[id] || 0);
    const currentOvr = (p.ovr || 70) + (save.ovrAdj[id] || 0);
    let chance = 0;
    if (adjAge >= 42) chance = 0.70;
    else if (adjAge >= 40) chance = 0.45;
    else if (adjAge >= 38) chance = 0.22;
    else if (adjAge >= 36) chance = 0.08;
    /* 低 OVR 退役加成仅适用于 30 岁以上老将；年轻球员（含新秀）即使 OVR 低也不退役，
       他们有成长空间，不应因能力值低而消失 */
    if (adjAge >= 30) {
      if (currentOvr < 60) chance += 0.15;
      if (currentOvr < 50) chance += 0.20;
    }
    if (chance > 0 && Math.random() < chance) {
      save.retired[id] = save.seasonNo;
      save.retireLog.push({ id, name: p.nameCn, team: p.team, age: adjAge, ovr: currentOvr });
      save.roster = save.roster.filter(r => r.id !== id);
      if (save.aiRosters) {
        Object.keys(save.aiRosters).forEach(abbr => {
          save.aiRosters[abbr] = save.aiRosters[abbr].filter(x => x !== id);
        });
      }
    }
  });
}

/* 单个球员成长/衰退 */
function _agePlayer(save, id, findPlayer) {
  const p = findPlayer(id);
  if (!p) return;
  const adjAge = (p.age || 24) + (save.ageAdj[id] || 0);
  const ovrAdj = save.ovrAdj[id] || 0;
  const currentOvr = (p.ovr || 70) + ovrAdj;
  const potential = p.potential || Math.min(85, (p.ovr || 70) + 8); /* 非新秀用 OVR+8 估算潜力 */

  save.ageAdj[id] = (save.ageAdj[id] || 0) + 1;

  let delta;
  if (adjAge <= 21) {
    /* 19-21: 快速成长期，潜力越高涨越多 */
    const room = Math.max(0, potential - currentOvr);
    delta = 1 + Math.round(hash01(id, 11) * 2);  /* +1~3 */
    if (room > 10) delta += 1;                    /* 潜力空间大，多涨 */
    if (room <= 0) delta = 0;                     /* 已达上限，不涨 */
  } else if (adjAge <= 24) {
    /* 22-24: 稳定成长期 */
    const room = Math.max(0, potential - currentOvr);
    delta = Math.round(hash01(id, 12));            /* 0~1 */
    if (room > 5) delta += 1;                      /* 潜力空间够，多涨 */
    if (room <= 0) delta = 0;
  } else if (adjAge <= 27) {
    /* 25-27: 巅峰期，基本不变 */
    delta = 0;
  } else if (adjAge <= 30) {
    /* 28-30: 缓慢下滑 */
    delta = -Math.round(hash01(id, 13));           /* 0 或 -1 */
  } else if (adjAge <= 33) {
    /* 31-33: 加速衰退 */
    delta = -1 - Math.round(hash01(id, 14));      /* -1 或 -2 */
  } else if (adjAge <= 36) {
    /* 34-36: 快速衰退 */
    delta = -2 - Math.round(hash01(id, 15));      /* -2 或 -3 */
  } else {
    /* 37+: 严重衰退 */
    delta = -3 - Math.round(hash01(id, 16) * 2);  /* -3 ~ -5 */
  }
  save.ovrAdj[id] = Math.max(-20, Math.min(20, ovrAdj + delta));
}

/* ===== 新赛季重置（含历史归档） ===== */
function newSeason(save) {
  const my = myAbbr(save);
  const st = save.standings[my];
  save.history = save.history || [];
  const aw = seasonAwards(save);
  save.history.push({
    seasonNo: save.seasonNo, w: st ? st.w : save.record.w, l: st ? st.l : save.record.l,
    result: save.playoffs ? (save.playoffs.userResult || "未进季后赛") : "未进季后赛",
    champion: save.playoffs ? save.playoffs.champion : null,
    fmvp: aw.fmvp ? { id: aw.fmvp.p.id, name: aw.fmvp.p.nameCn, team: aw.fmvp.p.team } : null,
    mvp: aw.mvp && aw.mvp[0] ? { id: aw.mvp[0].p.id, name: aw.mvp[0].p.nameCn, team: aw.mvp[0].p.team } : null
  });
  /* 累计球员个人荣誉 */
  save.playerAccolades = save.playerAccolades || {};
  const _acc = (id, key) => {
    save.playerAccolades[id] = save.playerAccolades[id] || { mvp: 0, fmvp: 0, champ: 0, allNBA: 0, allDef: 0, dpoy: 0, scoring: 0, assists: 0, rebounds: 0, allRookie: 0 };
    save.playerAccolades[id][key]++;
  };
  if (aw.mvp && aw.mvp[0]) _acc(aw.mvp[0].p.id, "mvp");
  if (aw.fmvp) _acc(aw.fmvp.p.id, "fmvp");
  if (save.playoffs && save.playoffs.champion) {
    const champIds = ((save.aiRosters && save.aiRosters[save.playoffs.champion]) || playersByTeam(save.playoffs.champion).map(p => p.id));
    champIds.forEach(id => _acc(id, "champ"));
  }
  if (aw.dpoy && aw.dpoy[0]) _acc(aw.dpoy[0].p.id, "dpoy");
  if (aw.scoring) _acc(aw.scoring.p.id, "scoring");
  if (aw.assists) _acc(aw.assists.p.id, "assists");
  if (aw.rebounds) _acc(aw.rebounds.p.id, "rebounds");
  (aw.allNBA1 || []).concat(aw.allNBA2 || [], aw.allNBA3 || []).forEach(c => _acc(c.p.id, "allNBA"));
  (aw.allDef1 || []).concat(aw.allDef2 || []).forEach(c => _acc(c.p.id, "allDef"));
  (aw.allRookie1 || []).concat(aw.allRookie2 || []).forEach(c => _acc(c.p.id, "allRookie"));
  doAging(save);
  save.seasonNo++;
  save.gameNo = 0;
  save.record = { w: 0, l: 0 };
  save.tradeDeadlinePassed = false;  /* 重置交易截止日标志 */
  save.injuries = {};  /* 新赛季伤病清零 */
  save.injuryLog = [];
  /* 新赛季重置工资帽硬帽状态：硬帽触发、特例使用全部清零（每季独立结算） */
  if (save.capStatus) {
    const prevBAESeason = save.capStatus.lastBAESeason || 0;  /* 双年特例需保留上赛季记录用于两年间隔判定 */
    save.capStatus = {
      hardCapped: false,
      hardCapReason: "",
      usedMLE: null,
      usedTaxpayerMLE: null,
      usedBAE: null,
      lastBAESeason: prevBAESeason  /* 保留上赛季使用记录 */
    };
  }
  /* 名人堂选举 */
  save.hofNewInductees = electHOF(save);
  save.schedule = makeSchedule(save);
  /* 重置战绩前先快照最终排名：选秀顺位在新赛季开启后才计算，必须依据上赛季真实战绩，
     否则所有队战绩被清零（胜率 0.5）会导致垫底队拿不到高顺位 */
  save.lastStandings = {};
  Object.keys(save.standings).forEach(a => {
    save.lastStandings[a] = { w: save.standings[a].w, l: save.standings[a].l };
  });
  save.standings = initStandings(save);
  /* 累计职业生涯数据（用于名人堂展示） */
  save.careerStats = save.careerStats || {};
  Object.keys(save.playerStats || {}).forEach(function (id) {
    var s = save.playerStats[id];
    var c = save.careerStats[id] || (save.careerStats[id] = { g: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, seasons: 0 });
    c.g += s.g || 0; c.pts += s.pts || 0; c.reb += s.reb || 0; c.ast += s.ast || 0;
    c.stl += s.stl || 0; c.blk += s.blk || 0; c.tov += s.tov || 0;
    c.fgm += s.fgm || 0; c.fga += s.fga || 0; c.tpm += s.tpm || 0; c.tpa += s.tpa || 0;
    c.ftm += s.ftm || 0; c.fta += s.fta || 0; c.seasons += 1;
  });
  save.playerStats = {};
  /* 保存季后赛结果供选秀顺位计算 */
  var lp = null;
  if (save.playoffs) {
    lp = { champion: save.playoffs.champion, rounds: [] };
    save.playoffs.rounds.forEach(function(r) {
      if (!r) { lp.rounds.push(null); return; }
      var rd = { name: r.name, E: [], W: [] };
      r.E.forEach(function(s) {
        var loser = s.a === s.winner ? s.b : s.a;
        rd.E.push({ winner: s.winner, loser: loser });
      });
      r.W.forEach(function(s) {
        var loser = s.a === s.winner ? s.b : s.a;
        rd.W.push({ winner: s.winner, loser: loser });
      });
      lp.rounds.push(rd);
    });
  }
  save.lastPlayoffs = lp;
  save.playoffs = null;
  save.pendingDraft = true;  /* 标记需要选秀 */
  return save;
}

/* ===== 士气值系统 ===== */
const DEFAULT_MORALE = 75;
function moraleOf(save, id) {
  return (save.morale && save.morale[id] != null) ? save.morale[id] : DEFAULT_MORALE;
}
function setMorale(save, id, v) {
  if (!save.morale) save.morale = {};
  save.morale[id] = Math.max(0, Math.min(100, Math.round(v)));
}
function moraleOvrDelta(morale) {
  if (morale >= 90) return 2;
  if (morale >= 80) return 1;
  if (morale >= 60) return 0;
  if (morale >= 40) return -1;
  if (morale >= 20) return -2;
  return -4;
}

/* ===== 伤病系统 ===== */
/* save.injuries[id] = { gamesLeft, type, name } —— type 决定恢复速度 */
const INJURY_TYPES = [
  { type: "ankle",    name: "脚踝扭伤",   min: 1, max: 5,  weight: 30 },
  { type: "knee",     name: "膝盖挫伤",   min: 3, max: 10, weight: 22 },
  { type: "hamstring",name: "腿筋拉伤",   min: 5, max: 15, weight: 18 },
  { type: "concussion",name:"脑震荡",     min: 3, max: 8,  weight: 12 },
  { type: "wrist",    name: "手腕挫伤",   min: 2, max: 7,  weight: 10 },
  { type: "back",     name: "背部痉挛",   min: 3, max: 12, weight: 5 },
  { type: "fracture", name: "骨折",       min: 15, max: 40, weight: 3 }
];
function _pickInjuryType() {
  const total = INJURY_TYPES.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of INJURY_TYPES) { r -= t.weight; if (r <= 0) return t; }
  return INJURY_TYPES[0];
}
/* 检查球员是否伤停中 */
function isInjured(save, id) {
  return save.injuries && save.injuries[id] && save.injuries[id].gamesLeft > 0;
}
/* 比赛后随机伤病判定：遍历参赛球员，小概率受伤 */
function rollInjuries(save, playerIds) {
  save.injuries = save.injuries || {};
  save.injuryLog = save.injuryLog || [];
  playerIds.forEach(id => {
    if (isInjured(save, id)) return;
    if (save.retired && save.retired[id]) return;
    const p = (save.customPlayers || []).find(c => c.id === id) || PLAYERS_RATED.players.find(p => p.id === id);
    if (!p) return;
    const adjAge = (p.age || 24) + (save.ageAdj && save.ageAdj[id] || 0);
    const ovr = (p.ovr || 70) + (save.ovrAdj && save.ovrAdj[id] || 0);
    /* 基础概率 1.5%，老将 +1%/岁(35+)，低 OVR 球员出场少概率低 */
    let chance = 0.015;
    if (adjAge >= 35) chance += (adjAge - 34) * 0.004;
    if (ovr >= 90) chance += 0.008;  /* 明星球员出场多，受伤概率略高 */
    if (Math.random() < chance) {
      const t = _pickInjuryType();
      const games = t.min + Math.floor(Math.random() * (t.max - t.min + 1));
      save.injuries[id] = { gamesLeft: games, type: t.type, name: t.name };
      save.injuryLog.push({ id, name: p.nameCn, team: p.team, injury: t.name, games });
    }
  });
}
/* 每场比赛后恢复：gamesLeft -1，归零则清除 */
function tickInjuries(save) {
  if (!save.injuries) return [];
  const recovered = [];
  Object.keys(save.injuries).forEach(id => {
    const inj = save.injuries[id];
    if (!inj || inj.gamesLeft <= 0) { delete save.injuries[id]; return; }
    inj.gamesLeft--;
    if (inj.gamesLeft <= 0) {
      const p = (save.customPlayers || []).find(c => c.id === Number(id)) || PLAYERS_RATED.players.find(p => p.id === Number(id));
      recovered.push({ id: Number(id), name: p ? p.nameCn : "球员", injury: inj.name });
      delete save.injuries[id];
    }
  });
  return recovered;
}
function expectedMinutes(ovr) {
  if (ovr >= 93) return 36;
  if (ovr >= 88) return 32;
  if (ovr >= 83) return 27;
  if (ovr >= 78) return 22;
  if (ovr >= 73) return 16;
  if (ovr >= 68) return 10;
  return 5;
}
function expectedShots(ovr) {
  if (ovr >= 93) return 18;
  if (ovr >= 88) return 14;
  if (ovr >= 83) return 10;
  if (ovr >= 78) return 7;
  return 4;
}
function applyStreak(save, abbr, won) {
  const s = save.standings[abbr] || (save.standings[abbr] = { w: 0, l: 0, streak: 0 });
  if (s.streak === undefined) s.streak = 0;
  if (won) s.streak = s.streak >= 0 ? s.streak + 1 : 1;
  else s.streak = s.streak <= 0 ? s.streak - 1 : -1;
}

/* 用户比赛赛后士气更新（双方球员都算） */
function updateMoraleAfterGame(save, sim, win) {
  const my = myAbbr(save);
  applyStreak(save, my, win);
  [0, 1].forEach(sideIdx => {
    const side = sim.teams[sideIdx];
    const abbr = sideIdx === 0 ? my : (side.info.abbr || sim.teams[1].info.abbr);
    const teamWon = (sideIdx === 0) === win;
    const streak = (save.standings[abbr] || {}).streak || 0;
    if (sideIdx === 1) applyStreak(save, abbr, teamWon);
    side.box.forEach((b, id) => {
      const p0 = findPlayerById(save, id);
      if (!p0) return;
      const delta = computeMoraleDelta(p0, save, b, teamWon, streak, side);
      setMorale(save, id, moraleOf(save, id) + delta);
    });
  });
}

function findPlayerById(save, id) {
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  return customById.get(id) || byId.get(id);
}

function computeMoraleDelta(p0, save, b, teamWon, streak, side) {
  const baseOvr = (p0.ovr || 70) + ((save.ovrAdj && save.ovrAdj[p0.id]) || 0);
  const actualMin = b.sec / 60;
  const actualShots = b.fga || 0;
  let d = 0;
  /* A. 上场时间惩罚 */
  const expMin = expectedMinutes(baseOvr);
  if (baseOvr >= 80 && actualMin < expMin * 0.6) {
    d += -1.5 * (1 - actualMin / Math.max(1, expMin * 0.6));
  } else if (actualMin > expMin * 1.3 && baseOvr >= 75) {
    d += 0.3;
  }
  /* B. 球权惩罚 */
  if (baseOvr >= 85) {
    const expS = expectedShots(baseOvr);
    if (actualShots < expS * 0.5) d += -1.0 * (1 - actualShots / Math.max(1, expS * 0.5));
  }
  /* C. 连胜/连败 */
  if (streak >= 3) d += Math.min(2.5, 0.5 * streak);
  else if (streak <= -3) d += Math.max(-2.0, 0.5 * streak);
  /* D. 个人表现 */
  const est = estStats(p0);
  const perf = b.pts + b.reb * 0.7 + b.ast * 0.9 + (b.stl + b.blk) * 1.2 - b.tov * 0.8;
  const expPerf = est.ppg + est.rpg * 0.7 + est.apg * 0.9;
  d += Math.max(-1.5, Math.min(1.5, (perf - expPerf) * 0.15));
  /* E. 胜负 */
  d += teamWon ? 0.3 : -0.3;
  /* F. 主力未登场 */
  if (b.sec === 0 && baseOvr >= 78 && side.rotation && side.rotation.includes(p0.id)) d += -0.8;
  return d;
}

/* AI-vs-AI 简化士气更新 */
function updateAIMorale(save, abbr, won) {
  const ids = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
  const top = ids.map(id => {
    const p0 = findPlayerById(save, id);
    return p0 ? { id, ovr: (p0.ovr || 70) + ((save.ovrAdj && save.ovrAdj[id]) || 0) } : null;
  }).filter(Boolean).sort((a, b) => b.ovr - a.ovr).slice(0, 8);
  const streak = (save.standings[abbr] || {}).streak || 0;
  /* 连胜/连败影响收敛，避免弱队一旦连败就士气崩盘、战力 -4 形成死循环，
     导致全联盟弱队集体沉底、摆烂队扎堆 */
  const streakFactor = Math.max(-0.8, Math.min(0.8, 0.15 * streak));
  const winFactor = won ? 0.25 : -0.25;
  top.forEach(p => setMorale(save, p.id, moraleOf(save, p.id) + winFactor + streakFactor));
}

/* ===== 名人堂系统 ===== */
/* save.hof = [{ id, name, team, pos, peakOvr, age, seasonNo, acc, score }]
   save.retired = { id: seasonNo }
   save.playerAccolades = { id: { mvp, fmvp, champ, allNBA, allDef, dpoy, scoring, assists, rebounds, allRookie } } */

/* 计算球员的名人堂评分 */
function hofScore(save, id) {
  const p = findPlayerById(save, id);
  if (!p) return 0;
  const peakOvr = (p.ovr || 70) + Math.max(0, (save.ovrAdj && save.ovrAdj[id]) || 0);
  const expYears = getExpYears(p, save.seasonNo);
  const acc = (save.playerAccolades && save.playerAccolades[id]) || {};
  let score = 0;
  /* 能力值：巅峰 OVR 权重最高 */
  score += peakOvr * 1.5;
  if (peakOvr >= 95) score += 10;
  if (peakOvr >= 90) score += 5;
  /* 球龄：长生涯加分 */
  score += Math.min(15, expYears);
  /* 核心荣誉 */
  score += (acc.mvp || 0) * 12;
  score += (acc.fmvp || 0) * 10;
  score += (acc.champ || 0) * 6;
  score += (acc.dpoy || 0) * 6;
  /* 阵容入选 */
  score += (acc.allNBA || 0) * 4;
  score += (acc.allDef || 0) * 2;
  score += (acc.allRookie || 0) * 1;
  /* 数据王 */
  score += (acc.scoring || 0) * 3;
  score += (acc.assists || 0) * 3;
  score += (acc.rebounds || 0) * 3;
  return Math.round(score);
}

/* 名人堂选举：退役后满 1 赛季可入选，评分 >= 50 自动入选 */
function electHOF(save) {
  save.hof = save.hof || [];
  save.hofRejected = save.hofRejected || [];
  const alreadyIn = new Set(save.hof.map(h => h.id));
  const rejected = new Set(save.hofRejected);
  const newInductees = [];
  const eligible = Object.keys(save.retired)
    .map(Number)
    .filter(id => !alreadyIn.has(id) && !rejected.has(id))
    .filter(id => save.seasonNo - save.retired[id] >= 1); /* 退役满 1 赛季 */
  eligible.forEach(id => {
    const p = findPlayerById(save, id);
    if (!p) return;
    const score = hofScore(save, id);
    /* 评分阈值 50，或拥有 MVP+总冠军直接入选 */
    const acc = (save.playerAccolades && save.playerAccolades[id]) || {};
    const autoIn = (acc.mvp || 0) > 0 && (acc.champ || 0) > 0;
    if (score >= 50 || autoIn) {
      const peakOvr = (p.ovr || 70) + Math.max(0, (save.ovrAdj && save.ovrAdj[id]) || 0);
      const adjAge = (p.age || 24) + (save.ageAdj[id] || 0);
      const expYears = getExpYears(p, save.seasonNo);
      /* 快照职业生涯数据（含当年累计） */
      const cur = (save.playerStats && save.playerStats[id]) || {};
      const car = (save.careerStats && save.careerStats[id]) || {};
      const totG = (car.g || 0) + (cur.g || 0);
      const totPts = (car.pts || 0) + (cur.pts || 0);
      const totReb = (car.reb || 0) + (cur.reb || 0);
      const totAst = (car.ast || 0) + (cur.ast || 0);
      const totStl = (car.stl || 0) + (cur.stl || 0);
      const totBlk = (car.blk || 0) + (cur.blk || 0);
      const totFgm = (car.fgm || 0) + (cur.fgm || 0);
      const totFga = (car.fga || 0) + (cur.fga || 0);
      const totTpm = (car.tpm || 0) + (cur.tpm || 0);
      const totTpa = (car.tpa || 0) + (cur.tpa || 0);
      const totFtm = (car.ftm || 0) + (cur.ftm || 0);
      const totFta = (car.fta || 0) + (cur.fta || 0);
      save.hof.push({
        id, name: p.nameCn, team: p.team, pos: p.pos,
        peakOvr, age: adjAge, expYears,
        seasonNo: save.seasonNo, score,
        acc: save.playerAccolades[id] || {},
        career: {
          g: totG,
          pts: totPts, reb: totReb, ast: totAst, stl: totStl, blk: totBlk,
          fgm: totFgm, fga: totFga, tpm: totTpm, tpa: totTpa, ftm: totFtm, fta: totFta,
          seasons: (car.seasons || 0) + 1,
          ppg: totG ? +(totPts / totG).toFixed(1) : 0,
          rpg: totG ? +(totReb / totG).toFixed(1) : 0,
          apg: totG ? +(totAst / totG).toFixed(1) : 0,
          fg: totFga ? Math.round(totFgm / totFga * 100) : 0,
          tp: totTpa ? Math.round(totTpm / totTpa * 100) : 0,
          ft: totFta ? Math.round(totFtm / totFta * 100) : 0
        }
      });
      alreadyIn.add(id);
      newInductees.push({ id, name: p.nameCn, team: p.team, score });
    } else if (score < 25) {
      /* 评分太低，永久落选 */
      save.hofRejected.push(id);
    }
    /* 评分 25-49 的球员继续保留资格，等未来赛季重新评估 */
  });
  return newInductees;
}

/* 获取退役球员完整列表（含荣誉和评分） */
function getRetiredPlayers(save) {
  save.retired = save.retired || {};
  save.hof = save.hof || [];
  const hofIds = new Set(save.hof.map(h => h.id));
  const rejected = new Set(save.hofRejected || []);
  return Object.keys(save.retired).map(Number).map(id => {
    const p = findPlayerById(save, id);
    if (!p) return null;
    const peakOvr = (p.ovr || 70) + Math.max(0, (save.ovrAdj && save.ovrAdj[id]) || 0);
    const adjAge = (p.age || 24) + (save.ageAdj[id] || 0);
    const expYears = getExpYears(p, save.seasonNo);
    const acc = (save.playerAccolades && save.playerAccolades[id]) || {};
    const score = hofScore(save, id);
    const inHOF = hofIds.has(id);
    const isRejected = rejected.has(id);
    const eligible = save.seasonNo - save.retired[id] >= 1;
    return { id, p, name: p.nameCn, team: p.team, pos: p.pos, peakOvr, age: adjAge, expYears, acc, score, inHOF, isRejected, eligible };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

/* ===== 全明星周末 ===== */
/* 第 42 场打完后触发全明星周末（对应 seasonDates 中 plan[ASB]=7 天 gap） */
const ALL_STAR_TRIGGER_GAME = 42;

/* 选拔用综合实力（含士气/老化修正） */
function allStarScore(save, id) {
  const p0 = findPlayerById(save, id);
  if (!p0) return 0;
  return (p0.ovr || 70) + ((save.ovrAdj && save.ovrAdj[id]) || 0) + moraleOvrDelta(moraleOf(save, id));
}

/* 收集全联盟球员并分东西部 */
function collectLeaguePlayers(save) {
  const my = myAbbr(save);
  const myIds = save.roster.map(r => r.id);
  const pool = [];
  TEAMS.forEach(t => {
    const conf = confOf(t.abbr);
    let ids;
    if (t.abbr === my) ids = myIds;
    else ids = (save.aiRosters && save.aiRosters[t.abbr]) || playersByTeam(t.abbr).map(p => p.id);
    ids.forEach(id => {
      const p0 = findPlayerById(save, id);
      if (!p0) return;
      pool.push({ id, p: p0, team: t.abbr, conf, ovr: allStarScore(save, id), isMine: t.abbr === my });
    });
  });
  return pool;
}

/* 全明星正赛阵容：东西部各12人（前5首发，后7替补） */
function buildAllStarRosters(save) {
  const pool = collectLeaguePlayers(save);
  const east = pool.filter(x => x.conf === "E").sort((a, b) => b.ovr - a.ovr).slice(0, 12)
    .map((x, i) => ({ id: x.id, p: x.p, team: x.team, ovr: x.ovr, isMine: x.isMine, isStarter: i < 5 }));
  const west = pool.filter(x => x.conf === "W").sort((a, b) => b.ovr - a.ovr).slice(0, 12)
    .map((x, i) => ({ id: x.id, p: x.p, team: x.team, ovr: x.ovr, isMine: x.isMine, isStarter: i < 5 }));
  return { east, west };
}

/* 模拟全明星正赛：东西部对抗，高分，MVP=赢方得分最高者 */
function simAllStarGame(save, rosters) {
  const simPlayer = (p) => {
    const ovrFactor = Math.max(0, Math.min(1, (p.ovr - 70) / 25));
    const pts = Math.round((8 + ovrFactor * 18) * (0.7 + Math.random() * 0.6));
    const reb = Math.round((2 + ovrFactor * 6) * (0.7 + Math.random() * 0.6));
    const ast = Math.round((1 + ovrFactor * 5) * (0.7 + Math.random() * 0.6));
    return { id: p.id, name: p.p.nameCn, team: p.team, pts, reb, ast, isStarter: p.isStarter, isMine: p.isMine };
  };
  const eastBox = rosters.east.map(simPlayer);
  const westBox = rosters.west.map(simPlayer);
  const eastScore = eastBox.reduce((s, b) => s + b.pts, 0);
  const westScore = westBox.reduce((s, b) => s + b.pts, 0);
  const winner = eastScore >= westScore ? "E" : "W";
  const winBox = winner === "E" ? eastBox : westBox;
  const mvp = winBox.slice().sort((a, b) => b.pts - a.pts || b.reb - a.reb)[0] || null;
  return {
    eastScore, westScore, winner,
    mvp: mvp ? { id: mvp.id, name: mvp.name, team: mvp.team, pts: mvp.pts, reb: mvp.reb, ast: mvp.ast } : null,
    box: { east: eastBox, west: westBox }
  };
}

/* 三分大赛候选：偏好 PG/SG/SF + OVR≥75 */
function threePtCandidates(save) {
  const pool = collectLeaguePlayers(save);
  const scored = pool.map(x => {
    const pos = getPos(x.p).pos;
    const posBonus = (pos === "PG" || pos === "SG") ? 5 : (pos === "SF" ? 2 : -3);
    return { id: x.id, p: x.p, team: x.team, ovr: x.ovr, pos, score: x.ovr + posBonus, isMine: x.isMine };
  }).filter(x => x.ovr >= 75);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

/* 模拟三分大赛：8人单淘汰，每轮每人25球，命中率基于OVR+位置 */
function simThreePoint(save, candidates) {
  if (candidates.length < 2) return { winner: null, rounds: [] };
  const shoot = (player) => {
    const base = 0.35 + Math.min(0.3, Math.max(0, (player.score - 75)) / 60);
    const rate = Math.max(0.3, Math.min(0.65, base + (Math.random() - 0.5) * 0.15));
    return Math.round(25 * rate);
  };
  const rounds = [];
  const roundNames = ["1/4决赛", "半决赛", "决赛"];
  let current = candidates.slice();
  let ri = 0;
  while (current.length > 1) {
    const matchups = [];
    const next = [];
    for (let i = 0; i + 1 < current.length; i += 2) {
      const a = current[i], b = current[i + 1];
      let aS = shoot(a), bS = shoot(b);
      while (aS === bS) { aS = shoot(a); bS = shoot(b); }
      const winner = aS > bS ? a : b;
      matchups.push({
        a: { id: a.id, name: a.p.nameCn, team: a.team, score: aS, isMine: a.isMine },
        b: { id: b.id, name: b.p.nameCn, team: b.team, score: bS, isMine: b.isMine },
        winnerId: winner.id
      });
      next.push(winner);
    }
    rounds.push({ round: roundNames[ri] || ("第" + (ri + 1) + "轮"), matchups });
    current = next;
    ri++;
  }
  const w = current[0];
  return {
    winner: w ? { id: w.id, name: w.p.nameCn, team: w.team, isMine: w.isMine } : null,
    rounds
  };
}

/* 扣篮大赛候选：年龄≤28 + 偏好前锋/中锋 */
function dunkCandidates(save) {
  const pool = collectLeaguePlayers(save);
  const scored = pool.map(x => {
    const adjAge = (x.p.age || 24) + ((save.ageAdj && save.ageAdj[x.id]) || 0);
    const pos = getPos(x.p).pos;
    const posBonus = (pos === "PF" || pos === "C") ? 4 : (pos === "SF" ? 2 : 0);
    const ageBonus = Math.max(0, (25 - adjAge)) * 1.5;
    return { id: x.id, p: x.p, team: x.team, ovr: x.ovr, pos, age: adjAge, score: x.ovr + posBonus + ageBonus, isMine: x.isMine };
  }).filter(x => x.age <= 28 && x.ovr >= 75);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4);
}

/* 模拟扣篮大赛：4人2轮（半决赛+决赛），5评委各6-10分，满分50/ dunk */
function simDunk(save, candidates) {
  if (candidates.length < 2) return { winner: null, rounds: [] };
  const dunkScore = (player) => {
    const base = 7 + Math.min(2, Math.max(0, (player.score - 75)) / 15);
    let total = 0;
    for (let i = 0; i < 5; i++) {
      total += Math.max(6, Math.min(10, base + (Math.random() - 0.5) * 3));
    }
    return Math.round(total * 10) / 10;
  };
  const rounds = [];
  const roundNames = ["半决赛", "决赛"];
  let current = candidates.slice();
  let ri = 0;
  while (current.length > 1) {
    const scores = current.map(p => {
      const d1 = dunkScore(p), d2 = dunkScore(p);
      return { id: p.id, name: p.p.nameCn, team: p.team, pos: p.pos, dunk1: d1, dunk2: d2, total: Math.round((d1 + d2) * 10) / 10, isMine: p.isMine };
    });
    scores.sort((a, b) => b.total - a.total);
    const advanceCount = Math.max(1, Math.floor(current.length / 2));
    const advance = scores.slice(0, advanceCount);
    const advanceIds = new Set(advance.map(s => s.id));
    rounds.push({ round: roundNames[ri] || ("第" + (ri + 1) + "轮"), scores, advanceIds: [...advanceIds] });
    current = current.filter(p => advanceIds.has(p.id));
    ri++;
  }
  const w = current[0];
  return {
    winner: w ? { id: w.id, name: w.p.nameCn, team: w.team, isMine: w.isMine } : null,
    rounds
  };
}

/* 初始化/获取本赛季全明星周末数据 */
function ensureAllStar(save) {
  if (!save.allStar || save.allStar.seasonNo !== save.seasonNo) {
    save.allStar = {
      seasonNo: save.seasonNo,
      done: false,
      rosters: buildAllStarRosters(save),
      game: null,
      threePt: null,
      dunk: null
    };
  }
  return save.allStar;
}
