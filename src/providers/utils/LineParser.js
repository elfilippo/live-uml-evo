/**
 * LineParser — Line-based StatementParser for Flowchart and Sequence providers.
 *
 * Produces flat typed nodes with 'close_brace' scope markers.
 * This flat format is intentional — flowchart/sequence translate scope
 * nesting into PlantUML if/endif, while/endwhile, alt/end markers.
 */

const StatementParser = require('./StatementParser');
const { StatementNode, KEYWORDS, _extractCondition } = StatementParser;

class LineParser extends StatementParser {
  parseStatements(body, language) {
    return this._parseCStyleStatements(body);
  }

  _parseCStyleStatements(body) {
    const lines = body.replace(/\r\n?/g, '\n').split('\n');
    const nodes = [];
    let switchDepth = 0;
    let inPython = false;
    if (!body.includes('{')) inPython = true;

    function countChar(s, c) {
      let n = 0;
      for (const ch of s) if (ch === c) n++;
      return n;
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') ||
          trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/'))
        continue;

      if (trimmed === '{' || trimmed === ');' ||
          trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
          trimmed.startsWith('require(') || trimmed.startsWith('"""') || trimmed.startsWith("'''") ||
          trimmed.startsWith('@'))
        continue;

      if (/^\w+\s+\w+\)\s*\{?\s*$/.test(trimmed) && !/^[a-z]+\s*\(/.test(trimmed))
        continue;

      const openB = countChar(trimmed, '{');
      const closeB = countChar(trimmed, '}');

      if (/^\bif\s*\(/.test(trimmed) || /^\bif\s+/.test(trimmed)) {
        let ifLine = trimmed;
        let ifLineIndex = i;
        if (trimmed.match(/^\bif\s*\(/)) {
          let openP = (ifLine.match(/\(/g) || []).length;
          let closeP = (ifLine.match(/\)/g) || []).length;
          while (openP > closeP && ifLineIndex + 1 < lines.length) {
            ifLineIndex++;
            const nextL = lines[ifLineIndex].trim();
            if (nextL === '{' || nextL.startsWith('{')) break;
            ifLine += ' ' + nextL;
            openP = (ifLine.match(/\(/g) || []).length;
            closeP = (ifLine.match(/\)/g) || []).length;
          }
        }
        const cond = _extractCondition(ifLine, 'if');
        nodes.push(new StatementNode('if', { condition: cond, raw: ifLine, line: i + 1 }));
        const after = ifLine.replace(/^\s*if\s*\([^)]*\)\s*\{?\s*/, '').replace(/^\s*if\s+.*?:\s*/, '').trim();
        if (/^return\b/.test(after) || /^break\b/.test(after)) {
          const retMatch = after.match(/^return(?:\s+(.+?))?\s*;/); const val = retMatch ? (retMatch[1] || '') : '';
          const tp = after.startsWith('return') ? 'return' : 'break';
          nodes.push(new StatementNode(tp, tp === 'return' ? { value: val, raw: after, line: i + 1 } : { raw: after, line: i + 1 }));
        }
        if (ifLineIndex > i) i = ifLineIndex;
      } else if (/^\belse\s+if\b/.test(trimmed)) {
        const cond = _extractCondition(trimmed, 'else if');
        nodes.push(new StatementNode('elseif', { condition: cond, raw: trimmed, line: i + 1 }));
        const after = trimmed.replace(/^\s*else\s+if\s*\([^)]*\)\s*/, '').replace(/^\s*elif\s+.*?:\s*/, '').trim();
        if (/^return\b/.test(after) || /^break\b/.test(after)) {
          const retMatch = after.match(/^return(?:\s+(.+?))?\s*;/); const val = retMatch ? (retMatch[1] || '') : '';
          const tp = after.startsWith('return') ? 'return' : 'break';
          nodes.push(new StatementNode(tp, tp === 'return' ? { value: val, raw: after, line: i + 1 } : { raw: after, line: i + 1 }));
        }
      } else if (/^\belif\s+/.test(trimmed)) {
        const m = trimmed.match(/elif\s+(.+?):/);
        nodes.push(new StatementNode('elseif', { condition: m ? m[1] : trimmed, raw: trimmed, line: i + 1 }));
        const after = trimmed.replace(/^\s*elif\s+.*?:\s*/, '').trim();
        if (/^return\b/.test(after) || /^break\b/.test(after)) {
          const retMatch = after.match(/^return(?:\s+(.+?))?\s*;/); const val = retMatch ? (retMatch[1] || '') : '';
          const tp = after.startsWith('return') ? 'return' : 'break';
          nodes.push(new StatementNode(tp, tp === 'return' ? { value: val, raw: after, line: i + 1 } : { raw: after, line: i + 1 }));
        }
      } else if (/^\belse\b/.test(trimmed) && !/^\belse\s+if\b/.test(trimmed)) {
        nodes.push(new StatementNode('else', { raw: trimmed, line: i + 1 }));
        const after = trimmed.replace(/^\s*else\s*/, '').replace(/^\{?\s*/, '').trim();
        if (/^return\b/.test(after) || /^break\b/.test(after)) {
          const retMatch = after.match(/^return(?:\s+(.+?))?\s*;/); const val = retMatch ? (retMatch[1] || '') : '';
          const tp = after.startsWith('return') ? 'return' : 'break';
          nodes.push(new StatementNode(tp, tp === 'return' ? { value: val, raw: after, line: i + 1 } : { raw: after, line: i + 1 }));
        }
      } else if (/^\bfor\b\s*\(/.test(trimmed) || /^\bfor\s+/.test(trimmed)) {
        let forLine = trimmed;
        let forLineIndex = i;
        if (trimmed.match(/^\bfor\s*\(/)) {
          let openP = (forLine.match(/\(/g) || []).length;
          let closeP = (forLine.match(/\)/g) || []).length;
          while (openP > closeP && forLineIndex + 1 < lines.length) {
            forLineIndex++;
            const nextL = lines[forLineIndex].trim();
            if (nextL === '{' || nextL.startsWith('{')) break;
            forLine += ' ' + nextL;
            openP = (forLine.match(/\(/g) || []).length;
            closeP = (forLine.match(/\)/g) || []).length;
          }
        }
        const cond = _extractCondition(forLine, 'for');
        nodes.push(new StatementNode('for', { condition: cond, raw: forLine, line: i + 1 }));
        if (forLineIndex > i) i = forLineIndex;
      } else if (/^\bwhile\b\s*\(/.test(trimmed) || /^\bwhile\s+/.test(trimmed)) {
        let whileLine = trimmed;
        let whileLineIndex = i;
        if (trimmed.match(/^\bwhile\s*\(/)) {
          let openP = (whileLine.match(/\(/g) || []).length;
          let closeP = (whileLine.match(/\)/g) || []).length;
          while (openP > closeP && whileLineIndex + 1 < lines.length) {
            whileLineIndex++;
            const nextL = lines[whileLineIndex].trim();
            if (nextL === '{' || nextL.startsWith('{')) break;
            whileLine += ' ' + nextL;
            openP = (whileLine.match(/\(/g) || []).length;
            closeP = (whileLine.match(/\)/g) || []).length;
          }
        }
        const cond = _extractCondition(whileLine, 'while');
        nodes.push(new StatementNode('while', { condition: cond, raw: whileLine, line: i + 1 }));
        if (whileLineIndex > i) i = whileLineIndex;
      } else if (/^\bdo\b/.test(trimmed)) {
        nodes.push(new StatementNode('do', { raw: trimmed, line: i + 1 }));
      } else if (/^\bswitch\b\s*\(/.test(trimmed)) {
        const m = trimmed.match(/switch\s*\(([^)]*)\)/);
        nodes.push(new StatementNode('switch', { condition: m ? m[1] : '', raw: trimmed, line: i + 1 }));
        if (openB) switchDepth++;
      } else if (/^case\s+/.test(trimmed)) {
        const m = trimmed.match(/case\s+(.+?):/);
        nodes.push(new StatementNode('case', { condition: m ? m[1] : '', raw: trimmed, line: i + 1 }));
      } else if (/^default\s*:/.test(trimmed)) {
        nodes.push(new StatementNode('default', { raw: trimmed, line: i + 1 }));
      } else if (/^\breturn\b/.test(trimmed)) {
        const m = trimmed.match(/return\s+(.+?);?$/);
        nodes.push(new StatementNode('return', { value: m ? m[1] : '', raw: trimmed, line: i + 1 }));
      } else if (/^\bthrow\b/.test(trimmed)) {
        const m = trimmed.match(/throw\s+(.+?);?$/);
        nodes.push(new StatementNode('throw', { value: m ? m[1] : '', raw: trimmed, line: i + 1 }));
      } else if (/^\bbreak\b/.test(trimmed)) {
        nodes.push(new StatementNode('break', { raw: trimmed, line: i + 1 }));
      } else if (/^\bcontinue\b/.test(trimmed)) {
        nodes.push(new StatementNode('continue', { raw: trimmed, line: i + 1 }));
      } else if (/^\bgoto\b/.test(trimmed)) {
        const m = trimmed.match(/goto\s+(\w+)/);
        nodes.push(new StatementNode('goto', { condition: m ? m[1] : '', raw: trimmed, line: i + 1 }));
      } else if ((trimmed === '}' || trimmed.startsWith('}')) && !inPython) {
        switchDepth = Math.max(0, switchDepth - closeB);
        const afterBrace = trimmed.replace(/^}\s*/, '');
        const isElseAfter = afterBrace.match(/^else\s*\{?$/);
        const isElseIfAfter = afterBrace.match(/^else\s+if\b/);
        const isCatchAfter = afterBrace.match(/^catch\s*\(/);
        const isFinallyAfter = afterBrace.match(/^finally\s*\{?$/);
        const isWhileAfter = afterBrace.match(/^while\s*\(([^)]*)\)/);

        let nextLineIsElse = false, nextLineIsCatch = false, nextLineIsFinally = false;
        if (!isElseAfter && !isElseIfAfter && !isCatchAfter && !isFinallyAfter && !isWhileAfter) {
          for (let j = i + 1; j < lines.length; j++) {
            const nt = lines[j].trim();
            if (!nt || nt === '{') continue;
            if (nt.match(/^\belse\b/) && !nt.match(/^\belse\s+if\b/)) nextLineIsElse = true;
            else if (nt.match(/^\belse\s+if\b/)) nextLineIsElse = true;
            else if (nt.match(/^\bcatch\s*\(/)) nextLineIsCatch = true;
            else if (nt.match(/^\bfinally\b/)) nextLineIsFinally = true;
            break;
          }
        }

        nodes.push(new StatementNode('close_brace', {
          hasElse: !!isElseAfter || !!isElseIfAfter || nextLineIsElse,
          hasCatch: !!isCatchAfter || nextLineIsCatch,
          hasFinally: !!isFinallyAfter || nextLineIsFinally,
          hasWhile: !!isWhileAfter,
          whileCondition: isWhileAfter ? isWhileAfter[1] : '',
          raw: trimmed,
          line: i + 1
        }));

        if (isElseAfter) nodes.push(new StatementNode('else', { raw: 'else', line: i + 1 }));
        if (isElseIfAfter) {
          const cond = _extractCondition(afterBrace, 'else if');
          nodes.push(new StatementNode('elseif', { condition: cond, raw: afterBrace, line: i + 1 }));
        }
        if (isCatchAfter) {
          const cm = trimmed.match(/catch\s*\(([^)]*)\)/);
          nodes.push(new StatementNode('catch', { condition: cm ? cm[1].trim().split(/\s+/)[0] : '', raw: trimmed, line: i + 1 }));
        }
        if (isFinallyAfter) nodes.push(new StatementNode('finally', { raw: trimmed, line: i + 1 }));
        if (isWhileAfter) nodes.push(new StatementNode('while', { condition: isWhileAfter[1], raw: trimmed, line: i + 1 }));
      } else if (/^\btry\b/.test(trimmed) || /^\btry\s*:/.test(trimmed)) {
        nodes.push(new StatementNode('try', { raw: trimmed, line: i + 1 }));
      } else if (/^\bcatch\s*\(/.test(trimmed)) {
        const m = trimmed.match(/catch\s*\(([^)]*)\)/);
        nodes.push(new StatementNode('catch', { condition: m ? m[1].trim().split(/\s+/)[0] : '', raw: trimmed, line: i + 1 }));
      } else if (/^\bexcept\b/.test(trimmed)) {
        const m = trimmed.match(/except\s+(.+?)(?:\s+as\s+\w+)?\s*:/);
        nodes.push(new StatementNode('catch', { condition: m ? m[1] : '', raw: trimmed, line: i + 1 }));
      } else if (/^\bfinally\b/.test(trimmed) || /^\bfinally\s*:/.test(trimmed)) {
        nodes.push(new StatementNode('finally', { raw: trimmed, line: i + 1 }));
      } else if (/^\w+:\s*$/.test(trimmed) && !/^(try|finally|case|default|else|if|while|for|switch):\s*$/.test(trimmed)) {
        nodes.push(new StatementNode('label', { condition: trimmed.replace(':', '').trim(), raw: trimmed, line: i + 1 }));
      } else if (trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
                 trimmed.startsWith('require(') || trimmed.startsWith('@')) {
        continue;
      } else if (trimmed.length > 0 && !trimmed.startsWith(')')) {
        if (/^(auto|int|float|double|char|byte|short|long|boolean|var|let|const|unsigned|signed)\s+\w+\s*,/.test(trimmed)) continue;
        if (/^(auto|int|float|double|char|byte|short|long|boolean|var|let|const|unsigned|signed)\s+\w+\s*;\s*$/.test(trimmed)) continue;
        if (/^(auto|int|float|double|char|byte|short|long|boolean|var|let|const|unsigned|signed)\s+\w+\s*=\s*[^a-zA-Z_\s]/.test(trimmed)) continue;
        if (/^(function|def|public|private|protected|static|async)\s/.test(trimmed) &&
            (trimmed.includes('(') || trimmed.includes('=>'))) continue;
        if (/^(const|let|var)\s/.test(trimmed) &&
            (trimmed.includes('=>') || /=\s*function\s*\(/.test(trimmed))) continue;
        if (/^[A-Za-z_]\w*\s+\w+\s*[=;]/.test(trimmed) &&
            !/^\w+\s*\(/.test(trimmed) &&
            !/^[A-Za-z_]\w*\s+\w+\s*=\s*\w+\s*\(/.test(trimmed))
          continue;
        if (/^auto\s+\w+\s*[=;]/.test(trimmed) &&
            !/^auto\s+\w+\s*=\s*[\w.]+\s*\(/.test(trimmed))
          continue;

        let statement = trimmed;
        let openP = (statement.match(/\(/g) || []).length;
        let closeP = (statement.match(/\)/g) || []).length;
        let stmtIdx = i;
        while (openP > closeP && stmtIdx + 1 < lines.length) {
          stmtIdx++;
          const nextL = lines[stmtIdx].trim();
          if (!nextL || nextL === '{' || nextL.startsWith('{')) break;
          statement += ' ' + nextL;
          openP = (statement.match(/\(/g) || []).length;
          closeP = (statement.match(/\)/g) || []).length;
        }
        statement = statement.replace(/;$/, '');
        nodes.push(new StatementNode('statement', { content: statement, raw: statement, line: i + 1 }));
        if (stmtIdx > i) i = stmtIdx;
      }
    }
    return nodes;
  }
}

module.exports = LineParser;
