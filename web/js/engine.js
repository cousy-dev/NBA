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
    targetMin.set(p.id, m);
  });
  /* 归一化到 240 分钟（48min × 5位置），按 OVR 设上下限 */
  const minCap = p => {
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

class GameSim {
  constructor(home, away) {
    this.teams = [this._initSide(home, 0), this._initSide(away, 1)];
    this.q = 1; this.clock = Q_LEN; this.off = Math.random() < 0.5 ? 0 : 1;
    this.over = false; this.winner = -1;
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
      box: new Map(), energy: new Map(),
      playedSec: new Map(),
      timeouts: 4, lastResult: ""
    };
    all.forEach(p => {
      side.box.set(p.id, newBox());
      side.energy.set(p.id, 100);
      side.playedSec.set(p.id, 0);
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
    return base * (e > 60 ? 1 : 0.72 + e * 0.0045);
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
  /* usage rate：star 球员出手权重大幅高于角色球员 */
  _usageWeight(side, p) {
    const ovr = p.ovr;
    const org = this._attr(side, p.id, "org");
    const out = this._attr(side, p.id, "out");
    const ins = this._attr(side, p.id, "ins");
    let starF;
    if (ovr >= 92) starF = 3.5;
    else if (ovr >= 87) starF = 2.5;
    else if (ovr >= 82) starF = 2.35;
    else if (ovr >= 77) starF = 1.2;
    else starF = 0.7;
    return (org * 0.35 + out * 0.35 + ins * 0.30 + ovr * 0.08) * starF;
  }

  /* ===== 单回合 ===== */
  next() {
    if (this.over) return { events: [], over: true };
    const evs = [];
    /* 节结束 */
    if (this.clock <= 0) {
      evs.push({ t: "period", text: "—— 第" + this.q + "节结束 ——", q: this.q, score: this.score() });
      this.q++;
      if (this.q > Q_COUNT) { this._finish(evs); return { events: evs, over: this.over }; }
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

    /* 控球人：高 org 的 star 球员更可能持球 */
    const handler = this._weighted(offP, p => {
      const org = this._attr(offT, p.id, "org");
      let f = p.ovr >= 88 ? 2.5 : p.ovr >= 80 ? 1.5 : 1;
      return org * f;
    });

    /* 失误 */
    let toP = 0.115 + (dAvg - 76) * 0.003 + (76 - this._attr(offT, handler.id, "org")) * 0.0035;
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
    /* 持球决策：roll < passP 时传给无球队友（按 usageWeight 加权），否则持球人自己攻；球星 OVR 越高 passP 越低、自攻越多 */
    const passP = Math.max(0.30, Math.min(0.50, 0.37 + (handler.ovr - 80) * 0.005));
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
    let fgP;
    if (isThree) {
      fgP = 0.355 + (this._attr(offT, shooter.id, "out") - 75) * 0.0025 - (dAvg - 76) * 0.0025 + momOff;
      if (defTac.def === "double" && shooter.ovr >= 88) fgP -= 0.04;
      fgP = Math.max(0.20, Math.min(0.55, fgP));
    } else if (isRim) {
      fgP = 0.60 + (this._attr(offT, shooter.id, "ins") - 75) * 0.004 - (dAvg - 76) * 0.003 + momOff;
      if (defTac.def === "zone") fgP -= 0.03;
      if (defTac.def === "double" && shooter.ovr >= 88) fgP -= 0.035;
      fgP = Math.max(0.35, Math.min(0.82, fgP));
    } else {
      fgP = 0.42 + (this._attr(offT, shooter.id, "out") - 75) * 0.002 - (dAvg - 76) * 0.002 + momOff;
      fgP = Math.max(0.28, Math.min(0.60, fgP));
    }

    const boxS = offT.box.get(shooter.id);
    boxS.fga++; if (isThree) boxS.tpa++;
    const made = Math.random() < fgP;
    let ev;

    if (made) {
      boxS.fgm++; if (isThree) boxS.tpm++;
      boxS.pts += isThree ? 3 : 2;
      if (shooter.id !== handler.id && Math.random() < 0.80 + (this._attr(offT, handler.id, "org") - 75) * 0.006 + (defTac.def === "double" ? 0.10 : 0)) {
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
    const ftP = 0.72 + (shooter.attrs.out - 75) * 0.004;
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
    while (!this.over && guard++ < 5000) this.next();
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
