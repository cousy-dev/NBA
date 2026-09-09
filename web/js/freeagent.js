"use strict";
/* 自由市场 / 续约系统（NBA 规则：鸟权 / 球员选项 / 球队选项 / RFA） */
/* 流程：赛季结束 → 选秀 → 选项处理 → 自由市场（UFA/RFA/我的续约）→ 新赛季 */

/* ===== 合同字段说明 =====
   roster 条目:
   { id, salary, years,
     birdYears,        // 连续效力母队年数（>=3 完全鸟权 / =2 早鸟权 / =1 非鸟权 / 0 无）
     optionType,       // "player" | "team" | null
     optionYear,       // 选项所在合同年（如 4 年合同含第 4 年选项 → optionYear=4）
     optionSalary,     // 选项年薪资（执行选项后的新薪资）
     isRookieScale,    // 是否新秀合同（决定 RFA 资格）
     signedVia         // "draft" | "fa" | "trade" | "init" | "bird"
   }

   FA 池条目:
   { id, ovr, age,
     birdYears,        // 母队鸟权累计（仅对从阵容到期的球员有意义）
     isRookieScale,    // 是否新秀合同到期（决定 RFA）
     originTeam        // 母队缩写（用于 RFA 匹配判断）
   }
*/

/* ===== 鸟权等级 ===== */
function birdRightsLevel(birdYears) {
  if (birdYears >= 3) return "bird";       // 完全鸟权
  if (birdYears === 2) return "early";     // 早鸟权
  if (birdYears === 1) return "non";       // 非鸟权
  return null;                              // 无鸟权（UFA/RFA 签约）
}
function birdLabel(level) {
  if (level === "bird") return "完全鸟权";
  if (level === "early") return "早鸟权";
  if (level === "non") return "非鸟权";
  return "无鸟权";
}

/* 鸟权等级 → 顶薪系数（基础价的倍数上限） */
function birdMaxFactor(level) {
  if (level === "bird") return 1.30;
  if (level === "early") return 1.15;
  if (level === "non") return 1.08;
  return 1.00;
}
/* 鸟权等级 → 超帽安全阀（基于 SALARY_CAP 的倍数）
   现实 NBA 规则：鸟权续约（完全/早/非）本身【不触发硬工资帽】，可以超工资帽
   乃至奢侈税线续约本队球员（如库里、文班这种顶薪球星续约后球队薪资普遍超税线）。
   硬工资帽（卡在第一土豪线）只在先签后换、空间中产特例、双年特例等场景触发。
   因此这里只设宽松安全阀防止误操作，顶薪本身仍由 maxSalaryByBird 限制：
   - 完全鸟权：1.80 × SALARY_CAP（约 253M，15 人阵容合理极限约 220M，等于不限制）
   - 早鸟权：1.50 × SALARY_CAP（约 211M，早鸟起薪受限顶不到此线）
   - 非鸟权：1.25 × SALARY_CAP（约 176M，非鸟起薪 ≤ 前薪 120%）
   注：UFA 签约不可超 SALARY_CAP（budget ≤ SALARY_CAP 的球队） */
function birdCapAbsolute(level) {
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 140.6;
  if (level === "bird") return cap * 1.80;
  if (level === "early") return cap * 1.50;
  if (level === "non") return cap * 1.25;
  return cap;
}

/* 奢侈税警告：续约后总薪资超线时返回警告文案（仅警告不阻止，鸟权续约可超帽）
   TAX_LINE(170.8)=奢侈税线（超线交税）；FIRST_APRON(178.1)=第一土豪线（操作受限） */
function taxWarning(total) {
  const apron = typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 178.1;
  const tax = typeof TAX_LINE !== "undefined" ? TAX_LINE : 170.8;
  if (total > apron + 0.01) return "⚠ 续约后总薪资 " + fmtM(total) + " 超第一土豪线 " + fmtM(apron) + "，将面临土豪线限制";
  if (total > tax + 0.01) return "⚠ 续约后总薪资 " + fmtM(total) + " 超奢侈税线 " + fmtM(tax) + "，需缴纳奢侈税";
  return "";
}
/* 鸟权等级 → 可签年限范围 */
function birdYearsRange(level) {
  if (level === "bird") return [1, 5];
  if (level === "early") return [2, 4];
  if (level === "non") return [1, 4];
  return [1, 4]; /* UFA/RFA */
}

