"use strict";
/* 位置系统 —— 兼容旧位置（G/G-F/F/F-C/C）并派生具体位置（PG/SG/SF/PF/C）+ 第二位置
 *
 * 数据文件 players_rated.js 仍使用简化位置（G/G-F/F/F-C/C），本模块负责：
 * 1) 兼容版 catOf：把任意位置值（新/旧）归类到 G/F/C 三类，供轮换、篮板、交易使用
 * 2) derivePos：基于 attrs + 身高 + 原始 pos 派生具体位置 + 第二位置
 * 3) POS_OVERRIDE：知名球星硬编码覆盖表（用 id 匹配，最稳定）
 * 4) getPos：统一入口，先查覆盖表 → 已具体位置直接用 → 派生
 * 5) posLabel：UI 显示文本，如 "PG" 或 "PF/PG"
 */

/* ===== 兼容版 catOf：支持新旧位置值 =====
 * 输入：pos 字符串（"G"/"G-F"/"F"/"F-C"/"C" 旧版，或 "PG"/"SG"/"SF"/"PF"/"C" 新版）
 * 输出："G" | "F" | "C"
 * 注意：本函数覆盖 engine.js 中的旧版 catOf，保持向后兼容 */
function catOf(pos) {
  const p = (pos || "F").toUpperCase();
  if (p === "PG" || p === "SG" || p === "G" || p === "G-F") return "G";
  if (p === "SF" || p === "PF" || p === "F" || p === "F-C") return "F";
  return "C";
}
function evaluateFit(pos) { return catOf(pos) === "G" ? 0 : catOf(pos) === "F" ? 1 : 2; }

/* ===== UI 位置样式类（覆盖 app.js 旧版） =====
 * 输入：pos 字符串；输出：pos-g / pos-f / pos-c（CSS 类名） */
function posClass(pos) {
  const c = catOf(pos);
  return c === "G" ? "pos-g" : c === "F" ? "pos-f" : "pos-c";
}

/* ===== 知名球星位置覆盖表（用 id 匹配，避免姓名变体问题） =====
 * 现实 NBA 2025-26 赛季的实际位置 + 第二位置 */
