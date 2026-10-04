import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveFetusAncestry, getBloodlineInfo, normalizeBloodline, formatBloodline, parseRaceDescriptor,
  getMergedRacePhysiologyProfile, getRacePhysiologyProfile, getCompanionEggsMeanByRace,
  mergeFetusAncestry, getEmbryoTypeByRace } from '../scripts/race_config.js';
import { migrateCharacters, normalizeCharacterBloodlines } from '../scripts/state_migration.js';
import { createDefaultFemaleState, createEmptyChatState } from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { applyRegistryResult, applyRegistryChildInheritance } from '../scripts/registry.js';
import { buildLineageView } from '../scripts/lineage_view.js';
import { calculateOffspringPreview } from '../scripts/calculator.js';

const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);
function character(name,race,bloodline){const c=createDefaultFemaleState(name);c.initialized=true;c.profile.base.race=race;Object.assign(c.profile.base,getBloodlineInfo(race,bloodline));c.profile.base.stage='卵泡期';Object.assign(c.profile.bio,getMergedRacePhysiologyProfile(race,c.profile.base.bloodline));return c}

test('同族份额相加，半精灵回交后为四分之一，之后逐代减半而非去重均分',()=>{
 let child=deriveFetusAncestry('精灵','人类');assert.deepEqual(child.bloodline,{人类:0.5,精灵:0.5});
 child=deriveFetusAncestry(child,'人类');assert.deepEqual(child.bloodline,{人类:0.75,精灵:0.25});
 for(let i=0;i<12;i++)child=deriveFetusAncestry(child,'人类');close(child.bloodline.精灵,0.25/4096);
 close(Object.values(child.bloodline).reduce((a,b)=>a+b,0),1);assert.equal(child.bloodlineSource,'inherited');
 assert.deepEqual(deriveFetusAncestry('人类','人类').bloodline,{人类:1});
});
test('比例字串、百分比与部分未知；衍生不占种族份额',()=>{
 for(const value of ['1/4精灵x3/4人类','精灵25%x人类75%','25%精灵×75%人类'])assert.deepEqual(parseRaceDescriptor(value).bloodline,{精灵:0.25,人类:0.75});
 const d=parseRaceDescriptor('[血族]1/4精灵x人类');assert.equal(d.race,'精灵x人类');assert.equal(d.derivedType,'血族');assert.deepEqual(d.bloodline,{精灵:0.25,人类:0.75});
 assert.deepEqual(parseRaceDescriptor('1/4精灵').bloodline,{精灵:0.25,未知:0.75});
 assert.equal(getMergedRacePhysiologyProfile('1/4精灵').hasUnknownRace,true);
});
test('旧字串按基种族均分并标注推定，同基装饰子项不重复加权',()=>{
 const old=getBloodlineInfo('精灵x人类');assert.equal(old.bloodlineSource,'estimated');assert.deepEqual(old.bloodline,{精灵:0.5,人类:0.5});
 assert.match(formatBloodline('精灵x人类'),/比例推定/);
 assert.deepEqual(normalizeBloodline('兽耳族-兔x人类x兽耳族-猫'),{'兽耳族-兔':0.25,'兽耳族-猫':0.25,人类:0.5});
 const inherited=deriveFetusAncestry('精灵x人类','人类');assert.equal(inherited.bloodlineSource,'estimated');close(inherited.bloodline.精灵,0.25);
});
test('非法份额与过期种族键不污染结果，零比例不参与胚型选择',()=>{
 for(const raw of [{精灵:NaN,人类:1},{精灵:-1,人类:2},{精灵:Infinity},{矮人:1},[]])assert.deepEqual(normalizeBloodline('精灵x人类',raw),{精灵:0.5,人类:0.5});
 assert.deepEqual(normalizeBloodline('精灵x人类',{精灵:25,人类:75}),{精灵:0.25,人类:0.75});
 assert.equal(getEmbryoTypeByRace('人类x水母族',{人类:1,水母族:0}),'胎生');
});
test('常规数值按比例算术加权，孕期按天数加权而非速度平均',()=>{
 const weights={精灵:0.25,人类:0.75};const profile=getMergedRacePhysiologyProfile('精灵x人类',weights);
 close(280/profile.gestationSpeciesSpeed,350);
 for(const field of ['birthDifficulty','breedTolerance','impregnationDifficulty','menstrualLengthRatio','identicalProbability','recoveryCoefficient'])close(profile[field],getRacePhysiologyProfile('精灵')[field]*0.25+getRacePhysiologyProfile('人类')[field]*0.75);
 // 双性要占 25% 以上才固定：零点几成的祖先血统不再让每一代都是双性
 assert.equal(getMergedRacePhysiologyProfile('史萊姆x人类',{史萊姆:0.25,人类:0.75}).genderRatio,null);
 assert.equal(getMergedRacePhysiologyProfile('史萊姆x人类').genderRatio,null,'旧资料均分仍是双性');
 assert.equal(getMergedRacePhysiologyProfile('史萊姆x人类',{史萊姆:0.01,人类:0.99}).genderRatio,getRacePhysiologyProfile('人类').genderRatio);
 assert.equal(getMergedRacePhysiologyProfile('史萊姆x人类',{史萊姆:0.2,人类:0.8}).genderRatio,getRacePhysiologyProfile('人类').genderRatio,'低于门槛时按其余成分的性别比');
 const eggs=getCompanionEggsMeanByRace('鸟人x龟族',{鸟人:0.25,龟族:0.75});close(eggs+1,(getRacePhysiologyProfile('鸟人').companionEggsMean+1)**0.25*(getRacePhysiologyProfile('龟族').companionEggsMean+1)**0.75);
});
test('特殊核型保留被选遗传方的全部比例；双特殊核型各半',()=>{
 const half={race:'精灵x人类',bloodline:{精灵:0.25,人类:0.75}};
 assert.deepEqual(deriveFetusAncestry(half,'哥布林').bloodline,{哥布林:1});
 assert.deepEqual(deriveFetusAncestry(half,'媚魔').bloodline,half.bloodline);
 assert.deepEqual(deriveFetusAncestry('媚魔',half).bloodline,{媚魔:1});
 assert.deepEqual(deriveFetusAncestry('心魇','媚魔').bloodline,{媚魔:0.5,心魇:0.5});
});
test('三源嵌合体按来源数保留三分之一，融合顺序不影响比例',()=>{
 const a={race:'精灵'},b={race:'人类'},c={race:'矮人'};
 const ab={race:'精灵x人类',...mergeFetusAncestry([a,b]),chimera:{sourceCount:2}};
 const abc=mergeFetusAncestry([ab,c]);for(const value of Object.values(abc.bloodline))close(value,1/3);
});
test('v4存档与重复正規化保留比例、未知栏位、旧生理值和嵌套记录',()=>{
 const c=character('A','精灵x人类',{精灵:0.25,人类:0.75});c.profile.base.note='保留';c.profile.children=[{id:'old',race:'精灵x人类',extra:3}];c.profile.pregnant.fetuses=[{race:'人类',fatherRace:'精灵x人类'}];
 const bio=structuredClone(c.profile.bio);migrateCharacters({A:c},4);const once=structuredClone(c);normalizeCharacterBloodlines(c);assert.deepEqual(c,once);assert.deepEqual(c.profile.bio,bio);assert.equal(c.profile.base.note,'保留');assert.equal(c.profile.children[0].extra,3);assert.equal(c.profile.children[0].bloodlineSource,'estimated');assert.deepEqual(c.profile.base.bloodline,{精灵:0.25,人类:0.75});
});
test('注册明确比例后生理为四分之一加权；重新注册与孩子继承不退回均分',()=>{
 const chat=createEmptyChatState();applyRegistryResult(chat,{name:'A',profile:{base:{race:'1/4精灵x3/4人类'}}});
 const c=chat.characters.A;assert.deepEqual(c.profile.base.bloodline,{精灵:0.25,人类:0.75});close(280/c.profile.bio.gestationSpeciesSpeed,350);
 applyRegistryResult(chat,{name:'A',profile:{base:{race:'精灵x人类'}}});close(chat.characters.A.profile.base.bloodline.精灵,0.25);
 chat.characters.A.profile.children=[{race:'精灵x人类',bloodline:{精灵:0.125,人类:0.875},bloodlineSource:'inherited'}];chat.characters.B=character('B','人类');
 applyRegistryChildInheritance(chat,'B',{motherName:'A',childIndex:0});close(chat.characters.B.profile.base.bloodline.精灵,0.125);close(280/chat.characters.B.profile.bio.gestationSpeciesSpeed,315);
});
test('代孕按卵源血脉与父源计算，出生后与族谱继续保留25%',()=>{
 const chat=createEmptyChatState();chat.characters.宿主=character('宿主','矮人');chat.characters.卵源=character('卵源','精灵x人类',{精灵:0.5,人类:0.5});chat.characters.父亲=character('父亲','人类');
 const result=applyToolCall(chat,{name:'bsImplantEmbryo',arguments:{female:'宿主',provider:'卵源',fathers:'父亲',fatherRace:'人类'}});assert.equal(result.applied,true);
 const fetus=chat.characters.宿主.profile.pregnant.fetuses[0];close(fetus.bloodline.精灵,0.25);close(fetus.bloodline.人类,0.75);assert.ok(!('矮人' in fetus.bloodline));
 chat.characters.宿主.profile.base.stage='第二产程';chat.characters.宿主.profile.pregnant.effectivePregnantDays=280;
 const birth=applyToolCall(chat,{name:'bsChildbirth',arguments:{female:'宿主'}});assert.equal(birth.applied,true);
 const child=chat.characters.卵源.profile.children[0]||chat.characters.宿主.profile.children[0];assert.ok(child);close(child.bloodline.精灵,0.25);
 const view=buildLineageView(chat,'卵源');assert.ok(view.nodes.some(n=>n.bloodlineLabel.includes('精灵 25%')));
});
test('后代计算器与正式生理共用血脉比例',()=>{
 const preview=calculateOffspringPreview({eggRace:'精灵50%x人类50%',spermRace:'人类'});close(preview.bloodline.精灵,0.25);close(280/preview.gestationSpeciesSpeed,350);
});

