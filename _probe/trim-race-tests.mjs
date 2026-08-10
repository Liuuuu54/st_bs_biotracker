import { readFileSync, writeFileSync } from 'node:fs';
const file = 'C:/Users/zouyu/Downloads/_work/st_bs_biotracker/tests/audit_fixes.test.mjs';
const lines = readFileSync(file, 'utf8').split('\n');
// 删除从 '<bs_race> 块内' 测试到文件尾（这些 import race_prompt_context.js，属 PR#2 分支）
const idx = lines.findIndex((l) => l.includes('<bs_race> 块内精子'));
if (idx >= 0) {
  const kept = lines.slice(0, idx);
  writeFileSync(file, kept.join('\n').trimEnd() + '\n', 'utf8');
  console.log('已删除 race 用例，新行数:', kept.length);
} else {
  console.log('未找到 race 用例锚点');
}