const POS_OVERRIDE = {
  // ===== 超级巨星 =====
  2544:    { pos: "SF", pos2: "PG" },   // 勒布朗·詹姆斯
  203507:  { pos: "PF", pos2: "PG" },   // 扬尼斯·安特托昆博（字母哥，组织前锋）
  1641705: { pos: "C",  pos2: "PF" },  // 维克托·文班亚马
  203999:  { pos: "C",  pos2: "PF" },   // 尼古拉·约基奇
  1628983: { pos: "SG", pos2: "PG" },   // 谢伊·吉尔杰斯-亚历山大（双能卫）
  1629029: { pos: "PG", pos2: "SF" },   // 卢卡·东契奇
  1628369: { pos: "SF", pos2: "PF" },   // 杰森·塔图姆
  201142:  { pos: "SF", pos2: "PF" },   // 凯文·杜兰特
  201939:  { pos: "PG", pos2: "SG" },   // 斯蒂芬·库里
  1626157: { pos: "C",  pos2: "PF" },   // 卡尔-安东尼·唐斯（空间型中锋）
  203954:  { pos: "C",  pos2: null },   // 乔尔·恩比德
  203076:  { pos: "PF", pos2: "C" },    // 安东尼·戴维斯（浓眉）
  1630169: { pos: "PG", pos2: null },   // 泰雷塞·哈利伯顿
  // ===== 全明星 / 主力 =====
  1628378: { pos: "SG", pos2: "PG" },   // 多诺万·米切尔
  1627759: { pos: "SG", pos2: "SF" },   // 杰伦·布朗
  1626164: { pos: "SG", pos2: "PG" },   // 德文·布克
  1628973: { pos: "PG", pos2: null },   // 杰伦·布伦森
  1630162: { pos: "SG", pos2: null },   // 安东尼·爱德华兹
  1630178: { pos: "PG", pos2: "SG" },   // 泰雷塞·马克西
  1630567: { pos: "SF", pos2: "PG" },   // 斯科蒂·巴恩斯（组织前锋）
  1627783: { pos: "PF", pos2: "SF" },   // 帕斯卡尔·西亚卡姆
  1628389: { pos: "C",  pos2: "PF" },   // 巴姆·阿德巴约
  1631094: { pos: "PF", pos2: "SF" },   // 保罗·班凯罗
  1630578: { pos: "C",  pos2: null },   // 阿尔佩伦·申京
  1642264: { pos: "PG", pos2: "SG" },   // 斯蒂芬·卡斯尔
  1642843: { pos: "SF", pos2: "PF" },   // 库珀·弗拉格
  1629027: { pos: "PG", pos2: null },   // 特雷·杨
  1630552: { pos: "PF", pos2: "SF" },   // 杰伦·约翰逊
  201935:  { pos: "PG", pos2: "SG" },   // 詹姆斯·哈登
  202681:  { pos: "PG", pos2: "SG" },   // 凯里·欧文
  1631096: { pos: "C",  pos2: "PF" },   // 切特·霍姆格伦
  1630163: { pos: "PG", pos2: null },   // 拉梅洛·鲍尔
  1628991: { pos: "PF", pos2: "C" },    // 贾伦·杰克逊
  1641708: { pos: "PG", pos2: "SF" },   // 阿门·汤普森
  203081:  { pos: "PG", pos2: null },   // 达米安·利拉德
  1629639: { pos: "SG", pos2: null },   // 泰勒·希罗
  1627734: { pos: "PF", pos2: "C" },    // 多曼塔斯·萨博尼斯
  1631114: { pos: "SG", pos2: "SF" },   // 杰伦·威廉姆斯
  1631105: { pos: "C",  pos2: null },   // 杰伦·杜伦
  1641706: { pos: "SF", pos2: null },   // 布兰登·米勒
  1641709: { pos: "SF", pos2: "PG" },   // 奥萨尔·汤普森
  1628386: { pos: "C",  pos2: null },   // 贾勒特·阿伦
  1629008: { pos: "SF", pos2: "PF" },   // 迈克尔·波特
  1630183: { pos: "SF", pos2: "PF" },   // 杰登·麦克丹尼尔斯
  1642844: { pos: "PG", pos2: "SG" },   // 迪伦·哈珀
  1630581: { pos: "PG", pos2: "SG" },   // 约什·吉迪
  1628368: { pos: "PG", pos2: null },   // 达龙·福克斯
  1629630: { pos: "PG", pos2: null },   // 贾·莫兰特
  1629636: { pos: "PG", pos2: null },   // 达柳斯·加兰
  1627742: { pos: "SF", pos2: "PF" },   // 布兰登·英格拉姆
  203944:  { pos: "PF", pos2: "C" },    // 朱利叶斯·兰德尔
  203932:  { pos: "PF", pos2: "SF" },   // 阿隆·戈登
  201942:  { pos: "SF", pos2: "SG" },   // 德马尔·德罗赞
  1628401: { pos: "SG", pos2: "PG" },   // 德里克·怀特
  203897:  { pos: "SG", pos2: "SF" },    // 扎克·拉文
  1642270: { pos: "C",  pos2: null },   // 多诺万·克林根
  1627749: { pos: "PG", pos2: "SG" },   // 德章泰·穆雷
  201950:  { pos: "PG", pos2: "SG" },   // 朱·霍勒迪
  1628404: { pos: "SF", pos2: "PG" },   // 约什·哈特
  1630170: { pos: "SG", pos2: "SF" },   // 德文·瓦塞尔
  1641717: { pos: "SG", pos2: "PG" },   // 卡森·华莱士
  1630530: { pos: "SF", pos2: "PF" },   // 特雷·墨菲三世
  1629638: { pos: "SG", pos2: "PG" },   // 尼基尔·亚历山大-沃克
  1630166: { pos: "SF", pos2: "PF" },   // 德尼·阿夫迪亚
  1627750: { pos: "PG", pos2: "SG" },   // 贾马尔·穆雷
  1630559: { pos: "SG", pos2: "PG" }    // 奥斯汀·里夫斯
};

