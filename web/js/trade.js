"use strict";
/* 交易系统 —— 球员价值评估 / AI 报价 / 谈判逻辑（纯逻辑无 DOM） */

/* ===== 球员交易价值 ===== */
/* 基于 OVR + 年龄 + 合同，返回 0-100 价值分 */
function tradeValue(p, salary) {
  const ovr = p.ovr;
  let v = ovr;                          // 基础 = OVR
  /* 年龄修正：年轻潜力股加分，老将减分 */
  const age = p.age || 24;
  if (age <= 22) v += 8;
  else if (age <= 25) v += 4;
  else if (age <= 28) v += 0;
  else if (age <= 31) v -= 3;
  else if (age <= 34) v -= 8;
  else v -= 15;
  /* 合同性价比：工资 vs OVR 预期 */
  const exp = estimateSalary(ovr, p.id);
  if (salary && exp > 0) {
    const ratio = salary / exp;
    if (ratio < 0.7) v += 5;           // 物超所值
    else if (ratio > 1.4) v -= 6;       // 溢价合同
  }
  /* 新秀合同特别加分（低薪高能） */
  if (p.draftYear && p.draftYear >= 2024 && ovr >= 75) v += 4;
  return Math.max(10, Math.min(99, Math.round(v)));
}

/* ===== 阵容需求评估 ===== */
/* 返回球队最弱位置 { weak: 'G'|'F'|'C', depth: 缺口人数 } */
function teamNeeds(save, abbr) {
  let players;
  if (abbr === myAbbr(save)) {
    players = loadMyPlayers(save).map(x => x.p);
  } else {
    players = playersByTeam(abbr);
  }
  const cat = { G: 0, F: 0, C: 0 };
  players.forEach(p => { cat[catOf(p.pos)]++; });
  /* 理想：G≥5, F≥5, C≥3 */
  const gaps = [
    { pos: "G", depth: 5 - cat.G },
    { pos: "F", depth: 5 - cat.F },
    { pos: "C", depth: 3 - cat.C }
  ].sort((a, b) => b.depth - a.depth);
  return { weak: gaps[0].pos, gaps };
}

/* ===== AI 交易意愿 ===== */
/* AI 评估一笔交易是否接受，返回 { accept: bool, reason: string, counter?: offer } */
/* myOffer/aiOffer: [{ p, sal }] 或空数组; myPicks/aiPicks: [pickInfo] 或空数组 */
function aiEvaluateTrade(save, myAbbrCode, myOffer, aiOffer, myPicks, aiPicks) {
  const aiTeam = myAbbrCode;
  myPicks = myPicks || [];
  aiPicks = aiPicks || [];
  /* 计算双方价值（球员 + 选秀权） */
  const myVal = myOffer.reduce((s, x) => s + tradeValue(x.p, x.sal), 0) +
    myPicks.reduce((s, pk) => s + pickValue(pk), 0);
  const aiVal = aiOffer.reduce((s, x) => s + tradeValue(x.p, x.sal), 0) +
    aiPicks.reduce((s, pk) => s + pickValue(pk), 0);
  /* AI 需要得到略多的价值才愿意交易（主场优势心理） */
  const threshold = 1.05;
  const ratio = myVal / Math.max(1, aiVal);
  /* 阵容需求：如果用户提供的球员恰好补 AI 弱位，加成 */
  const needs = teamNeeds(save, aiTeam);
  const fillsNeed = myOffer.some(p => catOf(p.p.pos) === needs.weak);
  const needBonus = fillsNeed ? 1.08 : 1.0;
  /* 战绩因素：烂队更愿意送走老将换潜力 */
  const aiStr = teamStrength(aiTeam);
  const record = save.standings[aiTeam] || { w: 0, l: 0 };
  const gp = record.w + record.l;
  const winPct = gp ? record.w / gp : 0.5;
  /* 重建中球队：偏好年轻潜力股 */
  const avgAgeMy = myOffer.reduce((s, p) => s + (p.p.age || 24), 0) / myOffer.length;
  const avgAgeAi = aiOffer.reduce((s, p) => s + (p.p.age || 24), 0) / aiOffer.length;
  const rebuildBonus = (winPct < 0.4 && avgAgeMy < avgAgeAi) ? 1.10 : 1.0;

  const effectiveRatio = ratio * needBonus * rebuildBonus;
  if (effectiveRatio >= threshold) {
    return { accept: true, reason: "交易方案公平，对方愿意接受。" };
  }
  /* 拒绝时尝试生成还价 */
  if (effectiveRatio >= 0.82) {
    /* 接近但不够，AI 选一个价值稍低的替代品还价 */
    const allAi = playersByTeam(aiTeam).filter(p => p.ovr < 90 && !aiOffer.find(x => x.p.id === p.id));
    const targetVal = aiVal * 0.95;
    const counter = allAi
      .map(p => ({ p, v: tradeValue(p, estimateSalary(p.ovr, p.id)) }))
      .filter(x => Math.abs(x.v - targetVal) < 12)
      .sort((a, b) => a.v - b.v)[0];
    if (counter) {
      return {
        accept: false,
        reason: "对方认为价值不够，提出还价：用 " + counter.p.nameCn + " 替换 " + aiOffer[0].p.nameCn + "？",
        counter: { out: aiOffer[0], in: { p: counter.p, sal: estimateSalary(counter.p.ovr, counter.p.id) } }
      };
    }
  }
  return { accept: false, reason: "对方拒绝了这笔交易，价值差距过大。" };
}

/* ===== 执行交易 ===== */
function executeTrade(save, myAbbrCode, myOfferIds, aiOfferIds, aiTeamAbbr, myPickOffers, aiPickOffers) {
  /* 从用户阵容移除 myOffer，加入 aiOffer */
  const newRoster = save.roster.filter(r => !myOfferIds.includes(r.id));
  aiOfferIds.forEach(id => {
    const p = PLAYERS_RATED.players.find(x => x.id === id);
    if (p) newRoster.push({ id: p.id, salary: estimateSalary(p.ovr, p.id) });
  });
  save.roster = newRoster;
  /* AI 阵容变化：从 aiTeam 移除 aiOffer，加入 myOffer（仅记录，不影响玩家） */
  save.aiRosters = save.aiRosters || {};
  const aiList = (save.aiRosters[aiTeamAbbr] || playersByTeam(aiTeamAbbr).map(p => p.id))
    .filter(id => !aiOfferIds.includes(id));
  myOfferIds.forEach(id => aiList.push(id));
  save.aiRosters[aiTeamAbbr] = aiList;
  /* 选秀权交换 */
  if (myPickOffers && myPickOffers.length) {
    myPickOffers.forEach(pk => { pk.team = aiTeamAbbr; });
  }
  if (aiPickOffers && aiPickOffers.length) {
    aiPickOffers.forEach(pk => { pk.team = myAbbrCode; });
  }
  writeSave(save);
}

/* ===== 获取 AI 队伍可交易球员（全部返回，OVR≥90 标记为非卖品） ===== */
function getTradable(aiTeamAbbr) {
  const all = playersByTeam(aiTeamAbbr);
  /* OVR≥90 视为非卖品：仍然展示，但打上标记且不可被选入交易篮 */
  return all
    .map(p => ({ p, untouchable: p.ovr >= 90 }))
    .sort((a, b) => b.p.ovr - a.p.ovr);
}
