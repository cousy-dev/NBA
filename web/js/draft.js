"use strict";
/* 选秀系统 —— 新秀生成 / 选秀逻辑 / AI选人 / 潜力评估（纯逻辑无 DOM） */

/* 新秀名字池 */
const ROOKIE_FIRST = ["贾", "凯", "马", "德", "安", "布", "杰", "以", "塔", "卡", "洛", "塞", "奥", "尼", "阿", "扎", "贾", "迪", "韦", "坎"];
const ROOKIE_LAST = ["威廉姆斯", "布朗", "约翰逊", "戴维斯", "托马斯", "杰克逊", "怀特", "哈里斯", "马丁", "汤普森", "刘易斯", "沃克", "罗宾逊", "格林", "伍德", "米勒", "卡特", "福斯特", "班克斯", "克鲁兹"];

/* 位置模板属性 */
const POS_TEMPLATES = {
  G:  { ins: -4, out: 4, org: 4, def: 0, reb: -5, ath: 3 },
  "G-F": { ins: -1, out: 2, org: 2, def: 1, reb: -2, ath: 2 },
  F:  { ins: 2, out: 0, org: -1, def: 2, reb: 2, ath: 1 },
  "F-C": { ins: 4, out: -2, org: -2, def: 3, reb: 4, ath: 0 },
  C:  { ins: 6, out: -4, org: -3, def: 4, reb: 6, ath: -1 }
};

/* 生成一个新秀 */
let ROOKIE_ID_COUNTER = 900000;
function genRookie(pickOvrSeed) {
  /* pickOvrSeed: 0-1, 0=状元 1=末轮 */
  const posList = ["G", "G", "G-F", "F", "F", "F-C", "C"];
  const pos = posList[Math.floor(Math.random() * posList.length)];
  /* OVR: 状元 76-80, 乐透 70-76, 首轮 65-72, 二轮 60-67 */
  let ovr;
  if (pickOvrSeed < 0.05) ovr = 76 + Math.floor(Math.random() * 5);
  else if (pickOvrSeed < 0.14) ovr = 70 + Math.floor(Math.random() * 6);
  else if (pickOvrSeed < 0.30) ovr = 65 + Math.floor(Math.random() * 7);
  else ovr = 60 + Math.floor(Math.random() * 7);

  const nameCn = ROOKIE_FIRST[Math.floor(Math.random() * ROOKIE_FIRST.length)] + "·" +
    ROOKIE_LAST[Math.floor(Math.random() * ROOKIE_LAST.length)];
  /* id：counter 分段 ×1000 + 段内随机，保证同届新秀 id 零碰撞（旧方案 900000+随机数有约 6% 碰撞概率） */
  const id = (++ROOKIE_ID_COUNTER) * 1000 + Math.floor(Math.random() * 1000);
  const age = 19 + Math.floor(Math.random() * 3);
  const tpl = POS_TEMPLATES[pos] || POS_TEMPLATES.F;
  const base = ovr * 0.85;
  const jitter = (salt, range) => Math.round((hash01(id, salt) - 0.5) * 2 * range);
  const clamp = v => Math.max(25, Math.min(95, Math.round(v)));

  const attrs = {
    ins: clamp(base + tpl.ins + jitter(1, 4)),
    out: clamp(base + tpl.out + jitter(2, 4)),
    org: clamp(base + tpl.org + jitter(3, 4)),
    def: clamp(base + tpl.def + jitter(4, 4)),
    reb: clamp(base + tpl.reb + jitter(5, 4)),
    ath: clamp(base + tpl.ath + jitter(6, 5))
  };
  const mgr = {
    off: clamp((attrs.ins + attrs.out + attrs.org) / 3),
    def: clamp((attrs.def + attrs.reb) / 2),
    sta: clamp(62 + (age <= 20 ? 8 : 4) + jitter(7, 3)),
    twk: clamp(55 + jitter(8, 5))
  };
  /* 潜力分：基于顺位 + 年龄 + 随机波动，拉开差距 */
  /* 状元级 88-94, 乐透 80-88, 首轮中段 74-82, 首轮末段 68-76, 二轮 60-70 */
  let potentialBase;
  if (pickOvrSeed < 0.05) potentialBase = 88 + Math.floor(Math.random() * 7);      /* 88-94 */
  else if (pickOvrSeed < 0.14) potentialBase = 80 + Math.floor(Math.random() * 9); /* 80-88 */
  else if (pickOvrSeed < 0.30) potentialBase = 74 + Math.floor(Math.random() * 9); /* 74-82 */
  else if (pickOvrSeed < 0.50) potentialBase = 68 + Math.floor(Math.random() * 9); /* 68-76 */
  else potentialBase = 60 + Math.floor(Math.random() * 11);                         /* 60-70 */
  /* 年龄修正：年轻 +1~2, 年长 -1~2 */
  const ageMod = age <= 19 ? 2 : age <= 20 ? 1 : age >= 22 ? -2 : 0;
  /* 高 ath/org 微加成 */
  const attrBonus = Math.round((attrs.ath - 60) * 0.1 + (attrs.org - 55) * 0.08);
  const potential = Math.max(58, Math.min(95, potentialBase + ageMod + attrBonus));

  return {
    id, nameCn, nameEn: nameCn, team: "ROOKIE", pos, num: 0, age,
    heightCm: pos === "C" ? 211 + Math.floor(Math.random() * 8) : pos === "F" || pos === "F-C" ? 201 + Math.floor(Math.random() * 8) : 190 + Math.floor(Math.random() * 8),
    weightKg: pos === "C" ? 110 + Math.floor(Math.random() * 15) : 90 + Math.floor(Math.random() * 15),
    expYears: 0, draftYear: 2026 + (typeof state !== "undefined" && state.save ? state.save.seasonNo : 1) - 1,
    avatar: null,
    ovr, ratingSource: "draft",
    attrs, mgr,
    stats: null,
    potential,
    isRookie: true
  };
}

