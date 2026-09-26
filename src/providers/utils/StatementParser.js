/**
 * StatementParser — Abstract base class for the parsing hierarchy.
 *
 * Subclasses must implement parseStatements().
 * Static properties / methods are shared by all consumers.
 */

const _KEYWORDS = new Set([
  'if', 'else', 'elif', 'while', 'for', 'switch', 'return', 'case', 'break',
  'continue', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'delete',
  'sizeof', 'typeof', 'instanceof', 'void', 'int', 'float', 'double', 'char',
  'byte', 'short', 'long', 'boolean', 'print', 'println', 'printf', 'len',
  'range', 'assert', 'import', 'export', 'from', 'class', 'interface', 'enum',
  'extends', 'implements', 'public', 'private', 'protected', 'static', 'final',
  'abstract', 'synchronized', 'native', 'transient', 'volatile',
  'async', 'await', 'def', 'lambda', 'yield', 'with', 'as', 'pass', 'raise',
  'except', 'finally', 'self', 'super', 'this', 'var', 'let', 'const',
  'function', 'constructor', 'get', 'set', 'typeof', 'do', 'in', 'of',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
]);

const ASSIGN_RE = /(?:(\bthis|self)\s*\.\s*)?([a-zA-Z_]\w*)(?:\s*:\s*\w+(?:\s*<[^>]*>)?)?\s*=\s*['"]?(\w+)['"]?/g;
const SWITCH_RE = /\bswitch\s*\(\s*(?:(this|self)\.)?\s*([a-zA-Z_]\w*)\s*\)/g;
const COMPARE_RE = /(?:(this|self)\.)?([a-zA-Z_]\w*)\s*(?:===?|==|!=|>=|<=|>|<|is\s+not|is)\s*['"]?(\w+)['"]?/g;
const CALL_RE = /(\w+)\s*\(/g;

class StatementNode {
  constructor(type, props) {
    this.type = type;
    Object.assign(this, props);
  }
}

function _getLang(language) {
  const l = language.toLowerCase();
  if (l === 'c' || l === 'cpp') return 'c';
  if (l === 'java') return 'java';
  if (l === 'python') return 'python';
  return 'js';
}

function _extractCondition(line, keyword) {
  const kw = keyword === 'else if' ? 'else\\s+if' : keyword;
  const parenRe = new RegExp('\\b' + kw + '\\s*\\(');
  const match = line.match(parenRe);
  if (match) {
    const after = line.substring(match.index + match[0].length);
    let depth = 1;
    const condChars = [];
    for (const ch of after) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      condChars.push(ch);
    }
    return condChars.join('').trim();
  }

  if (keyword === 'else if') {
    const pyMatch = line.match(/elif\s+(.+?):/);
    if (pyMatch) return pyMatch[1];
  } else {
    const pyRe = new RegExp(keyword + '\\s+(.+?):');
    const pm = line.match(pyRe);
    if (pm) return pm[1];
  }
  return line;
}

function removeComments(code) {
    code = code.replace(/"""[\s\S]*?"""/g, match => match.replace(/[^\n]/g, '.'));
    code = code.replace(/'''[\s\S]*?'''/g, match => match.replace(/[^\n]/g, '.'));
    code = code.replace(/"(?:[^"\\\n]|\\.)*"/g, match => match.replace(/[^\n]/g, '.'));
    code = code.replace(/'(?:[^'\\\n]|\\.)*'/g, match => match.replace(/[^\n]/g, '.'));
    code = code.replace(/`(?:[^`\\]|\\.)*`/g, match => match.replace(/[^\n]/g, '.'));

    code = code.replace(/\/\*[\s\S]*?\*\//g, match => {
        const lineCount = (match.match(/\n/g) || []).length;
        return '\n'.repeat(lineCount);
    });

    code = code.replace(/\/\/.*$/gm, '');
    code = code.replace(/#.*$/gm, '');

    return code;
}

function removeCommentsPreservingStrings(code) {
    code = code.replace(/\/\*[\s\S]*?\*\//g, match => {
        const lineCount = (match.match(/\n/g) || []).length;
        return '\n'.repeat(lineCount);
    });
    code = code.replace(/\/\/.*$/gm, '');
    code = code.replace(/#.*$/gm, '');
    return code;
}

class StatementParser {
  constructor() {
    if (new.target === StatementParser) {
      throw new Error('StatementParser is abstract — use LineParser or ASTParser');
    }
  }

  parseStatements(body, language) {
    throw new Error('Subclass must implement parseStatements');
  }
}

StatementParser.StatementNode = StatementNode;
StatementParser.KEYWORDS = _KEYWORDS;
StatementParser.ASSIGN_RE = ASSIGN_RE;
StatementParser.SWITCH_RE = SWITCH_RE;
StatementParser.COMPARE_RE = COMPARE_RE;
StatementParser.CALL_RE = CALL_RE;
StatementParser._getLang = _getLang;
StatementParser._extractCondition = _extractCondition;
StatementParser.removeComments = removeComments;
StatementParser.removeCommentsPreservingStrings = removeCommentsPreservingStrings;

module.exports = StatementParser;
