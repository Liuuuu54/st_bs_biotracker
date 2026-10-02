import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { githubSlug, parseDocHref, renderMarkdown, resolveRepoPath, REPO_BLOB_BASE } from '../scripts/doc_viewer.js';

const root = new URL('../', import.meta.url);

test('heading slugs match GitHub anchors, dropping full-width punctuation', () => {
  assert.equal(githubSlug('溫度、思考強度、格式化輸出'), '溫度思考強度格式化輸出');
  assert.equal(githubSlug('技能目錄、角色技能與天賦'), '技能目錄角色技能與天賦');
  assert.equal(githubSlug('Luker 多智能體 (安全) 模式'), 'luker-多智能體-安全-模式');
});

test('GitHub doc URLs and relative links resolve to local repo paths', () => {
  assert.deepEqual(
    parseDocHref(`${REPO_BLOB_BASE}docs/mechanics/registration.md#開局已懷孕與特殊效果`),
    { path: 'docs/mechanics/registration.md', anchor: '開局已懷孕與特殊效果' },
  );
  assert.deepEqual(
    parseDocHref(`${REPO_BLOB_BASE}docs/mechanics/registration.md#%E9%96%8B`),
    { path: 'docs/mechanics/registration.md', anchor: '開' },
  );
  assert.deepEqual(parseDocHref('../guide.md', 'docs/mechanics/README.md'), { path: 'docs/guide.md', anchor: '' });
  assert.equal(parseDocHref(`${REPO_BLOB_BASE}scripts/state.js#L10`), null);
  assert.equal(parseDocHref('https://example.com/a.md'), null);
  assert.equal(resolveRepoPath('../../../x.md', 'docs/mechanics/README.md'), null);
});

test('markdown renders headings with ids, lists, tables, code and links', () => {
  const { html, headings } = renderMarkdown([
    '# 標題',
    '',
    '段落一行',
    '接續同段，含 `<code>` 與 **粗體**。',
    '',
    '- [註冊](registration.md#開局)',
    '- [程式](../../scripts/tools.js#L5)',
    '',
    '1. 第一',
    '2. 第二',
    '',
    '| 欄 | 說明 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '```mermaid',
    'A --> B',
    '```',
    '## 重複',
    '## 重複',
  ].join('\n'), 'docs/mechanics/README.md');
  assert.match(html, /<h1 id="標題">標題<\/h1>/);
  assert.match(html, /<p>段落一行 接續同段，含 <code>&lt;code&gt;<\/code> 與 <strong>粗體<\/strong>。<\/p>/);
  assert.match(html, /data-doc-path="docs\/mechanics\/registration\.md" data-doc-anchor="開局"/);
  assert.match(html, /href="https:\/\/github\.com\/Liuuuu54\/st_bs_biotracker\/blob\/main\/scripts\/tools\.js#L5" target="_blank"/);
  assert.match(html, /<ol><li>第一<\/li><li>第二<\/li><\/ol>/);
  assert.match(html, /<th>欄<\/th><th>說明<\/th>[\s\S]*<td>a<\/td><td>b<\/td>/);
  assert.match(html, /<pre><code>A --&gt; B<\/code><\/pre>/);
  assert.deepEqual(headings.map((item) => item.id), ['標題', '重複', '重複-1']);
});

test('every in-app doc link points at a heading that exists in the bundled docs', async () => {
  const sources = await Promise.all(['settings.html', 'index.js'].map((name) => readFile(new URL(name, root), 'utf8')));
  const hrefs = sources.flatMap((source) => [...source.matchAll(/href="(https:\/\/github\.com\/Liuuuu54\/st_bs_biotracker\/blob\/main\/docs\/[^"]+)"/g)].map((match) => match[1]));
  assert.ok(hrefs.length >= 20);
  for (const href of hrefs) {
    const doc = parseDocHref(href);
    assert.ok(doc, href);
    const markdown = await readFile(new URL(doc.path, root), 'utf8');
    if (!doc.anchor) continue;
    const ids = renderMarkdown(markdown, doc.path).headings.map((item) => item.id);
    assert.ok(ids.includes(doc.anchor), `${href} -> missing heading #${doc.anchor}`);
  }
});

test('doc links open in the in-app viewer instead of navigating to GitHub', async () => {
  const [html, controller] = await Promise.all(['settings.html', 'index.js'].map((name) => readFile(new URL(name, root), 'utf8')));
  assert.match(html, /id="bs-bt-doc-viewer"[^>]*hidden/);
  assert.match(html, /data-doc-viewer-body/);
  assert.match(controller, /createDocViewer\(document\.getElementById\('bs-bt-doc-viewer'\)\)/);
  assert.match(controller, /parseDocHref\(link\.getAttribute\('href'\)\)/);
});
