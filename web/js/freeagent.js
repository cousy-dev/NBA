"use strict";
/* 自由市场 / 续约系统 */
/* 流程：赛季结束 → 选秀 → 自由市场 → 新赛季 */

/* ===== 合同管理 ===== */
/* roster 条目: { id, salary, years } — years 为剩余合同年数 */

/* 为新签约分配合同年限 */
function contractYears(ovr, age) {
  if (ovr >= 88) return 3 + Math.floor(hash01(ovr * 7 + age, 31) * 2); /* 3-4 年 */
  if (ovr >= 80) return 2 + Math.floor(hash01(ovr * 7 + age, 32) * 2); /* 2-3 年 */
  if (ovr >= 70) return 1 + Math.floor(hash01(ovr * 7 + age, 33) * 2); /* 1-2 年 */
  return 1; /* 替补/边缘球员 1 年 */
}

/* 新秀合同：2-4 年（顺位越高越长） */
function rookieContractYears(potential) {
  if (potential >= 85) return 4;
  if (potential >= 75) return 3;
  return 2;
}

/* 赛季结束：合同年数 -1，到期球员进入自由市场 */
function decrementContracts(save) {
  save.faPool = []; /* 自由市场池 */
  const expired = [];
  save.roster = save.roster.filter(r => {
    r.years = (r.years || 1) - 1;
    if (r.years <= 0) {
      expired.push(r);
      return false; /* 从阵容移除 */
    }
    return true;
  });
  /* 到期球员进入 FA 池 */
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));
  expired.forEach(r => {
    const p = customMap.get(r.id) || ratedMap.get(r.id);
    if (p) save.faPool.push({ id: p.id, ovr: (p.ovr || 70) + (save.ovrAdj[p.id] || 0), age: (p.age || 24) + (save.ageAdj[p.id] || 0) });
  });
  /* 生成额外自由球员（联盟边缘球员 + 随机新秀） */
  _genExtraFA(save);
  writeSave(save);
}

/* 生成额外自由球员 */
function _genExtraFA(save) {
  /* 从未在阵容中的球员里选取一些作为自由球员 */
  const rosterIds = new Set(save.roster.map(r => r.id));
  const faIds = new Set(save.faPool.map(f => f.id));
  const avail = PLAYERS_RATED.players.filter(p => !rosterIds.has(p.id) && !faIds.has(p.id));
  /* 随机选 15-25 名作为自由市场补充 */
  const n = 15 + Math.floor(Math.random() * 11);
  const shuffled = avail.slice().sort(() => Math.random() - 0.5);
  shuffled.slice(0, n).forEach(p => {
    save.faPool.push({
      id: p.id,
      ovr: (p.ovr || 70) + ((save.ovrAdj || {})[p.id] || 0),
      age: (p.age || 24) + ((save.ageAdj || {})[p.id] || 0)
    });
  });
}

/* 自由球员要价：基于 OVR */
function faAskingPrice(ovr, id) {
  const base = estimateSalary(ovr, id);
  /* 自由市场溢价 10-30% */
  return Math.round(base * (1.1 + hash01(id, 99) * 0.2) * 10) / 10;
}

/* 续约：用户续约自己的到期球员 */
function reSignPlayer(save, playerId, years) {
  /* 续约球员从 FA 池回到阵容 */
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员不在自由市场"); return false; }
  const salary = faAskingPrice(faItem.ovr, playerId);
  /* 工资帽检查 */
  const total = save.roster.reduce((s, r) => s + r.salary, 0) + salary;
  if (total > save.budget) { toast("超出工资帽，无法续约"); return false; }
  save.roster.push({ id: playerId, salary, years });
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  toast("续约成功！" + years + " 年 " + fmtM(salary) + "/年");
  return true;
}

/* 签约自由球员 */
function signFreeAgent(save, playerId, years) {
  const faItem = (save.faPool || []).find(f => f.id === playerId);
  if (!faItem) { toast("该球员已签约其他球队"); return false; }
  const salary = faAskingPrice(faItem.ovr, playerId);
  const total = save.roster.reduce((s, r) => s + r.salary, 0) + salary;
  if (total > save.budget) { toast("超出工资帽 $" + save.budget + "M，无法签约"); return false; }
  save.roster.push({ id: playerId, salary, years });
  save.faPool = save.faPool.filter(f => f.id !== playerId);
  writeSave(save);
  toast("签约成功！" + years + " 年 " + fmtM(salary) + "/年");
  return true;
}

/* 释放球员（腾出空间） */
function releasePlayer(save, playerId) {
  save.roster = save.roster.filter(r => r.id !== playerId);
  writeSave(save);
}

