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

/* ===== AI 球队薪资与阵容工具 ===== */
/* AI 队当前总薪资（估算合同）+ 球员 id 列表 */
function aiTeamFinances(save, abbr) {
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  const ids = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
  let payroll = 0;
  const players = [];
  ids.forEach(id => {
    const p = customById.get(id) || byId.get(id);
    if (p) {
      const adj = (typeof applyAdj === "function") ? applyAdj(p, save) : p;
      const sal = estimateSalary(adj.ovr, id);
      payroll += sal;
      players.push({ p: adj, sal });
    }
  });
  return { ids, players, payroll };
}

/* ===== NBA CBA 2023 薪资配平规则 =====
   送出 outSal 的球队，超帽时最多可收回：
   - outSal < 7.5M：200% × outSal + 0.1M
   - 7.5M ≤ outSal < 29M：outSal + 5.0M
   - outSal ≥ 29M：125% × outSal + 0.1M
   帽下球队可直接用薪资空间吃到工资帽。
   payrollAfterOut：送出球员后该队总薪资（M） */
function maxIncomingSalary(outSal, payrollAfterOut, cap) {
  cap = cap || (typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0);
  let matched;
  if (outSal < 0.11) matched = 0.11;                 /* 空气：超帽几乎不能收回 */
  else if (outSal < 7.5) matched = outSal * 2 + 0.1;
  else if (outSal < 29) matched = outSal + 5.0;
  else matched = outSal * 1.25 + 0.1;
  /* 帽下空间可以叠加：只要交易后不超工资帽即可，空间额就是可收回的薪资上限
     （注意：不是 outSal + room，送出的薪资已体现在 payrollAfterOut 中） */
  const room = Math.max(0, cap - payrollAfterOut);
  return Math.max(matched, room);
}

/* 检查配平是否合法：inSal 是否为送出 outSal 的球队可接收 */
function salaryMatchOk(outSal, inSal, payrollAfterOut, cap) {
  cap = cap || (typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0);
  /* 帽下直接吃 */
  if (payrollAfterOut + inSal <= cap + 0.01) return { ok: true, via: "cap-room" };
  /* 超帽走配平例外 */
  if (outSal < 0.11) return { ok: false, via: "trade-exception", max: 0.11 };
  const maxIn = maxIncomingSalary(outSal, payrollAfterOut, cap);
  return { ok: inSal <= maxIn + 0.01, via: "trade-exception", max: maxIn };
}

/* ===== 打包价值：极陡峭边际递减，防止"一堆添头=球星" =====
   现实交易看核心资产等级：第 1 件 100%，第 2 件起仅作补偿 35%/15%/8%/5%
   选秀权为独立硬资产，权重 100%/60%/40%
   items: [{p, sal, ctx, _v?}]；pickItems: [pickInfo] */
function packagedValue(items, pickItems, valueFn) {
  valueFn = valueFn || (x => x._v);
  const sorted = items.slice().map(x => ({ x, v: valueFn(x) })).sort((a, b) => b.v - a.v);
  let total = 0;
  sorted.forEach((it, i) => {
    const f = i === 0 ? 1.0 : i === 1 ? 0.35 : i === 2 ? 0.15 : i === 3 ? 0.08 : 0.05;
    total += it.v * f;
  });
  const picks = (pickItems || []).slice().map(pk => ({ pk, v: pickValue(pk) })).sort((a, b) => b.v - a.v);
  picks.forEach((it, i) => {
    const f = i === 0 ? 1.0 : i === 1 ? 0.60 : 0.40;
    total += it.v * f;
  });
  return total;
}

/* 位置人数下限：现代阵容常有 1 名纯中锋（F-C 双能位计入两侧） */
const POS_FLOOR = { G: 4, F: 4, C: 2 };

/* 交易后某队各位置人数（G/F/C），G-F / F-C 双能位在主副位置各计一次 */
function positionCountsAfter(currentPlayers, outIds, inPlayers) {
  const c = { G: 0, F: 0, C: 0 };
  const tally = p => {
    const gp = getPos(p);
    c[catOf(gp.pos)]++;
    if (gp.pos2) c[catOf(gp.pos2)]++;
  };
  currentPlayers.forEach(x => {
    if (!outIds.includes(x.p.id)) tally(x.p);
  });
  inPlayers.forEach(x => tally(x.p));
  return c;
}

