// Reproduction against the unchanged legacy branch plus the opt-in proposed model.
// Run: node tests/repro_sperm_pool.mjs
import { calculateFertilizationPreview } from '../scripts/calculator.js';
const percent = (p) => `${(p * 100).toFixed(6)}%`;
const cases = [
  ['1×20', [20]], ['2×10 (same total)', [10, 10]],
  ['1×40', [40]], ['2×20 (same total)', [20, 20]],
];
console.table(cases.map(([input, amounts]) => {
  const options = { eggRace: '人类', elapsedDays: 1, uterusVolumeFactor: 1,
    spermSources: amounts.map((value) => ({ male: 'same-donor', race: '人类', value, quality: 1 })) };
  return { input, legacy: percent(calculateFertilizationPreview(options).successChance),
    pooled: percent(calculateFertilizationPreview({ ...options, model: 'pooled-v1' }).successChance) };
}));
console.log('These are single-egg, no-new-input mathematical projections, not browser/clinical results.');
