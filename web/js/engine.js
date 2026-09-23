"use strict";
/* 比赛模拟引擎 —— 回合制（逐进攻回合），纯逻辑无 DOM */
/* 位置归类函数 catOf/evaluateFit 已移至 positions.js，支持新旧位置值
   （G/G-F/F/F-C/C 旧版 + PG/SG/SF/PF/C 新版），engine.js 直接使用 */

/* 挑选 10 人轮换 + 分钟目标 */
function pickRotation(players) {
  const byCat = k => players.filter(p => catOf(p.pos) === k).sort((a, b) => b.ovr - a.ovr);
  const gs = byCat("G"), fs = byCat("F"), cs = byCat("C");
  const starters = [];
  const take = arr => { for (const p of arr) if (!starters.includes(p)) return p; return null; };
  [cs, fs, fs, gs, gs].forEach(pool => {
    const p = take(pool) || take(gs) || take(fs) || take(cs);
    if (p) starters.push(p);
  });
  while (starters.length < 5) {
    const p = players.slice().sort((a, b) => b.ovr - a.ovr).find(p => !starters.includes(p));
    if (p) starters.push(p); else break;
  }
  const bench = players.filter(p => !starters.includes(p)).sort((a, b) => b.ovr - a.ovr);
  const rotation = starters.concat(bench.slice(0, 5));

  /* 分钟目标：真实 MPG 优先，否则按 OVR 分档 */
  const targetMin = new Map();
  rotation.forEach(p => {
    let m;
    if (p.stats && p.stats.mpg && p.stats.mpg > 5) m = p.stats.mpg;
    else if (p.ovr >= 93) m = 36;
    else if (p.ovr >= 88) m = 32;
    else if (p.ovr >= 83) m = 27;
    else if (p.ovr >= 78) m = 22;
    else if (p.ovr >= 73) m = 16;
    else if (p.ovr >= 68) m = 10;
    else m = 5;
    /* 传奇新秀（如新秀保罗）立即作为核心培养：32 分钟；
       高潜力新秀（状元级潜力 92+）28 分钟，85+ 潜力 24 分钟 */
    if (p.isLegend) m = Math.max(m, 32);
    else if (p.isRookie && (p.potential || 0) >= 92) m = Math.max(m, 28);
    else if (p.isRookie && (p.potential || 0) >= 85) m = Math.max(m, 24);
    targetMin.set(p.id, m);
  });
  /* 归一化到 240 分钟（48min × 5位置），按 OVR 设上下限 */
  const minCap = p => {
    if (p.isLegend) return 34;
    if (p.isRookie && (p.potential || 0) >= 92) return 30;
    const o = p.ovr;
    if (o < 65) return 8;
    if (o < 70) return 14;
    if (o < 75) return 20;
    if (o < 85) return 30;
    if (o < 90) return 34;
    return 36;
  };
  const clamp = () => {
    const total = Array.from(targetMin.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const scale = 240 / total;
    let excess = 0;
    rotation.forEach(p => {
      const raw = Math.max(1, Math.round(targetMin.get(p.id) * scale));
      const cap = minCap(p);
      if (raw > cap) { excess += raw - cap; targetMin.set(p.id, cap); }
      else targetMin.set(p.id, raw);
    });
    /* 多余分钟按 OVR 权重分给未达上限的球员 */
    const elig = rotation.filter(p => targetMin.get(p.id) < minCap(p)).sort((a, b) => b.ovr - a.ovr);
    let i = 0;
    while (excess > 0.5 && elig.length) {
      const p = elig[i % elig.length];
      const cap = minCap(p);
      if (targetMin.get(p.id) < cap) { targetMin.set(p.id, targetMin.get(p.id) + 1); excess--; }
      i++;
      if (i > 200) break;
    }
  };
  clamp();
  return { rotation, starters: starters.map(p => p.id), targetMin };
}

function newBox() { return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, sec: 0 }; }

const Q_LEN = 720;
const Q_COUNT = 4;
const OT_LEN = 300; /* 加时赛 5 分钟 */

