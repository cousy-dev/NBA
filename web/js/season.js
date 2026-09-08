"use strict";
/* 赛季系统 —— 赛程 / 联盟AI模拟 / 排名 / 季后赛 / 奖项 / 老化（纯逻辑，无 DOM） */

/* ===== 东西部（静态映射，自定义队归西部） ===== */
const CONF_EAST = ["ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"];
const CONF_WEST = ["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA"];
function confOf(abbr) { return CONF_EAST.includes(abbr) ? "E" : "W"; }
const ROUND_NAMES = ["季后赛首轮", "分区半决赛", "分区决赛", "总决赛"];
const GAMES_PER_SEASON = 82;

/* ===== 工具 ===== */
function shuffleArr(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function myAbbr(save) { return save.team.abbr || "CUS"; }

/* ===== 赛程生成：82 场，每对手主客各一次 + 24 场随机 ===== */
function makeSchedule(save) {
  const pool = TEAMS.map(t => t.abbr).filter(a => a !== myAbbr(save));
  const list = [];
  pool.forEach(a => { list.push({ opp: a, home: true, result: null, score: null }); list.push({ opp: a, home: false, result: null, score: null }); });
  for (let i = 0; i < 24; i++) list.push({ opp: pool[Math.floor(Math.random() * pool.length)], home: Math.random() < 0.5, result: null, score: null });
  return shuffleArr(list);
}

/* ===== 排名初始化（30 队，自定义队占西部一席） ===== */
function initStandings(save) {
  const st = {};
  TEAMS.forEach(t => { st[t.abbr] = { w: 0, l: 0, streak: 0 }; });
  st[myAbbr(save)] = { w: 0, l: 0, streak: 0 };
  return st;
}

/* ===== 球队战力（含用户老化修正） ===== */
function strengthOf(save, abbr) {
  if (abbr === myAbbr(save)) {
    const mine = loadMyPlayers(save);
    const top8 = mine.slice().sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 8);
    return top8.reduce((s, x) => s + x.p.ovr, 0) / Math.max(1, top8.length);
  }
  const raw = teamStrength(abbr);
  const ids = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
  const top8 = ids.slice(0, 8);
  const mAvg = top8.length ? top8.reduce((s, id) => s + moraleOf(save, id), 0) / top8.length : DEFAULT_MORALE;
  return raw + moraleOvrDelta(mAvg);
}
/* Elo 式胜率：主场 +2 */
function winProb(strA, strB, homeA) {
  return 1 / (1 + Math.pow(10, (strB + (homeA ? 2 : -2) - strA) / 7));
}

