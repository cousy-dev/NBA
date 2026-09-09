"use strict";
/* 选秀系统 —— 新秀生成 / 选秀逻辑 / AI选人 / 潜力评估（纯逻辑无 DOM） */

/* 新秀名字池 —— 按地区分组，包含美国/加拿大、欧洲、亚洲、其他（澳洲/非洲/南美），
   大幅增加名字多样性，避免"一字+两字"的单调重复 */
const ROOKIE_REGIONS = [
  { /* 美国 / 加拿大 */
    w: 58,
    first: ["贾", "凯", "马", "德", "安", "布", "杰", "以", "塔", "卡", "洛", "塞", "奥", "尼", "阿", "扎", "迪", "韦", "坎", "泰", "科", "迈", "乔", "克", "丹", "哈", "兰", "路", "杰伦", "贾伦", "泰勒", "乔丹", "卡梅隆", "奥斯汀", "德章泰", "泰厄斯", "马拉奇", "杰登", "斯科蒂", "弗兰茨", "阿门", "奥萨尔", "库珀", "布莱斯", "杰特", "布兰丁", "AJ", "RJ", "KJ", "DJ", "特雷", "朗佐", "拉梅洛", "锡安", "贾莫", "朱利叶斯", "德斯蒙德", "卡修斯", "基恩", "戴森", "凯斯勒", "约什", "基根", "班切罗", "小贾巴里", "夏普", "马瑟林", "迪昂", "拉拉维亚", "博尚", "克里斯蒂", "科林斯", "亨德里克斯", "霍华德", "惠特莫尔", "迪克", "乔治", "华莱士", "霍金斯", "卡斯尔", "克劳德", "韦尔斯", "巴特勒", "科菲", "纳吉", "沃特福德", "普雷斯顿", "波士顿"],
    last: ["威廉姆斯", "布朗", "约翰逊", "戴维斯", "托马斯", "杰克逊", "怀特", "哈里斯", "马丁", "汤普森", "刘易斯", "沃克", "罗宾逊", "格林", "伍德", "米勒", "卡特", "福斯特", "班克斯", "克鲁兹", "安德森", "泰勒", "摩尔", "克拉克", "罗伯茨", "特纳", "菲利普斯", "坎贝尔", "帕克", "埃文斯", "爱德华兹", "戈登", "海斯", "亨德森", "英格拉姆", "鲍尔", "莫里森", "雷迪什", "巴雷特", "希罗", "华盛顿", "马克西", "奎克利", "托平", "贝恩", "斯图尔特", "萨迪克", "奥科吉", "诺克斯", "波特", "塞布尔", "布里奇斯", "凯斯勒", "杜伦", "格里芬", "索汉", "穆雷", "艾维", "夏普", "迪昂", "索汉", "华盛顿", "克里斯蒂", "米勒", "霍华德", "汤普森", "惠特莫尔", "迪克", "乔治", "华莱士", "霍金斯", "卡斯尔", "克劳德", "韦尔斯", "巴特勒", "科菲", "纳吉", "沃特福德", "普雷斯顿", "波士顿", "琼斯", "史密斯", "威尔逊", "海斯", "李", "佩雷斯", "加西亚", "罗德里格斯", "马丁内斯", "洛佩斯", "冈萨雷斯", "赫尔南德斯", "迪亚兹", "托雷斯", "亚当斯", "布鲁克斯", "詹姆斯", "威尔逊", "墨菲", "库克", "贝尔", "霍顿", "塔克", "兰德尔", "诺埃尔"]
  },
  { /* 欧洲 */
    w: 22,
    first: ["尼古拉", "卢卡", "扬尼斯", "博格丹", "博扬", "武切", "德拉季", "东契", "约基", "别利察", "沙里奇", "博格达诺维奇", "祖巴茨", "本德尔", "日日奇", "萨马尼奇", "托皮奇", "里基", "亚历克斯", "胡安", "威利", "盖尔", "塞古", "基利安", "蒂莫泰", "戈贝尔", "富尼耶", "巴图姆", "卡巴罗", "尼利基纳", "奥科博", "马勒东", "海斯", "萨尔", "库利巴利", "文班亚马", "弗朗茨", "莫里茨", "丹尼尔", "丹尼斯", "马克西", "伊萨克", "克勒贝尔", "泰斯", "瓦格纳", "施罗德", "劳里", "凯文", "埃里克", "乔纳斯", "瓦兰", "博格达", "库鲁茨", "贝尔坦斯", "阿尔佩伦", "切特", "优素福", "比塔泽", "申京", "奥斯曼", "科尔克马兹", "拉金", "威尔贝金", "拉维尔", "米哈伊柳克", "米哈柳克", "博尔马罗", "加鲁巴", "恩迪亚耶", "法尔", "杜布列", "迪亚基特", "卡明斯基", "帕塞奇尼克斯", "库尔博卡", "库兹明斯卡斯", "瓦兰丘纳斯", "格里古尼斯", "塞库", "马兰", "普罗斯珀", "杜普里斯", "里萨谢", "萨尔", "亚布塞莱", "尼利基纳", "奥科吉", "恩尼斯", "卡巴罗", "戈贝尔"],
    last: ["约基奇", "东契奇", "武切维奇", "博格丹诺维奇", "博格达诺维奇", "德拉季奇", "别利察", "沙里奇", "马里亚诺维奇", "拉杜利察", "卡卢察", "泰乌多西奇", "祖巴茨", "本德尔", "日日奇", "萨马尼奇", "托皮奇", "卢比奥", "阿夫迪亚", "埃尔南戈麦斯", "加鲁巴", "博尔马罗", "阿尔达马", "米罗蒂奇", "伊巴卡", "加索尔", "费尔南德斯", "纳瓦罗", "卡尔德龙", "富尼耶", "巴图姆", "戈贝尔", "尼利基纳", "奥科博", "马勒东", "海斯", "库利巴利", "文班亚马", "萨尔", "瓦格纳", "施罗德", "克勒贝尔", "泰斯", "哈尔滕施泰因", "克莱伯", "马扬诺维奇", "博格达诺维奇", "马尔卡宁", "波蒂斯", "库鲁茨", "贝尔坦斯", "波尔津吉斯", "贝尔坦斯", "库兹明斯卡斯", "瓦兰丘纳斯", "格里古尼斯", "萨博尼斯", "约纳斯", "莫泰尤纳斯", "库明斯", "塞库", "马兰", "普罗斯珀", "里萨谢", "亚布塞莱", "恩尼斯", "卡巴罗", "迪亚基特", "帕塞奇尼克斯", "库尔博卡", "比塔泽", "申京", "奥斯曼", "科尔克马兹", "拉金", "威尔贝金", "米哈伊柳克", "博尔马罗", "加鲁巴", "法尔", "杜布列", "卡明斯基", "赫罗宁", "马尔卡宁", "格兰特", "威廉姆斯", "安德森", "彼得森", "埃里克森", "约根森", "汉森", "拉尔森", "尼尔森", "奥尔森"]
  },
  { /* 亚洲 */
    w: 10,
    first: ["周", "王", "郭", "易", "赵", "孙", "胡", "沈", "张", "曾", "余", "杨", "李", "朱", "徐", "林", "河", "渡边", "八村", "马场", "比江岛", "富坚", "罗健儿", "李承铉", "金", "李", "朴", "崔", "梁", "徐", "赵", "宋", "崔", "金善亨", "李大成", "许勋", "许雄", "全俊范", "宋教昌", "姜相才", "河允基", "张", "陈", "刘", "黄", "吴", "何", "林", "郑", "罗", "梁", "谢", "苏", "叶", "吕", "丁", "阿布都", "可兰", "西热力江", "阿不都", "唐才育", "齐麟", "于德豪", "吴前", "程帅澎", "陆文博", "朱旭航", "赖俊豪", "王奕博", "林孝天", "孙铭徽", "赵岩昊", "胡金秋", "赵嘉仁", "赵嘉义", "朱俊龙", "许可", "田宇翔", "雷蒙", "塔瑞克", "范子铭", "丘天", "杨阿力", "于晓辉", "孙昊锋", "陈赞宇", "加尼尤", "奥努阿库", "尤金", "亚当斯", "斯隆", "梅森", "约瑟夫", "克拉克森", "索托", "拉维纳", "帕克斯", "布莱克", "塔梅约", "卡尔沃", "马尔多纳多", "阿吉拉尔", "卡鲁阿纳", "卡斯特罗", "罗密欧", "普林格尔", "诺伍德", "马修", "法哈多", "陶拉瓦", "威廉姆斯", "哈迪", "佩奇", "莫德斯特", "博尔登", "亚伯特", "吉亚科", "齐亚雷", "贝尔加", "雷", "陈", "林", "高", "刘", "蔡", "苏", "王", "李", "黄", "吴", "何", "胡", "郑", "罗", "梁", "谢", "叶", "田", "董", "范", "蒋", "沈", "韩", "杨", "朱", "秦", "尤", "许", "汪", "陆", "金", "钱", "孙", "马", "冯", "邓", "曹", "彭", "曾", "肖", "田", "董", "袁", "潘", "于", "蒋", "蔡", "余", "杜", "叶", "程", "苏", "魏", "吕", "丁", "任", "沈", "姚", "卢", "蒋", "蔡", "余", "杜", "叶", "程", "苏", "魏", "吕", "丁"],
    last: ["琦", "哲林", "艾伦", "建联", "睿", "悦", "金秋", "梓捷", "镇麟", "凡博", "嘉豪", "瀚森", "昊文", "峻豪", "梓捷", "浩然", "厚然", "泓森", "立谦", "文炜", "佳轩", "兴亮", "俊杰", "嘉义", "嘉仁", "俊龙", "于德豪", "吴前", "帅澎", "文博", "旭航", "俊豪", "奕博", "孝天", "铭徽", "岩昊", "金秋", "嘉仁", "嘉义", "俊龙", "可", "宇翔", "蒙", "子铭", "天", "阿力", "晓辉", "昊锋", "赞宇", "加尼尤", "尤金", "亚当斯", "斯隆", "梅森", "约瑟夫", "克拉克森", "索托", "拉维纳", "帕克斯", "布莱克", "塔梅约", "卡尔沃", "马尔多纳多", "阿吉拉尔", "卡鲁阿纳", "卡斯特罗", "罗密欧", "普林格尔", "诺伍德", "马修", "法哈多", "陶拉瓦", "威廉姆斯", "哈迪", "佩奇", "莫德斯特", "博尔登", "亚伯特", "吉亚科", "齐亚雷", "贝尔加", "雄太", "翼", "贵文", "慎之介", "莲", "斗", "翔", "莲", "莲", "莲", "莲", "承铉", "大成", "勋", "雄", "俊范", "教昌", "相才", "允基", "善亨", "大成", "勋", "雄", "俊范", "教昌", "相才", "允基"]
  },
  { /* 其他：澳洲 / 非洲 / 南美 */
    w: 10,
    first: ["本", "乔", "帕蒂", "阿隆", "丹特", "约什", "索恩", "泰", "泽维尔", "戴森", "坦纳", "杰克", "山姆", "利亚姆", "瑞恩", "卡姆", "杰登", "里斯", "威尔", "卢卡", "马蒂斯", "德怀特", "戈兰", "德拉甘", "博扬", "尼古拉", "武克", "斯特凡", "马尔科", "拉扎尔", "亚历山大", "谢伊", "帕斯卡尔", "OG", "凯利", "科里", "贾马尔", "狄龙", "RJ", "尼基尔", "凯斯", "埃德里斯", "博尔", "穆罕默德", "阿卜杜勒", "优素福", "萨利姆", "哈米杜", "谢赫", "阿米尔", "索洛", "埃内斯", "切迪", "德尼", "申京", "阿尔佩伦", "布里塞特", "奥谢", "尼基", "马库斯", "托马斯", "卢克", "马克", "阿维", "本", "马特", "亚当", "大卫", "卢克", "克里斯", "詹姆斯", "尼古拉斯", "威廉", "爱德华", "哈里森", "乔治", "弗雷泽", "卡梅伦", "乔丹", "泰勒", "迪伦", "科里", "基弗", "桑托斯", "加布里埃尔", "布鲁诺", "克里斯特安", "内托", "劳尔", "卢卡斯", "尼古拉斯", "马科斯", "卢西亚诺", "马科斯", "卢卡斯", "尼古拉斯", "加布里埃尔", "布鲁诺", "克里斯特安"],
    last: ["西蒙斯", "英格尔斯", "米尔斯", "贝恩斯", "埃克萨姆", "吉迪", "梅克", "克雷格", "库克斯", "丹尼尔斯", "克里克", "兰代尔", "怀特", "布兰汉姆", "布洛瑟姆盖姆", "瑟蒂斯", "马扬诺维奇", "德拉季奇", "博格达诺维奇", "约维奇", "武切维奇", "别利察", "马里亚诺维奇", "拉杜利察", "西马尼奇", "佩特鲁舍夫", "阿夫拉莫维奇", "卢西奇", "卡利尼奇", "博格达诺维奇", "马尔卡宁", "格兰特", "威廉姆斯", "安德森", "彼得森", "埃里克森", "约根森", "汉森", "拉尔森", "尼尔森", "奥尔森", "西亚卡姆", "伊巴卡", "恩比德", "卡佩拉", "戈贝尔", "阿米奴", "奥科吉", "阿努诺比", "奥科吉", "恩尼斯", "梅图", "奥尼", "奥科博", "迪亚基特", "博尔", "穆罕默德", "阿卜杜勒", "优素福", "萨利姆", "哈米杜", "谢赫", "阿米尔", "索洛", "埃内斯", "切迪", "德尼", "申京", "阿尔佩伦", "布里塞特", "奥谢", "尼基", "马库斯", "托马斯", "卢克", "马克", "阿维", "本", "马特", "亚当", "大卫", "卢克", "克里斯", "詹姆斯", "尼古拉斯", "威廉", "爱德华", "哈里森", "乔治", "弗雷泽", "卡梅伦", "乔丹", "泰勒", "迪伦", "科里", "基弗", "桑托斯", "加布里埃尔", "布鲁诺", "克里斯特安", "内托", "劳尔", "卢卡斯", "尼古拉斯", "马科斯", "卢西亚诺", "戴克", "坎帕佐", "德科洛", "德科", "普罗斯佩", "杜普里斯", "里萨谢", "萨尔", "亚布塞莱", "尼利基纳", "奥科吉", "恩尼斯", "卡巴罗", "戈贝尔", "文班亚马", "萨尔", "库利巴利", "海斯", "马勒东", "奥科博", "尼利基纳", "卡巴罗", "巴图姆", "富尼耶", "戈贝尔"]
  }
];

