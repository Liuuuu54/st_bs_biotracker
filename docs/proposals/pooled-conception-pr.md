# PR 说明

标题：feat: add opt-in pooled conception with minute-stable sampling

## 概要

为角色增加显式、默认关闭的实验性 `pooled-v1` 模式，修正同一物理量因source/contact拆分而改变生理结算的问题。旧角色与旧算法默认保持，不全局替换平衡。

## 主要改动

- 无宿主依赖的混合池数学内核：共享品质流失、连续混匀溢出、连续hazard及真实竞争风险积分。
- 独立逐次来源与冻结快照；按名字聚合只作视图，不再反向覆盖contact品质。
- 前向迁移、单调卵/来源ID、持久随机预算、绝对分钟网格。
- 接入实际 `bsAddSperm` / `bsPassedTime` / 既有冲洗与事后避孕路径，事件在推进时形成并回执。
- `24h / 24×1h / 1440×1min` 固定状态与seed下得到相同受精分钟、父方和冻结胎儿数据。
- 伴生卵剂量按胜出的父方/语义快照组聚合，避免同源20拆成10+10改变伴生卵数。
- 保留原孕中孕宿主门槛和隐藏异期胎不发受精cue的规则。
- 角色完整变量页显式启用，启用前后保存快照；模式内随机种子/阈值/审计字段不进入模型提示词。
- 静态24h预览读取canonical contacts与同一个积分内核；明确不模拟未来行动/阶段变化或新增卵。

## 有意的平衡变化

- 取消0.5剂量加成地板，微量风险趋零，保留上限2。
- 同族人类单条20/q1首日22.8800%→22.7852%，换取连续积分与拆分一致。
- 满池采用连续混匀溢出，不再保留旧逐次比例裁剪结果。
- 实验模式单次时间推进要求整数分钟、最多31天，超出先整体验证再返回，不部分推进。
- 混合池清除不是细胞绝对寿命模型；原代谢、着床、分娩系统不在此PR整体重构。

## 验证

```sh
node tests/repro_sperm_pool.mjs
node --test tests/sperm_pool.test.mjs tests/pooled_reproduction.test.mjs tests/pooled_tools.test.mjs tests/pooled_ui_contract.test.mjs
node --test tests/*.test.mjs
```

- 原基线 **1128/1128**。
- 新增 **62项**；最终全量 **1190/1190，0失败、0跳过**。
- 覆盖混品质/混相容性、独立RK参考、拆分/排列/时间半群、满池/部分满池、守恒、微量、固定seed、JSON重启、真实dispatcher、伴生卵、nested/隐藏cue、流干后父系/避孕链接、提示词白名单与legacy不变。
- 语法及 `git diff --check` 通过。
- Node缺少宿主外部模块时仍有原有fallback日志；未进行SillyTavern浏览器端到端或长期存档压力验收。

## 迁移/回退

- 只在显式启用时从当前分钟向后迁移，不重估旧品质、不重抽既有胎儿。
- source/egg随机状态进完整存档及楼层快照，不放会被快照剔除的runtime。
- 回退请恢复启用前备份/快照，不直接删模式字段并让旧算法解释新残量。

## 审查建议

本PR可先作为实验性分支讨论；若维护者倾向更小改动，可将纯数学/性质测试、逐次快照、实际时钟接线与UI分别审查。方案完整解释见 `docs/proposals/pooled-conception.md`，问题复现正文见 `docs/proposals/pooled-conception-issue.md`。
