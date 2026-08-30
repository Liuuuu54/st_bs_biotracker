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