/* ===== 工资 / 顶薪计算 ===== */
/* 基础要价（UFA 市场价）：基于 OVR + 自由市场溢价 10-30% */
function faAskingPrice(ovr, id) {
  const base = estimateSalary(ovr, id);
  return Math.round(base * (1.10 + hash01(id, 99) * 0.20) * 10) / 10;
}
/* 鸟权续约顶薪：基础价 × 鸟权系数 */
function maxSalaryByBird(ovr, id, level) {
  const base = estimateSalary(ovr, id);
  const f = birdMaxFactor(level);
  return Math.round(base * f * 10) / 10;
}

/* 为新签约分配合同年限 */
function contractYears(ovr, age) {
  if (ovr >= 88) return 3 + Math.floor(hash01(ovr * 7 + age, 31) * 2); /* 3-4 年 */
  if (ovr >= 80) return 2 + Math.floor(hash01(ovr * 7 + age, 32) * 2); /* 2-3 年 */
  if (ovr >= 70) return 1 + Math.floor(hash01(ovr * 7 + age, 33) * 2); /* 1-2 年 */
  return 1;
}
/* 新秀合同：4 年保障（首轮秀）；二轮 3 年 */
function rookieContractYears(potential) {
  if (potential >= 75) return 4; /* 首轮/高潜力：4 年 */
  return 3;
}

/* 自动注入合同选项（签约时调用）
   - 高价续约（OVR>=85 且 years>=4）：50% 加球员选项（PO），第 4 年
   - 老将底薪（OVR<75 且 years>=2）：50% 加球队选项（TO），第 2 年 */
function maybeAssignOption(rosterEntry, ovr, id) {
  if (rosterEntry.optionType) return; /* 已有选项不覆盖 */
  if (ovr >= 85 && rosterEntry.years >= 4) {
    if (hash01(id, 71) < 0.5) {
      rosterEntry.optionType = "player";
      rosterEntry.optionYear = rosterEntry.years; /* 最后一年选项 */
      rosterEntry.optionSalary = Math.round(rosterEntry.salary * 1.05 * 10) / 10; /* 选项年涨 5% */
    }
  } else if (ovr < 75 && rosterEntry.years >= 2) {
    if (hash01(id, 72) < 0.5) {
      rosterEntry.optionType = "team";
      rosterEntry.optionYear = rosterEntry.years;
      rosterEntry.optionSalary = rosterEntry.salary; /* 球队选项年保持原薪 */
    }
  }
}

/* ===== 选项处理（休赛期，decrementContracts 内部调用） ===== */
function processOptions(save) {
  if (!save.roster) return;
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  save.roster.forEach(r => {
    if (!r.optionType) return;
    /* 选项触发条件：合同年数到达选项年 */
    if (r.years !== 1) return; /* 选项年 = 合同最后一年 */
    const p = customMap.get(r.id) || ratedMap.get(r.id);
    const ovr = (p ? p.ovr : 70) + ((save.ovrAdj || {})[r.id] || 0);
    if (r.optionType === "player") {
      /* 球员选项：高 OVR 跳出试水 FA，低 OVR 执行求稳 */
      const jumpProb = ovr >= 90 ? 0.80 : ovr >= 85 ? 0.60 : ovr >= 80 ? 0.40 : 0.20;
      if (Math.random() < jumpProb) {
        r.years = 0; /* 跳出，标记到期 */
      } else {
        r.years = 1; r.salary = r.optionSalary || r.salary;
        r.optionType = null; r.optionYear = 0;
      }
    } else if (r.optionType === "team") {
      /* 球队选项：高 OVR 执行保留，低 OVR 放弃 */
      const execProb = ovr >= 88 ? 0.95 : ovr >= 80 ? 0.75 : ovr >= 70 ? 0.50 : 0.25;
      if (Math.random() < execProb) {
        r.years = 1; r.salary = r.optionSalary || r.salary;
      } else {
        r.years = 0; /* 放弃，进入 FA */
      }
      r.optionType = null; r.optionYear = 0;
    }
  });
}