/* ===== 派生具体位置（用于未在覆盖表中的球员） =====
 * 输入：player 对象（含 pos、attrs、heightCm）
 * 输出：{ pos: "PG"/"SG"/"SF"/"PF"/"C", pos2: null 或第二位置 }
 * 规则：
 *   - 已是具体位置（PG/SG/SF/PF/C）→ 直接返回，不派生
 *   - "C"  → "C"
 *   - "F-C" → 看 ins+reb vs out+ath 决定 "C" 或 "PF"
 *   - "G-F" → 看 org/reb/out 决定 "PG"/"SG"/"SF"
 *   - "G"  → 看 org vs out，身高兜底决定 "PG"/"SG"
 *   - "F"  → 看 ins+reb vs out+ath，身高兜底决定 "PF"/"SF" */
function derivePos(p) {
  const rawPos = (p && p.pos || "F").toUpperCase();
  const a = (p && p.attrs) || {};
  const ins = a.ins || 50, out = a.out || 50, org = a.org || 50;
  const reb = a.reb || 50, ath = a.ath || 50;
  const h = (p && p.heightCm) || 198;

  /* 已是具体位置：直接用，pos2 取球员自带的（新秀生成时可能已设） */
  if (rawPos === "PG" || rawPos === "SG" || rawPos === "SF" || rawPos === "PF" || rawPos === "C") {
    return { pos: rawPos, pos2: (p && p.pos2) || null };
  }

  if (rawPos === "C") return { pos: "C", pos2: null };

  /* F-C：内线型双能锋 */
  if (rawPos === "F-C") {
    const inside = ins + reb;
    const outside = out + ath;
    /* 内线属性明显占优且身高够高 → 主打中锋 */
    if (inside >= outside + 8 && h >= 206) return { pos: "C", pos2: "PF" };
    /* 否则主打大前，篮板极强则第二位置中锋 */
    return { pos: "PF", pos2: inside >= outside + 6 ? "C" : null };
  }

  /* G-F：锋卫摇摆人 */
  if (rawPos === "G-F") {
    /* 组织能力突出 → 控卫 */
    if (org >= out + 4 && org >= 82) return { pos: "PG", pos2: "SG" };
    /* 篮板强且身高足 → 小前/大前 */
    if (reb >= out && reb >= 78 && h >= 201) return { pos: "SF", pos2: "PF" };
    /* 默认分卫，第二位置小前 */
    return { pos: "SG", pos2: "SF" };
  }

  /* G：后卫 */
  if (rawPos === "G") {
    if (org >= out + 4) return { pos: "PG", pos2: null };
    if (out >= org + 4) return { pos: "SG", pos2: null };
    /* 平衡：矮个偏控卫，高个偏分卫 */
    return h >= 194 ? { pos: "SG", pos2: null } : { pos: "PG", pos2: null };
  }

  /* F：前锋 */
  if (rawPos === "F") {
    const inside = ins + reb;
    const outside = out + ath;
    if (inside >= outside + 6) return { pos: "PF", pos2: null };
    if (outside >= inside + 6) return { pos: "SF", pos2: null };
    /* 平衡：高个偏大前，矮个偏小前 */
    return h >= 203 ? { pos: "PF", pos2: null } : { pos: "SF", pos2: null };
  }

  return { pos: "SF", pos2: null };
}

/* ===== 统一入口：获取球员的具体位置 + 第二位置 =====
 * 优先级：覆盖表（id 匹配）> 已具体位置（直接用）> 派生 */
function getPos(p) {
  if (!p) return { pos: "SF", pos2: null };
  /* 1. 覆盖表优先 */
  if (p.id && POS_OVERRIDE[p.id]) {
    return Object.assign({}, POS_OVERRIDE[p.id]);
  }
  /* 2. 已是具体位置（新秀或自定义球员）直接用，保留自带 pos2 */
  const raw = (p.pos || "F").toUpperCase();
  if (raw === "PG" || raw === "SG" || raw === "SF" || raw === "PF" || raw === "C") {
    return { pos: raw, pos2: p.pos2 || null };
  }
  /* 3. 派生 */
  return derivePos(p);
}

/* ===== UI 显示文本：单位置 "PG"，双位置 "PF/PG" ===== */
function posLabel(p) {
  const r = getPos(p);
  return r.pos2 ? r.pos + "/" + r.pos2 : r.pos;
}
