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
   - 完全鸟权：1.80 × SALARY_CAP（约 297M，15 人阵容合理极限约 260M，等于不限制）
   - 早鸟权：1.50 × SALARY_CAP（约 248M，早鸟起薪受限顶不到此线）
   - 非鸟权：1.25 × SALARY_CAP（约 206M，非鸟起薪 ≤ 前薪 120%）
   注：UFA 签约不可超 SALARY_CAP（budget ≤ SALARY_CAP 的球队） */
function birdCapAbsolute(level) {
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  if (level === "bird") return cap * 1.80;
  if (level === "early") return cap * 1.50;
  if (level === "non") return cap * 1.25;
  return cap;
}

/* 奢侈税警告：续约后总薪资超线时返回警告文案（仅警告不阻止，鸟权续约可超帽）
   TAX_LINE(200.4)=奢侈税线（超线交税）；FIRST_APRON(209.0)=第一土豪线（操作受限）
   isBird: 是否为鸟权续约 —— true 时明确说明"鸟权可超帽，不触发硬帽" */
function taxWarning(total, isBird) {
  const apron = typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 209.0;
  const tax = typeof TAX_LINE !== "undefined" ? TAX_LINE : 200.4;
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  const birdNote = isBird ? "（鸟权可超帽，不触发硬帽）" : "";
  if (total > apron + 0.01) return "⚠ 续约后总薪资 " + fmtM(total) + " 超第一土豪线 " + fmtM(apron) + birdNote;
  if (total > tax + 0.01) return "⚠ 续约后总薪资 " + fmtM(total) + " 超奢侈税线 " + fmtM(tax) + birdNote;
  if (total > cap + 0.01 && !isBird) return "⚠ 续约后总薪资 " + fmtM(total) + " 超工资帽 " + fmtM(cap);
  return "";
}

/* ===== 工资帽硬帽触发与执行 =====
   触发条件（符合 NBA CBA 规则）：
   1. 先签后换（sign-and-trade）：本队接收 S&T 来的球员
   2. 空间中产特例（MLE）：帽下球队签约 MLE 球员
   3. 双年特例（BAE）：每两年可用一次，触发硬帽
   不触发：
   - 鸟权续约（完全/早/非）→ 永远不触发硬帽
   - 纳税人中产特例（Taxpayer MLE）→ 不触发硬帽（但需缴税）
*/
function getCapStatus(save) {
  if (!save.capStatus) {
    save.capStatus = {
      hardCapped: false, hardCapReason: "",
      usedMLE: null, usedTaxpayerMLE: null, usedBAE: null, lastBAESeason: 0
    };
  }
  return save.capStatus;
}

/* 获取本队当前总薪资 */
function teamSalary(save) {
  return save.roster.reduce((s, r) => s + (r.salary || 0), 0);
}

/* 触发硬帽：标记本队本赛季被卡在第一土豪线
   reason: "先签后换" / "空间中产特例" / "双年特例" */
function triggerHardCap(save, reason) {
  const cs = getCapStatus(save);
  cs.hardCapped = true;
  cs.hardCapReason = reason;
}

/* 检查硬帽是否会被违反：本队被硬帽时，新增薪资后不能超第一土豪线
   返回 { ok: bool, message: string } */
function enforceHardCap(save, addedSalary) {
  const cs = getCapStatus(save);
  if (!cs.hardCapped) return { ok: true, message: "" };
  const total = teamSalary(save) + addedSalary;
  const apron = typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 209.0;
  if (total > apron + 0.01) {
    return {
      ok: false,
      message: "⚠ 已触发硬帽（" + (cs.hardCapReason || "操作受限") + "），总薪资 " +
              fmtM(total) + " 不可超第一土豪线 " + fmtM(apron)
    };
  }
  return { ok: true, message: "" };
}

/* 硬帽状态描述（用于 UI 展示） */
function hardCapBadge(save) {
  const cs = getCapStatus(save);
  if (!cs.hardCapped) return null;
  return {
    text: "硬帽触发",
    reason: cs.hardCapReason,
    cls: "hard-cap-on"
  };
}

/* 特例可用性检查（用于 UI 展示与签约前校验）
   返回 { mle, taxpayerMle, bae } 各为 { available: bool, amount: number, maxYears: number, reason: string } */
function exceptionAvailability(save) {
  const cs = getCapStatus(save);
  const total = teamSalary(save);
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  const tax = typeof TAX_LINE !== "undefined" ? TAX_LINE : 200.4;
  const mleAmt = typeof MLE_AMOUNT !== "undefined" ? MLE_AMOUNT : 12.4;
  const taxMleAmt = typeof TAXPAYER_MLE !== "undefined" ? TAXPAYER_MLE : 5.3;
  const baeAmt = typeof BAE_AMOUNT !== "undefined" ? BAE_AMOUNT : 4.5;

  /* 空间中产特例：仅帽下球队可用（薪资 ≤ SALARY_CAP），且本队未触发硬帽，且未用过 */
  const mleRoom = cap - total;
  const mle = {
    available: !cs.usedMLE && !cs.hardCapped && mleRoom >= mleAmt,
    amount: mleAmt,
    maxYears: typeof MLE_MAX_YEARS !== "undefined" ? MLE_MAX_YEARS : 3,
    reason: cs.usedMLE ? "本季已用空间中产" :
            cs.hardCapped ? "已触发硬帽，无法用空间中产" :
            mleRoom < mleAmt ? "帽下空间不足 " + fmtM(mleAmt) : ""
  };

  /* 纳税人中产特例：超帽球队可用，不触发硬帽 */
  const taxpayerMle = {
    available: !cs.usedTaxpayerMLE && total > cap,
    amount: taxMleAmt,
    maxYears: typeof MLE_MAX_YEARS !== "undefined" ? MLE_MAX_YEARS : 3,
    reason: cs.usedTaxpayerMLE ? "本季已用纳税人中产" :
            total <= cap ? "帽下球队应使用空间中产" : ""
  };

  /* 双年特例：每两年可用一次（lastBAESeason 间隔 ≥ 1），触发硬帽 */
  const currentSeason = save.seasonNo || 1;
  const baeEligible = (currentSeason - (cs.lastBAESeason || 0)) >= 2;
  const bae = {
    available: baeEligible && !cs.usedBAE && !cs.hardCapped,
    amount: baeAmt,
    maxYears: typeof BAE_MAX_YEARS !== "undefined" ? BAE_MAX_YEARS : 2,
    reason: !baeEligible ? "上赛季已用，本季不可用" :
            cs.usedBAE ? "本季已用双年特例" :
            cs.hardCapped ? "已触发硬帽" : ""
  };

  return { mle, taxpayerMle, bae };
}
/* 鸟权等级 → 可签年限范围 */
function birdYearsRange(level) {
  if (level === "bird") return [1, 5];
  if (level === "early") return [2, 4];
  if (level === "non") return [1, 4];
  return [1, 4]; /* UFA/RFA */
}

