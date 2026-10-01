// 文件原始码行号连结的检查与重新对齐。
//
//   node tools/relink_docs.mjs          检查：列出指向空行、越界或函式名对不上的连结，有问题时 exit 1
//   node tools/relink_docs.mjs --fix    对齐：按连结写入当时的程式码，找出现在的行号并改写文件
//
// 对齐的做法：每个连结先找出它被写进该文件的 commit，取那时连到的那一行，再到目前的档案里找同一行。
// 唯一相符就直接换；不唯一时退回「所在的顶层函式 + 相对位移」，并列出来请人工确认；
// 两者都失败（多半是写文件时就没对准）会列成 UNRESOLVED，需要看连结文字人工处理。
// 改完程式码后先跑 --fix，再跑一次检查确认。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = [
  ...fs.readdirSync(path.join(ROOT, 'docs/mechanics'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/mechanics/${name}`),
  'docs/guide.md',
  'README.md',
];
const LINK = /\[([^\]]+)\]\(((?:\.\.\/)+)([^)#]+)#L(\d+)\)/g;
const DECL = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=/;
const WEAK_TARGETS = new Set(['', '}', '};', '},', ');', '/**', '*/']);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

const currentFiles = new Map();
function currentLines(file) {
  if (!currentFiles.has(file)) currentFiles.set(file, splitLines(fs.readFileSync(path.join(ROOT, file), 'utf8')));
  return currentFiles.get(file);
}

const historicFiles = new Map();
function linesAt(commit, file) {
  const key = `${commit}:${file}`;
  if (!historicFiles.has(key)) {
    let text = '';
    try {
      text = git('show', key);
    } catch {
      text = '';
    }
    historicFiles.set(key, splitLines(text));
  }
  return historicFiles.get(key);
}

function declName(line) {
  const match = DECL.exec(line);
  return match ? (match[1] || match[2]) : null;
}

function enclosingDecl(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const name = declName(lines[i]);
    if (name) return { index: i, name };
  }
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const introCache = new Map();
/**
 * 连结最近一次「被写进去」的 commit。不能用 git log -S：它只看字串出现次数，
 * 一次重排里 A 换成 #L100、B 从 #L100 换走时次数不变，会被跳过而找到更早、指向别处的那次。
 * 这里逐个看 diff：新增行里有这段完整连结（含连结文字）、删除行里没有，才算写进去；
 * 只改同一行其它文字、连结原封不动的 commit 不算。
 */
function findIntroCommit(doc, markup) {
  const key = `${doc}\u0000${markup}`;
  if (introCache.has(key)) return introCache.get(key);
  let found = '';
  const commits = git('log', '--format=%H', '-G', escapeRegExp(markup), '--', doc).split(/\r?\n/).filter(Boolean);
  for (const commit of commits) {
    const diff = splitLines(git('show', '--format=', '-U0', commit, '--', doc));
    const added = diff.some((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes(markup));
    const removed = diff.some((line) => line.startsWith('-') && !line.startsWith('---') && line.includes(markup));
    if (added && !removed) {
      found = commit;
      break;
    }
  }
  introCache.set(key, found);
  return found;
}

function resolveTarget(doc, markup, ups, rel, lineNo, headLineNo = null) {
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(doc), ups + rel));
  if (!fs.existsSync(path.join(ROOT, file))) return { error: 'MISSING FILE' };
  const commit = findIntroCommit(doc, markup);
  if (commit) return mapFromSource(commit, file, lineNo);
  // 历史里找不到这段连结：多半是已对齐过、还没提交，之后程式码又动了。
  // 同一行文件在 HEAD 里还在（只差行号）时，用 HEAD 的行号对 HEAD 的程式码重新对齐
  if (headLineNo !== null) return mapFromSource('HEAD', file, headLineNo);
  // 连 HEAD 都没有这行：工作区里刚写的，本来就对着目前的程式码，原样保留
  return { line: lineNo, how: 'uncommitted' };
}

function mapFromSource(commit, file, lineNo) {
  const old = linesAt(commit, file);
  if (lineNo < 1 || lineNo > old.length) return { error: `OUT OF RANGE at ${commit.slice(0, 7)}` };
  const target = old[lineNo - 1];
  const now = currentLines(file);
  const hits = [];
  if (target.trim()) now.forEach((line, i) => { if (line === target) hits.push(i); });
  if (hits.length === 1) return { line: hits[0] + 1, how: 'exact' };
  const decl = enclosingDecl(old, lineNo - 1);
  if (decl) {
    const declHits = [];
    now.forEach((line, i) => { if (declName(line) === decl.name) declHits.push(i); });
    if (declHits.length === 1) {
      const guess = declHits[0] + (lineNo - 1 - decl.index);
      const near = hits.filter((i) => i >= declHits[0] && i <= declHits[0] + 600);
      const line = near.length > 0
        ? near.reduce((best, i) => (Math.abs(i - guess) < Math.abs(best - guess) ? i : best)) + 1
        : guess + 1;
      return { line, how: `via ${decl.name}${near.length > 0 ? '' : ' (offset)'}` };
    }
  }
  return { error: `UNRESOLVED (${hits.length} hits) ${target.trim().slice(0, 70)}` };
}

/** 去掉行号后的文件行：用来在 HEAD 版文件里认出「同一行，只是行号不同」 */
function linkShape(line) {
  return line.replace(/#L\d+\)/g, '#L)').replace(/\r$/, '');
}

function headDocLinesByShape(doc) {
  const map = new Map();
  let text = '';
  try {
    text = git('show', `HEAD:${doc}`);
  } catch {
    return map;
  }
  for (const line of splitLines(text)) {
    const shape = linkShape(line);
    if (shape !== line && !map.has(shape)) map.set(shape, line);
  }
  return map;
}

function fix() {
  let moved = 0;
  const notes = [];
  for (const doc of DOCS) {
    const docPath = path.join(ROOT, doc);
    const text = fs.readFileSync(docPath, 'utf8');
    const headLines = headDocLinesByShape(doc);
    const next = text.split('\n').map((line, index) => {
      const headLine = headLines.get(linkShape(line));
      const headNumbers = headLine ? [...headLine.matchAll(LINK)].map((match) => Number(match[4])) : [];
      let linkIndex = 0;
      return line.replace(LINK, (whole, label, ups, rel, n) => {
        const lineNo = Number(n);
        const headLineNo = linkIndex < headNumbers.length ? headNumbers[linkIndex] : null;
        linkIndex += 1;
        const result = resolveTarget(doc, whole, ups, rel, lineNo, headLineNo);
        if (result.error) {
          notes.push(`${doc}:${index + 1} [${label}] ${rel}#L${lineNo} ${result.error}`);
          return whole;
        }
        if (result.line === lineNo) return whole;
        moved += 1;
        if (result.how !== 'exact') notes.push(`${doc}:${index + 1} [${label}] ${rel}#L${lineNo} -> ${result.line} (${result.how})，请人工确认`);
        return `[${label}](${ups}${rel}#L${result.line})`;
      });
    }).join('\n');
    if (next !== text) fs.writeFileSync(docPath, next);
  }
  notes.forEach((line) => console.log(line));
  console.log(`moved ${moved} link(s)`);
}

