# Issue 草稿（尚未发布）

建议标题：同一物理精源的记录拆分会改变受精结果，面板/实际留存也存在粒度差异

## 版本

BioTracker 1.2.1，commit `78b34f459ea681b6630b4a2f198ae50ee5e02f73`。

## 现象与最小复现

同族人类、品质1、容积倍率1、暴露24小时，调用原 `calculateFertilizationPreview`：

```js
import { calculateFertilizationPreview as preview } from './scripts/calculator.js';
const run = (amounts) => preview({
  eggRace: '人类', elapsedDays: 1, uterusVolumeFactor: 1,
  spermSources: amounts.map((value) => ({ male: '同一精方', race: '人类', value, quality: 1 })),
}).successChance;
console.log(run([20]), run([10, 10]));
console.log(run([40]), run([20, 20]));
```

| 输入记录 | 现有概率 |
| --- | ---: |
| 一条20 | 22.880007% |
| 两条10，同一总量/来源 | 18.200828% |
| 一条40 | 32.757365% |
| 两条20，同一总量/来源 | 28.384712% |

这些是独立模块结果，非浏览器或真实存档统计。

## 静态调用链

1. `scripts/calculator.js` 逐source模拟固定日流失，得到暴露面积，再计算共同剂量加成。
2. 来源份额乘在指数概率外，然后 `1-∏(1-chance_i)`，因此同一面积拆成更多份本身也会稀释结果。
3. `scripts/tools.js` 的正式受精优先展开 `spermContacts`，但实际清除读取按名字聚合的 `base.sperms`。
4. `index.js` 24h预览又直接读取聚合行。一次40与两次20可以走到不同输入粒度。
5. 同名后续deposit把聚合行quality覆盖成新品质，旧contact仍保留旧品质，清除与受精采用不同品质。
6. 每次登记后同比裁容量同样影响拆分：容量20、旧A20，新B20一次后A10/B10；拆B10两次后A8.8889/B11.1111。

## 希望满足的不变量

- 同刻、同品质、同生理参数的20与10+10，作为相同已入体物理量时，总残留/受精机会相同。
- 来源记录保留，不依赖数组顺序；修改精方档案不改既有沉积快照。
- 同一存档和随机状态下，24小时一次推进、24次1小时、1440次1分钟，受精分钟和父方相同。
- 区分真实时间间隔、不同品质/相容性、独立避孕事件与单纯记账拆分。

## 提议

先讨论一套默认关闭的实验性混合池，避免直接改所有旧存档平衡：

- 物理流失由整池共享，品质影响各份额清除。
- 统一连续hazard，来源份额分配瞬时风险而非最终概率。
- 每卵保存固定随机阈值，使用绝对分钟网格；真实首次事件选父方。
- 连续混匀溢出使同种流入分次一致。
- 保留canonical逐次快照，聚合行仅作视图；预测与正式内核同源。

对应实现/性质证明与限制见本fork `docs/proposals/pooled-conception.md`；完整工具dispatcher验证覆盖伴生卵、流干后父系关联、孕中孕及隐藏事件提示，不只测试数学helper。默认legacy保持。

希望先确认这些不变量与玩法取舍，再决定是否合入实验入口或拆成更小的修复。新公式属于平衡变化，不宣称医学真实性，也不把Node测试当宿主浏览器端到端。