/* ===== 赛季结束：选项处理 → 合同年数 -1 → 到期球员进入 FA 池 ===== */
function decrementContracts(save) {
  /* 1. 先处理选项（PO/TO），可能直接让球员到期 */
  processOptions(save);
  /* 2. 合同年数 -1，到期球员移除并进入 FA 池 */
  save.faPool = [];
  const expired = [];
  const myAbbr = (function(){ try { return save.team.abbr || "CUS"; } catch(e){ return "CUS"; } })();
  save.roster = save.roster.filter(r => {
    if (r.years <= 0) { expired.push(r); return false; }
    r.years = (r.years || 1) - 1;
    if (r.years <= 0) { expired.push(r); return false; }
    /* 续约/签约的球员 birdYears 累计 +1 */
    r.birdYears = (r.birdYears || 0) + 1;
    return true;
  });
  /* 3. 到期球员进入 FA 池（带鸟权信息 + 母队标记，用于 RFA） */
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  expired.forEach(r => {
    const p = customMap.get(r.id) || ratedMap.get(r.id);
    if (!p) return;
    const ovr = (p.ovr || 70) + ((save.ovrAdj || {})[p.id] || 0);
    const age = (p.age || 24) + ((save.ageAdj || {})[p.id] || 0);
    save.faPool.push({
      id: p.id, ovr, age,
      birdYears: r.birdYears || 0,
      isRookieScale: !!r.isRookieScale,
      originTeam: myAbbr
    });
  });
  /* 4. 生成额外自由球员（联盟边缘球员 + 随机新秀）填充市场 */
  _genExtraFA(save);
  writeSave(save);
}

/* 生成额外自由球员 */
function _genExtraFA(save) {
  const rosterIds = new Set(save.roster.map(r => r.id));
  const faIds = new Set(save.faPool.map(f => f.id));
  const avail = PLAYERS_RATED.players.filter(p => !rosterIds.has(p.id) && !faIds.has(p.id));
  const n = 15 + Math.floor(Math.random() * 11);
  const shuffled = avail.slice().sort(() => Math.random() - 0.5);
  shuffled.slice(0, n).forEach(p => {
    save.faPool.push({
      id: p.id,
      ovr: (p.ovr || 70) + ((save.ovrAdj || {})[p.id] || 0),
      age: (p.age || 24) + ((save.ageAdj || {})[p.id] || 0),
      birdYears: 0,
      isRookieScale: false,
      originTeam: p.team || ""
    });
  });
}

/* ===== FA 分类：UFA / RFA ===== */
function faCategory(faItem) {
  if (faItem.isRookieScale && faItem.birdYears >= 1) return "RFA";
  return "UFA";
}

/* ===== 续约：用户用鸟权续约本队到期球员（可超帽） ===== */
function reSignPlayer(save, playerId, years, salary) {
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员不在自由市场"); return false; }
  if (faItem.originTeam !== myAbbr(save)) {
    toast("该球员非本队到期，请走自由市场签约");
    return false;
  }
  const level = birdRightsLevel(faItem.birdYears);
  if (!level) { toast("该球员无鸟权，请走自由市场签约"); return false; }
  /* 顶薪校验 */
  const maxSal = maxSalaryByBird(faItem.ovr, playerId, level);
  if (salary > maxSal + 0.01) { toast("超过鸟权顶薪上限 " + fmtM(maxSal)); return false; }
  /* 年限校验 */
  const [minY, maxY] = birdYearsRange(level);
  if (years < minY || years > maxY) { toast("年限不合法（" + minY + "-" + maxY + "年）"); return false; }
  /* 工资帽校验：鸟权续约可超工资帽/奢侈税线，仅设宽松安全阀 */
  const total = save.roster.reduce((s, r) => s + r.salary, 0);
  const cap = birdCapAbsolute(level);
  const newTotal = total + salary;
  if (newTotal > cap + 0.01) { toast("超过薪资安全阀 " + fmtM(cap) + "（" + birdLabel(level) + "）"); return false; }
  /* 续约成功 */
  const entry = {
    id: playerId, salary, years,
    birdYears: faItem.birdYears, /* 续约后保留鸟权累计 */
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: false, signedVia: "bird"
  };
  maybeAssignOption(entry, faItem.ovr, playerId);
  save.roster.push(entry);
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  const warn = taxWarning(newTotal);
  toast("续约成功！" + years + " 年 " + fmtM(salary) + "/年（" + birdLabel(level) + "）" + (warn ? " " + warn : ""));
  return true;
}

