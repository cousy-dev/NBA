"use strict";
/* 交易系统 —— 球员价值评估 / AI 报价 / 谈判逻辑（纯逻辑无 DOM） */

/* ===== 球员交易价值 ===== */
/* ctx: { years, morale, potential, birdYears } 可选上下文，传入后启用对应维度 */
function tradeValueDetail(p, salary, ctx) {
  ctx = ctx || {};
  const ovr = p.ovr;
  const age = p.age || 24;
  const breakdown = { base: ovr };
  let v = ovr;
  /* 年龄修正：年轻潜力股加分，老将减分 */
  let ageMod;
  if (age <= 22) ageMod = 8;
  else if (age <= 25) ageMod = 4;
  else if (age <= 28) ageMod = 0;
  else if (age <= 31) ageMod = -3;
  else if (age <= 34) ageMod = -8;
  else ageMod = -15;
  v += ageMod; breakdown.age = ageMod;
  /* 位置稀缺性：中锋和控卫更值钱（按具体位置 PG/SG/SF/PF/C） */
  const dp = getPos(p).pos;
  const posMod = { C: 3, PG: 2.5, SG: 2, PF: 2, SF: 1.5 }[dp] || 0;
  v += posMod; breakdown.position = posMod;
  /* 合同性价比：工资 vs OVR 预期 */
  const exp = estimateSalary(ovr, p.id);
  let salMod = 0;
  if (salary && exp > 0) {
    const ratio = salary / exp;
    if (ratio < 0.7) salMod = 5;
    else if (ratio > 1.4) salMod = -6;
    else if (ratio > 1.15) salMod = -2;
    else if (ratio < 0.85) salMod = 2;
  }
  v += salMod; breakdown.salary = salMod;
  /* 新秀合同特别加分（低薪高能） */
  const rookieMod = (p.draftYear && p.draftYear >= 2024 && ovr >= 75) ? 4 : 0;
  v += rookieMod; breakdown.rookie = rookieMod;
  /* 合同剩余年限：长合同可控性更强，到期合同贬值 */
  if (ctx.years != null) {
    let yrsMod;
    if (ctx.years >= 4) yrsMod = 3;
    else if (ctx.years === 3) yrsMod = 2;
    else if (ctx.years === 2) yrsMod = 1;
    else if (ctx.years === 1) yrsMod = -1;
    else yrsMod = -4;
    v += yrsMod; breakdown.contractYears = yrsMod;
  }
  /* 潜力加成：年轻高潜球员更值钱 */
  if (ctx.potential != null && age <= 25) {
    let potMod = 0;
    if (ctx.potential >= 90) potMod = 5;
    else if (ctx.potential >= 85) potMod = 3;
    else if (ctx.potential >= 80) potMod = 1;
    v += potMod; breakdown.potential = potMod;
  }
  /* 士气修正：士气低的球员交易价值下降 */
  if (ctx.morale != null) {
    let morMod;
    if (ctx.morale >= 80) morMod = 2;
    else if (ctx.morale >= 60) morMod = 0;
    else if (ctx.morale >= 40) morMod = -3;
    else morMod = -6;
    v += morMod; breakdown.morale = morMod;
  }
  /* 鸟权加成：完全鸟权可帽上续约，提升交易价值 */
  if (ctx.birdYears != null) {
    let birdMod;
    if (ctx.birdYears >= 3) birdMod = 3;
    else if (ctx.birdYears === 2) birdMod = 1;
    else if (ctx.birdYears === 1) birdMod = 0;
    else birdMod = -1;
    v += birdMod; breakdown.birdRights = birdMod;
  }
  /* 球队需求：填补阵容短板的球员更值钱（从评估方视角） */
  if (ctx.needBonus != null) {
    v += ctx.needBonus; breakdown.teamNeed = ctx.needBonus;
  }
  const total = Math.max(10, Math.min(99, Math.round(v)));
  breakdown.total = total;
  return { value: total, breakdown };
}

