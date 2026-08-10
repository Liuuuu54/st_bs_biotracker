import { readFileSync } from 'node:fs';

const REPO = 'Liuuuu54/st_bs_biotracker';
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('GH_TOKEN 缺失');
  process.exit(1);
}

for (const n of [1, 2, 3]) {
  const body = readFileSync(`_probe/pr-body-${n}.md`, 'utf8');
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
    console.log(`PR#${n}: body 已修复 (${data.body.length} chars, head=${data.head.sha.slice(0, 7)})`);
  } else {
    console.error(`PR#${n}: 失败 ${res.status}`, data.message);
  }
}