/* 生成选秀班底（30 队 60 人；含自建队 31 队时 62 人，多生成 2 人保证末轮签也能选到人） */
function genDraftClass(save) {
  const class_ = [];
  const n = 62;
  for (let i = 0; i < n; i++) {
    const seed = i / n;
    class_.push(genRookie(seed));
  }
  /* 按潜力排序展示 */
  class_.sort((a, b) => b.potential - a.potential || b.ovr - a.ovr);
  return class_;
}

/* 选秀顺位：用户顺位基于上赛季战绩（越差越前，季后赛出局越早越前） */
function draftOrder(save) {
  const my = myAbbr(save);
  const teams = TEAMS.map(t => {
    const s = save.standings[t.abbr] || { w: 0, l: 0 };
    const gp = s.w + s.l;
    const winPct = gp ? s.w / gp : 0.5;
    /* 用户队用真实战绩，AI 队也用战绩排序 */
    return { abbr: t.abbr, winPct, str: teamStrength(t.abbr), w: s.w, l: s.l };
  });
  /* 乐透抽签：战绩最差 14 队随机前 4（简化） */
  const lottery = teams.filter(t => t.winPct < 0.5 || (t.abbr !== my && t.winPct < 0.5)).sort((a, b) => a.winPct - b.winPct);
  const playoff = teams.filter(t => !lottery.includes(t)).sort((a, b) => b.winPct - a.winPct);
  /* 简化乐透：最差 3 队随机排前 3 */
  const lottoTop = lottery.slice(0, 3);
  shuffleArr(lottoTop);
  const rest = lottery.slice(3).sort((a, b) => a.winPct - b.winPct || a.str - b.str);
  const order = lottoTop.concat(rest).concat(playoff);
  /* 用户位置 */
  const userPick = order.findIndex(t => t.abbr === my) + 1;
  return { order: order.map(t => t.abbr), userPick };
}

/* AI 选人策略：按需求 + 潜力 */
function aiPickRookie(draftClass, save, aiTeamAbbr, pickedIds) {
  const needs = teamNeeds(save, aiTeamAbbr);
  const available = draftClass.filter(r => !pickedIds.has(r.id));
  if (!available.length) return null;
  /* 优先选需求位置的高潜力新秀 */
  const fitPos = available.filter(r => catOf(r.pos) === needs.weak);
  const pool = fitPos.length ? fitPos : available;
  /* 综合分：潜力 70% + OVR 30% */
  pool.sort((a, b) => (b.potential * 0.7 + b.ovr * 0.3) - (a.potential * 0.7 + a.ovr * 0.3));
  return pool[0];
}

