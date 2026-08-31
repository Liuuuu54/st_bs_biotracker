<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

Project Documentation Rules

完成重要开发任务后，必须主动检查并同步项目文档。

优先更新：

- docs/
- README.md
- Changelog.md

根据实际代码记录：

- 项目结构和模块职责
- 核心实现思路
- 重要修改及原因
- API / 接口
- URL / 端口
- 配置
- 启动和开发方式
- 后续开发注意事项

要求：

- 优先更新已有文档，不重复创建
- 以实际代码为准，不猜测
- 重要内容注明文件路径和函数名
- 保持现有 docs/ 文档体系和索引
- 如果代码产生了新的通用开发模式或约定，再同步到 .trellis/spec/
- 不记录密码、Token、API Key
- 不为了写文档修改业务代码

每次完成重要开发任务后，必须检查并同步相关文档。
如果没有需要更新的内容，明确说明无需更新。