class GameSim {
  constructor(home, away, homeIdx) {
    /* teams[0] 固定为用户队（便于数据提取），homeIdx 标记哪一侧是真正的主场，
       修正此前用户队客场也永久享受主场加成的问题 */
    this.homeSide = homeIdx === 1 ? 1 : 0;
    this.teams = [this._initSide(home, 0), this._initSide(away, 1)];
    this.q = 1; this.clock = Q_LEN; this.off = Math.random() < 0.5 ? 0 : 1;
    this.over = false; this.winner = -1;
    this.otCount = 0; /* 已进行的加时赛数 */
    this.tactics = [
      { def: "man", pace: "normal", focus: "balanced" },
      { def: "man", pace: "normal", focus: "balanced" }
    ];
    this.momentum = { side: -1, streak: 0 };
  }
  _initSide(info, idx) {
    const all = info.players.slice();
    /* 教练轮换覆盖：{ rotationIds, starters, targetMin }，由 app.js 教练设置构建 */
    let rot;
    if (info.rotationOverride && info.rotationOverride.starters.length === 5) {
      const ov = info.rotationOverride;
      const byId = new Map(all.map(p => [p.id, p]));
      const starters = ov.starters.filter(id => byId.has(id));
      const rotationIds = ov.rotationIds.filter(id => byId.has(id));
      const rotation = rotationIds.map(id => byId.get(id));
      const targetMin = new Map();
      rotationIds.forEach(id => { if (ov.targetMin[id] != null) targetMin.set(id, ov.targetMin[id]); });
      rot = { rotation, starters, targetMin };
    } else {
      rot = pickRotation(all);
    }
    const side = {
      idx, info, all,
      court: rot.starters.slice(),
      rotation: rot.rotation.map(p => p.id),
      targetMin: rot.targetMin,
      box: new Map(), energy: new Map(), form: new Map(),
      playedSec: new Map(),
      timeouts: 4, lastResult: ""
    };
    all.forEach(p => {
      side.box.set(p.id, newBox());
      side.energy.set(p.id, 100);
      side.playedSec.set(p.id, 0);
      /* 每场发挥波动：基础正态分布(±9%)，8%概率爆发(+15~30%)，8%概率低迷(-15~25%) */
      let form = (Math.random() + Math.random() + Math.random() - 1.5) * 0.06;
      if (Math.random() < 0.08) form += 0.15 + Math.random() * 0.15;
      if (Math.random() < 0.08) form -= 0.15 + Math.random() * 0.10;
      side.form.set(p.id, Math.max(0.65, Math.min(1.35, 1 + form)));
    });
    return side;
  }
  /* ===== 工具 ===== */
  _p(side, id) { return side.all.find(x => x.id === id); }
  _courtPlayers(side) { return side.court.map(id => this._p(side, id)); }
  _bench(side) { return side.all.filter(p => !side.court.includes(p.id) && side.rotation.includes(p.id)); }
  _attr(side, id, key) {
    const base = this._p(side, id).attrs[key];
    const e = side.energy.get(id);
    const f = side.form ? side.form.get(id) || 1 : 1;
    return base * f * (e > 60 ? 1 : 0.72 + e * 0.0045);
  }
  _avgCourt(side, key) {
    return side.court.reduce((s, id) => s + this._attr(side, id, key), 0) / 5;
  }
  _weighted(list, valFn) {
    const w = list.map(p => Math.max(0.01, valFn(p)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  /* usage rate：star 球员出手权重大幅高于角色球员，低能力值球员出手很少 */
  _usageWeight(side, p) {
    const ovr = p.ovr;
    const org = this._attr(side, p.id, "org");
    const out = this._attr(side, p.id, "out");
    const ins = this._attr(side, p.id, "ins");
    let starF;
    if (ovr >= 92) starF = 3.6;
    else if (ovr >= 87) starF = 2.7;
    else if (ovr >= 82) starF = 2.3;
    else if (ovr >= 77) starF = 1.2;
    else if (ovr >= 70) starF = 0.75;
    else starF = 0.45;
    return (org * 0.35 + out * 0.35 + ins * 0.30 + ovr * 0.08) * starF;
  }

  /* ===== 单回合 ===== */
  next() {
    if (this.over) return { events: [], over: true };
    const evs = [];
    /* 节结束 */
    if (this.clock <= 0) {
      evs.push({ t: "period", text: "—— " + this._periodName() + "结束 ——", q: this.q, score: this.score() });
      this.q++;
      const endScore = this.score();
      const tied = endScore[0] === endScore[1];
      if (this.q > Q_COUNT && !tied) {
        /* 常规时间/加时结束且分出胜负 */
        this._finish(evs);
        return { events: evs, over: this.over };
      }
      if (this.q > Q_COUNT && tied) {
        /* 平局 → 进入加时赛（可连续多个加时直至分出胜负） */
        this.otCount++;
        this.clock = OT_LEN;
        this.off = Math.random() < 0.5 ? 0 : 1;
        [0, 1].forEach(i => this._startQuarter(this.teams[i], evs));
        evs.push({ t: "period", text: "—— 加时赛" + this.otCount + "开始（5 分钟）——", q: this.q, score: this.score() });
        return { events: evs, over: false };
      }
      this.clock = Q_LEN; this.off = Math.random() < 0.5 ? 0 : 1;
      [0, 1].forEach(i => this._startQuarter(this.teams[i], evs));
      evs.push({ t: "period", text: "—— 第" + this.q + "节开始 ——", q: this.q, score: this.score() });
      return { events: evs, over: false };
    }
    const offT = this.teams[this.off], defT = this.teams[1 - this.off];
    const tac = this.tactics[this.off], defTac = this.tactics[1 - this.off];
    const offP = this._courtPlayers(offT), defP = this._courtPlayers(defT);
    const dAvg = defP.reduce((s, p) => s + this._attr(defT, p.id, "def"), 0) / 5;
    const momOff = this.momentum.side === this.off ? 0.02 : this.momentum.side === 1 - this.off ? -0.02 : 0;

    /* 消耗时间与体能 */
    let poss = 12 + Math.random() * 6;
    if (tac.pace === "fast") poss = 10 + Math.random() * 6;
    if (tac.pace === "slow") poss = 19 + Math.random() * 7;
    if (defTac.def === "press") poss -= 2;
    const used = Math.min(this.clock, Math.round(poss));
    this.clock -= used;
    [offT, defT].forEach(s => s.court.forEach(id => {
      s.box.get(id).sec += used;
      s.playedSec.set(id, s.playedSec.get(id) + used);
      const sta = this._p(s, id).mgr.sta;
      s.energy.set(id, Math.max(5, s.energy.get(id) - used * (0.055 - (sta - 70) * 0.00045)));
    }));
    [offT, defT].forEach(s => s.all.forEach(p => {
      if (!s.court.includes(p.id)) s.energy.set(p.id, Math.min(100, s.energy.get(p.id) + used * 0.03));
    }));

    /* 控球人：组织越高持球越多，权重平方化让队内主控手（如保罗/东契奇）掌控多数回合 */
    const handler = this._weighted(offP, p => {
      const org = this._attr(offT, p.id, "org");
      const f = 1 + Math.max(0, org - 60) * 0.08;
      return Math.pow(org * f, 2);
    });

    /* 失误 */
    const homeAdv = this.off === this.homeSide ? -0.012 : 0;  /* 主场失误更少 */
    let toP = 0.115 + (dAvg - 76) * 0.002 + (76 - this._attr(offT, handler.id, "org")) * 0.0025 + homeAdv;
    if (tac.pace === "fast") toP += 0.02;
    if (defTac.def === "press") toP += 0.05;
    if (Math.random() < toP) {
      offT.box.get(handler.id).tov++;
      const thief = this._weighted(defP, p => this._attr(defT, p.id, "def") + this._attr(defT, p.id, "ath") * 0.6);
      if (Math.random() < 0.62) {
        defT.box.get(thief.id).stl++;
        evs.push({ t: "to", side: 1 - this.off, text: thief.nameCn + " 抢断 " + handler.nameCn + "！" });
      } else {
        evs.push({ t: "to", side: 1 - this.off, text: handler.nameCn + " " + (Math.random() < 0.5 ? "传球失误" : "运球失误") });
      }
      this.momentum = this.momentum.side === 1 - this.off ? { side: 1 - this.off, streak: this.momentum.streak + 1 } : { side: 1 - this.off, streak: 1 };
      this.off = 1 - this.off;
      this._autoSub(offT, evs);
      return { events: evs, over: false };
    }

    /* 投篮选择：usage rate 驱动，star 球员出手更多 */
    /* 持球决策：roll < passP 时传给无球队友（按 usageWeight 加权），否则持球人自己攻。
       传球率由组织属性决定：高 org 主控手（保罗/基德）更多策动传球刷助攻，低 org 球员更多自己攻 */
    const handlerOrg = this._attr(offT, handler.id, "org");
    const passP = Math.max(0.25, Math.min(0.62, 0.30 + (handlerOrg - 62) * 0.018));
    const shooter = Math.random() < passP
      ? this._weighted(offP.filter(p => p.id !== handler.id), p => this._usageWeight(offT, p))
      : handler;
    let threeP = 0.35 + (this._attr(offT, shooter.id, "out") - 78) * 0.005;
    if (tac.pace === "slow") threeP *= 0.7;
    if (tac.focus === "outside") threeP += 0.09;   /* 外线战术：更多三分出手 */
    if (tac.focus === "inside") threeP -= 0.10;    /* 内线战术：优先攻框，三分大减 */
    if (defTac.def === "zone") threeP -= 0.02;
    const isThree = Math.random() < Math.max(0.08, threeP);
    const isRim = !isThree && Math.random() < 0.68;
    const defender = this._weighted(defP, p => this._attr(defT, p.id, "def") + Math.random() * 8);
    const dA = this._attr(defT, defender.id, "def");
    /* 追赶机制：落后方在大比分落后时小幅提升命中率，领先方小幅下降（模拟垃圾时间放松） */
    const sc = this.score();
    const diff = sc[this.off] - sc[1 - this.off];
    const catchUp = diff <= -15 ? 0.035 : diff >= 15 ? -0.02 : 0;
    const homeFgBoost = this.off === this.homeSide ? 0.015 : 0;  /* 主场命中率小幅加成 */
    let fgP;
    if (isThree) {
      /* 锚点：out 75 → 33%，out 92 → 39%，out 51(约60总评) → 25% */
      fgP = 0.33 + (this._attr(offT, shooter.id, "out") - 75) * 0.0035 - (dAvg - 76) * 0.0022 + momOff + catchUp + homeFgBoost;
      if (defTac.def === "double" && shooter.ovr >= 88) fgP -= 0.04;
      fgP = Math.max(0.22, Math.min(0.46, fgP));
    } else if (isRim) {
      /* 锚点：ins 70 → 50%，ins 90 → 69%，ins 51(约60总评) → 32% */
      fgP = 0.50 + (this._attr(offT, shooter.id, "ins") - 70) * 0.0095 - (dAvg - 76) * 0.0026 + momOff + catchUp + homeFgBoost;
      if (defTac.def === "zone") fgP -= 0.03;
      if (defTac.def === "double" && shooter.ovr >= 88) fgP -= 0.035;
      fgP = Math.max(0.30, Math.min(0.72, fgP));
    } else {
      /* 中距离：out 72 → 36%，out 51(约60总评) → 24% */
      fgP = 0.36 + (this._attr(offT, shooter.id, "out") - 72) * 0.0055 - (dAvg - 76) * 0.002 + momOff + catchUp + homeFgBoost;
      fgP = Math.max(0.22, Math.min(0.55, fgP));
    }

    const boxS = offT.box.get(shooter.id);
    boxS.fga++; if (isThree) boxS.tpa++;
    const made = Math.random() < fgP;
    let ev;

    if (made) {
      boxS.fgm++; if (isThree) boxS.tpm++;
      boxS.pts += isThree ? 3 : 2;
      if (shooter.id !== handler.id && Math.random() < 0.86 + (this._attr(offT, handler.id, "org") - 75) * 0.005 + (defTac.def === "double" ? 0.08 : 0)) {
        offT.box.get(handler.id).ast++;
        ev = { t: "score", side: this.off, text: shooter.nameCn + (isThree ? " 命中三分" : isRim ? " 空接/吃饼得手" : " 中距离命中") + "（" + handler.nameCn + " 助攻）" };
      } else {
        ev = { t: "score", side: this.off, text: shooter.nameCn + (isThree ? " 命中三分！" : isRim ? " 突破上篮得手" : " 中投命中") };
      }
      ev.pts = isThree ? 3 : 2;
      evs.push(ev);
      if (Math.random() < (isRim ? 0.16 : 0.05)) this._foulFTs(offT, defT, shooter, defP, evs, 1);
      this.momentum = this.momentum.side === this.off ? { side: this.off, streak: this.momentum.streak + 1 } : { side: this.off, streak: 1 };
    } else {
      if (isRim && Math.random() < 0.075) {
        const blocker = this._weighted(defP, p => this._attr(defT, p.id, "def") * 0.4 + this._attr(defT, p.id, "ath") + (catOf(p.pos) === "C" ? 2 : 0));
        defT.box.get(blocker.id).blk++;
        evs.push({ t: "blk", side: 1 - this.off, text: blocker.nameCn + " 送出封盖！" });
      } else {
        evs.push({ t: "miss", side: this.off, text: shooter.nameCn + (isThree ? " 三分偏出" : isRim ? " 篮下不中" : " 中投打铁") });
      }
      const oR = offP.reduce((s, p) => s + this._attr(offT, p.id, "reb"), 0);
      const dR = defP.reduce((s, p) => s + this._attr(defT, p.id, "reb"), 0);
      let orebP = 0.27 * Math.min(1.35, oR / dR);
      if (defTac.def === "zone") orebP -= 0.02;
      const offensive = Math.random() < orebP;
      const rebTeam = offensive ? offT : defT;
      const rebPlayers = offensive ? offP.filter(p => p.id !== shooter.id) : defP;
      const rebber = this._weighted(rebPlayers, p => this._attr(rebTeam, p.id, "reb") * (p.pos.indexOf("C") >= 0 ? 1.55 : p.pos.indexOf("F") >= 0 ? 1.2 : 0.55));
      rebTeam.box.get(rebber.id).reb++;
      evs.push({ t: "reb", side: rebTeam.idx, text: rebber.nameCn + " 摘下" + (offensive ? "进攻" : "防守") + "篮板" });
      if (!offensive) this.off = 1 - this.off;
      else if (Math.random() < 0.4) evs[evs.length - 1].text += "（二次进攻）";
    }
    if (!made && Math.random() < (isRim ? 0.24 : 0.09)) this._foulFTs(offT, defT, shooter, defP, evs, 2);
    this._autoSub(offT, evs); this._autoSub(defT, evs);
    return { events: evs, over: false, score: this.score(), q: this.q, clock: this.clock };
  }
  _foulFTs(offT, defT, shooter, defP, evs, n) {
    /* 锚点：out 72 → 66%，out 90 → 79%，out 51(约60总评) → 51% */
    const ftP = Math.max(0.42, Math.min(0.92, 0.66 + (this._attr(offT, shooter.id, "out") - 72) * 0.007));
    let hits = 0;
    for (let i = 0; i < n; i++) { offT.box.get(shooter.id).fta++; if (Math.random() < ftP) { offT.box.get(shooter.id).ftm++; offT.box.get(shooter.id).pts++; hits++; } }
    evs.push({ t: "ft", side: offT.idx, pts: hits, text: shooter.nameCn + " " + (n === 1 ? "加罚" : "两罚") + (hits === n ? "全中" : hits === 0 ? "不中" : hits + "/" + n) });
    this.off = 1 - this.off;
  }
  /* 节开始：首发上场 */
  _startQuarter(side, evs) {
    side.court = side.rotation.slice(0, 5);
    side.energy.forEach((v, id) => side.energy.set(id, Math.min(100, v + 25)));
  }
  /* 换人 AI：分钟目标硬上限 + 体能保护 */
  _autoSub(side, evs) {
    for (let i = 0; i < side.court.length; i++) {
      const id = side.court[i];
      const e = side.energy.get(id);
      const played = side.playedSec.get(id) / 60;
      const target = side.targetMin.get(id) || 0;
      /* 换下条件：已达目标分钟（硬上限） 或 体能极低 */
      const needOut = played >= target || e < 30;
      if (!needOut) continue;
      const bench = this._bench(side);
      if (!bench.length) continue;
      const pos = this._p(side, id).pos;
      /* 优先：未达目标分钟 + 体能充足 + 位置匹配 */
      let cands = bench.filter(p => {
        const pPlayed = side.playedSec.get(p.id) / 60;
        const pTarget = side.targetMin.get(p.id) || 0;
        return pPlayed < pTarget * 1.05 && side.energy.get(p.id) > 30;
      }).sort((a, b) => {
        const fitA = Math.abs(evaluateFit(a.pos) - evaluateFit(pos));
        const fitB = Math.abs(evaluateFit(b.pos) - evaluateFit(pos));
        if (fitA !== fitB) return fitA - fitB;
        return b.ovr - a.ovr;
      });
      /* 兜底：所有替补中选体能最高的（即使已超 targetMin，避免主力打 44 分钟）；超出目标 2 分钟以上强制换人 */
      if (!cands.length) {
        cands = bench.filter(p => side.energy.get(p.id) > (played >= (target || 40) + 2 ? 0 : 20))
          .sort((a, b) => {
            const fitA = Math.abs(evaluateFit(a.pos) - evaluateFit(pos));
            const fitB = Math.abs(evaluateFit(b.pos) - evaluateFit(pos));
            if (fitA !== fitB) return fitA - fitB;
            return side.energy.get(b.id) - side.energy.get(a.id);
          });
      }
      if (cands[0]) this._swap(side, id, cands[0].id, evs);
    }
  }
  _swap(side, outId, inId, evs) {
    if (inId === outId || side.court.includes(inId)) return;
    const idx = side.court.indexOf(outId);
    if (idx < 0) return;
    side.court[idx] = inId;
    if (evs) evs.push({ t: "sub", side: side.idx, text: side.info.short + "换人：" + this._p(side, inId).nameCn + " ⇄ " + this._p(side, outId).nameCn });
  }
  sub(sideIdx, outId, inId) {
    const s = this.teams[sideIdx];
    if (!s.court.includes(outId) || s.court.includes(inId)) return false;
    this._swap(s, outId, inId, []);
    return true;
  }
  timeout(sideIdx) {
    const s = this.teams[sideIdx];
    if (s.timeouts <= 0) return false;
    s.timeouts--;
    this.momentum = { side: -1, streak: 0 };
    s.court.forEach(id => s.energy.set(id, Math.min(100, s.energy.get(id) + 9)));
    return true;
  }
  setTactic(sideIdx, key, val) { this.tactics[sideIdx][key] = val; }
  /* 当前节名称：第1-4节 / 加时赛N */
  _periodName() { return this.q <= Q_COUNT ? "第" + this.q + "节" : "加时赛" + (this.q - Q_COUNT); }
  score() { return this.teams.map(s => this._sidePts(s)); }
  _sidePts(s) { let t = 0; s.box.forEach(b => t += b.pts); return t; }
  _finish(evs) {
    this.over = true;
    const sc = this.score();
    this.winner = sc[0] === sc[1] ? (Math.random() < 0.5 ? 0 : 1) : (sc[0] > sc[1] ? 0 : 1);
    evs.push({ t: "final", side: this.winner, text: "全场比赛结束：" + this.teams[0].info.name + " " + sc[0] + " - " + sc[1] + " " + this.teams[1].info.name, score: sc });
  }
  skipToEnd() {
    let guard = 0;
    this.quarterScores = []; /* 每节结束时的累计比分 [q1Score, q2Score, ...] */
    while (!this.over && guard++ < 5000) {
      const r = this.next();
      r.events.forEach(e => {
        if (e.t === "period" && e.text.includes("结束")) this.quarterScores.push(e.score.slice());
      });
    }
    return this.over;
  }
  mvp() {
    let best = null;
    this.teams.forEach(s => s.box.forEach((b, id) => {
      const v = b.pts + (b.reb + b.ast) * 0.6 + (b.stl + b.blk) * 0.4;
      if (!best || v > best.v) best = { v, id, side: s.idx, p: this._p(s, id), box: b };
    }));
    return best;
  }
  minsStr(id) {
    const s = this.teams.find(t => t.box.has(id));
    if (!s) return "0:00";
    const sec = s.box.get(id).sec;
    return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  }
}