/* ===== 市场吸引力：球员意愿 =====
   NBA 球员选择时看重：① 大球市曝光度 ② 球队实力（争冠希望） ③ 薪资 ④ 母队情怀 */

/* 市场等级（基于 Forbes 估值/营收/城市规模）：1.0=顶流 0.35=小球市 */
const MARKET_TIER = {
  LAL: 1.00, NYK: 1.00, GSW: 0.95, BOS: 0.95, CHI: 0.90, BKN: 0.88,
  LAC: 0.85, MIA: 0.82, PHI: 0.80, DAL: 0.78, TOR: 0.72, HOU: 0.70,
  PHO: 0.68, SAC: 0.65, POR: 0.62, ATL: 0.60, DEN: 0.58, CLE: 0.55,
  IND: 0.52, CHA: 0.50, DET: 0.48, ORL: 0.46, UTA: 0.44, MIL: 0.42,
  NOP: 0.40, OKC: 0.38, MEM: 0.36, MIN: 0.35, SAS: 0.35, WAS: 0.35
};
function marketTier(abbr) { return MARKET_TIER[abbr] || 0.50; }

/* 计算球队吸引力评分（0-100）
   market: 大球市分 (0-100) × 0.35
   strength: 阵容平均 OVR → 实力分 (0-100) × 0.40
   recent: 上赛季战绩/季后赛表现 → 0.25 */
function teamAttractiveness(save, abbr) {
  /* 大球市：MARKET_TIER × 100 */
  const marketScore = marketTier(abbr) * 100;

  /* 阵容实力：取该队 roster（AI 用 aiRosters 或原始 PLAYERS）
     用户队用 save.roster */
  let avgOvr = 70;
  let roster = [];
  if (abbr === myAbbr(save)) {
    roster = save.roster.map(r => r.id);
  } else {
    roster = (save.aiRosters && save.aiRosters[abbr]) || playersByTeam(abbr).map(p => p.id);
  }
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  let sum = 0, cnt = 0;
  roster.forEach(id => {
    const p = customMap.get(id) || ratedMap.get(id);
    if (p) {
      const adj = (save.ovrAdj || {})[id] || 0;
      sum += p.ovr + adj;
      cnt++;
    }
  });
  avgOvr = cnt > 0 ? sum / cnt : 70;
  /* OVR 70 → 50分；OVR 95 → 100分；线性插值 */
  const strengthScore = Math.max(0, Math.min(100, (avgOvr - 70) * 2 + 50));

  /* 近期战绩：上赛季排名/季后赛 */
  let recentScore = 50;
  if (save.lastSeason && save.lastSeason[abbr]) {
    const rec = save.lastSeason[abbr]; /* {wins, losses, rankE, rankW} */
    const total = (rec.wins || 0) + (rec.losses || 0) || 1;
    const pct = (rec.wins || 0) / total;
    recentScore = Math.round(pct * 100); /* 胜率 50% → 50 分 */
    if (rec.madePlayoffs) recentScore += 10;
    if (rec.reachedFinals) recentScore += 20;
    if (rec.champion) recentScore += 30;
  }

  return Math.round(marketScore * 0.35 + strengthScore * 0.40 + recentScore * 0.25);
}

/* 球员签约意愿：给定 FA 球员 + 目标球队吸引力，返回接受概率 (0-1)
   - 球星 (OVR ≥ 88)：只去吸引力 ≥ 75 的队，门槛极高
   - 准球星 (OVR 82-87)：吸引力 ≥ 65
   - 实力派 (OVR 75-81)：吸引力 ≥ 50
   - 角色球员 (OVR < 75)：基本不挑，吸引力 ≥ 35 即可
   - 母队情怀：originTeam === abbr 时 +10 分加成 */
function signingWillingness(faItem, save, targetAbbr) {
  const attr = teamAttractiveness(save, targetAbbr);
  const homeBoost = (faItem.originTeam && faItem.originTeam === targetAbbr) ? 10 : 0;
  const effAttr = attr + homeBoost;
  const ovr = faItem.ovr;
  let threshold;
  if (ovr >= 90) threshold = 80;
  else if (ovr >= 88) threshold = 75;
  else if (ovr >= 82) threshold = 65;
  else if (ovr >= 75) threshold = 50;
  else threshold = 35;
  /* 超过阈值越多，概率越高；低于阈值则概率低 */
  const diff = effAttr - threshold;
  let prob;
  if (diff >= 20) prob = 0.95;
  else if (diff >= 10) prob = 0.80;
  else if (diff >= 0) prob = 0.55 + diff * 0.02; /* 0.55 ~ 0.75 */
  else if (diff >= -10) prob = 0.25 + (diff + 10) * 0.03; /* 0.25 ~ 0.55 */
  else if (diff >= -20) prob = 0.05 + (diff + 20) * 0.02; /* 0.05 ~ 0.25 */
  else prob = 0.05;
  /* 年龄因素：30+ 岁球员更看重赢球，加成最近战绩 */
  if (faItem.age >= 30) {
    if (effAttr >= threshold + 10) prob = Math.min(0.98, prob + 0.10);
    else prob = Math.max(0.02, prob - 0.05);
  }
  return Math.max(0.02, Math.min(0.98, prob));
}

