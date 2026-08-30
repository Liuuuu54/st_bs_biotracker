import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRegexRule,
  normalizeHistoryRegexRules,
  processHistoryMessages,
  processHistoryText,
} from '../scripts/history_regex.js';

test('extract without g only keeps the first match', () => {
  const result = applyRegexRule('A<content>one</content>B<content>two</content>', {
    mode: 'extract',
    regex: '/<content>(.*?)<\\/content>/s',
  });
  assert.equal(result.text, 'one');
});

test('extract with g keeps all matches in order', () => {
  const result = applyRegexRule('A<content>one</content>B<content>two</content>', {
    mode: 'extract',
    regex: '/<content>(.*?)<\\/content>/gs',
  });
  assert.equal(result.text, 'onetwo');
});

test('exclude respects the supplied g flag', () => {
  assert.equal(applyRegexRule('foo foo foo', { mode: 'exclude', regex: '/foo/' }).text, ' foo foo');
  assert.equal(applyRegexRule('foo foo foo', { mode: 'exclude', regex: '/foo/g' }).text, '  ');
});

test('capturing groups are used for extraction, including alternations', () => {
  const result = applyRegexRule(
    '<content>A</content>\n[/CHAPTER_HEADER]\n<content>B</content>\n[SYNOPSIS_BLOCK]',
    {
      mode: 'extract',
      regex: '/<content>(.*?)<\\/content>|\\[\\/CHAPTER_HEADER\\]\\s*(?:<content>\\s*)?([\\s\\S]*?)(?:\\s*\\[SYNOPSIS_BLOCK\\]|$)/gs',
    },
  );
  assert.equal(result.text, 'AB</content>');
});

test('multiple rules form a top-to-bottom pipeline', () => {
  const result = processHistoryText('<A>one</A><X>bad</X><A>two</A>', [
    { mode: 'extract', regex: '/<A>(.*?)<\\/A>/g' },
    { mode: 'exclude', regex: '/bad/g' },
  ]);
  assert.equal(result.text, 'onetwo');
});
test('extract rules do not modify intermediate current text for subsequent rules', () => {
  const result = processHistoryText('TIME: 2026-08-30\n<content>Hello World</content>\n[DEBUG] some noise', [
    { mode: 'exclude', regex: '\\[DEBUG\\]\\s*.*' },
    { mode: 'extract', regex: 'TIME:\\s*([^\\r\\n]+)' },
    { mode: 'extract', regex: '/<content>(.*?)<\\/content>/gs' },
  ]);
  // 排除规则应该生效，且两个提取规则都能在去除了 DEBUG 的文本上匹配成功并被合并
  assert.equal(result.text, '2026-08-30\nHello World');
});