/* 按权重随机选一个地区 */
function pickRookieRegion() {
  const total = ROOKIE_REGIONS.reduce((s, r) => s + r.w, 0);
  let rnd = Math.random() * total;
  for (const r of ROOKIE_REGIONS) { if (rnd < r.w) return r; rnd -= r.w; }
  return ROOKIE_REGIONS[0];
}
/* 生成一个随机新秀名字 */
function genRookieName() {
  const region = pickRookieRegion();
  const first = region.first[Math.floor(Math.random() * region.first.length)];
  const last = region.last[Math.floor(Math.random() * region.last.length)];
  /* 约 25% 概率不加间隔点（单字名+姓连读更自然），其余用"名·姓" */
  return Math.random() < 0.25 ? first + last : first + "·" + last;
}

/* 位置模板属性（具体位置 PG/SG/SF/PF/C） */
const POS_TEMPLATES = {
  PG: { ins: -5, out: 3, org: 6, def: -1, reb: -6, ath: 3 },
  SG: { ins: -3, out: 5, org: 2, def: 0, reb: -4, ath: 3 },
  SF: { ins: 1, out: 2, org: 0, def: 2, reb: 1, ath: 2 },
  PF: { ins: 4, out: -1, org: -1, def: 2, reb: 4, ath: 1 },
  C:  { ins: 6, out: -4, org: -3, def: 4, reb: 6, ath: -1 }
};
/* 第二位置候选表（生成 pos2 时使用，约 20% 高 OVR 新秀会有第二位置） */
const POS2_CANDIDATES = {
  PG: ["SG"], SG: ["PG", "SF"], SF: ["SG", "PF"], PF: ["SF", "C"], C: ["PF"]
};