/* ===== 续约接受度评估 ===== */
/* 基于：薪资 vs 市场预期、士气值、球星等级、合同年限 */
/* 返回 { accept: bool, chance: 0-100, reason: string } */
function extensionAcceptance(save, playerId, offeredSalary, years) {
  const p = PLAYERS_RATED.players.find(x => x.id === playerId) || { ovr: 75, nameCn: "球员" };
  const expected = estimateSalary(p.ovr, playerId);
  const ratio = offeredSalary / Math.max(0.1, expected);
  const morale = moraleOf(save, playerId);
  /* 球星等级对应的最低可接受薪资比例（顶级球星更挑剔） */
  let minRatio;
  if (p.ovr >= 95) minRatio = 1.05;       /* 超级巨星：至少要市场价 105% */
  else if (p.ovr >= 90) minRatio = 0.98;   /* 全明星：接近市场价 */
  else if (p.ovr >= 85) minRatio = 0.88;    /* 首发主力：88% 市场价 */
  else if (p.ovr >= 78) minRatio = 0.78;     /* 角色球员：78% 市场价 */
  else minRatio = 0.65;                      /* 边缘球员：65% 市场价 */
  /* 士气修正：士气高愿意降薪，士气低要求加价 */
  let moraleMod = 0;
  if (morale >= 90) moraleMod = -0.12;      /* 极高士气：可接受降薪 12% */
  else if (morale >= 80) moraleMod = -0.06;
  else if (morale < 40) moraleMod = +0.18;   /* 极低士气：要求加价 18% */
  else if (morale < 60) moraleMod = +0.08;
  /* 年限修正：长合同略加分（球员喜欢保障） */
  const yearsMod = years >= 4 ? -0.04 : years <= 1 ? +0.05 : 0;
  const effectiveMin = Math.max(0.3, minRatio + moraleMod + yearsMod);
  /* 计算接受概率：薪资达到有效下限则开始可接受，超出部分提升概率 */
  let chance;
  if (ratio < effectiveMin - 0.15) {
    chance = 0;
  } else {
    const overshoot = ratio - effectiveMin;
    chance = Math.round(Math.max(0, Math.min(100, 50 + overshoot * 250 + (morale - 60) * 0.6)));
  }
  /* 决定是否接受 */
  const accept = ratio >= effectiveMin && chance >= 50;
  let reason;
  if (!accept) {
    if (ratio < effectiveMin - 0.15) reason = "薪资远低于预期，球员直接拒绝";
    else if (ratio < effectiveMin) reason = "薪资低于球员底线（" + (effectiveMin * 100).toFixed(0) + "% 市场价）";
    else if (morale < 40) reason = "士气过低（" + morale + "），球员不愿续约";
    else reason = "报价缺乏吸引力，球员选择试水自由市场";
  } else {
    reason = "球员接受续约";
  }
  return { accept, chance, reason, ratio, effectiveMin, morale };
}

/* ===== 赛季中提前续约（在册球员，区别于休赛期 reSignPlayer 的 faPool 入口） ===== */
/* 仅允许剩余年限 ≤ 2 的球员续约（避免任意合同无限重签） */
function extendContract(save, playerId, newYears, newSalary) {
  const entry = save.roster.find(r => r.id === playerId);
  if (!entry) { toast("球员不在阵容中"); return false; }
  /* 资格门槛：普通球员剩余年限 ≤ 2；球星（OVR ≥ 88）可享受指定老将条款，剩余 ≤ 3 年也可续约 */
  const p = PLAYERS_RATED.players.find(x => x.id === playerId) || { ovr: 75 };
  const maxRemainingYears = p.ovr >= 88 ? 3 : 2;
  if (entry.years > maxRemainingYears) {
    toast("剩余 " + entry.years + " 年合同，不符合提前续约条件（需 ≤ " + maxRemainingYears + " 年" + (p.ovr >= 88 ? " · 指定老将条款" : "") + "）");
    return false;
  }
  /* 鸟权等级：复用现有规则。无鸟权（birdYears < 1）→ 非鸟权，按非鸟权顶薪续约 */
  const level = birdRightsLevel(entry.birdYears || 0);
  if (!level) { toast("该球员无鸟权，无法提前续约"); return false; }
  /* 顶薪校验 */
  const maxSal = maxSalaryByBird(p.ovr, playerId, level);
  if (newSalary > maxSal + 0.01) { toast("超过鸟权顶薪上限 " + fmtM(maxSal)); return false; }
  /* 年限校验 */
  const [minY, maxY] = birdYearsRange(level);
  if (newYears < minY || newYears > maxY) { toast("年限不合法（" + minY + "-" + maxY + "年）"); return false; }
  /* 球员接受度校验 */
  const acc = extensionAcceptance(save, playerId, newSalary, newYears);
  if (!acc.accept) {
    toast("❌ " + acc.reason + "（接受度 " + acc.chance + "%）");
    return false;
  }
  /* 工资帽校验：鸟权续约可超工资帽/奢侈税线，仅设宽松安全阀 */
  const total = save.roster.reduce((s, r) => s + r.salary, 0) - entry.salary + newSalary;
  const cap = birdCapAbsolute(level);
  if (total > cap + 0.01) { toast("超过薪资安全阀 " + fmtM(cap) + "（" + birdLabel(level) + "）"); return false; }
  /* 续约成功：替换原合同，保留鸟权累计，重置选项 */
  entry.salary = newSalary;
  entry.years = newYears;
  entry.optionType = null;
  entry.optionYear = 0;
  entry.optionSalary = 0;
  entry.isRookieScale = false;
  entry.signedVia = "extension";
  maybeAssignOption(entry, p.ovr, playerId);
  writeSave(save);
  const warn = taxWarning(total);
  toast("✅ 续约成功！" + p.nameCn + " · " + newYears + " 年 " + fmtM(newSalary) + "/年（" + birdLabel(level) + "）" + (warn ? " " + warn : ""));
  return true;
}