test('注册孕中孕按宿主胎儿的血脉计算，阵列顺序与承载者种族不影响结果',()=>{
 const chat=createEmptyChatState();applyRegistryResult(chat,{name:'承载者',profile:{base:{race:'矮人',stage:'孕中期'},pregnant:{pregnantDays:100,fetuses:[
  {race:'精灵x人类',fatherRace:'人类',tags:['nested'],nestedInIndex:1},
  {race:'精灵x人类',bloodline:{精灵:0.5,人类:0.5},embryoType:'胎生'},
 ]}}});
 const nested=chat.characters.承载者.profile.pregnant.fetuses[0];close(nested.bloodline.精灵,0.25);close(nested.bloodline.人类,0.75);assert.ok(!('矮人' in nested.bloodline));
});

test('the race prompt sends one weighted block per race and share, listing every owner', async () => {
  const { buildRacePhysiologyPrompt } = await import('../scripts/race_prompt_context.js');
  const quarter = { race: '精灵x人类', bloodline: { 精灵: 0.25, 人类: 0.75 }, bloodlineSource: 'inherited' };
  const prompt = buildRacePhysiologyPrompt({ existing_state: {
    甲: { profile: { base: { ...quarter }, pregnant: { fetuses: [{ ...quarter }, { ...quarter }, { ...quarter }] } } },
    乙: { profile: { base: { ...quarter } } },
  } });
  assert.equal(prompt.match(/【混血加权参考】/g)?.length, 1, '三胞胎与另一名同比例角色只出一块');
  assert.match(prompt, /【甲、乙 \/ 精灵x人类】/);
});