/* 生成一个新秀 */
let ROOKIE_ID_COUNTER = 900000;
function genRookie(pickOvrSeed) {
  /* pickOvrSeed: 0-1, 0=状元 1=末轮 */
  /* 位置分布：后卫/前锋多，中锋少，更贴近真实 NBA */
  const posList = ["PG", "SG", "SG", "SF", "SF", "PF", "PF", "C"];
  const pos = posList[Math.floor(Math.random() * posList.length)];
  /* OVR: 状元 76-80, 前5 72-77, 乐透 68-74, 首轮中段 63-70, 首轮末 60-66, 二轮 55-62 */
  let ovr;
  if (pickOvrSeed < 0.025) ovr = 76 + Math.floor(Math.random() * 5);   /* 状元 76-80 */
  else if (pickOvrSeed < 0.08) ovr = 72 + Math.floor(Math.random() * 6);  /* 前5 72-77 */
  else if (pickOvrSeed < 0.23) ovr = 68 + Math.floor(Math.random() * 7);  /* 乐透 68-74 */
  else if (pickOvrSeed < 0.40) ovr = 63 + Math.floor(Math.random() * 8);  /* 首轮中段 63-70 */
  else if (pickOvrSeed < 0.50) ovr = 60 + Math.floor(Math.random() * 7);  /* 首轮末 60-66 */
  else if (pickOvrSeed < 0.75) ovr = 55 + Math.floor(Math.random() * 8);  /* 二轮前段 55-62 */
  else ovr = 50 + Math.floor(Math.random() * 8);                          /* 二轮末 50-57 */

  const nameCn = genRookieName();
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
  /* 潜力分：基于顺位 + 年龄 + 随机波动，严格按真实 NBA 顺位梯度拉开差距
     现实参考：状元/前3（Wemby/LeBron 级）独一档 92-96；前5 85-92；乐透(6-14) 78-86；
     首轮中段(15-20) 70-80；首轮末(21-30) 65-74；二轮 55-68（偶有黑马≤72） */
  let potentialBase;
  if (pickOvrSeed < 0.025) potentialBase = 92 + Math.floor(Math.random() * 5);     /* 状元级 92-96 */
  else if (pickOvrSeed < 0.08) potentialBase = 85 + Math.floor(Math.random() * 7);  /* 前5 85-91 */
  else if (pickOvrSeed < 0.23) potentialBase = 78 + Math.floor(Math.random() * 9);  /* 乐透 78-86 */
  else if (pickOvrSeed < 0.40) potentialBase = 70 + Math.floor(Math.random() * 10); /* 首轮中段 70-79 */
  else if (pickOvrSeed < 0.50) potentialBase = 65 + Math.floor(Math.random() * 9);  /* 首轮末 65-73 */
  else if (pickOvrSeed < 0.75) potentialBase = 58 + Math.floor(Math.random() * 10); /* 二轮前段 58-67 */
  else potentialBase = 52 + Math.floor(Math.random() * 10);                          /* 二轮末 52-61 */
  /* 年龄修正：年轻 +1~2, 年长 -1~2 */
  const ageMod = age <= 19 ? 2 : age <= 20 ? 1 : age >= 22 ? -2 : 0;
  /* 高 ath/org 微加成，封顶 +3 避免高顺位被反复加成至 95 */
  const attrBonus = Math.max(0, Math.min(3, Math.round((attrs.ath - 60) * 0.08 + (attrs.org - 55) * 0.06)));
  const potential = Math.max(50, Math.min(96, potentialBase + ageMod + attrBonus));

  /* 大学联赛数据：基于 OVR + 位置模板 + 随机波动，模拟真实大学赛况
     选秀界面只展示大学数据，隐藏 OVR/潜力，给玩家"盲盒选秀"体验 */
  const posR = { PG: 3.0, SG: 3.6, SF: 5.2, PF: 7.0, C: 9.6 };
  const posA = { PG: 6.0, SG: 3.8, SF: 2.8, PF: 2.0, C: 1.4 };
  const posS = { PG: 1.3, SG: 1.2, SF: 1.0, PF: 0.8, C: 0.5 };
  const posB = { PG: 0.5, SG: 0.6, SF: 0.8, PF: 1.2, C: 1.8 };
  const ovrFactor = Math.max(0.3, (ovr - 50) / 35); /* 0.3-1.0+ */
  const collegeJitter = (salt, range) => Math.round((hash01(id, salt) - 0.5) * 2 * range * 10) / 10;
  /* 得分：OVR 80+ 才能拿到 20+ 分；大学赛场比 NBA 容易，数据普遍偏高 */
  let collegePpg;
  if (ovr >= 75) collegePpg = 18 + (ovr - 75) * 1.4 + collegeJitter(11, 3);
  else if (ovr >= 68) collegePpg = 12 + (ovr - 68) * 0.85 + collegeJitter(11, 3);
  else if (ovr >= 60) collegePpg = 7 + (ovr - 60) * 0.7 + collegeJitter(11, 2);
  else collegePpg = 3 + Math.max(0, ovr - 50) * 0.4 + collegeJitter(11, 2);
  /* 大学名单（虚构，增强沉浸感） */
  const COLLEGES = ["肯塔基大学", "杜克大学", "北卡大学", "UCLA", "堪萨斯大学", "冈萨加大学", "维拉诺瓦大学", "亚利桑那大学", "德州大学", "密歇根大学", "田纳西大学", "奥本大学", "普渡大学", "马凯特大学", "休斯顿大学", "贝勒大学", "伊利诺伊大学", "爱荷华大学", "克雷顿大学", "圣玛丽大学"];
  const college = COLLEGES[Math.floor(hash01(id, 21) * COLLEGES.length)];
  const collegeStats = {
    college,
    ppg: Math.max(1.5, Math.round(collegePpg * 10) / 10),
    rpg: Math.max(1.0, Math.round(((posR[pos] || 5) * (0.6 + ovrFactor * 0.7) + collegeJitter(12, 1.5)) * 10) / 10),
    apg: Math.max(0.3, Math.round(((posA[pos] || 3) * (0.6 + ovrFactor * 0.7) + collegeJitter(13, 1.2)) * 10) / 10),
    spg: Math.max(0.1, Math.round(((posS[pos] || 0.8) * (0.5 + ovrFactor * 0.8) + collegeJitter(14, 0.4)) * 10) / 10),
    bpg: Math.max(0.1, Math.round(((posB[pos] || 0.8) * (0.5 + ovrFactor * 0.8) + collegeJitter(15, 0.5)) * 10) / 10),
    fgPct: Math.round((0.42 + ovrFactor * 0.08 + (hash01(id, 16) - 0.5) * 0.06) * 1000) / 10,
    tpm: Math.round(Math.max(0.2, (pos === "PG" || pos === "SG" ? 1.8 : pos === "SF" ? 1.2 : 0.6) * ovrFactor + collegeJitter(17, 0.8)) * 10) / 10,
    /* 三分出手数 = 命中数 / 命中率（命中率 28-42%） */
    tpPct: Math.round((0.28 + ovrFactor * 0.12 + (hash01(id, 18) - 0.5) * 0.08) * 1000) / 10
  };

  /* 第二位置：约 20% 高 OVR 新秀会有第二位置（versatile 球员） */
  let pos2 = null;
  if (ovr >= 70 && Math.random() < 0.20) {
    const opts = POS2_CANDIDATES[pos] || [];
    if (opts.length) pos2 = opts[Math.floor(Math.random() * opts.length)];
  }

  /* 身高体重按具体位置生成 */
  const heightCm = pos === "C" ? 211 + Math.floor(Math.random() * 8)
    : pos === "PF" ? 206 + Math.floor(Math.random() * 8)
    : pos === "SF" ? 201 + Math.floor(Math.random() * 6)
    : pos === "SG" ? 193 + Math.floor(Math.random() * 8)
    : 188 + Math.floor(Math.random() * 6);
  const weightKg = pos === "C" ? 110 + Math.floor(Math.random() * 15)
    : pos === "PF" ? 100 + Math.floor(Math.random() * 15)
    : 90 + Math.floor(Math.random() * 15);

  return {
    id, nameCn, nameEn: nameCn, team: "ROOKIE", pos, pos2, num: 0, age,
    heightCm, weightKg,
    expYears: 0, draftYear: 2026 + (typeof state !== "undefined" && state.save ? state.save.seasonNo : 1) - 1,
    avatar: null,
    ovr, ratingSource: "draft",
    attrs, mgr,
    stats: null,
    potential,
    collegeStats,
    isRookie: true
  };
}

