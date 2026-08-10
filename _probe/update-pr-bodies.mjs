import { execSync } from 'node:child_process';

const REPO = 'Liuuuu54/st_bs_biotracker';
const SECURITY_SECTION = `## 安全审查修复（2026-08-10，防御式编程）

新增安全性修复（独立复核后确认的真实 P1/P2）：

- **P1 mainflow 提示注入**：状态 JSON 序列化后转义 \`</\` 与换行——角色卡/注册内容（描述/日记/种族名）含 \`</bs_biotracker>\` 曾可闭合包裹标签向主线 LLM 注入任意指令（经 setExtensionPrompt 可达主模型）
- **P1 bsPassedTime CPU 冻结**：各分量独立 clamp 后合计可达 2.6e8 分钟 → ~1e9 轮妊娠代谢循环冻结 UI；总量现封顶一年（365 天），上界收敛至 ~3.65M 轮（10-30ms）
- **P2 race 提示注入**：\`<bs_race>\` 高优先级块内全部 8 处 race/derivedType/精子/胎儿插值经消毒（剥离换行/\`</\`/控制字符含 C1 区）
- **P2 API http 明文旁路**：\`assertSafeDirectApiBase\` 改为无条件调用，覆盖 host-proxy 路径（key 经 proxy_password/custom_include_headers 交给 ST 后端的明文风险）
- **P2 toastr HTML sink**：bootstrap 时包装 \`globalThis.toastr\` 四方法，消息/标题经 escapeHtml 转义（ST toastr 以 .html() 插入，角色名/工具消息未转义曾可 DOM XSS）
- **P2 \`__proto__\` 原型污染**：characters 改 \`Object.create(null)\`（\`__proto__\`/constructor 角色名不再污染原型），getChatState 迁移存量 plain-object 并丢弃污染键

新增回归测试（本分支）覆盖上述各项；测试数同步更新。`;

const PRS = [1, 2, 3];
for (const n of PRS) {
  const current = JSON.parse(execSync(`gh api repos/${REPO}/pulls/${n}`, { encoding: 'utf8', env: process.env }));
  let body = current.body || '';
  // 幂等：已有安全段则跳过
  if (body.includes('安全审查修复（2026-08-10')) {
    console.log(`PR#${n}: 已有安全段，跳过`);
    continue;
  }
  body = body.trimEnd() + '\n\n' + SECURITY_SECTION;
  // 更新测试数（181 -> 189）
  body = body.replace(/完整版 181 测试全过/g, '完整版 189 测试全过（含安全回归）');
  const tmp = `_probe/pr-body-${n}.md`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmp, body, 'utf8');
  execSync(`gh api -X PATCH repos/${REPO}/pulls/${n} -f body=@${tmp}`, { encoding: 'utf8', env: process.env });
  console.log(`PR#${n}: body 已更新（head=${current.head.sha.slice(0,7)}）`);
}
