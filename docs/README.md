# BS BioTracker 项目文档

欢迎来到 **BS BioTracker** 的技术与功能文档库。本目录旨在为开发者或高级用户提供清晰的代码结构说明与核心逻辑解释，帮助大家在日后快速定位并进行代码修改。

## 目录索引

以下是目前已建立的文档说明：

1. [文件功能与摘要汇总 (file_summary.md)](file_summary.md)
   - 详细列出了项目中每个核心文件、脚本文件的具体定位、职责与主要数据/方法定义。
   - 帮助开发者查找特定功能在哪个文件中实现。

2. [项目工作流与系统运行机制 (system_flow.md)](system_flow.md)
   - 解析了插件如何挂载到 SillyTavern 等宿主环境中。
   - 详细梳理了异步 Tracker 追踪的核心周期、MVU 变量同步门控、以及工具调度（Tools Call）的底层闭环。

3. [种族生理、生命周期与时间流逝逻辑 (race_and_stage.md)](race_and_stage.md)
   - 阐述 5 大胚胎生殖系统（胎生、卵生、卵胎生、胎转卵生、不定型）的核心配置与规则。
   - 解析时间流逝（`bsPassedTime`）对月经阶段、受精着床、孕期及分娩产程的复杂演进逻辑。

4. [技能、衣柜与心智系统 (features_detail.md)](features_detail.md)
   - 介绍技能和天赋系统（成长经验曲线、胎儿天赋转移）。
   - 解析衣柜四维属性与穿着状态对妊娠阻塞/扩容的影响。
   - 细化心智状态（mens 生理常规 / preg 妊娠）的阶段行为与晋升突破限制。

---

## 快速入口
- **项目入口**: [index.js](../index.js)
- **UI 结构**: [settings.html](../settings.html)
- **核心逻辑执行**: [scripts/tools.js](../scripts/tools.js)
- **状态管理器**: [scripts/state.js](../scripts/state.js)