/* 返回被交易掏空的位置（交易后低于下限且比交易前更少）；原本就只有 1 中锋的球队
   进行 G↔G 等不影响该位置的交易时，不算掏空 */
function positionHole(before, after) {
  return ["G", "F", "C"].find(pos => after[pos] < POS_FLOOR[pos] && after[pos] < before[pos]);
}

/* ===== 球队状态判定 =====
   根据阵容实力 + 战绩动态判定，影响非卖品门槛与交易偏好：
   contending    争冠中：Top8 均 OVR≥84（4 星+）或赛季胜率≥0.6 → 球星非卖品
   strengthening 补强中：79≤实力<84，胜率 0.35~0.6 → 仅超巨非卖品
   tanking       摆烂中：实力<79 或胜率<0.35 → 所有人可交易 */
const STATUS_CONTENDING = "contending";
const STATUS_STRENGTHENING = "strengthening";
const STATUS_TANKING = "tanking";
const STATUS_LABELS = { contending: "争冠中", strengthening: "补强中", tanking: "摆烂中" };

function teamStatus(save, abbr) {
  const str = (typeof teamStrength === "function") ? teamStrength(abbr) : 80;
  /* 战绩：用户队用 save.record，AI 队用 save.standings */
  let w = 0, l = 0, gp = 0;
  if (abbr === (save.team && save.team.abbr)) {
    const rec = save.record || { w: 0, l: 0 };
    w = rec.w; l = rec.l;
  } else if (save.standings && save.standings[abbr]) {
    w = save.standings[abbr].w; l = save.standings[abbr].l;
  }
  gp = w + l;
  const wpct = gp ? w / gp : 0.5;
  /* 赛季初（<20 场）以阵容实力为主；赛季中后期战绩权重上升 */
  if (str >= 84 || (gp >= 20 && wpct >= 0.6)) return STATUS_CONTENDING;
  if (str < 79 || (gp >= 20 && wpct < 0.35)) return STATUS_TANKING;
  return STATUS_STRENGTHENING;
}

/* 不同状态下的非卖品 OVR 门槛：摆烂队返回 200（即无人非卖品） */
function untouchableOvr(status) {
  if (status === STATUS_CONTENDING) return 85;
  if (status === STATUS_STRENGTHENING) return 90;
  return 200;
}

/* ===== AI 交易意愿 =====
   AI 必须"有利可图"才交易：薪资配平 + 阵容合理 + 收到的打包价值 ≥ 送出价值。
   返回 { accept, reason, counter? } */
