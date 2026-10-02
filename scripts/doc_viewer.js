// 插件内的说明阅读器：「?」连结改读随插件安装的 docs/，不再依赖 GitHub 网页
// （GitHub 的 /blob/ 页面常因限流回 503「独角兽」页）。
// 只实现 docs 实际用到的 Markdown：标题、段落、清单、表格、程式码区块、粗体、行内程式码、连结。

export const REPO_BLOB_BASE = 'https://github.com/Liuuuu54/st_bs_biotracker/blob/main/';
const REPO_ROOT_URL = new URL('../', import.meta.url);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 与 GitHub 的标题锚点一致：小写、去掉标点（含全形「、」等）、空白换成连字号
export function githubSlug(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

function stripInlineMarkdown(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

// 把 GitHub 上的 docs 网址或仓库内相对路径转成 { path, anchor }；不是仓库内的 .md 就回 null
export function parseDocHref(href, basePath = 'docs/mechanics/README.md') {
  const raw = String(href ?? '').trim();
  if (!raw) return null;
  let path = '';
  let hash = '';
  if (raw.startsWith(REPO_BLOB_BASE)) {
    const rest = raw.slice(REPO_BLOB_BASE.length);
    const hashIndex = rest.indexOf('#');
    path = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest;
    hash = hashIndex >= 0 ? rest.slice(hashIndex + 1) : '';
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    return null;
  } else {
    const resolved = resolveRepoPath(raw, basePath);
    if (!resolved) return null;
    path = resolved.path;
    hash = resolved.hash;
  }
  if (!/\.md$/i.test(path)) return null;
  let anchor = hash;
  try { anchor = decodeURIComponent(hash); } catch {}
  return { path: decodeURIComponentSafe(path), anchor };
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// 依目前文件位置解析相对连结；跳出仓库根目录就回 null
export function resolveRepoPath(href, basePath) {
  const raw = String(href ?? '');
  const hashIndex = raw.indexOf('#');
  const target = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  if (!target) return { path: basePath, hash };
  const parts = target.startsWith('/') ? [] : String(basePath || '').split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return { path: parts.join('/'), hash };
}

function renderInline(text, basePath) {
  const codeSpans = [];
  let source = String(text ?? '').replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  source = escapeHtml(source);
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => renderLink(label, href.replace(/&amp;/g, '&'), basePath));
  source = source.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return source.replace(/\u0000(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
}

function renderLink(label, href, basePath) {
  if (href.startsWith('#')) {
    return `<a href="#" data-doc-path="${escapeHtml(basePath)}" data-doc-anchor="${escapeHtml(decodeURIComponentSafe(href.slice(1)))}">${label}</a>`;
  }
  const doc = parseDocHref(href, basePath);
  if (doc) {
    return `<a href="${escapeHtml(REPO_BLOB_BASE + doc.path)}" data-doc-path="${escapeHtml(doc.path)}" data-doc-anchor="${escapeHtml(doc.anchor)}">${label}</a>`;
  }
  let external = href;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const resolved = resolveRepoPath(href, basePath);
    if (!resolved) return label;
    external = REPO_BLOB_BASE + resolved.path + (resolved.hash ? `#${resolved.hash}` : '');
  }
  if (!/^https?:/i.test(external)) return label;
  return `<a href="${escapeHtml(external)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function renderMarkdown(markdown, basePath = 'docs/mechanics/README.md') {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const slugCounts = new Map();
  const headings = [];
  const out = [];
  let index = 0;

  const isBlockStart = (line, next) => /^#{1,6}\s/.test(line)
    || /^```/.test(line)
    || LIST_ITEM.test(line)
    || (line.trim().startsWith('|') && TABLE_SEPARATOR.test(next || ''));

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^```(\S*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const plain = stripInlineMarkdown(heading[2]);
      const base = githubSlug(plain);
      const seen = slugCounts.get(base) || 0;
      slugCounts.set(base, seen + 1);
      const id = seen ? `${base}-${seen}` : base;
      headings.push({ level, id, text: plain });
      out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(heading[2], basePath)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.trim().startsWith('|') && TABLE_SEPARATOR.test(lines[index + 1] || '')) {
      const head = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(splitTableRow(lines[index++]));
      out.push(`<div class="bs-bt-doc-table"><table><thead><tr>${head.map((cell) => `<th>${renderInline(cell, basePath)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, basePath)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const listItem = line.match(LIST_ITEM);
    if (listItem) {
      const ordered = /\d/.test(listItem[2]);
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = current.match(LIST_ITEM);
        if (match && /\d/.test(match[2]) === ordered) {
          items.push(match[3]);
          index += 1;
        } else if (current.trim() && /^\s+/.test(current) && items.length && !match) {
          items[items.length - 1] += ` ${current.trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((item) => `<li>${renderInline(item, basePath)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], lines[index + 1])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${renderInline(paragraph.join(' '), basePath)}</p>`);
  }

  return { html: out.join('\n'), headings };
}

const docCache = new Map();

export async function loadDoc(path) {
  if (docCache.has(path)) return docCache.get(path);
  const request = fetch(new URL(path, REPO_ROOT_URL), { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  });
  docCache.set(path, request);
  try {
    return await request;
  } catch (error) {
    docCache.delete(path);
    throw error;
  }
}

export function createDocViewer(root) {
  const body = root?.querySelector('[data-doc-viewer-body]');
  const title = root?.querySelector('[data-doc-viewer-title]');
  const back = root?.querySelector('[data-doc-viewer-back]');
  const external = root?.querySelector('[data-doc-viewer-external]');
  const history = [];
  let current = null;
  let loadToken = 0;

  function scrollToAnchor(anchor) {
    if (!body) return;
    const target = anchor ? body.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
    body.querySelectorAll('.is-doc-target').forEach((node) => node.classList.remove('is-doc-target'));
    if (!target) { body.scrollTop = 0; return; }
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
    target.classList.add('is-doc-target');
  }

  async function show(path, anchor, { pushHistory = true } = {}) {
    if (!root || !body) return;
    if (pushHistory && current && current.path !== path) history.push(current);
    current = { path, anchor };
    root.hidden = false;
    if (back) back.hidden = history.length === 0;
    if (external) external.href = REPO_BLOB_BASE + path + (anchor ? `#${encodeURIComponent(anchor)}` : '');
    const token = ++loadToken;
    if (body.dataset.docPath !== path) {
      body.dataset.docPath = '';
      body.innerHTML = '<p class="bs-bt-doc-status">载入中…</p>';
      if (title) title.textContent = path.split('/').pop();
      try {
        const markdown = await loadDoc(path);
        if (token !== loadToken) return;
        const rendered = renderMarkdown(markdown, path);
        body.innerHTML = rendered.html;
        body.dataset.docPath = path;
        const firstHeading = rendered.headings.find((item) => item.level === 1);
        if (title) title.textContent = firstHeading?.text || path.split('/').pop();
      } catch (error) {
        if (token !== loadToken) return;
        body.innerHTML = `<p class="bs-bt-doc-status">读不到本机的 ${escapeHtml(path)}（${escapeHtml(error?.message || error)}）。可以点右上角改去 GitHub 看。</p>`;
        return;
      }
    }
    scrollToAnchor(anchor);
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    history.length = 0;
    current = null;
  }

  function goBack() {
    const previous = history.pop();
    if (previous) show(previous.path, previous.anchor, { pushHistory: false });
  }

  root?.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-doc-viewer-close]')) { event.preventDefault(); close(); return; }
    if (event.target?.closest?.('[data-doc-viewer-back]')) { event.preventDefault(); goBack(); return; }
    const link = event.target?.closest?.('a[data-doc-path]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
    event.preventDefault();
    show(link.dataset.docPath, link.dataset.docAnchor || '');
  });
  root?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  });

  return { show, close, isOpen: () => Boolean(root && !root.hidden) };
}