/* 意愿等级（用于 UI 标签） */
function willingnessLabel(faItem, save, targetAbbr) {
  const p = signingWillingness(faItem, save, targetAbbr);
  if (p >= 0.75) return { text: "兴趣浓厚", cls: "w-high" };
  if (p >= 0.45) return { text: "观望中", cls: "w-mid" };
  return { text: "兴趣缺缺", cls: "w-low" };
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

/* ===== 选项处理（休赛期，decrementContracts 内部调用） =====
   用户队规则（save.roster 即用户阵容）：
   - 球员选项（PO）：球员自己决定，按 OVR 概率跳出/执行（经理无权干涉）
   - 球队选项（TO）/ 新秀 2+2 选项：一律暂定执行并登记到 save.pendingTeamOptions，
     由经理在自由市场页逐一点击"执行/放弃"，未全部决策前不能开始新赛季 */
function processOptions(save) {
  if (!save.roster) return;
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  save.pendingTeamOptions = [];
  save.roster.forEach(r => {
    const p = customMap.get(r.id) || ratedMap.get(r.id);
    const ovr = (p ? p.ovr : 70) + ((save.ovrAdj || {})[r.id] || 0);

    /* 1. 首轮新秀 2+2 球队选项：years===3 决策第 3 年，years===2 决策第 4 年 */
    if (r.rookieTO && r.rookieTO.length) {
      if (r.years === 3 && r.rookieTO.includes(3)) {
        const nextSal = Math.round(r.salary * (1 + (r.raise || 0)) * 10) / 10;
        save.pendingTeamOptions.push({ id: r.id, name: p ? p.nameCn : "球员", ovr, kind: "rookie3", salary: nextSal });
      } else if (r.years === 2 && r.rookieTO.includes(4)) {
        const nextSal = Math.round(r.salary * (1 + (r.raise || 0)) * 10) / 10;
        save.pendingTeamOptions.push({ id: r.id, name: p ? p.nameCn : "球员", ovr, kind: "rookie4", salary: nextSal });
      }
      return;  /* 新秀无 PO/普通 TO，后续逻辑不适用 */
    }

    if (!r.optionType) return;
    if (r.years !== 1) return; /* 普通选项年 = 合同最后一年 */
    if (r.optionType === "player") {
      /* 球员选项：高 OVR 跳出试水 FA，低 OVR 执行求稳（球员的决定，不是球队） */
      const jumpProb = ovr >= 90 ? 0.80 : ovr >= 85 ? 0.60 : ovr >= 80 ? 0.40 : 0.20;
      if (Math.random() < jumpProb) {
        r.years = 0; /* 跳出，标记到期 */
      } else {
        r.salary = r.optionSalary || r.salary;
        r.optionType = null; r.optionYear = 0;
        r._skipDecYears = true; /* 执行了选项，跳过后续 years-1 */
      }
    } else if (r.optionType === "team") {
      /* 球队选项：暂定执行（保留合同），登记由经理手动决策；放弃时再移出阵容 */
      r.salary = r.optionSalary || r.salary;
      r.optionType = null; r.optionYear = 0;
      r._skipDecYears = true;
      save.pendingTeamOptions.push({ id: r.id, name: p ? p.nameCn : "球员", ovr, kind: "team", salary: r.salary });
    }
  });
}

/* 经理决策球队选项/新秀选项：exec=false 时球员立即离开阵容进入 UFA 池 */
function decideTeamOption(save, id, exec, kind) {
  save.pendingTeamOptions = (save.pendingTeamOptions || []).filter(o => o.id !== id);
  if (exec) { writeSave(save); return { ok: true }; }
  /* 放弃：移出阵容，进入自由市场（UFA；在队服役年限保留为鸟权累计） */
  const entry = save.roster.find(r => r.id === id);
  save.roster = save.roster.filter(r => r.id !== id);
  save.faPool = save.faPool || [];
  if (!save.faPool.some(f => f.id === id)) {
    const p = (save.customPlayers || []).find(x => x.id === id) || PLAYERS_RATED.players.find(x => x.id === id);
    const ovr = p ? (p.ovr || 70) + ((save.ovrAdj || {})[id] || 0) : 70;
    const age = p ? (p.age || 24) + ((save.ageAdj || {})[id] || 0) : 24;
    save.faPool.push({ id, ovr, age, birdYears: entry ? (entry.birdYears || 0) : 0, isRookieScale: false, originTeam: myAbbr(save) });
  }
  writeSave(save);
  return { ok: true };
}

/* 经理决策资质报价（QO）：provide=true → 受限制自由球员（可匹配别队报价）；false → UFA */
function decideQO(save, id, provide) {
  const f = (save.faPool || []).find(x => x.id === id);
  if (f) { f.isRookieScale = !!provide; f.qoPending = false; }
  save.pendingQOs = (save.pendingQOs || []).filter(q => q.id !== id);
  writeSave(save);
  return { ok: true };
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
    /* 执行了选项的球员跳过 years-1（选项年已被 processOptions 标记保留，
       工资已跳到 optionSalary，不再重复按涨幅递增） */
    if (!r._skipDecYears) {
      r.years = (r.years || 1) - 1;
      /* 薪资逐年递增：进入新合同年按合同涨幅加薪（鸟权续约 8% / 自由签约 5%；
         旧档合同无 raise 字段则保持不变） */
      if (r.years > 0 && r.raise) r.salary = Math.round(r.salary * (1 + r.raise) * 10) / 10;
    }
    r._skipDecYears = false; /* 清除临时标记 */
    if (r.years <= 0) { expired.push(r); return false; }
    /* 续约/签约的球员 birdYears 累计 +1 */
    r.birdYears = (r.birdYears || 0) + 1;
    return true;
  });
  /* 3. 到期球员进入 FA 池（带鸟权信息 + 母队标记，用于 RFA） */
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  save.pendingQOs = [];  /* 资质报价待决策（新秀标尺合同到期） */
  expired.forEach(r => {
    const p = customMap.get(r.id) || ratedMap.get(r.id);
    if (!p) return;
    const ovr = (p.ovr || 70) + ((save.ovrAdj || {})[p.id] || 0);
    const age = (p.age || 24) + ((save.ageAdj || {})[p.id] || 0);
    /* 新秀合同到期：QO 决策前暂不入 UFA/RFA 列表（isRookieScale=false + qoPending），
       经理提供资质报价后才成为 RFA，否则以 UFA 进入市场 */
    const qoPending = !!r.isRookieScale;
    save.faPool.push({
      id: p.id, ovr, age,
      birdYears: r.birdYears || 0,
      isRookieScale: false,
      qoPending,
      originTeam: myAbbr
    });
    if (qoPending) save.pendingQOs.push({ id: p.id, name: p.nameCn, ovr, salary: r.salary });
  });
  /* 4. 生成额外自由球员（联盟边缘球员 + 随机新秀）填充市场 */
  _genExtraFA(save);
  writeSave(save);
}

/* 生成额外自由球员 */
function _genExtraFA(save) {
  const rosterIds = new Set(save.roster.map(r => r.id));
  const faIds = new Set(save.faPool.map(f => f.id));
  /* 排除已在 AI 队名单中的球员，防止 AI 球员误流入自由市场 */
  const aiRosterIds = new Set();
  if (save.aiRosters) {
    Object.values(save.aiRosters).forEach(arr => (arr || []).forEach(id => aiRosterIds.add(id)));
  }
  const avail = PLAYERS_RATED.players.filter(p => !rosterIds.has(p.id) && !faIds.has(p.id) && !aiRosterIds.has(p.id));
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
    id: playerId, salary, years, raise: 0.08,  /* 鸟权续约逐年 8% 递增 */
    birdYears: faItem.birdYears, /* 续约后保留鸟权累计 */
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: false, signedVia: "bird"
  };
  maybeAssignOption(entry, faItem.ovr, playerId);
  save.roster.push(entry);
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  /* 鸟权续约不触发硬帽，即使已硬帽也可超帽续约自家球员（NBA CBA 例外条款） */
  const warn = taxWarning(newTotal, true);
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
  /* 续约成功：替换原合同，保留鸟权累计，重置选项；鸟权续约逐年 8% 递增 */
  entry.salary = newSalary;
  entry.years = newYears;
  entry.raise = 0.08;
  entry.optionType = null;
  entry.optionYear = 0;
  entry.optionSalary = 0;
  entry.isRookieScale = false;
  entry.signedVia = "extension";
  maybeAssignOption(entry, p.ovr, playerId);
  writeSave(save);
  /* 鸟权提前续约不触发硬帽（即使已硬帽也可续约自家球员） */
  const warn = taxWarning(total, true);
  toast("✅ 续约成功！" + p.nameCn + " · " + newYears + " 年 " + fmtM(newSalary) + "/年（" + birdLabel(level) + "）" + (warn ? " " + warn : ""));
  return true;
}