/* AI 队自由市场签约模拟 */
function simAIFreeAgency(save) {
  /* 每个 AI 队检查阵容深度，不足 13 人则签自由球员 */
  TEAMS.forEach(t => {
    if (t.abbr === myAbbr(save)) return;
    let roster = (save.aiRosters && save.aiRosters[t.abbr]) || playersByTeam(t.abbr).map(p => p.id);
    /* 过滤已不在球队的（被交易走的） */
    roster = roster.filter(id => {
      const p = PLAYERS_RATED.players.find(x => x.id === id) || (save.customPlayers || []).find(x => x.id === id);
      return p && p.team === t.abbr;
    });
    while (roster.length < 13 && save.faPool.length > 0) {
      /* 选最高 OVR 的自由球员 */
      save.faPool.sort((a, b) => b.ovr - a.ovr);
      const fa = save.faPool.shift();
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
  const myIds = new Set(save.roster.map(r => r.id));
  /* 到期的原队球员（仍在 FA 池中且之前是用户队的） */
  const mine = loadMyPlayers(save);
  const rosterIds = new Set(save.roster.map(r => r.id));
  const total = Math.round(save.roster.reduce((s, r) => s + r.salary, 0) * 10) / 10;
  const budget = save.budget || 115;
  const pct = Math.min(100, total / budget * 100);

  /* FA 池按 OVR 排序 */
  const faSorted = fa.slice().sort((a, b) => b.ovr - a.ovr);
  const customMap = new Map((save.customPlayers || []).map(p => [p.id, p]));
  const ratedMap = new Map(PLAYERS_RATED.players.map(p => [p.id, p]));

  const faRow = (f, i) => {
    const p = customMap.get(f.id) || ratedMap.get(f.id);
    if (!p) return "";
    const price = faAskingPrice(f.ovr, f.id);
    const wasMine = !rosterIds.has(f.id) && p.team === myAbbr(save);
    return '<div class="fa-row' + (wasMine ? " was-mine" : "") + '" data-id="' + f.id + '">' +
      '  <span class="aw-rank">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(f.ovr) + '">' + f.ovr + "</div>" +
      '  <div class="aw-name">' + esc(p.nameCn) +
      '    <span class="aw-team">' + (wasMine ? "到期续约" : "自由球员") + " · " + esc(p.pos) + " · " + f.age + "岁</span></div>" +
      '  <div class="fa-price">' + fmtM(price) + "/年</div>" +
      '  <button class="fa-sign" data-id="' + f.id + '">签约</button>' +
      "</div>";
  };

  const faRows = faSorted.map((f, i) => faRow(f, i)).join("") || '<div class="empty-stats">自由市场暂无球员</div>';

  $("#screen-freeagent").innerHTML =
    '<h2 class="screen-title">自由市场</h2>' +
    '<p class="screen-sub">第 ' + save.seasonNo + " 赛季休赛期 · 签约补强阵容</p>" +
    '<div class="fa-budget">' +
    '  <div class="fa-budget-row"><span>阵容人数</span><b>' + save.roster.length + "</b></div>" +
    '  <div class="fa-budget-row"><span>总工资</span><b>' + fmtM(total) + " / " + fmtM(budget) + "</b></div>" +
    '  <div class="fa-budget-bar"><div class="fb-fill' + (pct > 95 ? " over" : "") + '" style="width:' + pct + '%"></div></div>' +
    "</div>" +
    (save.roster.length < 8 ? '<div class="fa-warning">⚠ 阵容不足 8 人，无法开始赛季</div>' : "") +
    '<div class="fa-tabs">' +
    '  <button class="fa-tab active" data-tab="fa">自由市场 (' + fa.length + ")</button>" +
    '  <button class="fa-tab" data-tab="roster">我的阵容 (' + save.roster.length + ")</button>" +
    "</div>" +
    '<div class="fa-panel" id="fa-panel">' +
    '  <div class="aw-list">' + faRows + "</div>" +
    "</div>" +
    '<button class="btn btn-primary" id="btn-fa-done"' + (save.roster.length < 8 ? " disabled" : "") + ">开始新赛季</button>";

  /* Tab 切换 */
  const rosterHtml = mine.sort((a, b) => b.p.ovr - a.p.ovr).map((x, i) => {
    const r = save.roster.find(rr => rr.id === x.p.id);
    return '<div class="r-row" data-id="' + x.p.id + '">' +
      '  <span class="r-idx">' + (i + 1) + "</span>" +
      '  <div class="ovr-badge ' + ovrClass(x.p.ovr) + '">' + x.p.ovr + "</div>" +
      '  <div class="r-name">' + esc(x.p.nameCn) + (i < 5 ? '<span class="starter">首发</span>' : "") + "</div>" +
      '  <div class="r-meta">' + fmtM(x.sal) + " · " + (r ? r.years : 1) + "年</div>" +
      '  <button class="fa-release" data-id="' + x.p.id + '">释放</button>' +
      "</div>";
  }).join("");

  $$("#screen-freeagent .fa-tab").forEach(tab => {
    tab.onclick = () => {
      $$("#screen-freeagent .fa-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      if (tab.dataset.tab === "roster") {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + rosterHtml + "</div>";
        $$("#screen-freeagent .r-row[data-id]").forEach(row => { row.onclick = e => { if (!e.target.classList.contains("fa-release")) openPlayer(Number(row.dataset.id)); }; });
        $$("#screen-freeagent .fa-release").forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            if (save.roster.length <= 5) { toast("阵容不足 6 人，无法释放"); return; }
            releasePlayer(save, id);
            RENDERERS.freeagent(); /* 刷新 */
          };
        });
      } else {
        $("#fa-panel").innerHTML = '<div class="aw-list">' + faRows + "</div>";
        bindSignButtons();
      }
    };
  });

  function bindSignButtons() {
    $$("#screen-freeagent .fa-sign").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const f = save.faPool.find(x => x.id === id);
        if (!f) return;
        const years = contractYears(f.ovr, f.age);
        if (signFreeAgent(save, id, years)) {
          RENDERERS.freeagent(); /* 刷新 */
        }
      };
    });
    $$("#screen-freeagent .fa-row[data-id]").forEach(row => {
      row.onclick = () => openPlayer(Number(row.dataset.id));
    });
  }
  bindSignButtons();

  $("#btn-fa-done").onclick = () => {
    if (save.roster.length < 8) { toast("阵容不足 8 人，请先签约球员"); return; }
    simAIFreeAgency(save);
    toast("第 " + save.seasonNo + " 赛季开始！");
    RENDERERS.hub(); state.stack = []; activate("hub");
  };
};
