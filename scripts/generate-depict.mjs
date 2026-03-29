/**
 * Generate depict field for existing AI analysis cache
 * Based on tags, category, and description
 */

import fs from 'fs-extra';
import path from 'path';

const CACHE_PATH = './server/cache/analysis/analysis-cache.json';

// 意境描述模板库（按分类）
const depictTemplates = {
  '风景': [
    '山川静默，云影徘徊，天地间一幅水墨长卷。',
    '远山如黛，近水含烟，风光不与四时同。',
    '落日熔金，暮云合璧，山河入梦来。',
    '层峦叠嶂，翠色欲流，此中有真意。',
    '烟波浩渺，孤帆远影，江湖夜雨十年灯。',
    '会当凌绝顶，一览众山小。',
    '采菊东篱下，悠然见南山。',
    '行到水穷处，坐看云起时。',
    '空山新雨后，天气晚来秋。',
    '江流天地外，山色有无中。',
    '大漠孤烟直，长河落日圆。',
    '日出江花红胜火，春来江水绿如蓝。',
    '千里江山，只此青绿。',
    '山水之间，寻得浮生半日闲。',
    '云来山更佳，云去山如画。',
    '水光潋滟晴方好，山色空蒙雨亦奇。',
    '两岸猿声啼不住，轻舟已过万重山。',
    '飞流直下三千尺，疑是银河落九天。',
    '横看成岭侧成峰，远近高低各不同。',
    '山重水复疑无路，柳暗花明又一村。',
    '天苍苍，野茫茫，风吹草低见牛羊。',
    '春江潮水连海平，海上明月共潮生。',
    '孤帆远影碧空尽，唯见长江天际流。',
    '接天莲叶无穷碧，映日荷花别样红。',
    '停车坐爱枫林晚，霜叶红于二月花。'
  ],
  '建筑': [
    '飞檐斗拱间，藏着千年的光阴故事。',
    '青砖黛瓦，岁月静好，古意盎然。',
    '雕梁画栋，气势恢宏，一眼万年。',
    '亭台楼阁，错落有致，人间烟火气。',
    '古城墙下，时光慢递，往事如烟。'
  ],
  '夜景': [
    '灯火阑珊处，夜色温柔如水。',
    '星河滚烫，人间理想，万家灯火。',
    '华灯初上，夜色迷离，城市不眠。',
    '霓虹闪烁，夜色撩人，繁华落尽见真章。',
    '月黑风高夜，灯火暖人心。'
  ],
  '人像': [
    '眉眼如画，一笑倾城，春风十里不如你。',
    '光影流转，定格瞬间的温柔。',
    '回眸一笑百媚生，六宫粉黛无颜色。',
    '岁月从不败美人，时光沉淀的优雅。',
    '人间烟火气，最抚凡人心。'
  ],
  '美食': [
    '人间至味是清欢，一箪食一瓢饮。',
    '烟火气里藏着生活的诗意。',
    '色香味俱全，舌尖上的乡愁。',
    '一粥一饭，当思来之不易。',
    '人间有味是清欢，粗茶淡饭亦心安。'
  ],
  '动物': [
    '万物有灵，生生不息。',
    '灵动双眸，藏着大自然的故事。',
    '野性之美，自由之魂。',
    '毛茸茸的温柔，治愈世间所有。',
    '生灵涂炭，万物可爱。'
  ],
  '植物': [
    '草木有本心，何求美人折。',
    '一花一世界，一叶一菩提。',
    '绿意盎然，生机勃勃。',
    '花开半夏，岁月静好。',
    '草木蔓发，春山可望。'
  ],
  '街拍': [
    '街头巷尾，人间烟火最抚凡人心。',
    '行色匆匆，各怀心事，皆是风景。',
    '城市的脉搏，在街头巷尾跳动。',
    '人间百态，市井长巷，聚拢是烟火。',
    '街头一瞥，便是人间。'
  ],
  '自然': [
    '天地有大美而不言。',
    '万物并作，吾以观复。',
    '山川异域，风月同天。',
    '云卷云舒，去留无意。',
    '日出而作，日落而息，顺应自然。'
  ],
  '旅行': [
    '在路上，遇见更好的自己。',
    '身体和灵魂，总有一个在路上。',
    '读万卷书，行万里路。',
    '山水之间，寻找心灵的归宿。',
    '远方不远，就在脚下。'
  ],
  '活动': [
    '人间烟火，热闹非凡。',
    '欢声笑语，定格美好时光。',
    '热闹是他们的，也是我们的。',
    '光影流转，欢乐永恒。',
    '此时此刻，便是永恒。'
  ],
  '静物': [
    '静物无言，却有千言。',
    '岁月静物，时光不语。',
    '一器一物，皆有温度。',
    '静水流深，物我两忘。',
    '简约之美，在于留白。'
  ]
};