function aiEvaluateTrade(save, myAbbrCode, myOffer, aiOffer, myPicks, aiPicks) {
  const aiTeam = myAbbrCode;
  myPicks = myPicks || [];
  aiPicks = aiPicks || [];
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;

  /* 空报价拦截 */
  if (!myOffer.length && !myPicks.length) return { accept: false, reason: "你没有给出任何筹码。" };
  if (!aiOffer.length && !aiPicks.length) return { accept: false, reason: "对方没有送出任何球员或选秀权。" };

  /* ---- 硬性规则 1：非卖品保护（随球队状态变化）----
     争冠中：OVR≥85 即非卖品（保护核心争冠阵容）
     补强中：OVR≥90 非卖品（只锁超巨）
     摆烂中：无非卖品（所有人可交易，重建优先） */
  const aiStatus = teamStatus(save, aiTeam);
  const untouchOvr = untouchableOvr(aiStatus);
  const untouch = aiOffer.find(x => x.p.ovr >= untouchOvr);
  if (untouch) {
    return { accept: false, reason: untouch.p.nameCn + " 是" + STATUS_LABELS[aiStatus] + "球队的非卖品（OVR " + untouch.p.ovr + "），任何报价都不会被考虑。" };
  }

  /* ---- 薪资汇总 ---- */
  const inSalToAi = myOffer.reduce((s, x) => s + (x.sal || 0), 0);   /* AI 收到 */
  const outSalFromAi = aiOffer.reduce((s, x) => s + (x.sal || estimateSalary(x.p.ovr, x.p.id)), 0); /* AI 送出 */
  const fin = aiTeamFinances(save, aiTeam);
  const aiPayrollAfter = fin.payroll - outSalFromAi;

  /* ---- 硬性规则 2：薪资配平（双方都必须合规）---- */
  const aiMatch = salaryMatchOk(outSalFromAi, inSalToAi, aiPayrollAfter, cap);
  if (!aiMatch.ok) {
    const gap = inSalToAi - aiMatch.max;
    return {
      accept: false,
      reason: "薪资无法配平：对方送出 " + fmtM(outSalFromAi) + "，最多可收回 " + fmtM(aiMatch.max) +
              "，你的报价多出 " + fmtM(Math.max(0, gap)) + "。需减少报价球员或加大对方送出的合同。"
    };
  }
  /* 用户队同样受配平约束（用户是"送出 inSalToAi / 收回 outSalFromAi"的一方） */
  const userPayroll = save.roster.reduce((s, r) => s + (r.salary || 0), 0);
  const userPayrollAfter = userPayroll - inSalToAi;
  const userMatch = salaryMatchOk(inSalToAi, outSalFromAi, userPayrollAfter, cap);
  if (!userMatch.ok) {
    return {
      accept: false,
      reason: "薪资无法配平：你送出 " + fmtM(inSalToAi) + "，最多可收回 " + fmtM(userMatch.max) +
              "，对方合同 " + fmtM(outSalFromAi) + " 过大。"
    };
  }
  /* 用户已触发硬帽：交易后不得超第一土豪线 */
  if (typeof getCapStatus === "function") {
    const cs = getCapStatus(save);
    if (cs.hardCapped && userPayrollAfter + outSalFromAi > (FIRST_APRON || 209.0) + 0.01) {
      return { accept: false, reason: "本队已触发硬帽（" + cs.hardCapReason + "），交易后总薪资将超第一土豪线。" };
    }
  }

  /* ---- 硬性规则 3：阵容人数 ----
     下限：用户≥8（开赛要求）、AI≥9（轮换底线）
     上限：21 人（游戏阵容数据硬顶，允许 2换1/3换1 等正常打包交易） */
  const ROSTER_HARD_MAX = 21;
  const myOutIds = myOffer.map(x => x.p.id);
  const aiOutIds = aiOffer.map(x => x.p.id);
  const myRosterIds = save.roster.map(r => r.id);
  const myCountAfter0 = myRosterIds.length - myOutIds.length + aiOutIds.length;
  if (myCountAfter0 < 8) {
    return { accept: false, reason: "交易后你的阵容不足 8 人，无法开始赛季。" };
  }
  if (myCountAfter0 > ROSTER_HARD_MAX) {
    return { accept: false, reason: "交易后你的阵容将达 " + myCountAfter0 + " 人，超过 " + ROSTER_HARD_MAX + " 人上限。" };
  }
  const aiCountAfter = fin.ids.length - aiOutIds.length + myOutIds.length;
  if (aiCountAfter > ROSTER_HARD_MAX) {
    return { accept: false, reason: "对方无法接收更多球员（交易后将达 " + aiCountAfter + " 人，超过 " + ROSTER_HARD_MAX + " 人上限）。" };
  }
  if (aiCountAfter < 9) return { accept: false, reason: "对方交易后阵容不足 9 人，会导致其无法正常轮换，拒绝交易。" };

  /* ---- 硬性规则 4：位置掏空（AI 视角，仅拦截让薄弱位置进一步减少的交易）---- */
  const aiPosBefore = positionCountsAfter(fin.players, [], []);
  const aiPosAfter = positionCountsAfter(fin.players, aiOutIds, myOffer.map(x => ({ p: x.p })));
  const holePos = positionHole(aiPosBefore, aiPosAfter);
  if (holePos) {
    const hole = holePos === "G" ? "后卫" : holePos === "F" ? "前锋" : "中锋";
    return { accept: false, reason: "交易后对方" + hole + "位置人手不足，除非加入同位置球员，否则拒绝。" };
  }

  /* ===== 价值评估 ===== */
  /* AI 收到：先按基础价值（不含需求）计算并排序；
     阵容需求溢价只给包裹头牌足额，其余资产仅 40%——避免"每个添头都吃满需求加成" */
  const incoming = myOffer.map(x => {
    const baseCtx = { ...(x.ctx || {}) };
    delete baseCtx.needBonus;
    let v = tradeValue(x.p, x.sal, baseCtx);
    /* 溢价合同惩罚：薪资明显高于市场价值的资产，AI 视为负累 */
    const mkt = estimateSalary(x.p.ovr, x.p.id);
    if (x.sal > 0 && mkt > 0 && x.sal > mkt * 1.3) {
      v = Math.max(5, v - Math.round((x.sal - mkt * 1.3) * 1.5));
    }
    return { x, v, need: positionNeedBonus(save, aiTeam, x.p.pos) };
  }).sort((a, b) => b.v - a.v)
    .map((it, i) => ({ x: it.x, v: Math.round(it.v + it.need * (i === 0 ? 1 : 0.4)) }));
  const incomingVal = packagedValue(incoming.map(i => ({ _v: i.v })), myPicks);

  /* AI 送出：冗余位置球员损失略小（×0.75 需求反向），但核心球员按全价计 */
  const outgoing = aiOffer.map(x => {
    const neg = -positionNeedBonus(save, aiTeam, x.p.pos) * 0.75;
    const ctx = { ...(x.ctx || {}), needBonus: neg };
    return { _v: tradeValue(x.p, x.sal || estimateSalary(x.p.ovr, x.p.id), ctx) };
  });
  const outgoingVal = packagedValue(outgoing, aiPicks);

  const ratio = incomingVal / Math.max(1, outgoingVal);

  /* ---- 球星头牌硬门槛 + 球队状态偏好（随争冠/补强/摆烂变化）---- */
  const bestOut = aiOffer.reduce((m, x) => Math.max(m, x.p.ovr), 0);
  const bestIn = myOffer.reduce((m, x) => Math.max(m, x.p.ovr), 0);
  const bestOutName = (aiOffer.find(x => x.p.ovr === bestOut) || aiOffer[0]).p.nameCn;
  const firstRounders = myPicks.filter(pk => pk.round === 1).length;
  const lottoPick = myPicks.some(pk => (typeof estimatePickPosition === "function") &&
    estimatePickPosition(save, pk) <= 8);
  const avgAgeIn = myOffer.reduce((s, x) => s + (x.p.age || 24), 0) / Math.max(1, myOffer.length);
  const avgAgeOut = aiOffer.reduce((s, x) => s + (x.p.age || 24), 0) / Math.max(1, aiOffer.length);

  /* 状态前缀 + 年龄偏好：摆烂队要年轻资产（加分）/嫌老将（打折）；争冠队要即战力 */
  const statusPrefix = aiStatus === STATUS_TANKING ? "摆烂队"
                     : aiStatus === STATUS_CONTENDING ? "争冠球队" : "对方";
  let statusBonus = 1.0;
  if (aiStatus === STATUS_TANKING) {
    statusBonus = avgAgeIn < avgAgeOut - 1.5 ? 1.12 : (avgAgeIn > avgAgeOut + 2 ? 0.85 : 1.0);
  } else if (aiStatus === STATUS_CONTENDING) {
    statusBonus = avgAgeIn >= avgAgeOut - 1 ? 1.04 : 0.96;
  }

  /* 门槛随状态调整：摆烂队放宽（球星愿去赢球方）、争冠队收紧 */
  let threshold = 1.05;
  let starGate = null;
  if (aiStatus === STATUS_TANKING) {
    /* 摆烂队：所有人可交易，门槛整体降一档；82-84 档跳过头牌门槛 */
    if (bestOut >= 88) {
      threshold = 1.15;
      if (bestIn < bestOut - 8 && !lottoPick && firstRounders < 1) {
        starGate = bestOutName + "（OVR " + bestOut + "）是摆烂队为数不多的核心资产：" +
                   "至少需要一名 OVR≥" + (bestOut - 8) + " 的球员或一个首轮签。";
      }
    } else if (bestOut >= 85) {
      threshold = 1.10;
      if (bestIn < bestOut - 10 && firstRounders < 1) {
        starGate = "摆烂队愿意放走 " + bestOutName + "（OVR " + bestOut + "），但需要年轻资产：" +
                   "附带一个首轮签或 OVR≥" + (bestOut - 10) + " 的球员。";
      }
    }
    /* bestOut < 85：摆烂队跳过 starGate，只看价值 */
  } else if (aiStatus === STATUS_CONTENDING) {
    /* 争冠队：82+ 即触发头牌门槛（保护轮换核心） */
    if (bestOut >= 88) {
      threshold = 1.30;
      if (bestIn < bestOut - 4 && !lottoPick && firstRounders < 2) {
        starGate = "争冠球队不会为添头放走 " + bestOutName + "（OVR " + bestOut + "）：" +
                   "至少需要一名同级球星（OVR≥" + (bestOut - 4) + "）、一个前 8 顺位签或 2 个首轮签。";
      }
    } else if (bestOut >= 82) {
      threshold = 1.20;
      if (bestIn < bestOut - 7 && firstRounders < 1) {
        starGate = "争冠球队的轮换核心 " + bestOutName + "（OVR " + bestOut + "）非添头可换：" +
                   "需要 OVR≥" + (bestOut - 7) + " 的同级球员或一个首轮签。";
      }
    }
  } else {
    /* 补强队：原逻辑 */
    if (bestOut >= 88) {
      threshold = 1.30;
      if (bestIn < bestOut - 4 && !lottoPick && firstRounders < 2) {
        starGate = "对方不会为添头和普通筹码放走 " + bestOutName +
                   "（OVR " + bestOut + "）：至少需要一名同级球星（OVR≥" + (bestOut - 4) +
                   "）、一个前 8 顺位签或 2 个首轮签，添头再多也不行。";
      }
    } else if (bestOut >= 85) {
      threshold = 1.20;
      if (bestIn < bestOut - 7 && firstRounders < 1) {
        starGate = "对方不会用 " + bestOutName + "（OVR " + bestOut + "）换一堆角色球员：" +
                   "你的包裹中必须有一名 OVR≥" + (bestOut - 7) + " 的年轻核心，或附带一个首轮签。";
      }
    } else if (bestOut >= 82) {
      threshold = 1.15;
      if (bestIn < bestOut - 7 && firstRounders < 1) {
        starGate = "添头无法凑数换走 " + bestOutName + "（OVR " + bestOut + "）：" +
                   "请提供一名 OVR≥" + (bestOut - 7) + " 的同等级球员作为主体，或加入一个首轮签。";
      }
    }
  }

  const effectiveRatio = ratio * statusBonus;

  /* 头牌门槛为硬性拒绝，不看打包总值 */
  if (starGate) {
    return { accept: false, reason: starGate };
  }
  if (effectiveRatio >= threshold) {
    return { accept: true, reason: statusPrefix + "认为这笔交易有利可图，愿意接受。" };
  }

  /* ---- 拒绝：给出具体差距与补救提示 ---- */
  const pct = Math.round(effectiveRatio * 100);
  let hint = "";
  const firstAvail = getTeamPicks(save, myAbbr(save)).filter(pk => pk.round === 1);
  const hasPickNotOffered = firstAvail.some(pk =>
    !myPicks.find(d => d.originalTeam === pk.originalTeam && d.round === pk.round));
  if (hasPickNotOffered) hint = "追加一个首轮签可能促成交易。";
  if (effectiveRatio >= 0.85) {
    /* 接近：尝试生成换人还价（AI 降一档要价，用 p 替换 aiOffer[0]） */
    const replacedOutIds = aiOutIds.filter(id => id !== aiOffer[0].p.id);
    const allAi = fin.players
      .map(x => x.p).filter(p => p.ovr < 88 && !aiOutIds.includes(p.id))
      .filter(p => {
        const c = positionCountsAfter(fin.players, replacedOutIds.concat([p.id]), myOffer.map(x => ({ p: x.p })));
        return !positionHole(aiPosBefore, c);
      });
    const targetVal = outgoingVal * 0.92;
    const counter = allAi
      .map(p => ({ p, v: tradeValue(p, estimateSalary(p.ovr, p.id)) }))
      .filter(x => x.v <= targetVal && x.v >= targetVal - 18)
      .sort((a, b) => b.v - a.v)[0];
    if (counter && aiOffer[0]) {
      return {
        accept: false,
        reason: "对方觉得价值差一点（当前回报约为要价的 " + pct + "%），提出还价：用 " +
                counter.p.nameCn + "（OVR " + counter.p.ovr + "）替换 " + aiOffer[0].p.nameCn + "。" +
                (hint ? " 或者" + hint : ""),
        counter: { out: aiOffer[0], in: { p: counter.p, sal: estimateSalary(counter.p.ovr, counter.p.id) } }
      };
    }
  }
  return {
    accept: false,
    reason: "对方拒绝交易：你的包裹价值仅为要价的 " + pct + "%（需达到 " +
            Math.round(threshold * 100) + "%）。添头无法凑数——请提供更高 OVR 的球员或选秀权。" +
            (hint ? " " + hint : "")
  };
}