/* 生成选秀班底（31 队两轮 62 人；扩张队补偿签等额外首轮签最多 +1，多生成 2 人保证末轮签也能选到人） */
function genDraftClass(save) {
  const class_ = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const seed = i / n;
    class_.push(genRookie(seed));
  }
  /* 打乱展示顺序：避免玩家总是选第一位就拿到最高潜力新秀；
     AI 选人时仍按潜力+需求排序，公平性不变 */
  shuffleArr(class_);
  return class_;
}

/* ===== 扩张选秀（新球队作为第 31 队加入联盟时，从 30 支原球队挑选无人保护的球员） ===== */
/* 规则（贴近 NBA 扩张选秀，如 2004 山猫）：
   - 每支原球队最多保护 8 名球员（含受限制自由球员），按 OVR 自动保护最强 8 人
   - 每队必须至少提供 1 名非自由球员供挑选（保护数 = min(8, 阵容人数-1)）
   - 每支原球队最多流失 1 人：新队从某队挑走 1 人后，该队其余暴露球员即不可再选
   - 新球队挑选 14-29 人
   - 扩张球队享受特殊工资帽政策（建队阶段可吸收任意合同，不计工资帽）+ 早期额外首轮签优待 */
const EXPANSION_PROTECT_MAX = 8;
const EXPANSION_PICK_MIN = 14;
const EXPANSION_PICK_MAX = 29;
const EXPANSION_BONUS_PICKS = 2;   /* 扩张球队前两个赛季每年额外 1 个首轮签 */