/* 用户选人后的入职 */
function signRookie(save, rookie) {
  const sal = estimateSalary(rookie.ovr, rookie.id);
  const years = rookieContractYears(rookie.potential || 75);
  save.roster.push({ id: rookie.id, salary: sal, years });
  /* 持久化新秀到存档（防止刷新丢失） */
  save.customPlayers = save.customPlayers || [];
  if (!save.customPlayers.find(p => p.id === rookie.id)) {
    save.customPlayers.push(rookie);
  }
  /* 同时加入运行时全局库（本回合可用） */
  if (!PLAYERS_RATED.players.find(p => p.id === rookie.id)) {
    rookie.team = myAbbr(save);
    PLAYERS_RATED.players.push(rookie);
    if (LEAGUE_EST) LEAGUE_EST.set(rookie.id, estStats(rookie));
  }
  writeSave(save);
}

/* 执行完整选秀（用户选 1 轮，AI 自动选其余）。order 长度 60（30队）或 62（含自建队） */
function runDraft(save, userPickId, draftClass, order, userPickIdx) {
  const pickedIds = new Set();
  const results = []; /* {pick, abbr, rookie} */
  for (let i = 0; i < order.length; i++) {
    const abbr = order[i % order.length];
    let rookie;
    if (i === userPickIdx) {
      rookie = draftClass.find(r => r.id === userPickId);
    } else {
      rookie = aiPickRookie(draftClass, save, abbr, pickedIds);
    }
    if (!rookie) continue;
    pickedIds.add(rookie.id);
    rookie.team = abbr;
    /* 持久化所有新秀到存档 */
    save.customPlayers = save.customPlayers || [];
    if (!save.customPlayers.find(p => p.id === rookie.id)) {
      save.customPlayers.push(rookie);
    }
    /* 同时加入运行时全局库 */
    if (!PLAYERS_RATED.players.find(p => p.id === rookie.id)) {
      PLAYERS_RATED.players.push(rookie);
      if (LEAGUE_EST) LEAGUE_EST.set(rookie.id, estStats(rookie));
    }
    /* 用户队签约 */
    if (abbr === myAbbr(save)) {
      signRookie(save, rookie);
    }
    results.push({ pick: i + 1, abbr, rookie });
  }
  save.draftResults = results;
  return results;
}

/* ===== 选秀权系统 ===== */
/* 选秀权数据结构: { team: abbr, round: 1|2, season: N, originalTeam: abbr } */
/* save.draftPicks = [{ team, round, season, originalTeam }, ...] */

/* 初始化选秀权：每队每年 1 首轮 + 1 次轮，共 60 个（自建队作为第 31 队额外补 2 个） */
function initDraftPicks(save) {
  const season = save.seasonNo; /* 当前赛季结束后的选秀（newSeason 已 seasonNo++） */
  const picks = [];
  TEAMS.forEach(t => {
    picks.push({ team: t.abbr, round: 1, season, originalTeam: t.abbr });
    picks.push({ team: t.abbr, round: 2, season, originalTeam: t.abbr });
  });
  /* 自建球队（myAbbr 为 CUS，不在 30 支真实球队中）也要参与选秀，否则用户选的新秀签不到自己队 */
  const my = myAbbr(save);
  if (!TEAMS.some(t => t.abbr === my)) {
    picks.push({ team: my, round: 1, season, originalTeam: my });
    picks.push({ team: my, round: 2, season, originalTeam: my });
  }
  save.draftPicks = picks;
}