/* ===== 执行交易 ===== */
function executeTrade(save, myAbbrCode, myOfferIds, aiOfferIds, aiTeamAbbr, myPickOffers, aiPickOffers) {
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  /* 薪资汇总 */
  const myOutSal = save.roster.filter(r => myOfferIds.includes(r.id))
    .reduce((s, r) => s + (r.salary || 0), 0);
  const aiInSal = aiOfferIds.reduce((s, id) => {
    const p = PLAYERS_RATED.players.find(x => x.id === id);
    return s + (p ? estimateSalary(p.ovr, p.id) : 0);
  }, 0);
  const myPayroll = save.roster.reduce((s, r) => s + (r.salary || 0), 0);
  const fin = aiTeamFinances(save, aiTeamAbbr);
  const aiOutSal = fin.players.filter(x => aiOfferIds.includes(x.p.id)).reduce((s, x) => s + x.sal, 0);

  /* 防御性配平校验（正常流程已由 aiEvaluateTrade 拦截） */
  const userMatch = salaryMatchOk(myOutSal, aiInSal, myPayroll - myOutSal, cap);
  if (!userMatch.ok) {
    toast("⚠ 交易失败：薪资无法配平（你最多可收回 " + fmtM(userMatch.max) + "）");
    return false;
  }
  const aiMatch = salaryMatchOk(aiOutSal, myOutSal, fin.payroll - aiOutSal, cap);
  if (!aiMatch.ok) {
    toast("⚠ 交易失败：对方薪资无法配平（最多可收回 " + fmtM(aiMatch.max) + "）");
    return false;
  }
  /* 硬帽校验：接收方（用户）若已触发硬帽，交易后总薪资不得超第一土豪线 */
  if (typeof getCapStatus === "function") {
    const cs = getCapStatus(save);
    if (cs.hardCapped) {
      const newTotal = myPayroll - myOutSal + aiInSal;
      const apron = typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 209.0;
      if (newTotal > apron + 0.01) {
        toast("⚠ 交易失败：本队已触发硬帽（" + (cs.hardCapReason || "") + "），交易后总薪资 " +
              fmtM(newTotal) + " 将超第一土豪线 " + fmtM(apron));
        return false;
      }
    }
  }
  /* 人数校验：双方 9~21 人（用户下限 8） */
  const myCountAfter = save.roster.length - myOfferIds.length + aiOfferIds.length;
  if (myCountAfter < 8) { toast("⚠ 交易失败：交易后你的阵容不足 8 人"); return false; }
  if (myCountAfter > 21) { toast("⚠ 交易失败：交易后你的阵容超过 21 人上限"); return false; }
  const aiCountAfter = fin.ids.length - aiOfferIds.length + myOfferIds.length;
  if (aiCountAfter < 9 || aiCountAfter > 21) {
    toast("⚠ 交易失败：对方交易后阵容人数不合法（" + aiCountAfter + " 人）");
    return false;
  }
  /* 从用户阵容移除 myOffer，加入 aiOffer */
  const newRoster = save.roster.filter(r => !myOfferIds.includes(r.id));
  const newRosterIds = new Set(newRoster.map(r => r.id));
  aiOfferIds.forEach(id => {
    /* 使用 findPlayerById 兼容自定义新秀（仅在 save.customPlayers 中，未进 PLAYERS_RATED） */
    const p = (typeof findPlayerById === "function") ? findPlayerById(save, id) : PLAYERS_RATED.players.find(x => x.id === id);
    if (p && !newRosterIds.has(p.id)) {
      newRosterIds.add(p.id);
      newRoster.push({ id: p.id, salary: estimateSalary(p.ovr, p.id), years: realYearsForId(p.id) });
    }
  });
  save.roster = newRoster;
  /* AI 阵容变化：从 aiTeam 移除 aiOffer，加入 myOffer（仅记录，不影响玩家） */
  save.aiRosters = save.aiRosters || {};
  const aiList = (save.aiRosters[aiTeamAbbr] || playersByTeam(aiTeamAbbr).map(p => p.id))
    .filter(id => !aiOfferIds.includes(id));
  const aiExisting = new Set(aiList);
  myOfferIds.forEach(id => { if (!aiExisting.has(id)) { aiExisting.add(id); aiList.push(id); } });
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

/* ===== 获取 AI 队伍可交易球员（全部返回，按球队状态标记非卖品） ===== */
function getTradable(aiTeamAbbr, save) {
  const all = playersByTeam(aiTeamAbbr);
  const status = save ? teamStatus(save, aiTeamAbbr) : STATUS_STRENGTHENING;
  const untOvr = untouchableOvr(status);
  return all
    .map(p => ({ p, untouchable: p.ovr >= untOvr }))
    .sort((a, b) => b.p.ovr - a.p.ovr);
}

/* ===== 交易搜索器 ===== */
/* 遍历用户球员 × AI 球员，找出 AI 会接受的所有 1v1 交易方案
   返回 [{ myPlayer, aiPlayer, aiTeam, myVal, aiVal, rating, ratingLabel }]
   rating: 'fair' | 'good' | 'steal'  —— 从用户视角评估 */
function searchTradeOffers(save) {
  const my = myAbbr(save);
  const customById = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const byId = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  /* 用户球员（排除伤病） */
  const myPlayers = save.roster
    .map(r => { const p0 = customById.get(r.id) || byId.get(r.id); return p0 ? { p: applyAdj(p0, save), sal: r.salary, years: r.years } : null; })
    .filter(Boolean)
    .filter(x => !isInjured(save, x.p.id));
  /* 所有 AI 队 */
  const aiAbbrs = TEAMS.filter(t => t.abbr !== my).map(t => t.abbr);
  const offers = [];
  myPlayers.forEach(mine => {
    aiAbbrs.forEach(abbr => {
      const aiRoster = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
      aiRoster.forEach(id => {
        if (isInjured(save, id)) return;
        const p0 = customById.get(id) || byId.get(id);
        if (!p0) return;
        const aiP = applyAdj(p0, save);
        if (aiP.ovr >= 93) return; /* 超级巨星不交易 */
        const aiSal = estimateSalary(aiP.ovr, aiP.id);
        const aiYears = realYearsForId(aiP.id) || 2;
        /* 模拟 AI 评估 */
        const result = aiEvaluateTrade(save, abbr,
          [{ p: mine.p, sal: mine.sal, ctx: { years: mine.years, morale: moraleOf(save, mine.p.id) } }],
          [{ p: aiP, sal: aiSal, ctx: { years: aiYears, morale: moraleOf(save, aiP.id) } }],
          [], []);
        if (!result.accept) return;
        /* 计算用户视角评级 */
        const myVal = tradeValue(mine.p, mine.sal);
        const aiVal = tradeValue(aiP, aiSal);
        const diff = aiVal - myVal;
        let rating, ratingLabel;
        if (diff >= 5) { rating = "steal"; ratingLabel = "超值"; }
        else if (diff >= -2) { rating = "good"; ratingLabel = "公道"; }
        else { rating = "fair"; ratingLabel = "可接受"; }
        offers.push({
          myPlayer: mine.p, mySalary: mine.sal, myVal,
          aiPlayer: aiP, aiSalary: aiSal, aiVal, aiTeam: abbr,
          rating, ratingLabel
        });
      });
    });
  });
  /* 按价值差降序：最有利的交易排前面 */
  offers.sort((a, b) => (b.aiVal - b.myVal) - (a.aiVal - a.myVal));
  return offers;
}