/* 兼容旧调用：直接返回数值 */
function tradeValue(p, salary, ctx) {
  return tradeValueDetail(p, salary, ctx).value;
}

/* 价值等级标签：用于 UI 星级展示 */
function valueTier(v) {
  if (v >= 90) return { stars: 5, label: "基石", color: "t1" };
  if (v >= 80) return { stars: 4, label: "明星", color: "t2" };
  if (v >= 70) return { stars: 3, label: "优质", color: "t3" };
  if (v >= 55) return { stars: 2, label: "轮换", color: "t4" };
  if (v >= 40) return { stars: 1, label: "边缘", color: "t5" };
  return { stars: 0, label: "添头", color: "t6" };
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

/* 计算某位置对某球队的需求加成：
   - 填补最大缺口：+6
   - 填补次级缺口（depth > 0）：+3
   - 位置人数刚好：0
   - 位置冗余（depth < 0）：-3 */
function positionNeedBonus(save, abbr, pos) {
  const needs = teamNeeds(save, abbr);
  const cat = catOf(pos);
  const gap = needs.gaps.find(g => g.pos === cat);
  if (!gap) return 0;
  if (needs.weak === cat && gap.depth > 0) return 6;   /* 最大缺口 */
  if (gap.depth > 0) return 3;                          /* 次级缺口 */
  if (gap.depth < 0) return -3;                         /* 冗余 */
  return 0;                                             /* 刚好 */
}

/* ===== AI 交易意愿 ===== */
/* AI 评估一笔交易是否接受，返回 { accept: bool, reason: string, counter?: offer } */
/* myOffer/aiOffer: [{ p, sal }] 或空数组; myPicks/aiPicks: [pickInfo] 或空数组 */
function aiEvaluateTrade(save, myAbbrCode, myOffer, aiOffer, myPicks, aiPicks) {
  const aiTeam = myAbbrCode;
  myPicks = myPicks || [];
  aiPicks = aiPicks || [];
  /* 计算双方价值（球员 + 选秀权），传入 ctx 启用多维度评估 */
  /* AI 接收的球员（myOffer）按 AI 队阵容短板重新计算需求加成 */
  const myVal = myOffer.reduce((s, x) => {
    const ctx = { ...(x.ctx || {}), needBonus: positionNeedBonus(save, aiTeam, x.p.pos) };
    return s + tradeValue(x.p, x.sal, ctx);
  }, 0) + myPicks.reduce((s, pk) => s + pickValue(pk), 0);
  /* AI 送出的球员（aiOffer）按 AI 队冗余度评估：送走冗余位置球员损失更小 */
  const aiVal = aiOffer.reduce((s, x) => {
    const ctx = { ...(x.ctx || {}), needBonus: -positionNeedBonus(save, aiTeam, x.p.pos) * 0.5 };
    return s + tradeValue(x.p, x.sal, ctx);
  }, 0) + aiPicks.reduce((s, pk) => s + pickValue(pk), 0);
  /* AI 需要得到略多的价值才愿意交易（主场优势心理） */
  const threshold = 1.05;
  const ratio = myVal / Math.max(1, aiVal);
  /* 战绩因素：烂队更愿意送走老将换潜力 */
  const aiStr = teamStrength(aiTeam);
  const record = save.standings[aiTeam] || { w: 0, l: 0 };
  const gp = record.w + record.l;
  const winPct = gp ? record.w / gp : 0.5;
  /* 重建中球队：偏好年轻潜力股 */
  const avgAgeMy = myOffer.reduce((s, p) => s + (p.p.age || 24), 0) / myOffer.length;
  const avgAgeAi = aiOffer.reduce((s, p) => s + (p.p.age || 24), 0) / aiOffer.length;
  const rebuildBonus = (winPct < 0.4 && avgAgeMy < avgAgeAi) ? 1.10 : 1.0;

  const effectiveRatio = ratio * rebuildBonus;
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
