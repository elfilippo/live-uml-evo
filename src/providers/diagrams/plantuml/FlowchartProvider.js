const PlantUMLDiagramProvider = require('./PlantUMLDiagramProvider');

class PlantUMLFlowchartProvider extends PlantUMLDiagramProvider {
    generate(name, body, language) {
        const statements = this.parser.parseStatements(body, language);
        const uml = [];
        const stack = [];

        let buffer = [];
        let bufferType = null;
        let controlCount = 0;
        let statementCount = 0;
        let ifClosedByReturn = 0;

        const MAX_BLOCK = 2;
        const LINEAR_THRESHOLD = 6;

        uml.push('@startuml');
        uml.push('!pragma layout smetana');
        uml.push('skinparam backgroundColor #FEFEFE');
        uml.push('skinparam activityFontStyle bold');
        uml.push('skinparam activityFontSize 12');
        uml.push('skinparam activityFontColor #1a1a2e');
        uml.push('skinparam arrowFontSize 10');
        uml.push('skinparam arrowFontColor #555555');
        uml.push('skinparam titleFontSize 14');
        uml.push('skinparam titleFontColor #1a1a2e');
        uml.push('skinparam titleFontStyle bold');
        uml.push('skinparam conditionFontStyle bold');
        uml.push('skinparam conditionFontColor #2c3e50');
        uml.push('skinparam conditionBackgroundColor #FFF3CD');
        uml.push('skinparam activityBackgroundColor #E8F4FD');
        uml.push('skinparam activityBorderColor #2980b9');
        uml.push('skinparam activityBorderThickness 1');
        uml.push('skinparam activityDiamondBackgroundColor #FFF3CD');
        uml.push('skinparam activityDiamondBorderColor #f39c12');
        uml.push(`title ${name}`);
        uml.push('start');

        for (const stmt of statements) {
            if (['if', 'while', 'for', 'switch'].includes(stmt.type)) controlCount++;
            if (stmt.type === 'statement') statementCount++;

            const isLinearMode = controlCount === 0 && statementCount > LINEAR_THRESHOLD;

            if (stmt.type !== 'statement' || isLinearMode) {
                if (buffer.length > 0) {
                    uml.push(`:${buffer.join('\\n')};`);
                    buffer = [];
                    bufferType = null;
                }
            }

            switch (stmt.type) {
                case 'if': {
                    let cond = this._cleanExpression(stmt.condition.trim());
                    while (cond.startsWith('(') && cond.endsWith(')')) {
                        let depth = 0, matching = true;
                        for (let ci = 0; ci < cond.length - 1; ci++) {
                            if (cond[ci] === '(') depth++;
                            else if (cond[ci] === ')') depth--;
                            if (depth === 0 && ci < cond.length - 2) { matching = false; break; }
                        }
                        if (matching) cond = cond.substring(1, cond.length - 1).trim();
                        else break;
                    }
                    if (cond.length > 30) cond = cond.replace(/\s*(&&|\|\|)\s*/g, (m, op) => ` ${op}\n `);
                    uml.push(`if (${cond}) then (yes)`);
                    stack.push('if');
                    break;
                }
                case 'elseif': {
                    let cond = this._cleanExpression(stmt.condition.trim());
                    while (cond.startsWith('(') && cond.endsWith(')')) {
                        let depth = 0, matching = true;
                        for (let ci = 0; ci < cond.length - 1; ci++) {
                            if (cond[ci] === '(') depth++;
                            else if (cond[ci] === ')') depth--;
                            if (depth === 0 && ci < cond.length - 2) { matching = false; break; }
                        }
                        if (matching) cond = cond.substring(1, cond.length - 1).trim();
                        else break;
                    }
                    uml.push('else (no)');
                    uml.push(`if (${cond}) then (yes)`);
                    stack.push('if');
                    break;
                }
                case 'try': uml.push('fork'); stack.push('try'); break;
                case 'catch': uml.push('fork again'); uml.push(`note right: ${stmt.condition.replace(/[();]/g, '').trim()}`); break;
                case 'finally': uml.push('fork again'); uml.push(`note right: Finally`); break;
                case 'else': uml.push('else (no)'); break;
                case 'do': {
                    let doWhileCond = 'true';
                    for (let si = statements.indexOf(stmt) + 1; si < statements.length; si++) {
                        if (statements[si].type === 'while') {
                            doWhileCond = this._cleanExpression(statements[si].condition.trim()).replace(/[()]/g, '').trim();
                            break;
                        }
                        if (['do', 'for', 'if', 'switch'].includes(statements[si].type)) break;
                    }
                    uml.push(`while (${doWhileCond})`);
                    stack.push('loop');
                    break;
                }
                case 'while': {
                    let cond = this._cleanExpression(stmt.condition.trim()).replace(/[()]/g, '').trim();
                    const prevStmtIdx = statements.indexOf(stmt) - 1;
                    if (prevStmtIdx >= 0 && statements[prevStmtIdx].type === 'close_brace') {
                        const whileCount = uml.filter(l => l.startsWith('while (')).length;
                        const endwhileCount = uml.filter(l => l === 'endwhile').length;
                        if (whileCount > endwhileCount) {
                            if (stack.pop() === 'loop') uml.push('endwhile');
                            break;
                        }
                    }
                    uml.push(`while (${cond})`);
                    stack.push('loop');
                    break;
                }
                case 'for': {
                    let cond = this._cleanExpression(stmt.condition.trim()).replace(/[()]/g, '').trim().replace(/;\s*/g, ', ');
                    uml.push(`while (${cond})`);
                    stack.push('loop');
                    break;
                }
                case 'goto': {
                    if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                    uml.push(`:goto ${stmt.condition || ''};`);
                    break;
                }
                case 'label': {
                    if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                    uml.push(`:-- ${stmt.condition || ''}: --;`);
                    break;
                }
                case 'switch': {
                    uml.push(`switch (${stmt.condition.replace(/[()]/g, '').trim()})`);
                    stack.push('switch');
                    break;
                }
                case 'case': uml.push(`case (== ${stmt.condition.replace(/[():]/g, '').trim()})`); break;
                case 'default': uml.push(`case (default)`); break;
                case 'throw': {
                    if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                    uml.push(`:throw ${stmt.value ? stmt.value.trim() : ''};`);
                    break;
                }
                case 'return': {
                    if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                    const returnVal = stmt.value ? stmt.value.trim() : '';
                    if (returnVal) {
                        uml.push(`:return ${returnVal};`);
                    } else {
                        uml.push(`:return;`);
                    }
                    if (!stack.includes('try')) uml.push('stop');
                    if (stack.length > 0 && stack[stack.length - 1] === 'if') {
                        let hasElseFollowing = false;
                        for (let j = statements.indexOf(stmt) + 1; j < statements.length; j++) {
                            if (['else', 'elseif'].includes(statements[j].type)) { hasElseFollowing = true; break; }
                            if (statements[j].type === 'close_brace') { if (statements[j].hasElse) hasElseFollowing = true; break; }
                        }
                        if (!hasElseFollowing) { stack.pop(); uml.push('endif'); ifClosedByReturn++; }
                    }
                    break;
                }
                case 'statement': {
                    let text = this._simplifyStatement(stmt.content.replace(/[;{}]/g, '').trim());
                    if (text.includes('?') && text.includes(':')) {
                        if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                        const parts = text.split('=');
                        if (parts.length === 2) {
                            const left = parts[0].trim();
                            const [cond, rest] = parts[1].split('?');
                            const [t, f] = rest.split(':');
                            uml.push(`if (${cond.trim().replace(/^\((.+)\)$/, '$1')}) then (yes)`);
                            uml.push(`:${left} = ${t.trim()};`);
                            uml.push('else (no)');
                            uml.push(`:${left} = ${f.trim()};`);
                            uml.push('endif');
                        }
                        break;
                    }
                    let type = 'other';
                    if (/^\w+\+\+|^\w+--/.test(text)) type = 'increment';
                    else if (/^\w+\s*=/.test(text)) type = 'assignment';
                    else if (/\w+\(.*\)/.test(text)) type = 'call';

                    if (isLinearMode) { uml.push(`:${text};`); break; }
                    if (type === 'call') {
                        if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                        uml.push(`:${text};`);
                        break;
                    }
                    if (bufferType && (bufferType !== type || buffer.length >= MAX_BLOCK)) {
                        uml.push(`:${buffer.join('\\n')};`);
                        buffer = [];
                    }
                    buffer.push(text);
                    bufferType = type;
                    break;
                }
                case 'close_brace': {
                    if (buffer.length > 0) { uml.push(`:${buffer.join('\\n')};`); buffer = []; bufferType = null; }
                    if (stmt.hasElse || stmt.hasCatch || stmt.hasFinally || stmt.hasWhile) break;
                    if (ifClosedByReturn > 0) { ifClosedByReturn--; break; }
                    const block = stack.pop();
                    if (block === 'if') uml.push('endif');
                    if (block === 'loop') uml.push('endwhile');
                    if (block === 'switch') uml.push('endswitch');
                    if (block === 'try') uml.push('end fork');
                    break;
                }
            }
        }

        if (buffer.length > 0) uml.push(`:${buffer.join('\\n')};`);
        while (stack.length > 0) {
            const block = stack.pop();
            if (block === 'if') uml.push('endif');
            if (block === 'loop') uml.push('endwhile');
            if (block === 'switch') uml.push('endswitch');
            if (block === 'try') uml.push('end fork');
        }
        if (uml[uml.length - 1] !== 'stop') uml.push('stop');
        uml.push('@enduml');
        return uml.join('\n');
    }
}
module.exports = PlantUMLFlowchartProvider;