/* ===== 联盟一轮：其余 29 队随机配对打 14 场，1 队轮空 ===== */
function simLeagueRound(save) {
  const others = TEAMS.map(t => t.abbr).filter(a => a !== myAbbr(save));
  shuffleArr(others);
  for (let i = 0; i + 1 < others.length; i += 2) {
    const A = others[i], B = others[i + 1];
    const p = winProb(strengthOf(save, A), strengthOf(save, B), true);
    const aWon = Math.random() < p;
    if (aWon) { save.standings[A].w++; save.standings[B].l++; }
    else { save.standings[B].w++; save.standings[A].l++; }
    applyStreak(save, A, aWon);
    applyStreak(save, B, !aWon);
    updateAIMorale(save, A, aWon);
    updateAIMorale(save, B, !aWon);
  }
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
  const posR = { G: 2.2, "G-F": 3.4, F: 5.2, "F-C": 7.2, C: 9.4 };
  const posA = { G: 6.2, "G-F": 4.4, F: 2.8, "F-C": 2.0, C: 1.6 };
  const isC = p.pos === "C" || p.pos === "F-C";
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
    rpg: (posR[p.pos] || 5) * (0.7 + per * 0.6) * (0.85 + hash01(p.id, 2) * 0.3),
    apg: (posA[p.pos] || 3) * (0.7 + per * 0.6) * (0.85 + hash01(p.id, 3) * 0.3),
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

/* ===== 赛季中实时奖项排行 ===== */
function liveAwardRanks(save) {
  const real = save.playerStats || {};
  const myIds = new Set(save.roster.map(r => r.id));
  const est = leagueEst();
  const my = myAbbr(save);
  const gp = save.gameNo || 0;
  /* 用户队替补识别（OVR 前 5 为首发） */
  const mineSorted = loadMyPlayers(save).slice().sort((a, b) => b.p.ovr - a.p.ovr);
  const starterIds = new Set(mineSorted.slice(0, 5).map(x => x.p.id));

  const candidates = PLAYERS_RATED.players.map(p => {
    let st = est.get(p.id);
    const rs = real[p.id];
    const isMine = myIds.has(p.id);
    /* 用户球员有真实数据且打了足够场次，用真实数据 */
    if (rs && rs.g >= 5 && isMine) {
      st = { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g };
    }
    const teamSt = save.standings[p.team];
    let winPct = 0.45;
    if (teamSt) { const t = teamSt.w + teamSt.l; if (t) winPct = teamSt.w / t; }
    const mvp = st.ppg + st.rpg * 1.2 + st.apg * 1.5 + winPct * 10;
    const dpoy = (st.spg * 2 + st.bpg * 2.2) + (p.attrs ? p.attrs.def * 0.25 : p.ovr * 0.2);
    const isSixth = isMine && !starterIds.has(p.id);
    const sixth = isSixth ? st.ppg + st.apg * 0.5 : 0;
    const realGP = rs ? rs.g : 0;
    return { p, st, mvp, dpoy, sixth, mine: isMine, winPct, realGP };
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

  return { mvpTop, dpoyTop, sixthTop, scoringTop, assistTop, reboundTop, gp };
}

/* ===== 奖项：MVP / DPOY（联盟榜 + 用户真实数据覆盖） ===== */
function seasonAwards(save) {
  const real = save.playerStats || {};
  const myIds = new Set(save.roster.map(r => r.id));
  const est = leagueEst();
  const candidates = PLAYERS_RATED.players.map(p => {
    let st = est.get(p.id);
    const rs = real[p.id];
    if (rs && rs.g >= 20 && myIds.has(p.id)) {
      st = { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g };
    }
    let winPct = 0.45;
    const teamSt = save.standings[p.team];
    if (teamSt) { const gp = teamSt.w + teamSt.l; if (gp) winPct = teamSt.w / gp; }
    return { p, st, mvp: st.ppg + st.rpg * 1.2 + st.apg * 1.5 + winPct * 10, dpoy: (st.spg * 2 + st.bpg * 2.2) + p.attrs.def * 0.25, mine: myIds.has(p.id) };
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
  TEAMS.forEach(t => { allRosters[t.abbr] = playersByTeam(t.abbr).map(p => p.id); });
  const myAbbrLocal = myAbbr(save);
  if (!allRosters[myAbbrLocal]) allRosters[myAbbrLocal] = save.roster.map(r => r.id);
  const sixthCandidates = [];
  Object.keys(allRosters).forEach(abbr => {
    const ids = allRosters[abbr];
    /* 该队得分前5为首发，其余为替补 */
    const sortedByPts = ids.slice().sort((a, b) => avgPts(real, b) - avgPts(real, a));
    const starterIds = sortedByPts.slice(0, 5);
    sortedByPts.slice(5).forEach(id => {
      const p = PLAYERS_RATED.players.find(x => x.id === id);
      if (!p) return;
      const rs = real[id];
      const st = rs && rs.g ? { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g } : est.get(id);
      if (!st) return;
      sixthCandidates.push({ p, st, mine: myIds.has(id) });
    });
  });
  const sixth = sixthCandidates.sort((a, b) => b.st.ppg - a.st.ppg)[0] || null;

  /* FMVP：总决赛最有价值球员，总冠军队中综合表现最佳者 */
  let fmvp = null;
  if (save.playoffs && save.playoffs.done && save.playoffs.champion) {
    const champAbbr = save.playoffs.champion;
    const champRoster = playersByTeam(champAbbr);
    const champIds = champRoster.map(p => p.id);
    fmvp = champIds.map(id => {
      const p = PLAYERS_RATED.players.find(x => x.id === id);
      if (!p) return null;
      const rs = real[id];
      const st = rs && rs.g ? { ppg: rs.pts / rs.g, rpg: rs.reb / rs.g, apg: rs.ast / rs.g, spg: rs.stl / rs.g, bpg: rs.blk / rs.g } : est.get(id);
      if (!st) return null;
      /* FMVP 倾向：得分为主 + 篮板 + 助攻 + 防守贡献 */
      const score = st.ppg * 1.0 + st.rpg * 0.7 + st.apg * 0.8 + (st.spg + st.bpg) * 1.5;
      const mine = myIds.has(id);
      return { p, st, score, mine };
    }).filter(x => x).sort((a, b) => b.score - a.score)[0] || null;
  }

  return { mvp, dpoy, sixth, scoring, assists, rebounds, fmvp };
}
function avgPts(real, id) { const r = real[id]; return r && r.g ? r.pts / r.g : 0; }

/* ===== 季后赛 ===== */
function buildPlayoffs(save) {
  const mk = list => {
    const series = [];
    const pairs = [[0, 7], [3, 4], [2, 5], [1, 6]]; // 1v8 4v5 3v6 2v7
    pairs.forEach(([hi, lo]) => series.push({
      a: list[hi].abbr, b: list[lo].abbr, seedA: list[hi].seed, seedB: list[lo].seed,
      wa: 0, wb: 0, done: false, winner: null
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
/* AI 系列：整体模拟（2-2-1-1-1 主场，a 为高位种子） */
function resolveSeriesAI(ser) {
  const sA = teamStrength(ser.a), sB = teamStrength(ser.b);
  const pat = [1, 1, 0, 0, 1, 0, 1];
  for (let g = 0; g < 7; g++) {
    const p = winProb(sA, sB, pat[g] === 1);
    if (Math.random() < p) { ser.wa++; if (ser.wa >= 4) break; } else { ser.wb++; if (ser.wb >= 4) break; }
  }
  ser.done = true;
  ser.winner = ser.wa >= 4 ? ser.a : ser.b;
}
function winnerSeed(ser) { return ser.winner === ser.a ? ser.seedA : ser.seedB; }
function mkSer(s1, s2) {
  return { a: s1.winner, b: s2.winner, seedA: winnerSeed(s1), seedB: winnerSeed(s2), wa: 0, wb: 0, done: false, winner: null };
}
/* 该轮全部系列结束 → 生成下一轮；总决赛结束 → 冠军 */
function advancePlayoffs(save) {
  const ps = save.playoffs;
  const cur = ps.rounds[ps.round];
  cur.E.concat(cur.W).forEach(s => { if (!s.done) resolveSeriesAI(s); });
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
  if (!ps.userSeries) finishAllAI(save);
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
  /* 即时结算同轮剩余的 AI 系列赛（用户系列赛是唯一节奏驱动，绝不能被 AI 代打） */
  cur.E.concat(cur.W).forEach(s => { if (!s.done && s !== ps.userSeries) resolveSeriesAI(s); });
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
  doAging(save);
  save.seasonNo++;
  save.gameNo = 0;
  save.record = { w: 0, l: 0 };
  save.schedule = makeSchedule(save);
  save.standings = initStandings(save);
  save.playerStats = {};
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
  const streakFactor = Math.max(-1.8, Math.min(2.0, 0.4 * streak));
  const winFactor = won ? 0.4 : -0.4;
  top.forEach(p => setMorale(save, p.id, moraleOf(save, p.id) + winFactor + streakFactor));
}