/* ===== 签约自由球员（UFA，受工资帽约束） ===== */
function signFreeAgent(save, playerId, years, salary) {
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员已签约其他球队"); return false; }
  if (faCategory(faItem) === "RFA") {
    toast("受限制自由球员需走报价流程");
    return false;
  }
  /* UFA：受预算约束 */
  const total = save.roster.reduce((s, r) => s + r.salary, 0);
  if (total + salary > (save.budget || 115) + 0.01) {
    toast("超过工资帽 " + fmtM(save.budget || 115) + "，无法签约");
    return false;
  }
  const entry = {
    id: playerId, salary, years,
    birdYears: 0, /* 新签约球员 birdYears 从 0 开始 */
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: false, signedVia: "fa"
  };
  maybeAssignOption(entry, faItem.ovr, playerId);
  save.roster.push(entry);
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  toast("签约成功！" + years + " 年 " + fmtM(salary) + "/年");
  return true;
}

/* ===== RFA 报价：用户报价 → AI 母队决定是否匹配 ===== */
function offerRFA(save, playerId, years, salary) {
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员不在自由市场"); return false; }
  if (faCategory(faItem) !== "RFA") { toast("该球员非受限制自由球员"); return false; }
  /* 年限校验：RFA 报价 2-4 年 */
  if (years < 2 || years > 4) { toast("RFA 报价年限 2-4 年"); return false; }
  /* 工资帽校验：用户必须能在帽下签下此合同 */
  const total = save.roster.reduce((s, r) => s + r.salary, 0);
  if (total + salary > (save.budget || 115) + 0.01) {
    toast("超过工资帽，无法提交报价");
    return false;
  }
  /* AI 母队匹配决策 */
  const matched = aiMatchRFA(save, faItem, salary);
  if (matched) {
    toast("❌ " + (faItem.originTeam || "母队") + " 匹配了报价，球员留在母队");
    /* 球员离开 FA 池（被母队续约） */
    save.faPool = save.faPool.filter(f => f.id !== playerId);
    writeSave(save);
    return false;
  }
  /* 母队不匹配 → 球员归用户 */
  const entry = {
    id: playerId, salary, years,
    birdYears: 0,
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: false, signedVia: "fa"
  };
  maybeAssignOption(entry, faItem.ovr, playerId);
  save.roster.push(entry);
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  toast("✅ 母队放弃匹配！" + years + " 年 " + fmtM(salary) + "/年 加入阵容");
  return true;
}

