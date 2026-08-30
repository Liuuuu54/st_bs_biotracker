# Journal - ll (Part 1)

> AI development session journal
> Started: 2026-08-30

---



## Session 1: Fix BioTracker Regex Features
<!-- trellis-session: v=2 fp=a33121a4b68e246f -->

**Date**: 2026-08-30
**Task**: Fix BioTracker Regex Features
**Branch**: `main`

### Summary

Resolved login popups by utilizing a clean fetch instance to bypass captured mainflow hooks, refactored settings UI to render regex rules tightly on single rows (including enabled checkbox, type select, text input, move buttons, and delete button), removed current floor preview feature, verified cross-session settings persistence, and updated history_regex.md documentation.

### Git Commits

| Hash | Message |
|------|---------|
| `173d475` | fix(regex): resolve login popups, optimize UI row layout, remove preview, persist rules, and write docs |

### Status

[OK] **Completed**


## Session 2: 优化正则流水线逻辑支持多提取规则并行合并
<!-- trellis-session: v=2 fp=e93246d8af49f873 -->

**Date**: 2026-08-30
**Task**: 优化正则流水线逻辑支持多提取规则并行合并
**Branch**: `main`

### Summary

更新了 processHistoryText 逻辑以在保留中间文本不变的前提下并行提取并合并多个 extract 正则规则，修复了多个正则同时使用时因流水线覆盖而清空非匹配内容的 bug，并编写了对应单元测试与 docs 手册。

### Git Commits

| Hash | Message |
|------|---------|
| `13b70fa` | fix(regex): support multiple extract rules by keeping intermediate text intact |

### Status

[OK] **Completed**