/* 构建扩张选秀可选池：每队保护 OVR 最高的 8 人，其余暴露 */
function buildExpansionPool() {
  const pool = [];
  TEAMS.forEach(t => {
    const players = playersByTeam(t.abbr).slice().sort((a, b) => b.ovr - a.ovr);
    const protectCount = Math.min(EXPANSION_PROTECT_MAX, Math.max(0, players.length - 1));
    players.slice(protectCount).forEach(p => pool.push({ p, from: t.abbr }));
  });
  /* 按 OVR 降序，最强可挑球员排前 */
  pool.sort((a, b) => b.p.ovr - a.p.ovr);
  return pool;
}

/* 扩张球队特殊工资帽（建队首年可超帽吸收合同，给到大球市级别的财力空间） */
function expansionBudget() { return (typeof FIRST_APRON !== "undefined" ? FIRST_APRON : 209.0); }

/* 扩张完成后构建 AI 各队阵容：30 队原有球员 id 列表，排除被新队选走的球员 */
function buildExpansionAiRosters(selectedIds) {
  const rosters = {};
  TEAMS.forEach(t => {
    rosters[t.abbr] = playersByTeam(t.abbr).map(p => p.id).filter(id => !selectedIds.has(id));
  });
  return rosters;
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

/* 2026 届新秀工资标尺（百万美元/年，首年薪资，按顺位）。
   参照真实 2026-27 标尺：状元 AJ Dybantsa $14.75M，首轮末约 $2.4M；
   次轮介于底薪与约 $2.0M 之间。逐年递增由续约/年结逻辑处理，首年定薪以此为准。 */
function rookieScaleSalary(pick) {
  if (pick <= 30) {
    return Math.round((14.75 - (pick - 1) * 0.426) * 10) / 10;
  }
  return Math.round((2.0 - (pick - 31) * 0.028) * 10) / 10;
}

/* 用户选人后的入职（新秀合同 = 4 年保障 + isRookieScale 标记 RFA 资格） */
function signRookie(save, rookie) {
  /* 幂等保护：刷新/中断后重入时避免重复签约同一新秀 */
  if (save.roster && save.roster.some(r => r.id === rookie.id)) return;
  /* 薪资按真实新秀工资标尺（顺位）定；无顺位信息时退回能力值估算 */
  const sal = rookie.pick ? rookieScaleSalary(rookie.pick) : estimateSalary(rookie.ovr, rookie.id);
  const years = rookieContractYears(rookie.potential || 75);
  /* 新秀合同：birdYears 从 0 开始，isRookieScale=true（到期后享受 RFA 资格） */
  save.roster.push({
    id: rookie.id, salary: sal, years,
    birdYears: 0,
    optionType: null, optionYear: 0, optionSalary: 0,
    isRookieScale: true, signedVia: "draft"
  });
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

/* 处理单个选秀签位：记录新秀归属、持久化到存档与全局库、用户队则签约 */
/* results 累积 { pick, abbr, rookie }；幂等：同一新秀已处理则跳过 */
function processPick(save, rookie, teamAbbr, pickNumber, results) {
  if (results.some(r => r.rookie.id === rookie.id)) return;
  rookie.team = teamAbbr;
  rookie.pick = pickNumber;  /* 记录真实顺位，供新秀工资标尺定薪 */
  save.customPlayers = save.customPlayers || [];
  if (!save.customPlayers.find(p => p.id === rookie.id)) {
    save.customPlayers.push(rookie);
  }
  if (!PLAYERS_RATED.players.find(p => p.id === rookie.id)) {
    PLAYERS_RATED.players.push(rookie);
    if (LEAGUE_EST) LEAGUE_EST.set(rookie.id, estStats(rookie));
  }
  if (teamAbbr === myAbbr(save)) {
    signRookie(save, rookie);
  }
  results.push({ pick: pickNumber, abbr: teamAbbr, rookie });
}

/* AI 自动选完从 startIdx 起的所有剩余签位 */
/* pickOrder: [{ team, round, pick, season, originalTeam }] 已按顺位排序 */
/* userPickMap: { idx: rookieId } 用户在哪些签位选了谁（idx 为 pickOrder 下标） */
/* pickedIds: Set 已被选走的 ID */
/* results: 累积结果数组，函数末尾写入 save.draftResults */
function autoRunRemaining(save, draftClass, pickOrder, startIdx, pickedIds, userPickMap, results) {
  for (let i = startIdx; i < pickOrder.length; i++) {
    if (pickedIds.size >= draftClass.length) break;
    const po = pickOrder[i];
    let rookie = null;
    /* 用户预先选定的签位 */
    if (userPickMap[i] != null) {
      rookie = draftClass.find(r => r.id === userPickMap[i] && !pickedIds.has(r.id));
    }
    /* 否则 AI 选 */
    if (!rookie) {
      rookie = aiPickRookie(draftClass, save, po.team, pickedIds);
    }
    if (!rookie) continue;
    pickedIds.add(rookie.id);
    processPick(save, rookie, po.team, po.pick, results);
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
    /* 扩张球队选秀权优待：前两次选秀（第2、3赛季）每年额外 1 个首轮签（扩张补偿）。
       用赛季号判定，避免建队时 migrate 的初始签位生成误扣次数。 */
    if (save.expansion && season >= 2 && season <= (save.expansionBonusUntilSeason || 3)) {
      picks.push({ team: my, round: 1, season, originalTeam: my });
    }
  }
  save.draftPicks = picks;
}

/* 计算选秀顺位（基于上赛季战绩 + 季后赛成绩） */
/* 返回 [{ team, round, pick, season }] 排好序的 60 个选秀权 */
function computePickOrder(save) {
  const season = save.seasonNo; /* 当前赛季结束后选秀 */
  const my = myAbbr(save);
  /* 顺位依据上赛季最终战绩（newSeason 重置战绩前的快照）；快照缺失时退回当前战绩 */
  const stSrc = save.lastStandings || save.standings || {};
  /* 所有 30 支真实球队按战绩排序；自建球队（CUS）作为第 31 队一并纳入 */
  const ranked = TEAMS.map(t => {
    const s = stSrc[t.abbr] || { w: 0, l: 0 };
    const gp = s.w + s.l;
    const winPct = gp ? s.w / gp : 0.5;
    return { abbr: t.abbr, winPct, w: s.w, l: s.l, str: teamStrength(t.abbr) };
  });
  if (!TEAMS.some(t => t.abbr === my)) {
    const s = stSrc[my] || { w: 0, l: 0 };
    const gp = s.w + s.l;
    ranked.push({ abbr: my, winPct: gp ? s.w / gp : 0.5, w: s.w, l: s.l, str: strengthOf(save, my) });
  }
  /* 战绩越差顺位越靠前；战绩相同时实力弱的排前（弱队优先，符合选秀逻辑） */
  const sorted = ranked.slice().sort((a, b) => a.winPct - b.winPct || a.str - b.str);

  /* 从 lastPlayoffs 提取季后赛成绩，确定哪些队进了季后赛及走多远 */
  const lp = save.lastPlayoffs;
  const playoffTeams = new Set();   /* 进了季后赛的球队 */
  const elimRound = {};             /* 球队 → 被淘汰的轮次（0=首轮,1=半决赛,2=分区决赛,3=总决赛亚军,4=冠军） */
  if (lp) {
    /* 先收集所有参赛球队 */
    lp.rounds.forEach((r, ri) => {
      if (!r) return;
      r.E.concat(r.W).forEach(s => {
        if (s.winner) playoffTeams.add(s.winner);
        if (s.loser) playoffTeams.add(s.loser);
        /* loser 在该轮被淘汰 */
        if (s.loser && elimRound[s.loser] == null) elimRound[s.loser] = ri;
      });
    });
    /* 冠军走到最后 */
    if (lp.champion) { playoffTeams.add(lp.champion); elimRound[lp.champion] = 4; }
    /* winner 如果没被后续轮记为 loser，说明走得更远，更新其淘汰轮次 */
    lp.rounds.forEach((r, ri) => {
      if (!r) return;
      r.E.concat(r.W).forEach(s => {
        if (s.winner && elimRound[s.winner] != null && elimRound[s.winner] < ri) {
          /* 该 winner 在后续更远的轮次也出现了 → 更新到至少 ri */
          elimRound[s.winner] = ri;
        }
      });
    });
  }

  /* 分乐透（未进季后赛）和季后赛 */
  const lottery = sorted.filter(t => !playoffTeams.has(t.abbr));
  const playoff = sorted.filter(t => playoffTeams.has(t.abbr));

  /* 季后赛球队按淘汰轮次排序：首轮出局排前，冠军排最后 */
  playoff.sort((a, b) => {
    const ea = elimRound[a.abbr] != null ? elimRound[a.abbr] : 0;
    const eb = elimRound[b.abbr] != null ? elimRound[b.abbr] : 0;
    if (ea !== eb) return ea - eb;
    /* 同轮次：战绩差的顺位靠前（更早选人） */
    return a.winPct - b.winPct;
  });

  /* 乐透抽签：最差 3 队各有 14% 概率抽到前 4，简化为随机前 4 */
  const lottoTop4 = lottery.slice(0, Math.min(4, lottery.length));
  shuffleArr(lottoTop4);
  const lottoRest = lottery.slice(4); /* 已按战绩排序 */
  const firstRoundOrder = lottoTop4.concat(lottoRest).concat(playoff);
  /* 次轮：纯战绩倒序 */
  const secondRoundOrder = sorted.slice();

  /* 从 save.draftPicks 中找出该赛季的所有选秀权 */
  const allPicks = (save.draftPicks || []).filter(p => p.season === season);
  const result = [];
  /* 首轮：按战绩顺位给每队分配一个签位；一队持有的额外首轮签（扩张补偿签、交易多签）
     先收集，按原队顺位顺序排在首轮末段，避免额外签被丢弃 */
  const extraRound1 = [];
  firstRoundOrder.forEach((t, i) => {
    const picks = allPicks.filter(p => p.originalTeam === t.abbr && p.round === 1);
    if (picks.length) {
      result.push({ team: picks[0].team, round: 1, pick: i + 1, season, originalTeam: t.abbr });
      picks.slice(1).forEach(p => extraRound1.push(p));
    }
  });
  let nextPickNo = firstRoundOrder.length + 1;
  extraRound1.forEach(p => {
    result.push({ team: p.team, round: 1, pick: nextPickNo++, season, originalTeam: p.originalTeam });
  });
  /* 次轮：紧接首轮顺位编号，额外次轮签（交易等）排在次轮末段，最后统一顺延编号 */
  const round2 = [];
  const extraRound2 = [];
  secondRoundOrder.forEach(t => {
    const picks = allPicks.filter(p => p.originalTeam === t.abbr && p.round === 2);
    if (picks.length) {
      round2.push(picks[0]);
      picks.slice(1).forEach(p => extraRound2.push(p));
    }
  });
  round2.concat(extraRound2).forEach(p => {
    result.push({ team: p.team, round: 2, pick: nextPickNo++, season, originalTeam: p.originalTeam });
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