/* AI 母队 RFA 匹配决策：返回 true=匹配 */
function aiMatchRFA(save, faItem, offerSalary) {
  const ovr = faItem.ovr;
  /* 球员价值分（0-1）：OVR 越高越想留 */
  let valueScore;
  if (ovr >= 88) valueScore = 1.0;
  else if (ovr >= 80) valueScore = 0.7;
  else if (ovr >= 70) valueScore = 0.4;
  else valueScore = 0.2;
  /* 报价合理性分（0-1）：报价 ≤ 鸟权顶薪 → 1.0；超 20% → 0 */
  const maxSal = maxSalaryByBird(ovr, faItem.id, "bird");
  const ratio = maxSal > 0 ? offerSalary / maxSal : 1;
  let priceScore = ratio <= 1.0 ? 1.0 : ratio >= 1.2 ? 0.0 : 1.0 - (ratio - 1.0) / 0.2;
  /* 阵容深度分：母队同位置人数越少越想留（简化用整体阵容深度） */
  const aiRoster = (save.aiRosters && save.aiRosters[faItem.originTeam]) || [];
  const depth = aiRoster.length;
  let depthScore = depth <= 10 ? 1.0 : depth >= 15 ? 0.3 : 1.0 - (depth - 10) / 5 * 0.7;
  /* 综合分 */
  const total = valueScore * 0.5 + priceScore * 0.3 + depthScore * 0.2;
  return total >= 0.55;
}

/* 释放球员（腾出空间） */
function releasePlayer(save, playerId) {
  save.roster = save.roster.filter(r => r.id !== playerId);
  writeSave(save);
}

/* ===== AI 队自由市场签约模拟 ===== */
function simAIFreeAgency(save) {
  /* 每个 AI 队：先续约本队 RFA/重要到期球员，再签自由球员补足 13 人 */
  TEAMS.forEach(t => {
    if (t.abbr === myAbbr(save)) return;
    let roster = (save.aiRosters && save.aiRosters[t.abbr]) || playersByTeam(t.abbr).map(p => p.id);
    roster = roster.filter(id => {
      const p = PLAYERS_RATED.players.find(x => x.id === id) || (save.customPlayers || []).find(x => x.id === id);
      return p && p.team === t.abbr;
    });
    /* AI 续约本队 RFA：从 FA 池中挑出 originTeam 是本队的 RFA，按 OVR 排序，前 8 名续约 */
    const mine = (save.faPool || []).filter(f => f.originTeam === t.abbr && faCategory(f) === "RFA")
      .sort((a, b) => b.ovr - a.ovr);
    mine.slice(0, 8).forEach(f => {
      const sal = maxSalaryByBird(f.ovr, f.id, "bird");
      roster.push(f.id);
      save.faPool = save.faPool.filter(x => x.id !== f.id);
    });
    /* 不足 13 人则签自由球员（UFA 优先） */
    save.faPool.sort((a, b) => b.ovr - a.ovr);
    while (roster.length < 13 && save.faPool.length > 0) {
      const fa = save.faPool.shift();
      if (faCategory(fa) === "RFA") { /* 跳过别队 RFA，不能强签 */ save.faPool.push(fa); break; }
      roster.push(fa.id);
    }
    if (!save.aiRosters) save.aiRosters = {};
    save.aiRosters[t.abbr] = roster;
  });
  writeSave(save);
}

