/**
 * Per-message history regex pipeline.
 *
 * Each message is processed independently from top to bottom through the
 * configured rules, then the processed messages are passed to the caller for
 * merging. The original host chat objects are never mutated.
 */

function hasGlobalFlag(flags) {
  return String(flags || '').includes('g');
}

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase() === 'exclude' ? 'exclude' : 'extract';
}

export function parseRegexLiteral(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { pattern: '', flags: '' };

  // UI accepts both /pattern/flags and plain pattern text.
  if (raw.startsWith('/')) {
    let closingSlash = -1;
    let escaped = false;
    for (let index = raw.length - 1; index > 0; index -= 1) {
      const char = raw[index];
      if (char !== '/') continue;
      let slashEscaped = false;
      let cursor = index - 1;
      while (cursor >= 0 && raw[cursor] === '\\') {
        slashEscaped = !slashEscaped;
        cursor -= 1;
      }
      if (!slashEscaped) {
        closingSlash = index;
        break;
      }
    }
    if (closingSlash > 0) {
      return {
        pattern: raw.slice(1, closingSlash),
        flags: raw.slice(closingSlash + 1).trim(),
      };
    }
  }

  return { pattern: raw, flags: '' };
}

export function compileRegexRule(rule) {
  const source = rule && typeof rule === 'object'
    ? (rule.regex ?? rule.pattern ?? '')
    : rule;
  const parsed = parseRegexLiteral(source);
  const explicitFlags = rule && typeof rule === 'object' ? String(rule.flags ?? '') : '';
  const pattern = rule && typeof rule === 'object' && rule.pattern !== undefined && rule.regex === undefined
    ? String(rule.pattern ?? '')
    : parsed.pattern;
  const flags = rule && typeof rule === 'object' && (rule.flags !== undefined || rule.pattern !== undefined)
    ? explicitFlags
    : parsed.flags;

  try {
    return {
      regex: new RegExp(pattern, flags),
      pattern,
      flags,
      error: '',
    };
  } catch (error) {
    return {
      regex: null,
      pattern,
      flags,
      error: String(error?.message || error),
    };
  }
}

function collectMatches(text, regex) {
  regex.lastIndex = 0;
  const matches = [];
  if (regex.global) {
    for (const match of text.matchAll(regex)) matches.push(match);
  } else {
    const match = regex.exec(text);
    if (match) matches.push(match);
  }
  regex.lastIndex = 0;
  return matches;
}

function getExtractedMatchText(match) {
  // A capturing group means "extract the captured content". This makes
  // /<content>(.*?)<\/content>/gs return the inner content rather than tags.
  if (match.length > 1) {
    for (let index = 1; index < match.length; index += 1) {
      if (match[index] !== undefined) return match[index];
    }
  }
  return match[0] ?? '';
}

export function applyRegexRule(text, rule) {
  const sourceText = String(text ?? '');
  const mode = normalizeMode(rule?.mode);
  const rawSource = rule && typeof rule === 'object'
    ? String(rule.regex ?? rule.pattern ?? '').trim()
    : String(rule ?? '').trim();
  if (!rawSource) {
    return {
      text: sourceText,
      matched: false,
      error: '',
      pattern: '',
      flags: '',
      mode,
    };
  }
  const compiled = compileRegexRule(rule);
  if (!compiled.regex) {
    return {
      text: sourceText,
      matched: false,
      error: compiled.error,
      pattern: compiled.pattern,
      flags: compiled.flags,
      mode,
    };
  }

  if (mode === 'exclude') {
    const result = sourceText.replace(compiled.regex, '');
    return {
      text: result,
      matched: result !== sourceText,
      error: '',
      pattern: compiled.pattern,
      flags: compiled.flags,
      mode,
    };
  }

  const matches = collectMatches(sourceText, compiled.regex);
  if (matches.length === 0) {
    return {
      text: '',
      matched: false,
      error: '',
      pattern: compiled.pattern,
      flags: compiled.flags,
      mode,
    };
  }

  return {
    text: matches.map(getExtractedMatchText).join(''),
    matched: true,
    error: '',
    pattern: compiled.pattern,
    flags: compiled.flags,
    mode,
  };
}

export function processHistoryText(text, rules = []) {
  let current = String(text ?? '');
  const errors = [];
  const extractedParts = [];
  let hasExtractRule = false;

  for (const [index, rule] of (Array.isArray(rules) ? rules : []).entries()) {
    if (rule?.enabled === false) continue;
    const mode = String(rule?.mode || '').trim().toLowerCase() === 'exclude' ? 'exclude' : 'extract';
    if (mode === 'extract') {
      hasExtractRule = true;
    }
    const result = applyRegexRule(current, rule);
    if (result.error) {
      errors.push({ index, error: result.error, pattern: result.pattern, flags: result.flags });
      continue;
    }
    if (mode === 'exclude') {
      current = result.text;
    } else {
      if (result.matched) {
        extractedParts.push(result.text);
      }
    }
  }

  let finalText = current;
  if (hasExtractRule) {
    finalText = extractedParts.join('\n');
  }

  return { text: finalText, errors };
}

export function processHistoryMessages(messages, rules = []) {
  const list = Array.isArray(messages) ? messages : [];
  const processed = [];
  const errors = [];

  for (const [index, message] of list.entries()) {
    const rawText = String(message?.mes ?? message?.text ?? '');
    const result = processHistoryText(rawText, rules);
    if (result.errors.length) {
      errors.push(...result.errors.map((item) => ({ ...item, messageIndex: index })));
    }
    processed.push({
      ...message,
      text: result.text,
      mes: result.text,
    });
  }

  return { messages: processed, errors };
}

export function normalizeHistoryRegexRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((rule) => {
      if (typeof rule === 'string') {
        return { mode: 'extract', regex: rule, enabled: true };
      }
      if (!rule || typeof rule !== 'object') return null;
      return {
        id: String(rule.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        mode: normalizeMode(rule.mode),
        regex: String(rule.regex ?? rule.pattern ?? ''),
        flags: rule.pattern !== undefined && rule.regex === undefined ? String(rule.flags ?? '') : undefined,
        enabled: rule.enabled !== false,
      };
    })
    .filter(Boolean);
}

export function formatRegexRuleForInput(rule) {
  const regex = String(rule?.regex ?? rule?.pattern ?? '');
  const flags = String(rule?.flags ?? '');
  if (rule?.pattern !== undefined && rule?.regex === undefined) return regex;
  return regex;
}