/* ===== 签约自由球员（UFA，受工资帽约束 + 球员意愿） ===== */
function signFreeAgent(save, playerId, years, salary, exception) {
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员已签约其他球队"); return false; }
  if (faCategory(faItem) === "RFA") {
    toast("受限制自由球员需走报价流程");
    return false;
  }
  const total = save.roster.reduce((s, r) => s + r.salary, 0);
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  const cs = getCapStatus(save);
  const excs = exceptionAvailability(save);

  /* 1. 预算硬检查：超过 budget 即拒绝（除非走特例） */
  let usingException = null;
  if (exception === "MLE") {
    if (!excs.mle.available) { toast(excs.mle.reason || "空间中产特例不可用"); return false; }
    if (salary > excs.mle.amount + 0.01) { toast("空间中产上限 " + fmtM(excs.mle.amount) + "/年"); return false; }
    if (years > excs.mle.maxYears) { toast("空间中产最多 " + excs.mle.maxYears + " 年"); return false; }
    usingException = "MLE";
  } else if (exception === "BAE") {
    if (!excs.bae.available) { toast(excs.bae.reason || "双年特例不可用"); return false; }
    if (salary > excs.bae.amount + 0.01) { toast("双年特例上限 " + fmtM(excs.bae.amount) + "/年"); return false; }
    if (years > excs.bae.maxYears) { toast("双年特例最多 " + excs.bae.maxYears + " 年"); return false; }
    usingException = "BAE";
  } else if (exception === "TaxMLE") {
    if (!excs.taxpayerMle.available) { toast(excs.taxpayerMle.reason || "纳税人中产不可用"); return false; }
    if (salary > excs.taxpayerMle.amount + 0.01) { toast("纳税人中产上限 " + fmtM(excs.taxpayerMle.amount) + "/年"); return false; }
    if (years > excs.taxpayerMle.maxYears) { toast("纳税人中产最多 " + excs.taxpayerMle.maxYears + " 年"); return false; }
    usingException = "TaxMLE";
  } else {
    /* 普通签约：必须帽下（total + salary ≤ SALARY_CAP） */
    if (total + salary > cap + 0.01) {
      toast("超过工资帽 " + fmtM(cap) + "，需使用特例（空间中产/纳税人中产/双年）");
      return false;
    }
  }

  /* 2. 硬帽执行：本队已硬帽时，新增薪资不得超第一土豪线 */
  const hardCapCheck = enforceHardCap(save, salary);
  if (!hardCapCheck.ok) { toast(hardCapCheck.message); return false; }

  /* 3. 球员意愿检查 */
  const myAb = myAbbr(save);
  const willingness = signingWillingness(faItem, save, myAb);
  if (Math.random() > willingness) {
    const reason = teamAttractiveness(save, myAb);
    let reasonText = "";
    if (marketTier(myAb) < 0.55) reasonText = "小球市吸引力有限";
    else if (reason < 55) reasonText = "球队实力/战绩不足";
    else reasonText = "球员有其他意向";
    toast("❌ 球员拒绝了合同 — " + reasonText + "（接受概率 " + Math.round(willingness * 100) + "%）");
    return false;
  }

  /* 4. 触发硬帽（仅 MLE / BAE，TaxMLE 不触发） */
  if (usingException === "MLE") {
    triggerHardCap(save, "空间中产特例");
    cs.usedMLE = playerId;
  } else if (usingException === "BAE") {
    triggerHardCap(save, "双年特例");
    cs.usedBAE = playerId;
    cs.lastBAESeason = save.seasonNo || 1;
  } else if (usingException === "TaxMLE") {
    cs.usedTaxpayerMLE = playerId;
    /* TaxMLE 不触发硬帽，但需缴税 */
  }

  /* 5. 入队 */
  const entry = {
    id: playerId, salary, years, raise: 0.05,  /* 自由球员签约逐年 5% 递增 */
    birdYears: 0,
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: false,
    signedVia: usingException ? "exception:" + usingException : "fa"
  };
  maybeAssignOption(entry, faItem.ovr, playerId);
  save.roster.push(entry);
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  let toastMsg = "✅ 签约成功！" + years + " 年 " + fmtM(salary) + "/年（逐年+5%）";
  if (usingException === "MLE") {
    toastMsg += " ⚠ 触发硬帽（空间中产特例），本季总薪资不可超 " + fmtM(FIRST_APRON || 209.0);
  } else if (usingException === "BAE") {
    toastMsg += " ⚠ 触发硬帽（双年特例），本季总薪资不可超 " + fmtM(FIRST_APRON || 209.0);
  }
  const newTotal = total + salary;
  const taxWarn = taxWarning(newTotal, false);
  if (taxWarn) toastMsg += " · " + taxWarn;
  toast(toastMsg);
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
    id: playerId, salary, years, raise: 0.05,  /* RFA 挖角合同逐年 5% 递增 */
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

/* ===== 裁员/买断系统：waivers 认领 + 协商买断 + 延伸条款 ===== */

/* 剩余合同总金额（按 raise 逐年递增求和） */
function remainingContractTotal(entry) {
  let total = 0, sal = entry.salary || 0;
  for (let i = 0; i < (entry.years || 0); i++) { total += sal; sal *= 1 + (entry.raise || 0); }
  return Math.round(total * 10) / 10;
}

/* AI 队 waiver 认领判定：帽下球队按战绩倒序（现实 waiver wire 顺序），
   高薪低能（薪水 > 估值 1.35 倍且 OVR<82）无人认领。返回认领队 abbr 或 null */
function aiClaimOnWaivers(save, id, entry) {
  const p = (save.customPlayers || []).find(x => x.id === id) || PLAYERS_RATED.players.find(x => x.id === id);
  if (!p) return null;
  const ovr = (p.ovr || 70) + ((save.ovrAdj || {})[id] || 0);
  const sal = entry.salary || 0;
  const fairVal = estimateSalary(ovr, id);
  if (sal > fairVal * 1.35 && ovr < 82) return null;
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  const my = myAbbr(save);
  const findP = pid => (save.customPlayers || []).find(x => x.id === pid) || PLAYERS_RATED.players.find(x => x.id === pid);
  /* 帽下空间足够的球队，按当前胜率升序（最差队优先认领） */
  const cands = TEAMS.filter(t => t.abbr !== my).map(t => {
    const ts = save.standings[t.abbr] || { w: 0, l: 0 };
    const wp = (ts.w + ts.l) ? ts.w / (ts.w + ts.l) : 0.5;
    let pay = 0;
    ((save.aiRosters || {})[t.abbr] || []).forEach(pid => {
      const pp = findP(pid);
      if (pp) pay += estimateSalary((pp.ovr || 70) + ((save.ovrAdj || {})[pid] || 0), pid);
    });
    return { abbr: t.abbr, room: cap - pay, wp };
  }).filter(c => c.room >= sal).sort((a, b) => a.wp - b.wp);
  if (!cands.length) return null;
  const ratio = fairVal / Math.max(0.5, sal);
  let prob = ovr >= 80 ? 0.95 : ratio >= 1.1 ? 0.8 : ratio >= 0.9 ? 0.5 : 0.2;
  for (const c of cands) { if (Math.random() < prob) return c.abbr; }
  return null;
}

/* 裁员：mode="waiver"（先认领；无人认领付剩余合同 50% 一次性买断，球员进 FA）
   mode="stretch"（延伸条款：付 40%，分摊 2N+1 年计入工资帽，球员直接进 FA）
   返回 { ok, mode, claimed, cost, per, years } */
function waivePlayer(save, id, mode) {
  const entry = save.roster.find(r => r.id === id);
  if (!entry) return { ok: false };
  const p = (save.customPlayers || []).find(x => x.id === id) || PLAYERS_RATED.players.find(x => x.id === id);
  if (!p) return { ok: false };
  const total = remainingContractTotal(entry);
  save.roster = save.roster.filter(r => r.id !== id);
  save.buyoutCharges = save.buyoutCharges || [];

  if (mode === "stretch") {
    const buyout = Math.round(total * 0.4 * 10) / 10;
    const years = (entry.years || 1) * 2 + 1;
    const per = Math.round(buyout / years * 10) / 10;
    for (let k = 0; k < years; k++) {
      save.buyoutCharges.push({ id, name: p.nameCn, amount: per, season: save.seasonNo + k });
    }
    _waivedToFA(save, id, p, entry);
    writeSave(save);
    return { ok: true, mode: "stretch", claimed: null, cost: buyout, per, years };
  }

  /* waiver：AI 认领接盘合同 → 0 成本 */
  const claimer = aiClaimOnWaivers(save, id, entry);
  if (claimer) {
    save.aiRosters = save.aiRosters || {};
    save.aiRosters[claimer] = save.aiRosters[claimer] || [];
    if (!save.aiRosters[claimer].includes(id)) save.aiRosters[claimer].push(id);
    writeSave(save);
    return { ok: true, mode: "waiver", claimed: claimer, cost: 0 };
  }
  /* 无人认领：球员进入自由市场，剩余合同 50% 一次性买断（计入当前赛季工资帽/支出） */
  const buyout = Math.round(total * 0.5 * 10) / 10;
  if (buyout > 0) save.buyoutCharges.push({ id, name: p.nameCn, amount: buyout, season: save.seasonNo });
  _waivedToFA(save, id, p, entry);
  writeSave(save);
  return { ok: true, mode: "waiver", claimed: null, cost: buyout };
}

/* 被裁球员加入 FA 池（鸟权清零，非新秀标尺） */
function _waivedToFA(save, id, p, entry) {
  save.faPool = save.faPool || [];
  if (save.faPool.some(f => f.id === id)) return;
  const ovr = (p.ovr || 70) + ((save.ovrAdj || {})[id] || 0);
  const age = (p.age || 24) + ((save.ageAdj || {})[id] || 0);
  save.faPool.push({ id, ovr, age, birdYears: 0, isRookieScale: false, originTeam: myAbbr(save) });
}

/* ===== AI 队自由市场签约模拟（球员驱动 + 球队吸引力） ===== */
function simAIFreeAgency(save) {
  /* 初始化 AI 队 roster */
  if (!save.aiRosters) save.aiRosters = {};
  TEAMS.forEach(t => {
    if (t.abbr === myAbbr(save)) return;
    if (!save.aiRosters[t.abbr]) {
      let roster = playersByTeam(t.abbr).map(p => p.id);
      roster = roster.filter(id => {
        const p = PLAYERS_RATED.players.find(x => x.id === id);
        return p && p.team === t.abbr && !save.retired[id];
      });
      save.aiRosters[t.abbr] = roster;
    }
  });

  /* Phase 1：AI 队续约本队 RFA */
  TEAMS.forEach(t => {
    if (t.abbr === myAbbr(save)) return;
    const mine = (save.faPool || []).filter(f => f.originTeam === t.abbr && faCategory(f) === "RFA")
      .sort((a, b) => b.ovr - a.ovr);
    mine.slice(0, 8).forEach(f => {
      save.aiRosters[t.abbr].push(f.id);
      save.faPool = save.faPool.filter(x => x.id !== f.id);
    });
  });

  /* 用户未续约的 RFA 转为 UFA，供 AI 队在 Phase 2 签约 */
  (save.faPool || []).forEach(f => {
    if (f.originTeam === myAbbr(save) && faCategory(f) === "RFA") {
      f.isRookieScale = false;
    }
  });

  /* Phase 2：球员驱动选择 —— 从高 OVR 到低 OVR，每个球员从 top-3 最有吸引力的 AI 队中选择
     （忽略用户队，用户队已在自由市场页面完成签约） */
  const ufai = (save.faPool || []).filter(f => faCategory(f) === "UFA")
    .sort((a, b) => b.ovr - a.ovr);

  ufai.forEach(fa => {
    /* 筛选有空位（< 13 人）的 AI 队，按吸引力降序 */
    const candidates = TEAMS
      .filter(t => t.abbr !== myAbbr(save))
      .map(t => ({
        abbr: t.abbr,
        roster: save.aiRosters[t.abbr] || [],
        tier: t.market
      }))
      .filter(c => c.roster.length < 13)
      .map(c => ({ ...c, attr: teamAttractiveness(save, c.abbr) }))
      .sort((a, b) => b.attr - a.attr);

    if (candidates.length === 0) return;

    /* top-3 球队中，球员按意愿概率选择 */
    const topN = candidates.slice(0, 3);
    /* 计算每个候选队的意愿得分 → 转为选择概率 */
    const weights = topN.map(c => {
      const w = signingWillingness(fa, save, c.abbr);
      /* 球星更看重吸引力，角色球员更随机 */
      const ovrBoost = fa.ovr >= 85 ? 2.0 : fa.ovr >= 75 ? 1.3 : 1.0;
      return Math.pow(w, ovrBoost);
    });
    const totalW = weights.reduce((s, w) => s + w, 0) || 1;
    let r = Math.random() * totalW;
    let chosen = topN[0];
    for (let i = 0; i < topN.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = topN[i]; break; }
    }

    /* 概率性拒绝 —— 如果意愿太低，球员宁愿等下一份报价 */
    const baseWillingness = signingWillingness(fa, save, chosen.abbr);
    if (Math.random() > baseWillingness) return;

    save.aiRosters[chosen.abbr].push(fa.id);
    save.faPool = save.faPool.filter(x => x.id !== fa.id);
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

  /* FA 分类：UFA / RFA / 我的续约（QO 待决策球员在决策卡片处理，不进列表） */
  const faDecided = fa.filter(f => !f.qoPending);
  const ufa = faDecided.filter(f => faCategory(f) === "UFA").sort((a, b) => b.ovr - a.ovr);
  /* RFA tab 只显示其他球队的 RFA（用户的 RFA 球员走"我的续约"直接续约，不走 AI 匹配） */
  const rfa = faDecided.filter(f => faCategory(f) === "RFA" && f.originTeam !== myAbr).sort((a, b) => b.ovr - a.ovr);
  /* 我的续约：本队到期球员（含 UFA 和 RFA），用户自行决定是否续约 */
  const myRenew = faDecided.filter(f => f.originTeam === myAbr && f.birdYears >= 1)
    .sort((a, b) => b.ovr - a.ovr);

  /* 合同决策卡片：球队选项/新秀2+2 + 资质报价（QO），未全部决策不能开始新赛季 */
  const pendingOpts = save.pendingTeamOptions || [];
  const pendingQOList = save.pendingQOs || [];
  const OPT_KIND_LABEL = { team: "球队选项", rookie3: "新秀合同第 3 年球队选项（2+2）", rookie4: "新秀合同第 4 年球队选项（2+2）" };
  const decisionsHtml = (pendingOpts.length || pendingQOList.length)
    ? '<div class="opt-decisions">' +
      (pendingOpts.length ? '<div class="od-section-title">📋 合同选项决策（须逐一决定）</div>' : "") +
      pendingOpts.map(o =>
        '<div class="od-card">' +
        '<div class="od-main"><div class="od-name">' + esc(o.name) + ' <span class="od-ovr">' + o.ovr + "</span></div>" +
        '<div class="od-meta">' + OPT_KIND_LABEL[o.kind] + " · 选项工资 " + fmtM(o.salary) + "/年</div></div>" +
        '<div class="od-btns">' +
        '<button class="btn btn-primary od-btn" data-id="' + o.id + '" data-kind="' + o.kind + '" data-exec="1">执行选项</button>' +
        '<button class="btn btn-outline od-btn danger" data-id="' + o.id + '" data-kind="' + o.kind + '" data-exec="0">放弃（进自由市场）</button>' +
        "</div></div>"
      ).join("") +
      (pendingQOList.length ? '<div class="od-section-title">📨 资质报价 QO（新秀合同到期）</div>' : "") +
      pendingQOList.map(q =>
        '<div class="od-card">' +
        '<div class="od-main"><div class="od-name">' + esc(q.name) + ' <span class="od-ovr">' + q.ovr + "</span></div>" +
        '<div class="od-meta">提供资质报价 → 成为 RFA（可匹配其他球队报价）；不提供 → 成为 UFA</div></div>' +
        '<div class="od-btns">' +
        '<button class="btn btn-primary od-qo" data-id="' + q.id + '" data-provide="1">提供 QO（RFA）</button>' +
        '<button class="btn btn-outline od-qo danger" data-id="' + q.id + '" data-provide="0">不提供（UFA）</button>' +
        "</div></div>"
      ).join("") +
      "</div>"
    : "";

  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));

  const catLabel = f => faCategory(f) === "RFA" ? "RFA" : "UFA";
  const birdTag = f => {
    const lv = birdRightsLevel(f.birdYears);
    return lv ? '<span class="fa-tag bird-' + lv + '">' + birdLabel(lv) + "</span>" : "";
  };

  /* 自由市场行（UFA/RFA） — 含意愿标签 */
  const faRow = (f, i) => {
    const p = customMap.get(f.id) || ratedMap.get(f.id);
    if (!p) return "";
    const price = faAskingPrice(f.ovr, f.id);
    const cat = catLabel(f);
    const isRFA = cat === "RFA";
    /* UFA 显示意愿标签；RFA 不显示（有母队匹配机制） */
    const willTag = !isRFA ? (() => {
      const w = willingnessLabel(f, save, myAbr);
      return '<span class="fa-will ' + w.cls + '" title="' + w.text + '">愿:' + w.text.charAt(0) + '</span>';
    })() : '';
    return '<div class="fa-row' + (isRFA ? " rfa-row" : "") + '" data-id="' + f.id + '">' +
      '  <span class="aw-rank">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(f.ovr) + '">' + f.ovr + "</div>" +
      '  <div class="aw-name">' + esc(p.nameCn) + willTag +
      '    <span class="aw-team"><span class="fa-cat ' + cat.toLowerCase() + '">' + cat + "</span> " + esc(posLabel(p)) + " · " + f.age + "岁" + (f.originTeam && f.originTeam !== myAbr ? " · 母队 " + esc(f.originTeam) : "") + "</span></div>" +
      '  <div class="fa-price">' + fmtM(price) + "/年</div>" +
      '  <button class="fa-sign" data-id="' + f.id + '">' + (isRFA ? "报价" : "签约") + "</button>" +
      "</div>";
  };

  /* 我的续约行 — 两行布局：上球员信息，下续约表单 */
  const renewRow = (f, i) => {
    const p = customMap.get(f.id) || ratedMap.get(f.id);
    if (!p) return "";
    const lv = birdRightsLevel(f.birdYears) || "non";
    const maxSal = maxSalaryByBird(f.ovr, f.id, lv);
    const [minY, maxY] = birdYearsRange(lv);
    /* 鸟权续约可超工资帽：仅提示是否会触发奢侈税（不阻止） */
    const warnHint = taxWarning(total + maxSal);
    const renewHint = (warnHint ? warnHint + " · " : "") + "鸟权可超帽 · 薪资逐年+8%";
    return '<div class="fa-row renew-row" data-id="' + f.id + '">' +
      '  <div class="renew-head">' +
      '    <span class="aw-rank">' + (i + 1) + "</span>" +
      '    <div class="ovr-badge ' + ovrClass(f.ovr) + '">' + f.ovr + "</div>" +
      '    <div class="renew-info">' +
      '      <div class="renew-name">' + esc(p.nameCn) + '</div>' +
      '<div class="renew-meta">' + birdTag(f) + (faCategory(f) === "RFA" ? ' <span class="fa-tag rfa-tag">RFA</span>' : '') + " " + esc(posLabel(p)) + " · " + f.age + "岁 · 上限 " + fmtM(maxSal) + "/年</div>" +
      '    </div>' +
      '  </div>' +
      '  <div class="fa-renew">' +
      '    <label class="renew-field"><span>年限</span>' +
      '      <select class="fa-years" data-id="' + f.id + '">' +
      Array.from({length: maxY - minY + 1}, (_, k) => '<option value="' + (minY + k) + '">' + (minY + k) + " 年</option>").join("") +
      '      </select>' +
      '    </label>' +
      '    <label class="renew-field"><span>年薪 (M)</span>' +
      '      <input type="number" class="fa-salary" data-id="' + f.id + '" value="' + maxSal + '" step="0.1" min="0.5" max="' + maxSal + '">' +
      '    </label>' +
      '    <button class="fa-renew-btn" data-id="' + f.id + '">续约</button>' +
      '  </div>' +
      '  <div class="fa-cap-hint' + (warnHint ? " tax-warn" : "") + '">' + esc(renewHint) + "</div>" +
      "</div>";
  };

  const ufaRows = ufa.map((f, i) => faRow(f, i)).join("") || '<div class="empty-stats">自由市场暂无 UFA</div>';
  const rfaRows = rfa.map((f, i) => faRow(f, i)).join("") || '<div class="empty-stats">暂无受限制自由球员</div>';
  const renewRows = myRenew.map((f, i) => renewRow(f, i)).join("") || '<div class="empty-stats">无本队到期续约球员</div>';

  /* 工资帽硬帽状态 + 特例可用性 UI */
  const cs = getCapStatus(save);
  const excs = exceptionAvailability(save);
  const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
  const tax = typeof TAX_LINE !== "undefined" ? TAX_LINE : 200.4;
  const apron = typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 209.0;
  const hardCapHtml = cs.hardCapped
    ? '<div class="fa-hard-cap-badge">⚠ 硬帽触发 · ' + esc(cs.hardCapReason || "") + ' · 本季不可超 ' + fmtM(apron) + '</div>'
    : "";
  const excBadge = (e, label) => '<span class="fa-exc' + (e.available ? " on" : " off") + '" title="' + esc(e.reason) + '">' +
    label + ' ' + fmtM(e.amount) + '/' + e.maxYears + 'y' + (e.available ? '✓' : '✗') + '</span>';
  const excHtml = '<div class="fa-exc-list">' +
    excBadge(excs.mle, '空间中产') +
    excBadge(excs.taxpayerMle, '纳税人中产') +
    excBadge(excs.bae, '双年特例') +
    '</div>';
  const capLinesHtml = '<div class="fa-cap-lines">' +
    '<span>工资帽 ' + fmtM(cap) + '</span>' +
    '<span>奢侈税线 ' + fmtM(tax) + '</span>' +
    '<span>第一土豪线 ' + fmtM(apron) + '</span>' +
    '</div>';

  $("#screen-freeagent").innerHTML =
    '<h2 class="screen-title">自由市场</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季休赛期 · NBA 规则：鸟权续约 / UFA 签约 / RFA 报价匹配</p>" +
    '<div class="fa-budget">' +
    '  <div class="fa-budget-row"><span>阵容人数</span><b>' + save.roster.length + "</b></div>" +
    '  <div class="fa-budget-row"><span>总工资 / 预算</span><b>' + fmtM(total) + " / " + fmtM(budget) + "</b></div>" +
    (function () {
      const ch = (save.buyoutCharges || []).filter(c => c.season === save.seasonNo);
      if (!ch.length) return "";
      const sum = Math.round(ch.reduce((s, c) => s + c.amount, 0) * 10) / 10;
      return '<div class="fa-budget-row"><span>买断/延伸条款分摊（' + ch.length + '笔）</span><b class="neg-num">' + fmtM(sum) + "</b></div>";
    })() +
    '  <div class="fa-budget-bar"><div class="fb-fill' + (pct > 95 ? " over" : "") + '" style="width:' + pct + '%"></div></div>' +
    capLinesHtml + excHtml + hardCapHtml +
    "</div>" +
    (save.roster.length < 8 ? '<div class="fa-warning">⚠ 阵容不足 8 人，无法开始赛季</div>' : "") +
    decisionsHtml +
    '<div class="fa-tabs">' +
    '  <button class="fa-tab active" data-tab="ufa">UFA (' + ufa.length + ")</button>" +
    '  <button class="fa-tab" data-tab="rfa">RFA (' + rfa.length + ")</button>" +
    '  <button class="fa-tab" data-tab="renew">我的续约 (' + myRenew.length + ")</button>" +
    '  <button class="fa-tab" data-tab="roster">我的阵容 (' + save.roster.length + ")</button>" +
    "</div>" +
    '<div class="fa-panel" id="fa-panel">' +
    '  <div class="aw-list">' + ufaRows + "</div>" +
    "</div>" +
    '<div class="fa-actions">' +
    '<button class="btn btn-primary" id="btn-fa-done"' + ((save.roster.length < 8 || pendingOpts.length || pendingQOList.length) ? " disabled" : "") + ">开始新赛季</button>" +
    (pendingOpts.length || pendingQOList.length ? '<div class="fa-warning" style="margin:0">⚠ 还有 ' + (pendingOpts.length + pendingQOList.length) + ' 项合同决策未处理</div>' : "") +
    '<button class="btn btn-outline" id="btn-fa-trade">休赛期交易</button>' +
    "</div>";

  /* 我的阵容 HTML（首发徽标 = 实际首发 5 人：1C+2F+2G） */
  const starterIds = currentStarterIds(save);
  const rosterHtml = mine.sort((a, b) => b.p.ovr - a.p.ovr).map((x, i) => {
    const r = save.roster.find(rr => rr.id === x.p.id) || {};
    const optTag = r.optionType === "player" ? '<span class="fa-tag opt-po">球员选项</span>'
      : r.optionType === "team" ? '<span class="fa-tag opt-to">球队选项</span>'
      : (r.rookieTO && r.rookieTO.length) ? '<span class="fa-tag opt-to">新秀2+2 TO</span>'
      : "";
    return '<div class="r-row" data-id="' + x.p.id + '">' +
      '  <span class="r-idx">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '  <div class="r-name">' + esc(x.p.nameCn) + (starterIds.includes(x.p.id) ? '<span class="starter">首发</span>' : "") + "</div>" +
      '  <div class="r-meta">' + esc(posLabel(x.p)) + " · " + fmtM(x.sal) + " · " + (r.years || 1) + "年 " + optTag + "</div>" +
      '  <button class="fa-release" data-id="' + x.p.id + '">裁员</button>' +
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
            showWaiveModal(save, id);
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
          /* 检查是否需要特例 */
          const total = save.roster.reduce((s, r) => s + r.salary, 0);
          const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
          if (total + price > cap + 0.01) {
            /* 超帽签约：需选特例，弹窗让用户选 */
            openExceptionModal(save, id, years, price);
            return;
          }
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

  /* 裁员弹窗：Waivers（可能被认领=0成本 / 否则50%买断） vs 延伸条款（40%分摊2N+1年） */
  function showWaiveModal(save, playerId) {
    const entry = save.roster.find(r => r.id === playerId);
    if (!entry) return;
    const p = (save.customPlayers || []).find(x => x.id === playerId) || PLAYERS_RATED.players.find(x => x.id === playerId);
    if (!p) return;
    const old = $("#waive-modal");
    if (old) old.remove();
    const years = entry.years || 0;
    const total = remainingContractTotal(entry);
    const wCost = Math.round(total * 0.5 * 10) / 10;   /* 无人认领时买断 */
    const sCost = Math.round(total * 0.4 * 10) / 10;   /* 延伸总额 */
    const sYears = years * 2 + 1;
    const sPer = Math.round(sCost / sYears * 10) / 10;
    const m = document.createElement("div");
    m.id = "waive-modal";
    m.className = "modal-overlay";
    m.innerHTML =
      '<div class="modal-box">' +
      '<h3>裁员 / 买断</h3>' +
      '<p class="modal-sub">' + esc(p.nameCn) + " · 剩余 " + years + " 年合同 · 年薪 " + fmtM(entry.salary) +
        (entry.raise ? " · 逐年+" + Math.round(entry.raise * 100) + "%" : "") + " · 剩余总额 " + fmtM(total) + "</p>" +
      '<button class="waive-opt" id="waive-waiver">' +
        '<span class="waive-title">🏷 裁员（Waivers 澄清期）</span>' +
        '<span class="waive-desc">帽下球队可认领并接盘剩余合同 → 你 0 成本；<b>无人认领</b>则球员成自由身，你支付 <b class="neg-num">' + fmtM(wCost) + "</b>（剩余合同 50%）一次性计入本赛季工资帽</span>" +
      "</button>" +
      '<button class="waive-opt" id="waive-stretch">' +
        '<span class="waive-title">📏 协商买断 + 延伸条款</span>' +
        '<span class="waive-desc">支付 <b class="neg-num">' + fmtM(sCost) + "</b>（40%），分摊到 " + sYears + " 年（每年 " + fmtM(sPer) + " 计入工资帽），球员立即成为自由球员</span>" +
      "</button>" +
      '<button class="btn btn-outline" id="waive-cancel">取消</button>' +
      "</div>";
    $("#screen-freeagent").appendChild(m);
    const close = () => m.remove();
    $("#waive-cancel").onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    $("#waive-waiver").onclick = () => {
      const res = waivePlayer(save, playerId, "waiver");
      close();
      if (!res.ok) { toast("操作失败"); return; }
      if (res.claimed) toast("🏟 " + teamName(res.claimed) + " 认领了 " + p.nameCn + "，接盘全部剩余合同（0 成本）");
      else toast("📋 无人认领，" + p.nameCn + " 成为自由球员 · 支付买断金 " + fmtM(res.cost) + "（计入工资帽）");
      RENDERERS.freeagent();
    };
    $("#waive-stretch").onclick = () => {
      const res = waivePlayer(save, playerId, "stretch");
      close();
      if (!res.ok) { toast("操作失败"); return; }
      toast("📏 与 " + p.nameCn + " 达成买断：" + fmtM(res.cost) + " 分摊 " + res.years + " 年，每年 " + fmtM(res.per));
      RENDERERS.freeagent();
    };
  }

  /* 特例选择弹窗：超帽签约 UFA 时让用户选 MLE/纳税人中产/双年/取消 */
  function openExceptionModal(save, playerId, years, salary) {
    const f = save.faPool.find(x => x.id === playerId);
    if (!f) return;
    const p = (save.customPlayers || []).find(x => x.id === playerId) || PLAYERS_RATED.players.find(x => x.id === playerId);
    const excs = exceptionAvailability(save);
    const cap = typeof SALARY_CAP !== "undefined" ? SALARY_CAP : 165.0;
    const total = save.roster.reduce((s, r) => s + r.salary, 0);
    /* 关闭已有弹窗 */
    const old = $("#exc-modal");
    if (old) old.remove();
    const m = document.createElement("div");
    m.id = "exc-modal";
    m.className = "modal-overlay";
    m.innerHTML =
      '<div class="modal-box">' +
      '<h3>选择薪资特例</h3>' +
      '<p class="modal-sub">签 ' + esc(p.nameCn) + ' · ' + years + '年 ' + fmtM(salary) + '/年 · 当前总薪资 ' + fmtM(total) + ' 超工资帽 ' + fmtM(cap) + '</p>' +
      '<div class="exc-options">' +
        '<button class="exc-opt' + (excs.mle.available && salary <= excs.mle.amount ? " ok" : " disabled") + '" data-exc="MLE"' + (excs.mle.available && salary <= excs.mle.amount ? "" : " disabled") + '>' +
          '空间中产特例<br><small>' + fmtM(excs.mle.amount) + '/年 · 最多' + excs.mle.maxYears + '年' + (excs.mle.available ? ' ✓' : ' ✗') + '</small>' +
          (excs.mle.reason ? '<small class="exc-reason">' + excs.mle.reason + '</small>' : '') +
        '</button>' +
        '<button class="exc-opt' + (excs.taxpayerMle.available && salary <= excs.taxpayerMle.amount ? " ok" : " disabled") + '" data-exc="TaxMLE"' + (excs.taxpayerMle.available && salary <= excs.taxpayerMle.amount ? "" : " disabled") + '>' +
          '纳税人中产<br><small>' + fmtM(excs.taxpayerMle.amount) + '/年 · 最多' + excs.taxpayerMle.maxYears + '年' + (excs.taxpayerMle.available ? ' ✓' : ' ✗') + '</small>' +
          (excs.taxpayerMle.reason ? '<small class="exc-reason">' + excs.taxpayerMle.reason + '</small>' : '') +
        '</button>' +
        '<button class="exc-opt' + (excs.bae.available && salary <= excs.bae.amount ? " ok" : " disabled") + '" data-exc="BAE"' + (excs.bae.available && salary <= excs.bae.amount ? "" : " disabled") + '>' +
          '双年特例<br><small>' + fmtM(excs.bae.amount) + '/年 · 最多' + excs.bae.maxYears + '年' + (excs.bae.available ? ' ✓' : ' ✗') + '</small>' +
          (excs.bae.reason ? '<small class="exc-reason">' + excs.bae.reason + '</small>' : '') +
        '</button>' +
      '</div>' +
      '<button class="btn exc-cancel">取消</button>' +
      '</div>';
    document.body.appendChild(m);
    $$("#exc-modal .exc-opt").forEach(b => {
      b.onclick = () => {
        const exc = b.dataset.exc;
        if (signFreeAgent(save, playerId, years, salary, exc)) {
          m.remove();
          RENDERERS.freeagent();
        }
      };
    });
    $("#exc-modal .exc-cancel").onclick = () => m.remove();
    m.onclick = e => { if (e.target === m) m.remove(); };
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

  /* 合同选项决策（球队选项/新秀 2+2） */
  $$("#screen-freeagent .od-btn").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const kind = btn.dataset.kind;
      const exec = btn.dataset.exec === "1";
      const o = (save.pendingTeamOptions || []).find(x => x.id === id);
      decideTeamOption(save, id, exec, kind);
      if (exec) toast("✅ 执行选项：" + (o ? o.name : "球员") + " 留队（" + fmtM(o ? o.salary : 0) + "/年）");
      else toast("🚪 放弃选项：" + (o ? o.name : "球员") + " 进入自由市场");
      RENDERERS.freeagent();
    };
  });
  /* 资质报价 QO 决策 */
  $$("#screen-freeagent .od-qo").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const provide = btn.dataset.provide === "1";
      decideQO(save, id, provide);
      toast(provide ? "📨 已向该球员提供资质报价（RFA，可匹配报价）" : "✉ 未提供资质报价，该球员成为 UFA");
      RENDERERS.freeagent();
    };
  });

  $("#btn-fa-done").onclick = () => {
    if (save.roster.length < 8) { toast("阵容不足 8 人，请先签约球员"); return; }
    simAIFreeAgency(save);
    toast("第 " + save.seasonNo + " 赛季开始！");
    RENDERERS.hub(); state.stack = []; activate("hub");
  };
  $("#btn-fa-trade").onclick = () => { go("trade"); };
};
