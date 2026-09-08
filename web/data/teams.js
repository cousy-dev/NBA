/* 球市分级（基于福布斯 NBA 球队估值 + 营收数据）：
   large  = 大球市（洛杉矶/纽约/金州/芝加哥/波士顿/布鲁克林）—— 球队估值前 6，营收高，可挥金至第一奢侈税线之上
   medium = 中球市（迈阿密/达拉斯/休斯顿/菲尼克斯/费城/多伦多/萨克拉门托/犹他/波特兰/亚特兰大）—— 中等营收
   small  = 小球市（其余 14 队）—— 营收较低，预算较紧 */
/* 2024-25 NBA 工资帑数据：硬帽 $140.588M / 奢侈税线 $170.810M / 第一奢侈税线 $178.132M */
window.TEAMS = [
    { "id": 1610612759, "abbr": "SAS",  "nameCn": "马刺",   "cityEn": "San Antonio",     "market": "small"  },
    { "id": 1610612757, "abbr": "POR",  "nameCn": "开拓者", "cityEn": "Portland",        "market": "medium" },
    { "id": 1610612737, "abbr": "ATL",  "nameCn": "老鹰",   "cityEn": "Atlanta",         "market": "medium" },
    { "id": 1610612753, "abbr": "ORL",  "nameCn": "魔术",   "cityEn": "Orlando",         "market": "small"  },
    { "id": 1610612765, "abbr": "DET",  "nameCn": "活塞",   "cityEn": "Detroit",         "market": "small"  },
    { "id": 1610612741, "abbr": "CHI",  "nameCn": "公牛",   "cityEn": "Chicago",         "market": "large"  },
    { "id": 1610612750, "abbr": "MIN",  "nameCn": "森林狼", "cityEn": "Minnesota",       "market": "small"  },
    { "id": 1610612744, "abbr": "GSW",  "nameCn": "勇士",   "cityEn": "Golden State",    "market": "large"  },
    { "id": 1610612756, "abbr": "PHX",  "nameCn": "太阳",   "cityEn": "Phoenix",        "market": "medium" },
    { "id": 1610612764, "abbr": "WAS",  "nameCn": "奇才",   "cityEn": "Washington",     "market": "small"  },
    { "id": 1610612743, "abbr": "DEN",  "nameCn": "掘金",   "cityEn": "Denver",         "market": "small"  },
    { "id": 1610612758, "abbr": "SAC",  "nameCn": "国王",   "cityEn": "Sacramento",     "market": "medium" },
    { "id": 1610612742, "abbr": "DAL",  "nameCn": "独行侠", "cityEn": "Dallas",         "market": "medium" },
    { "id": 1610612760, "abbr": "OKC",  "nameCn": "雷霆",   "cityEn": "Oklahoma City",  "market": "small"  },
    { "id": 1610612754, "abbr": "IND",  "nameCn": "步行者", "cityEn": "Indiana",        "market": "small"  },
    { "id": 1610612740, "abbr": "NOP",  "nameCn": "鹈鹕",   "cityEn": "New Orleans",    "market": "small"  },
    { "id": 1610612755, "abbr": "PHI",  "nameCn": "76人",   "cityEn": "Philadelphia",   "market": "medium" },
    { "id": 1610612751, "abbr": "BKN",  "nameCn": "篮网",   "cityEn": "Brooklyn",       "market": "large"  },
    { "id": 1610612738, "abbr": "BOS",  "nameCn": "凯尔特人","cityEn": "Boston",        "market": "large"  },
    { "id": 1610612747, "abbr": "LAL",  "nameCn": "湖人",   "cityEn": "Los Angeles",    "market": "large"  },
    { "id": 1610612748, "abbr": "MIA",  "nameCn": "热火",   "cityEn": "Miami",          "market": "medium" },
    { "id": 1610612749, "abbr": "MIL",  "nameCn": "雄鹿",   "cityEn": "Milwaukee",      "market": "small"  },
    { "id": 1610612766, "abbr": "CHA",  "nameCn": "黄蜂",   "cityEn": "Charlotte",      "market": "small"  },
    { "id": 1610612752, "abbr": "NYK",  "nameCn": "尼克斯", "cityEn": "New York",       "market": "large"  },
    { "id": 1610612739, "abbr": "CLE",  "nameCn": "骑士",   "cityEn": "Cleveland",      "market": "small"  },
    { "id": 1610612763, "abbr": "MEM",  "nameCn": "灰熊",   "cityEn": "Memphis",        "market": "small"  },
    { "id": 1610612746, "abbr": "LAC",  "nameCn": "快船",   "cityEn": "LA",             "market": "large"  },
    { "id": 1610612745, "abbr": "HOU",  "nameCn": "火箭",   "cityEn": "Houston",        "market": "medium" },
    { "id": 1610612761, "abbr": "TOR",  "nameCn": "猛龙",   "cityEn": "Toronto",        "market": "medium" },
    { "id": 1610612762, "abbr": "UTA",  "nameCn": "爵士",   "cityEn": "Utah",           "market": "medium" }
];