/* 计算选秀顺位（基于上赛季战绩） */
/* 返回 [{ team, round, pick, season }] 排好序的 60 个选秀权 */
function computePickOrder(save) {
  const season = save.seasonNo; /* 当前赛季结束后选秀 */
  const my = myAbbr(save);
  /* 所有 30 支真实球队按战绩排序；自建球队（CUS）作为第 31 队一并纳入 */
  const ranked = TEAMS.map(t => {
    const s = save.standings[t.abbr] || { w: 0, l: 0 };
    const gp = s.w + s.l;
    const winPct = gp ? s.w / gp : 0.5;
    return { abbr: t.abbr, winPct, w: s.w, l: s.l, str: teamStrength(t.abbr) };
  });
  if (!TEAMS.some(t => t.abbr === my)) {
    const s = save.standings[my] || { w: 0, l: 0 };
    const gp = s.w + s.l;
    ranked.push({ abbr: my, winPct: gp ? s.w / gp : 0.5, w: s.w, l: s.l, str: strengthOf(save, my) });
  }
  /* 分乐透（未进季后赛）和季后赛 */
  /* 简化：战绩最差 14 队为乐透 */
  const sorted = ranked.slice().sort((a, b) => a.winPct - b.winPct || b.str - a.str);
  const lottery = sorted.slice(0, 14);
  const playoff = sorted.slice(14);
  /* 乐透抽签：最差 3 队各有 14% 概率抽到前 4，简化为随机前 4 */
  const lottoTop4 = lottery.slice(0, 4);
  shuffleArr(lottoTop4);
  const lottoRest = lottery.slice(4); /* 已按战绩排序 */
  const firstRoundOrder = lottoTop4.concat(lottoRest).concat(playoff);
  /* 次轮：纯战绩倒序 */
  const secondRoundOrder = sorted.slice();

  /* 从 save.draftPicks 中找出该赛季的所有选秀权 */
  const allPicks = (save.draftPicks || []).filter(p => p.season === season);
  /* 按顺位分配 */
  const result = [];
  /* 首轮 1-30 */
  firstRoundOrder.forEach((t, i) => {
    /* 找到持有该队首轮签的队伍 */
    const pick = allPicks.find(p => p.originalTeam === t.abbr && p.round === 1);
    if (pick) result.push({ team: pick.team, round: 1, pick: i + 1, season, originalTeam: t.abbr });
  });
  /* 次轮：紧接首轮顺位编号（30 队时 31-60；含自建队 31 队时 32-62） */
  const secondRoundStart = firstRoundOrder.length + 1;
  secondRoundOrder.forEach((t, i) => {
    const pick = allPicks.find(p => p.originalTeam === t.abbr && p.round === 2);
    if (pick) result.push({ team: pick.team, round: 2, pick: i + secondRoundStart, season, originalTeam: t.abbr });
  });
  return result;
}

/* 选秀权价值评估（0-100） */
function pickValue(pickInfo) {
  if (!pickInfo) return 0;
  const { round, pick } = pickInfo;
  if (round === 1) {
    if (pick <= 3) return 82;        /* 前 3 顺位：状元级 */
    if (pick <= 5) return 76;        /* 乐透前段 */
    if (pick <= 14) return 68;       /* 乐透区 */
    if (pick <= 20) return 55;       /* 首轮中段 */
    if (pick <= 30) return 42;       /* 首轮末段 */
  } else {
    if (pick <= 35) return 28;       /* 次轮前段 */
    if (pick <= 45) return 20;       /* 次轮中段 */
    return 12;                        /* 次轮末段 */
  }
  return 0;
}

/* 获取某队持有的所有选秀权 */
function getTeamPicks(save, abbr) {
  const season = save.seasonNo; /* 当前赛季结束后的选秀 */
  return (save.draftPicks || []).filter(p => p.team === abbr && p.season === season);
}

/* 获取选秀权显示文本 */
function pickLabel(pick) {
  if (!pick) return "";
  return "第" + pick.season + "赛季/" + (pick.round === 1 ? "首轮" : "次轮") + " #" + pick.pick;
}

/* 获取交易后顺位（模拟，实际在选秀时计算） */
function estimatePickPosition(save, pick) {
  /* 根据原属队战绩估算顺位 */
  const s = save.standings[pick.originalTeam] || { w: 0, l: 0 };
  const gp = s.w + s.l;
  const winPct = gp ? s.w / gp : 0.5;
  /* 简化：按胜率估算顺位（30 队倒序） */
  const ranked = TEAMS.map(t => {
    const st = save.standings[t.abbr] || { w: 0, l: 0 };
    const g = st.w + st.l;
    return { abbr: t.abbr, winPct: g ? st.w / g : 0.5 };
  }).sort((a, b) => a.winPct - b.winPct);
  const idx = ranked.findIndex(t => t.abbr === pick.originalTeam);
  const estPick = idx >= 0 ? idx + 1 : 15;
  return pick.round === 1 ? estPick : estPick + 30;
}
