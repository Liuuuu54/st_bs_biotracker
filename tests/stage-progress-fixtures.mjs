import { createDefaultFemaleState } from '../scripts/state.js';

export function progressProfile(stage, { days = 0, bio = {}, pregnant = {}, base = {}, experience = {} } = {}) {
  const p = createDefaultFemaleState('进度测试').profile;
  Object.assign(p.base, { stage, days, race: '人类', vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], isHere: false }, base);
  Object.assign(p.bio, { menstrualLengthRatio: 1, birthDifficulty: 1, recoveryDays: 56, gestationModifierMultiplier: 1 }, bio);
  const starts = { 孕早期: 0, 孕中期: 98, 孕晚期: 196, 临产期: 259, 逾期: 294, 延产期: 294 };
  const isPregnant = Object.hasOwn(starts, stage) || ['产兆前驱', '第一产程', '第二产程', '第三产程'].includes(stage);
  Object.assign(p.pregnant, {
    effectivePregnantDays: isPregnant ? (starts[stage] ?? 266) + days : 0,
    pregnantDays: isPregnant ? Math.max(0.001, (starts[stage] ?? 266) + days - 14) : 0,
    fetuses: isPregnant ? [{ embryoId: 1, fathers: '凯', race: '人类', embryoType: '胎生', weight: 1, tendencyAngle: 0, descentStage: -1 }] : [],
    effectiveLaborHours: 0, laborPhase: null, prodromalRemainingHours: 48,
  }, pregnant);
  Object.assign(p.experience, experience);
  return p;
}

// Independent UI examples: expected fractions and displayed units are deliberate fixture values.
export function stageProgressFixtures() {
  const cases = [];
  const add = (id, stage, options, text, fill, bar = true) => cases.push({ id, stage, profile: progressProfile(stage, options), text, fill, bar });
  for (const [stage, cap] of [['卵泡期',9],['排卵期',2],['黄体期',12],['月经期',5]]) {
    add(`${stage}-start`,stage,{days:0},`0 / ${cap} 天`,0);
    add(`${stage}-half`,stage,{days:cap/2},`${cap/2} / ${cap} 天`,50);
  }
  for (const [stage, cap] of [['孕早期',98],['孕中期',98],['孕晚期',63],['临产期',35]]) {
    add(`${stage}-half`,stage,{days:cap/2},`${cap/2} / ${cap} 天`,50);
    add(`${stage}-end`,stage,{days:cap},`${cap} / ${cap} 天`,100);
  }
  add('逾期','逾期',{days:12.5},'12.5 天',null,false);
  add('首次延产','延产期',{days:35,pregnant:{extensionUntilDays:364}},'35 / 70 天',50);
  add('再次延产','延产期',{days:49,pregnant:{extensionUntilDays:392}},'49 / 98 天',50);
  add('假孕','假孕期',{days:0,pregnant:{pregnantDays:42}},'42 / 84 天',50);
  add('回归','回归期',{pregnant:{wombReturn:{totalHours:48,remainingHours:24}}},'24 / 48 小时',50);
  add('前驱','产兆前驱',{pregnant:{prodromalRemainingHours:24}},'24 / 48 小时',50);
  add('第一潜伏','第一产程',{pregnant:{laborPhase:'潜伏期',effectiveLaborHours:3}},'3 / 12 小时',25);
  add('第一活跃','第一产程',{pregnant:{laborPhase:'活跃期',effectiveLaborHours:2.1}},'8.1 / 12 小时',67.5);
  add('第一过渡','第一产程',{pregnant:{laborPhase:'过渡期',effectiveLaborHours:0.9}},'11.1 / 12 小时',92.5);
  add('第二下降','第二产程',{pregnant:{laborPhase:'胎体下降',effectiveLaborHours:0.6,laborBirthNumber:1}},'0.6 / 1.2 小时',50);
  add('第二娩出','第二产程',{pregnant:{laborPhase:'胎体娩出',effectiveLaborHours:0.4,laborBirthNumber:1}},'0.4 / 0.8 小时',50);
  add('第二间歇','第二产程',{pregnant:{laborPhase:'间歇期',effectiveLaborHours:0.25,laborBirthNumber:1}},'0.25 / 0.5 小时',50);
  add('第三器官','第三产程',{pregnant:{laborPhase:'供养器官娩出',effectiveLaborHours:0.25,fetuses:[]}},'0.25 / 2.5 小时',10);
  add('第三观察','第三产程',{pregnant:{laborPhase:'产后观察',effectiveLaborHours:1,fetuses:[]}},'1.5 / 2.5 小时',60);
  add('产后','产后恢复',{days:10},'10 / 56 天',100*10/56);
  add('无经期','无经期',{},'本阶段无计时进度',null,false);
  add('未激活','未激活',{},'本阶段无计时进度',null,false);
  add('零天恢复','产后恢复',{bio:{recoveryDays:0}},'无需恢复',null,false);
  return cases;
}