/* ===== 渲染器 ===== */
RENDERERS.freeagent = function () {
  const save = state.save;
  if (!save) { back(); return; }
  const fa = save.faPool || [];
  const mine = loadMyPlayers(save);
  const rosterIds = new Set(save.roster.map(r => r.id));
  const total = Math.round(save.roster.reduce((s, r) => s + r.salary, 0) * 10) / 10;
  const budget = save.budget || 115;
  const pct = Math.min(100, total / budget * 100);
  const myAbr = myAbbr(save);

  /* FA 分类：UFA / RFA / 我的续约 */
  const ufa = fa.filter(f => faCategory(f) === "UFA").sort((a, b) => b.ovr - a.ovr);
  const rfa = fa.filter(f => faCategory(f) === "RFA").sort((a, b) => b.ovr - a.ovr);
  const myRenew = fa.filter(f => f.originTeam === myAbr && faCategory(f) === "UFA" && f.birdYears >= 1)
    .sort((a, b) => b.ovr - a.ovr);

  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));

  const catLabel = f => faCategory(f) === "RFA" ? "RFA" : "UFA";
  const birdTag = f => {
    const lv = birdRightsLevel(f.birdYears);
    return lv ? '<span class="fa-tag bird-' + lv + '">' + birdLabel(lv) + "</span>" : "";
  };

  /* 自由市场行（UFA/RFA） */
  const faRow = (f, i) => {
    const p = customMap.get(f.id) || ratedMap.get(f.id);
    if (!p) return "";
    const price = faAskingPrice(f.ovr, f.id);
    const cat = catLabel(f);
    const isRFA = cat === "RFA";
    return '<div class="fa-row' + (isRFA ? " rfa-row" : "") + '" data-id="' + f.id + '">' +
      '  <span class="aw-rank">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(f.ovr) + '">' + f.ovr + "</div>" +
      '  <div class="aw-name">' + esc(p.nameCn) +
      '    <span class="aw-team"><span class="fa-cat ' + cat.toLowerCase() + '">' + cat + "</span> " + esc(posLabel(p)) + " · " + f.age + "岁" + (f.originTeam && f.originTeam !== myAbr ? " · 母队 " + esc(f.originTeam) : "") + "</span></div>" +
      '  <div class="fa-price">' + fmtM(price) + "/年</div>" +
      '  <button class="fa-sign" data-id="' + f.id + '">' + (isRFA ? "报价" : "签约") + "</button>" +
      "</div>";
  };

  /* 我的续约行 */
  const renewRow = (f, i) => {
    const p = customMap.get(f.id) || ratedMap.get(f.id);
    if (!p) return "";
    const lv = birdRightsLevel(f.birdYears) || "non";
    const maxSal = maxSalaryByBird(f.ovr, f.id, lv);
    const [minY, maxY] = birdYearsRange(lv);
    /* 鸟权续约可超工资帽：仅提示是否会触发奢侈税（不阻止） */
    const warnHint = taxWarning(total + maxSal);
    const renewHint = warnHint || "鸟权可超帽续约";
    return '<div class="fa-row renew-row" data-id="' + f.id + '">' +
      '  <span class="aw-rank">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(f.ovr) + '">' + f.ovr + "</div>" +
      '  <div class="aw-name">' + esc(p.nameCn) +
      '    <span class="aw-team">' + birdTag(f) + " " + esc(posLabel(p)) + " · " + f.age + "岁 · 上限 " + fmtM(maxSal) + "/年</span></div>" +
      '  <div class="fa-renew">' +
      '    <select class="fa-years" data-id="' + f.id + '">' +
      Array.from({length: maxY - minY + 1}, (_, k) => '<option value="' + (minY + k) + '">' + (minY + k) + " 年</option>").join("") +
      '    </select>' +
      '    <input type="number" class="fa-salary" data-id="' + f.id + '" value="' + maxSal + '" step="0.1" min="0.5" max="' + maxSal + '">' +
      '    <button class="fa-renew-btn" data-id="' + f.id + '">续约</button>' +
      '  </div>' +
      '  <div class="fa-cap-hint' + (warnHint ? " tax-warn" : "") + '">' + esc(renewHint) + "</div>" +
      "</div>";
  };

  const ufaRows = ufa.map((f, i) => faRow(f, i)).join("") || '<div class="empty-stats">自由市场暂无 UFA</div>';
  const rfaRows = rfa.map((f, i) => faRow(f, i)).join("") || '<div class="empty-stats">暂无受限制自由球员</div>';
  const renewRows = myRenew.map((f, i) => renewRow(f, i)).join("") || '<div class="empty-stats">无本队到期续约球员</div>';

  $("#screen-freeagent").innerHTML =
    '<h2 class="screen-title">自由市场</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季休赛期 · NBA 规则：鸟权续约 / UFA 签约 / RFA 报价匹配</p>" +
    '<div class="fa-budget">' +
    '  <div class="fa-budget-row"><span>阵容人数</span><b>' + save.roster.length + "</b></div>" +
    '  <div class="fa-budget-row"><span>总工资 / 预算</span><b>' + fmtM(total) + " / " + fmtM(budget) + "</b></div>" +
    '  <div class="fa-budget-bar"><div class="fb-fill' + (pct > 95 ? " over" : "") + '" style="width:' + pct + '%"></div></div>' +
    "</div>" +
    (save.roster.length < 8 ? '<div class="fa-warning">⚠ 阵容不足 8 人，无法开始赛季</div>' : "") +
    '<div class="fa-tabs">' +
    '  <button class="fa-tab active" data-tab="ufa">UFA (' + ufa.length + ")</button>" +
    '  <button class="fa-tab" data-tab="rfa">RFA (' + rfa.length + ")</button>" +
    '  <button class="fa-tab" data-tab="renew">我的续约 (' + myRenew.length + ")</button>" +
    '  <button class="fa-tab" data-tab="roster">我的阵容 (' + save.roster.length + ")</button>" +
    "</div>" +
    '<div class="fa-panel" id="fa-panel">' +
    '  <div class="aw-list">' + ufaRows + "</div>" +
    "</div>" +
    '<button class="btn btn-primary" id="btn-fa-done"' + (save.roster.length < 8 ? " disabled" : "") + ">开始新赛季</button>";

  /* 我的阵容 HTML */
  const rosterHtml = mine.sort((a, b) => b.p.ovr - a.p.ovr).map((x, i) => {
    const r = save.roster.find(rr => rr.id === x.p.id) || {};
    const optTag = r.optionType === "player" ? '<span class="fa-tag opt-po">球员选项</span>'
      : r.optionType === "team" ? '<span class="fa-tag opt-to">球队选项</span>' : "";
    return '<div class="r-row" data-id="' + x.p.id + '">' +
      '  <span class="r-idx">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '  <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + "</div>" +
      '  <div class="r-meta">' + fmtM(x.sal) + " · " + (r.years || 1) + "年 " + optTag + "</div>" +
      '  <button class="fa-release" data-id="' + x.p.id + '">释放</button>' +
      "</div>";
  }).join("");

  /* Tab 切换 */
  $$("#screen-freeagent .fa-tab").forEach(tab => {
    tab.onclick = () => {
      $$("#screen-freeagent .fa-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const tt = tab.dataset.tab;
      if (tt === "roster") {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + rosterHtml + "</div>";
        $$("#screen-freeagent .r-row[data-id]").forEach(row => { row.onclick = e => { if (!e.target.classList.contains("fa-release")) openPlayer(Number(row.dataset.id)); }; });
        $$("#screen-freeagent .fa-release").forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (save.roster.length <= 5) { toast("阵容不足 6 人，无法释放"); return; }
            releasePlayer(save, id);
            RENDERERS.freeagent();
          };
        });
      } else if (tt === "ufa") {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + ufaRows + "</div>";
        bindSignButtons("ufa");
      } else if (tt === "rfa") {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + rfaRows + "</div>";
        bindSignButtons("rfa");
      } else if (tt === "renew") {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + renewRows + "</div>";
        bindRenewButtons();
      }
    };
  });

  /* 签约按钮（UFA 直接签 / RFA 报价） */
  function bindSignButtons(cat) {
    $$("#screen-freeagent .fa-sign").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const f = save.faPool.find(x => x.id === id);
        if (!f) return;
        const price = faAskingPrice(f.ovr, f.id);
        if (faCategory(f) === "UFA") {
          const years = contractYears(f.ovr, f.age);
          if (signFreeAgent(save, id, years, price)) RENDERERS.freeagent();
        } else {
          /* RFA 报价 */
          const years = 3;
          if (offerRFA(save, id, years, price)) RENDERERS.freeagent();
          else RENDERERS.freeagent();
        }
      };
    });
    $$("#screen-freeagent .fa-row[data-id]").forEach(row => {
      row.onclick = () => openPlayer(Number(row.dataset.id));
    });
  }

  /* 续约按钮（用户自定义年限+薪资） */
  function bindRenewButtons() {
    $$("#screen-freeagent .fa-renew-btn").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const yearsSel = $('select.fa-years[data-id="' + id + '"]');
        const salaryInp = $('input.fa-salary[data-id="' + id + '"]');
        if (!yearsSel || !salaryInp) return;
        const years = Number(yearsSel.value);
        const salary = Math.round(Number(salaryInp.value) * 10) / 10;
        if (reSignPlayer(save, id, years, salary)) RENDERERS.freeagent();
      };
    });
    $$("#screen-freeagent .fa-row[data-id]").forEach(row => {
      row.onclick = e => {
        if (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
        openPlayer(Number(row.dataset.id));
      };
    });
  }

  bindSignButtons("ufa");

  $("#btn-fa-done").onclick = () => {
    if (save.roster.length < 8) { toast("阵容不足 8 人，请先签约球员"); return; }
    simAIFreeAgency(save);
    toast("第 " + save.seasonNo + " 赛季开始！");
    RENDERERS.hub(); state.stack = []; activate("hub");
  };
};