test('混血胚型：占比最高者决定，平手取孕期较长者，再平手取母系占比较高者', async () => {
  // 占比决定：深潜者（卵生、孕期较短）占多数时就是卵生，不再一律取孕期最长的人类
  assert.equal(getEmbryoTypeByRace('深潜者x人类', { 深潜者: 0.75, 人类: 0.25 }), '卵生');
  assert.equal(getEmbryoTypeByRace('深潜者x人类', { 深潜者: 0.25, 人类: 0.75 }), '胎生');
  // 平手看孕期：人类孕期较长（速度 1 < 1.25）
  assert.equal(getEmbryoTypeByRace('深潜者x人类', { 深潜者: 0.5, 人类: 0.5 }), '胎生');
  // 占比与孕期都平手：找一对孕期速度相同、胚型不同的内置种族，交给母系决定
  const { ALL_BUILTIN_RACES } = await import('../scripts/race_config.js');
  const speed = (race) => getMergedRacePhysiologyProfile(race).gestationSpeciesSpeed;
  let pair = null;
  for (const a of ALL_BUILTIN_RACES) for (const b of ALL_BUILTIN_RACES) {
    if (!pair && a < b && speed(a) === speed(b) && getEmbryoTypeByRace(a) !== getEmbryoTypeByRace(b)) pair = [a, b];
  }
  assert.ok(pair, '需要一对孕期速度相同、胚型不同的种族');
  const [a, b] = pair; const half = { [a]: 0.5, [b]: 0.5 };
  assert.equal(getEmbryoTypeByRace(`${a}x${b}`, half, { [b]: 1 }), getEmbryoTypeByRace(b));
  assert.equal(getEmbryoTypeByRace(`${a}x${b}`, half, { [a]: 1 }), getEmbryoTypeByRace(a));
  assert.equal(getEmbryoTypeByRace(`${b}x${a}`, { [b]: 0.5, [a]: 0.5 }, { [a]: 0.5, 人类: 0.5 }), getEmbryoTypeByRace(a));
});