// 通用模板（当分类不匹配时）
const genericTemplates = [
  '光影交错，时光静好。',
  '一帧一世界，一眼一浮生。',
  '定格瞬间，留住永恒。',
  '镜头之下，自有诗意。',
  '画面无声，却道尽千言万语。',
  '光影为墨，岁月成诗。',
  '此中有真意，欲辨已忘言。',
  '一眼万年，定格美好。',
  '画面虽静，故事却在流动。',
  '光影之间，藏着生活的答案。'
];

// 根据标签选择更贴切的描述
const tagBasedDepicts = {
  '火焰': '火光跃动，如舞动的精灵，照亮黑夜。',
  '日落': '夕阳无限好，只是近黄昏。',
  '日出': '旭日东升，万物苏醒。',
  '海景': '面朝大海，春暖花开。',
  '山脉': '会当凌绝顶，一览众山小。',
  '雪景': '忽如一夜春风来，千树万树梨花开。',
  '雨': '天街小雨润如酥，草色遥看近却无。',
  '雾': '雾失楼台，月迷津渡。',
  '花': '花开堪折直须折，莫待无花空折枝。',
  '月亮': '举杯邀明月，对影成三人。',
  '星空': '醉后不知天在水，满船清梦压星河。',
  '河流': '逝者如斯夫，不舍昼夜。',
  '桥梁': '一桥飞架南北，天堑变通途。',
  '寺庙': '曲径通幽处，禅房花木深。',
  '古镇': '小桥流水人家，古道西风瘦马。'
};

// 从描述中提取关键词来生成更贴切的 depict
function extractKeywords(description) {
  if (!description) return [];
  const keywords = [];
  const patterns = [
    /(火焰|火光|火)/, /(山|峰|岭|峦)/, /(水|江|河|湖|海|溪)/,
    /(云|雾|霞|霜|雪|雨)/, /(花|草|树|木|林|森)/,
    /(日|月|星|光|影)/, /(古|旧|老|陈)/, /(夜|晚|暮|夕)/,
    /(城|镇|村|街)/, /(人|物|景)/
  ];
  patterns.forEach((p, i) => {
    if (p.test(description)) keywords.push(i);
  });
  return keywords;
}

// 生成 depict
function generateDepict(analysis, index) {
  const { tags, category, description } = analysis;
  
  // 1. 先检查是否有特定标签匹配
  for (const tag of tags || []) {
    if (tagBasedDepicts[tag]) {
      return tagBasedDepicts[tag];
    }
  }
  
  // 2. 根据分类选择模板
  const templates = depictTemplates[category] || genericTemplates;
  
  // 3. 使用多种因素生成哈希
  const hash = analysis.photoId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  // 4. 从描述中提取关键词，增加变化
  const keywords = extractKeywords(description);
  const keywordSum = keywords.reduce((a, b) => a + b, 0);
  
  // 5. 综合多种因素选择模板
  const variation = Math.abs(hash + index * 31 + (category?.length || 0) * 7 + keywordSum * 13);
  const templateIndex = variation % templates.length;
  
  return templates[templateIndex];
}

async function main() {
  console.log('🎨 Generating depict for existing analyses...\n');
  
  // 读取缓存
  const cachePath = path.resolve(CACHE_PATH);
  const data = await fs.readJson(cachePath);
  
  let updated = 0;
  let skipped = 0;
  
  // 为每个分析生成 depict
  for (const [key, analysis] of Object.entries(data)) {
    if (analysis.depict) {
      skipped++;
      continue;
    }
    
    analysis.depict = generateDepict(analysis, updated);
    updated++;
  }
  
  // 保存回缓存
  await fs.writeJson(cachePath, data, { spaces: 2 });
  
  console.log(`✅ Done!`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped (already has depict): ${skipped}`);
  console.log(`   Total: ${Object.keys(data).length}`);
  
  // 显示几个示例
  console.log('\n📖 Sample depicts:');
  const samples = Object.values(data).slice(0, 5);
  samples.forEach((a, i) => {
    console.log(`   ${i + 1}. [${a.category}] ${a.depict}`);
  });
}

main().catch(console.error);
