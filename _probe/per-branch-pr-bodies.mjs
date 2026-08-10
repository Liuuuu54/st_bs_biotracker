import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'Liuuuu54/st_bs_biotracker';
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('GH_TOKEN 缺失');
  process.exit(1);
}

// 各 PR 专属安全段（只列本分支 diff 实际包含的修复）
const SECTIONS = {
  1: `## 安全审查修复（2026-08-10，防御式编程）

本分支包含：

- **P1 mainflow 提示注入**：状态 JSON 序列化后转义 \`</\` 与换行——角色卡/注册内容（描述/日记/种族名）含 \`</bs_biotracker>\` 曾可闭合包裹标签向主线 LLM 注入任意指令（经 setExtensionPrompt 可达主模型）。新增回归测试：mainflow JSON 转义闭合标签与换行。

测试数：本分支 \`node --test tests/*.test.mjs\` 171 全过（含新增注入防线用例）。`,
  2: `## 安全审查修复（2026-08-10，防御式编程）

本分支包含：

- **P2 race 提示注入**：\`<bs_race>\` 高优先级块内全部 8 处 race/derivedType/精子/胎儿插值经消毒（剥离换行/\`</\`/控制字符含 C1 区），恶意种族名无法闭合块注入伪指令。新增回归测试：sperm/胎儿路径注入阻断。
- **P2 toastr HTML sink**：bootstrap 时包装 \`globalThis.toastr\` 四方法，消息/标题经 escapeHtml 转义（ST toastr 以 .html() 插入，角色名/工具消息未转义曾可 DOM XSS）。

测试数：本分支 \`node --test tests/*.test.mjs\` 151 全过（含新增注入用例）。`,
  3: `## 安全审查修复（2026-08-10，防御式编程）

本分支包含：

- **P1 bsPassedTime CPU 冻结**：各分量独立 clamp 后合计可达 2.6e8 分钟 → ~1e9 轮妊娠代谢循环冻结 UI；总量现封顶一年（365 天），上界收敛至 ~3.65M 轮（10-30ms）。新增回归测试：极端时间快速返回 + 总量不超 cap。
- **P2 API http 明文旁路**：\`assertSafeDirectApiBase\` 改为无条件调用，覆盖 host-proxy 路径（key 经 proxy_password/custom_include_headers 交给 ST 后端的明文风险）。
- **P2 \`__proto__\` 原型污染**：characters 改 \`Object.create(null)\`（\`__proto__\`/constructor 角色名不再污染原型），getChatState 迁移存量 plain-object 并丢弃污染键。新增回归测试：null-proto 防污染。

测试数：本分支 \`node --test tests/*.test.mjs\` 159 全过（含新增回归用例）。`,
};

async function getPr(n) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls/${n}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return res.json();
}

for (const n of [1, 2, 3]) {
  const pr = await getPr(n);
  let body = pr.body || '';
  // 移除旧的统一安全段（「安全审查修复（2026-08-10」开头，到文末）
  const start = body.indexOf('## 安全审查修复（2026-08-10');
  if (start >= 0) {
    body = body.slice(0, start).trimEnd() + '\n';
  }
  // 修正测试数行（各分支实际数）
  const real = { 1: 171, 2: 151, 3: 159 }[n];
  body = body
    .replace(/完整版 181 測試全過/g, `完整版 ${real} 測試全過（含安全回归）`)
    .replace(/完整版 181 测试全过/g, `完整版 ${real} 测试全过（含安全回归）`)
    .replace(/本分支：`node --test tests\/\*\.test\.mjs` \d+ 全過/g, `本分支：\`node --test tests/*.test.mjs\` ${real} 全過（含安全回归）`);
  // 追加专属安全段
  body = body.trimEnd() + '\n\n' + SECTIONS[n];

  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls/${n}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`PR#${n}: 安全段已改为分支专属 (${data.body.length} chars)`);
  } else {
    console.error(`PR#${n}: 失败 ${res.status}`, data.message);
  }
}