function check() {
  const problems = [];
  let total = 0;
  for (const doc of DOCS) {
    splitLines(fs.readFileSync(path.join(ROOT, doc), 'utf8')).forEach((line, index) => {
      for (const match of line.matchAll(LINK)) {
        total += 1;
        const [, label, ups, rel, n] = match;
        const lineNo = Number(n);
        const file = path.posix.normalize(path.posix.join(path.posix.dirname(doc), ups + rel));
        const where = `${doc}:${index + 1} [${label}] ${rel}#L${lineNo}`;
        if (!fs.existsSync(path.join(ROOT, file))) {
          problems.push(`${where} 档案不存在`);
          continue;
        }
        const src = currentLines(file);
        if (lineNo < 1 || lineNo > src.length) {
          problems.push(`${where} 超出档案行数`);
          continue;
        }
        const target = src[lineNo - 1].trim();
        // 指向说明注解的开头可以接受，但下一行得真的是注解内容
        const docblock = target === '/**' && /^\s*\*/.test(src[lineNo] || '');
        if (WEAK_TARGETS.has(target) && !docblock) problems.push(`${where} 指向 ${JSON.stringify(target)}`);
        // 连结文字是函式名时，目标行附近要真的出现它（不分大小写）；工具名 bsXxx 对应的是 applyXxx，不比对
        const ident = label.replace(/`/g, '');
        if (/^[A-Za-z_]\w*$/.test(ident) && !/^bs[A-Z]/.test(ident)) {
          const window = src.slice(lineNo - 1, lineNo + 2).join(' ').toLowerCase();
          if (!window.includes(ident.toLowerCase())) problems.push(`${where} 目标行不是 ${ident}：${target.slice(0, 60)}`);
        }
      }
    });
  }
  problems.forEach((line) => console.log(line));
  console.log(`checked ${total} link(s), ${problems.length} problem(s)`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv.includes('--fix')) fix();
else check();
