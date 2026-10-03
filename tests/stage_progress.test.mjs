import assert from 'node:assert/strict';
import test from 'node:test';
import { getStageProgress, formatProgressNumber } from '../scripts/stage_progress.js';
import { getStageLimit, getPseudoPregnancyLimit, applyToolCall } from '../scripts/tools.js';
import { createEmptyChatState, derivePregnancyStageState } from '../scripts/state.js';
import { progressProfile, stageProgressFixtures } from './stage-progress-fixtures.mjs';
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('monthly progress reaches the actual engine threshold with ratio and trait fluctuations', () => {
  for (const stage of ['卵泡期','排卵期','黄体期','月经期']) {
    for (const base of [{},{vitalityLevel:1,psyStressLevel:7}]) {
      const p = progressProfile(stage,{base,bio:{menstrualLengthRatio:1.7}});
      const limit = getStageProgress(p).max;
      assert.equal(limit,getStageLimit(p,stage));
      const s = createEmptyChatState();s.characters.A={name:'A',initialized:true,profile:p,runtime:{}};
      p.base.days=limit-2/1440;
      applyToolCall(s,{name:'bsPassedTime',arguments:{minute:1}});
      assert.equal(s.characters.A.profile.base.stage,stage);
      applyToolCall(s,{name:'bsPassedTime',arguments:{minute:2}});
      assert.notEqual(s.characters.A.profile.base.stage,stage);
    }
  }
});

test('pregnancy bars use the four effective-day intervals and their engine boundaries', () => {
  for (const [stage,start,max] of [['孕早期',0,98],['孕中期',98,98],['孕晚期',196,63],['临产期',259,35]]) {
    const p=progressProfile(stage,{days:max/2,bio:{gestationModifierMultiplier:0.1}});
    const progress=getStageProgress(p);assert.equal(progress.max,max);assert.equal(progress.value,max/2);
    assert.equal(derivePregnancyStageState(start+max/2).stage,stage);
    assert.equal(derivePregnancyStageState(start+max).stage,stage);
    assert.notEqual(derivePregnancyStageState(start+max+0.001).stage,stage);
    p.bio.gestationModifierMultiplier=0;assert.deepEqual(getStageProgress(p),progress);
  }
});

test('pseudo progress reads pregnancy actual days rather than the stale base-day clock', () => {
  const p=progressProfile('假孕期',{days:0,pregnant:{pregnantDays:42}});
  assert.deepEqual(getStageProgress(p),{label:'假孕进度',value:42,max:84,unit:'d'});
  p.bio.gestationModifierMultiplier=2;assert.equal(getStageProgress(p).max,168);
  assert.equal(getStageProgress(p).max,getPseudoPregnancyLimit(p));
  const s=createEmptyChatState();s.characters.A={name:'A',initialized:true,profile:p,runtime:{}};
  p.pregnant.pregnantDays=168-1/1440;
  applyToolCall(s,{name:'bsPassedTime',arguments:{minute:2}});
  assert.equal(s.characters.A.profile.base.stage,'月经期');
});

test('womb-return progress uses total minus remaining hours, with explicit instant and missing timing', () => {
  const p=progressProfile('回归期',{days:99,pregnant:{wombReturn:{totalHours:72,remainingHours:20}}});
  const x=getStageProgress(p);assert.equal(x.value,52);assert.equal(x.max,72);assert.equal(x.unit,'h');
  p.pregnant.wombReturn={totalHours:0,remainingHours:0};assert.equal(getStageProgress(p).max,0);
  delete p.pregnant.wombReturn;assert.equal(getStageProgress(p),null);
});

test('first labor stage accumulates phase offsets with the actual parity modifier', () => {
  const p=progressProfile('第一产程',{experience:{naturalBirthExperience:2},pregnant:{laborPhase:'活跃期',effectiveLaborHours:1}});
  near(getStageProgress(p).max,8.4);near(getStageProgress(p).value,5.2);
  p.pregnant.laborPhase='过渡期';near(getStageProgress(p).value,8.14);
  p.pregnant.laborPhase='unknown';near(getStageProgress(p).value,1);assert.equal(getStageProgress(p).phase,'潜伏期');
});

test('second labor stage shows the exact current phase, including fractional intervals and an empty fallback', () => {
  const p=progressProfile('第二产程');
  for(const [phase,max] of [['胎体下降',1.2],['胎体娩出',0.8],['间歇期',0.5]]) {
    p.pregnant.laborPhase=phase;near(getStageProgress(p).max,max);
  }
  p.pregnant.laborPhase='胎体下降';p.pregnant.fetuses[0].weight=1.5;p.pregnant.fetuses[0].tendencyAngle=180;
  near(getStageProgress(p).max,2.7);
  p.pregnant.fetuses=[];near(getStageProgress(p).max,1.2);
});

test('third labor stage includes organ time plus observation without ceiling fractional hours', () => {
  const p=progressProfile('第三产程',{pregnant:{laborPhase:'供养器官娩出',effectiveLaborHours:0.25,fetuses:[]}});
  near(getStageProgress(p).value,0.25);near(getStageProgress(p).max,2.5);
  p.pregnant.laborPhase='产后观察';p.pregnant.effectiveLaborHours=1;
  near(getStageProgress(p).value,1.5);
  p.bio.birthDifficulty=4;near(getStageProgress(p).max,10);near(getStageProgress(p).value,3);
});

test('prodromal missing countdown starts at zero; delaying past the initial window does not fabricate negative progress', () => {
  const p=progressProfile('产兆前驱',{bio:{birthDifficulty:2},pregnant:{prodromalRemainingHours:48}});
  assert.equal(getStageProgress(p).max,96);assert.equal(getStageProgress(p).value,48);
  p.pregnant.prodromalRemainingHours=120;assert.equal(getStageProgress(p).value,0);
  delete p.pregnant.prodromalRemainingHours;assert.equal(getStageProgress(p).value,0);
});

test('postpartum uses the saved actual duration, its fallback and a legitimate zero duration', () => {
  const p=progressProfile('产后恢复',{days:10});assert.equal(getStageProgress(p).max,56);
  p.bio.recoveryDays=84;assert.equal(getStageProgress(p).max,84);
  delete p.bio.recoveryDays;assert.equal(getStageProgress(p).max,56);
  p.bio.recoveryDays=0;assert.equal(getStageProgress(p).max,0);
});

test('postterm has no invented maximum; extensions include all days since week 42 and reject absent limits', () => {
  const p=progressProfile('逾期',{days:40});assert.equal(getStageProgress(p).unbounded,true);
  p.base.stage='延产期';p.pregnant.extensionUntilDays=364;assert.equal(getStageProgress(p).max,70);
  p.pregnant.extensionUntilDays=392;assert.equal(getStageProgress(p).max,98);
  for(const value of [null,undefined,NaN,100]){p.pregnant.extensionUntilDays=value;assert.equal(getStageProgress(p).unbounded,true);}
});

test('untimed and unknown stages do not get the old one-day progress fallback', () => {
  for(const stage of ['无经期','未激活','unknown',''])assert.equal(getStageProgress(progressProfile(stage)),null);
});

test('every UI fixture is read-only and fractional duration formatting preserves useful precision', () => {
  for(const {profile} of stageProgressFixtures()) {
    const before=JSON.stringify(profile);getStageProgress(profile);assert.equal(JSON.stringify(profile),before);
  }
  for(const [value,expected] of [[0,'0'],[0.25,'0.25'],[0.5,'0.5'],[8.4,'8.4'],[14.123456,'14.12']])assert.equal(formatProgressNumber(value),expected);
});
