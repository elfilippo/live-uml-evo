/**
 * ASTParser — AST-based StatementParser for StateAnalyzer.
 *
 * Provides semantic extraction methods (extractAssignments, extractComparisons,
 * etc.) used by state machine detection.  Uses web-tree-sitter WASM for all
 * 6 languages.
 *
 * Returns [] when tree-sitter is not yet initialized.
 */

const StatementParser = require('./StatementParser');
const { KEYWORDS } = StatementParser;
const tsProvider = require('./TreeSitterProvider');

const _stripQ = s => s.replace(/^['"]|['"]$/g, '');

// ── Assignment: unified CST walk ─────────────────────────────────────────────

function _cstAssignments(root) {
  const results = [];
  function walk(n) {
    if (!n) return;
    const t = n.type;

    // C/C++/Java/JS/TS: x = val
    if (t === 'assignment_expression') {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
          if (left && right) {
            const val = _stripQ(right.text);
            if (left.type === 'identifier') {
              if (!KEYWORDS.has(val)) results.push({ variable: left.text, value: val, isThis: false, key: left.text });
            } else if (left.type === 'member_expression') {
              const obj = left.childForFieldName('object');
              const prop = left.childForFieldName('property');
              if (obj && prop && (obj.type === 'this' || obj.type === 'self') && prop.type === 'property_identifier') {
                if (!KEYWORDS.has(val)) results.push({ variable: prop.text, value: val, isThis: true, key: 'this.' + prop.text });
          }
        }
      }
    }

    // Variable/init declarators: int x = 42, let x = 42
    if (t === 'variable_declarator' || t === 'init_declarator') {
      const name = n.childForFieldName('name') || n.childForFieldName('declarator');
      const val = n.childForFieldName('value');
      if (name && val && name.type === 'identifier') {
          const v = _stripQ(val.text);
          if (!KEYWORDS.has(v)) results.push({ variable: name.text, value: v, isThis: false, key: name.text });
      }
    }

    // Python: x = val
    if (t === 'assignment') {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      if (left && right) {
        const v = _stripQ(right.text);
        if (left.type === 'identifier') {
          if (!KEYWORDS.has(v)) results.push({ variable: left.text, value: v, isThis: false, key: left.text });
        } else if (left.type === 'attribute') {
          const obj = left.childForFieldName('object');
          const attr = left.childForFieldName('attribute');
          if (obj && attr && (obj.type === 'self' || obj.type === 'this')) {
            if (!KEYWORDS.has(v)) results.push({ variable: attr.text, value: v, isThis: true, key: 'this.' + attr.text });
          }
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  }
  walk(root);
  return results;
}

// ── Comparison: unified CST walk ─────────────────────────────────────────────

const _COMPARE_OPS = new Set(['==', '===', '!=', '!==', '>=', '<=', '>', '<', 'is', 'is not']);

function _cstComparisons(root) {
  const results = [];
  function walk(n) {
    if (!n) return;

    if (n.type === 'binary_expression') {
      const op = n.childForFieldName('operator');
      if (op && _COMPARE_OPS.has(op.text)) {
        const left = n.childForFieldName('left');
        const right = n.childForFieldName('right');
        if (left && right) {
          let variable = null, isThis = false;
          if (left.type === 'identifier') variable = left.text;
          else if (left.type === 'member_expression') {
            const obj = left.childForFieldName('object');
            const prop = left.childForFieldName('property');
            if (obj && prop && (obj.type === 'this' || obj.type === 'self') && prop.type === 'property_identifier') {
              variable = prop.text; isThis = true;
            }
          }
          if (variable) {
            const val = _stripQ(right.text);
            if (!KEYWORDS.has(val)) results.push({ variable, value: val, operator: op.text, isThis, key: isThis ? 'this.' + variable : variable });
          }
        }
      }
    }

    // Python comparison
    if (n.type === 'comparison_operator') {
      let leftVar = null, isThis = false, operator = null, rightVal = null;
      // Children: left, operator, right (or operator is composite like 'is not')
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i);
        if (i === 0) {
          if (ch.type === 'identifier') { leftVar = ch.text; }
          else if (ch.type === 'attribute') {
            const obj = ch.childForFieldName('object');
            const attr = ch.childForFieldName('attribute');
            if (obj && attr && (obj.type === 'self' || obj.type === 'this') && attr.type === 'identifier') {
              leftVar = attr.text; isThis = true;
            }
          }
        } else if (i === n.childCount - 1) {
          rightVal = _stripQ(ch.text);
        } else {
          operator = ch.type === 'is not' ? 'is not' : ch.text;
        }
      }
      if (leftVar && operator && rightVal && _COMPARE_OPS.has(operator) && !KEYWORDS.has(rightVal)) {
        results.push({ variable: leftVar, value: rightVal, operator, isThis, key: isThis ? 'this.' + leftVar : leftVar });
      }
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  }
  walk(root);
  return results;
}

// ── Switch / match: unified CST walk ─────────────────────────────────────────

function _cstSwitchDiscriminants(root) {
  const results = [];
  function walk(n) {
    if (!n) return;

    if (n.type === 'switch_statement' || n.type === 'switch_expression') {
      const cond = n.childForFieldName('condition') || n.childForFieldName('value');
      if (cond) {
        let variable = null, isThis = false;
        if (cond.type === 'identifier') variable = cond.text;
        else if (cond.type === 'member_expression') {
          const obj = cond.childForFieldName('object');
          const prop = cond.childForFieldName('property');
          if (obj && prop && (obj.type === 'this' || obj.type === 'self') && prop.type === 'property_identifier') {
            variable = prop.text; isThis = true;
          }
        } else if (cond.type === 'parenthesized_expression') {
          const inner = cond.namedChild(0);
          if (inner) {
            if (inner.type === 'identifier') variable = inner.text;
            else if (inner.type === 'member_expression') {
              const obj = inner.childForFieldName('object');
              const prop = inner.childForFieldName('property');
              if (obj && prop && (obj.type === 'this' || obj.type === 'self') && prop.type === 'property_identifier') {
                variable = prop.text; isThis = true;
              }
            }
          }
        }
        if (variable) results.push({ variable, isThis, key: isThis ? 'this.' + variable : variable });
      }
    }

    if (n.type === 'match_statement') {
      const subj = n.childForFieldName('subject');
      if (subj) {
        let variable = null, isThis = false;
        if (subj.type === 'identifier') variable = subj.text;
        else if (subj.type === 'attribute') {
          const obj = subj.childForFieldName('object');
          const attr = subj.childForFieldName('attribute');
          if (obj && attr && (obj.type === 'self' || obj.type === 'this')) {
            variable = attr.text; isThis = true;
          }
        }
        if (variable) results.push({ variable, isThis, key: isThis ? 'this.' + variable : variable });
      }
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  }
  walk(root);
  return results;
}

// ── Call expression: unified CST walk ────────────────────────────────────────

function _cstCalls(root) {
  const results = [];
  function walk(n) {
    if (!n) return;

    if (n.type === 'call_expression') {
      const func = n.childForFieldName('function');
      if (func && (func.type === 'identifier' || func.type === 'property_identifier')) {
        if (!KEYWORDS.has(func.text)) results.push({ name: func.text, index: func.startIndex });
      }
    }

    if (n.type === 'method_invocation') {
      const name = n.childForFieldName('name');
      if (name && name.type === 'identifier' && !KEYWORDS.has(name.text)) {
        results.push({ name: name.text, index: name.startIndex });
      }
    }

    if (n.type === 'call') {
      const func = n.childForFieldName('function');
      if (func && func.type === 'identifier' && !KEYWORDS.has(func.text)) {
        results.push({ name: func.text, index: func.startIndex });
      }
    }

    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  }
  walk(root);
  return results;
}

// ── ASTParser class ──────────────────────────────────────────────────────────

class ASTParser extends StatementParser {
  constructor() {
    super();
  }

  parseStatements(body, language) {
    throw new Error('ASTParser does not implement parseStatements — use LineParser for flowchart/sequence');
  }

  /** Try to parse with tree-sitter.  Returns Tree or null. */
  _tryParse(body, language) {
    if (!tsProvider.isReady()) return null;
    const parser = tsProvider._parsers.get(tsProvider._normalize(language));
    if (!parser) return null;
    try { return parser.parse(body); } catch (_) { return null; }
  }

  // ── Assignment extraction ──────────────────────────────────────────────────

  extractAssignments(body, language) {
    const tree = this._tryParse(body, language);
    if (tree) {
      const r = _cstAssignments(tree.rootNode);
      if (r.length > 0) return r;
    }
    // return this._extractAssignmentsRegex(body);
    return [];
  }

  // _extractAssignmentsRegex(body) {
  //   const results = [];
  //   const re = new RegExp(ASSIGN_RE.source, 'g');
  //   let m;
  //   while ((m = re.exec(body)) !== null) {
  //     const afterMatch = body.substring(m.index + m[0].length).trimLeft();
  //     if (afterMatch.startsWith('(')) continue;
  //     const key = m[1] ? m[1] + '.' + m[2] : m[2];
  //     const value = m[3];
  //     if (KEYWORDS.has(value)) continue;
  //     results.push({ variable: m[2], value, isThis: !!m[1], key });
  //   }
  //   return results;
  // }

  // ── Switch discriminant extraction ────────────────────────────────────────

  extractSwitchDiscriminants(body, language) {
    const tree = this._tryParse(body, language);
    if (tree) {
      const r = _cstSwitchDiscriminants(tree.rootNode);
      if (r.length > 0) return r;
    }
    // return this._extractSwitchDiscriminantsRegex(body);
    return [];
  }

  // _extractSwitchDiscriminantsRegex(body) {
  //   const results = [];
  //   const re = new RegExp(SWITCH_RE.source, 'g');
  //   let m;
  //   while ((m = re.exec(body)) !== null) {
  //     const key = m[1] ? m[1] + '.' + m[2] : m[2];
  //     results.push({ variable: m[2], isThis: !!m[1], key });
  //   }
  //   return results;
  // }

  // ── Comparison extraction ─────────────────────────────────────────────────

  extractComparisons(body, language) {
    const tree = this._tryParse(body, language);
    if (tree) {
      const r = _cstComparisons(tree.rootNode);
      if (r.length > 0) return r;
    }
    // return this._extractComparisonsRegex(body);
    return [];
  }

  // _extractComparisonsRegex(body) {
  //   const results = [];
  //   const re = new RegExp(COMPARE_RE.source, 'g');
  //   let m;
  //   while ((m = re.exec(body)) !== null) {
  //     const key = m[1] ? m[1] + '.' + m[2] : m[2];
  //     const value = m[3];
  //     if (KEYWORDS.has(value)) continue;
  //     results.push({ variable: m[2], value, operator: m[0].match(/(===?|!=|>=|<=|>|<|is\s+not|is)/)[1], isThis: !!m[1], key });
  //   }
  //   return results;
  // }

  // ── Call extraction ──────────────────────────────────────────────────────

  extractCalls(body, language) {
    const tree = this._tryParse(body, language);
    if (tree) {
      const r = _cstCalls(tree.rootNode);
      if (r.length > 0) return r;
    }
    // return this._extractCallsRegex(body);
    return [];
  }

  // _extractCallsRegex(body) {
  //   const results = [];
  //   const re = new RegExp(CALL_RE.source, 'g');
  //   let m;
  //   while ((m = re.exec(body)) !== null) {
  //     const name = m[1];
  //     if (KEYWORDS.has(name)) continue;
  //     results.push({ name, index: m.index });
  //   }
  //   return results;
  // }

  // ── Function params / call args (keep regex — simple enough) ──────────────

  extractFunctionParams(funcBody) {
    if (!funcBody) return [];
    const firstLine = funcBody.split('\n')[0].trim();
    const paramMatch = firstLine.match(/\(([^)]*)\)/);
    if (!paramMatch) return [];
    return paramMatch[1].split(',')
      .map(p => {
        let trimmed = p.trim();
        trimmed = trimmed.replace(/:.*$/, '').trim();
        const parts = trimmed.split(/\s+/);
        return parts[parts.length - 1].replace(/[^a-zA-Z_]\w*$/, '');
      })
      .filter(p => p && !KEYWORDS.has(p) && /^[a-zA-Z_]\w*$/.test(p));
  }

  extractCallArgs(body, callIndex) {
    if (!body) return [];
    const afterName = body.substring(callIndex);
    const parenStart = afterName.indexOf('(');
    if (parenStart === -1) return [];
    let depth = 0;
    let argsStr = '';
    for (let i = parenStart + 1; i < afterName.length; i++) {
      const ch = afterName[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      } else if (ch === '"' || ch === "'") {
        const quote = ch;
        argsStr += ch;
        i++;
        while (i < afterName.length && afterName[i] !== quote) {
          if (afterName[i] === '\\') { argsStr += afterName[i]; i++; }
          argsStr += afterName[i];
          i++;
        }
        if (i < afterName.length) argsStr += afterName[i];
        continue;
      }
      argsStr += ch;
    }
    return argsStr.split(',').map(a => a.trim()).filter(a => a);
  }
}

module.exports = ASTParser;
