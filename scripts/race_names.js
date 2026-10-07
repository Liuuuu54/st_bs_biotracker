// 种族与衍生类型名称的繁简对照：只收名称里实际用到、繁简不同的字。
// 模型可能用任一字形（甚至混用）写种族名，比对前一律转成简体再查表。
const PAIRS = '类類灵靈尔爾兽獸诺諾马馬猫貓鸟鳥亚亞会會虫蟲触觸龟龜壳殼宝寶潜潛头頭鱼魚独獨蝎蠍罗羅华華蕴蘊'
  + '欧歐龙龍东東狮獅鹫鷲恶惡凤鳳泽澤鲸鯨茧繭莱萊烛燭魇魘梦夢丛叢灯燈体體铠鎧伪偽炼煉导導际際机機变變异異缚縛';

const TO_SIMPLIFIED = new Map();
const TO_TRADITIONAL = new Map();
for (let index = 0; index < PAIRS.length; index += 2) {
  TO_SIMPLIFIED.set(PAIRS[index + 1], PAIRS[index]);
  TO_TRADITIONAL.set(PAIRS[index], PAIRS[index + 1]);
}

const convert = (value, table) => {
  let result = '';
  for (const char of String(value || '')) result += table.get(char) || char;
  return result;
};

export function toSimplifiedName(value) {
  return convert(value, TO_SIMPLIFIED);
}

export function toTraditionalName(value) {
  return convert(value, TO_TRADITIONAL);
}