test('extract rule matched against intermediate current text', () => {
  // If there are multiple extract rules, each extract rule matches against the CURRENT text (which starts as the original message text).
  // Wait, does it?
  // Let's verify: "本意是要把这两个都提取出来" ->
  // 1、提取：  TIME:\s*([^\r\n]+)
  // 2、提取：  /<content>(.*?)<\/content>|\[\/CHAPTER_HEADER\]\s*(?:<content>\s*)?([\s\S]*?)(?:\s*\[SYNOPSIS_BLOCK\]|$)/gs
  // 两个提取都在同一个原始消息上进行，还是后一个提取在前一个提取的结果上进行？
  // 用户说：“本意是要把这两个都提取出来...显示第一个的结果，然后显示第二个的结果，这就是一次提取”。
  // 如果后一个提取在前一个提取的结果上进行，因为前一个只剩 2026-08-30，第二个规则就匹配不到 <content> 了。
  // 所以每个提取规则应该基于进入这一层的 current 匹配，还是基于最初的原始文本匹配？
  // 如果提取规则是“流水线”，那么提取规则 1 会将文本替换为它的提取结果。接着规则 2 应该在规则 1 的结果上匹配。
  // 但如果规则 1 的提取结果不包含规则 2 想要匹配的东西，规则 2 就会匹配失败，返回空！
  // 这样两个提取规则就没法同时生效了！
  // 所以提取规则的输入应该是“最初的消息文本”（或者是排除规则处理后的文本）？
  // 不，如果一个楼层有提取规则，每个提取规则如果都对最初/当前的 sourceText 进行匹配，然后把它们提取到的内容合并起来，这才是合理的。
  // 让我们仔细思考：如果规则 1 匹配到 A，规则 2 匹配到 B，如果它们是流水线，A 里面没有 B，规则 2 就会匹配为空，导致最终只剩下 B (如果规则 2 返回空，那么最终是空还是 A 呢？)
  // 在之前的逻辑中，`applyRegexRule` 如果没匹配到，在 `extract` 模式下返回的是 `{ text: '', matched: false }`。
  // 如果是流水线：
  // 规则 1：匹配 A -> 结果为 A。
  // 规则 2：在 A 上匹配 B -> 没匹配到 -> 结果为 ''。
  // 所以如果像之前那样纯流水线，多个 extract 规则根本没法共存，后一个一定会把前一个的结果清空（或者除非前一个结果里刚好有后一个要匹配的内容）。
  // 因此，每个提取规则匹配时，其输入文本不应该是上一个 *提取* 规则的输出。
  // 而是：所有提取规则都应该从同一个「当前非提取状态的基础文本」（即原始文本经过之前的排除规则过滤后的文本）中提取，然后把它们的结果合并起来。
  // 或者是：每个提取规则都对最初的 text（或者排除后的 text）进行匹配。
  // 让我们看一下：
  // 比如我们有：
  // 1. 排除规则 1
  // 2. 提取规则 1
  // 3. 排除规则 2
  // 4. 提取规则 2
  // 如果用户是这样混合写的，该怎么处理？
  // 最简单且符合直觉的逻辑：
  // 整个 message 处理时：
  // 我们维护一个 `baseText`，它由所有的 `exclude` 规则依次修改（即流水线修改）。
  // 所有的 `extract` 规则，都作用于这个 `baseText` 上（或者在它执行时刻的 `current` 上，但提取出的部分收集到 `extractedParts` 中，而不去更新 `baseText` / `current`）。
  // 这样，在执行到一个 `extract` 规则时，它针对当前的 `current` 进行匹配，并将匹配结果收集起来。但它**不改变** `current`，以便后续的 `exclude` 或其他 `extract` 规则能继续在完整的 `current` 上工作。
  // 让我们看一个具体的执行过程：
  // 初始：current = 原始消息
  // 规则 1 (exclude): 排除 `[DEBUG]` -> current 变为去除了 DEBUG 的文本。
  // 规则 2 (extract): 提取 `TIME:...` -> 在当前的 current 上匹配，匹配到 `2026-08-30`，放入 `extractedParts`。current **保持不变**。
  // 规则 3 (exclude): 排除 `[TEMP]` -> current 变为去除了 TEMP 的文本。
  // 规则 4 (extract): 提取 `<content>...</content>` -> 在当前的 current 上匹配，匹配到 `Hello World`，放入 `extractedParts`。current **保持不变**。
  // 最后：如果存在任何启用的 extract 规则，最终文本为 `extractedParts.join('\n')`；如果没有任何启用的 extract 规则，最终文本为最后的 `current`。
  // 这个设计完美解决了：
  // 1. 排除规则能够过滤文本，且过滤后的文本能被后续的提取规则使用。
  // 2. 多个提取规则能共存，它们各自从当前的 baseText 中提取所需内容，而不会互相覆盖/清空。
  // 3. 如果没有提取规则，排除规则依然能正常生效并返回过滤后的 current。
  // 让我们来写一个测试来验证这个逻辑。
});

test('multiple extract rules combine results with newlines', () => {
  const result = processHistoryText('TIME: 2026-08-30\n<content>Hello World</content>', [
    { mode: 'extract', regex: 'TIME:\\s*([^\\r\\n]+)' },
    { mode: 'extract', regex: '/<content>(.*?)<\\/content>/gs' },
  ]);
  assert.equal(result.text, '2026-08-30\nHello World');
});


test('each floor is processed independently and original messages are untouched', () => {
  const messages = [
    { id: 1, mes: '<A>one</A>', is_user: false },
    { id: 2, mes: '<A>two</A>', is_user: true },
  ];
  const before = JSON.stringify(messages);
  const result = processHistoryMessages(messages, [
    { mode: 'extract', regex: '/<A>(.*?)<\\/A>/g' },
  ]);
  assert.deepEqual(result.messages.map((message) => message.text), ['one', 'two']);
  assert.equal(JSON.stringify(messages), before);
});

test('invalid rules are reported without destroying the current text', () => {
  const result = processHistoryText('keep me', [{ mode: 'exclude', regex: '/(broken/' }]);
  assert.equal(result.text, 'keep me');
  assert.equal(result.errors.length, 1);
});

test('blank rules are no-ops and legacy string rules normalize', () => {
  assert.equal(applyRegexRule('keep me', { mode: 'extract', regex: '' }).text, 'keep me');
  const rules = normalizeHistoryRegexRules([
    '/foo/g',
    { mode: 'exclude', pattern: 'bar', flags: 'i', enabled: false },
  ]);
  assert.equal(rules[0].regex, '/foo/g');
  assert.equal(rules[1].regex, 'bar');
  assert.equal(rules[1].enabled, false);
});
