const MermaidDiagramProvider = require('./MermaidDiagramProvider');

class SequenceProvider extends MermaidDiagramProvider {
    generate(name, body, language) {
        const statements = this.parser.parseStatements(body, language);
        const lines = [];
        const participants = new Set();

        participants.add(name);
        for (const stmt of statements) {
            if (stmt.type === 'statement' || stmt.type === 'return') {
                const text = stmt.type === 'return' ? stmt.value : stmt.content;
                if (text) {
                    const calls = this._extractMethodCalls(text, name);
                    for (const call of calls) {
                        if (call.object !== name) participants.add(call.object);
                    }
                }
            }
        }

        lines.push('sequenceDiagram');
        lines.push(`    actor Caller`);
        lines.push(`    participant ${name} as ${name}`);
        for (const p of participants) {
            if (p !== name) lines.push(`    participant ${p} as ${p}`);
        }

        lines.push('');
        lines.push(`    Caller->>+${name}: call()`);

        const stack = [];
        const ifHasElse = [];
        const ifStack = [];
        for (const stmt of statements) {
            if (stmt.type === 'if') {
                ifHasElse.push(false);
                ifStack.push(ifHasElse.length - 1);
            } else if (stmt.type === 'else' || stmt.type === 'elseif') {
                if (ifStack.length > 0) ifHasElse[ifStack[ifStack.length - 1]] = true;
            } else if (stmt.type === 'close_brace' && !stmt.hasElse) {
                ifStack.pop();
            }
        }

        let pendingReturn = false;
        let ifIdx = 0;

        for (const stmt of statements) {
            switch (stmt.type) {
                case 'if': {
                    let cond = this._cleanMermaidCond(stmt.condition);
                    const hasElse = ifHasElse[ifIdx] || false;
                    lines.push(`    alt ${cond}`);
                    stack.push({ type: 'if', hasElse: false });
                    ifIdx++;
                    break;
                }
                case 'elseif': {
                    let cond = this._cleanMermaidCond(stmt.condition);
                    lines.push(`    else ${cond}`);
                    break;
                }
                case 'else':
                    lines.push('    else');
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'try':
                    lines.push('    alt try');
                    stack.push({ type: 'try' });
                    break;
                case 'catch':
                    lines.push(`    else catch ${this._escapeMermaidLabel(stmt.condition.replace(/[();]/g, '').trim())}`);
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'finally':
                    lines.push('    else finally');
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'for':
                case 'while': {
                    let cond = this._cleanMermaidCond(stmt.condition);
                    cond = cond.replace(/;\s*/g, ', ');
                    lines.push(`    loop ${this._escapeMermaidLabel(cond)}`);
                    stack.push({ type: 'loop' });
                    break;
                }
                case 'switch':
                    lines.push(`    alt switch: ${this._escapeMermaidLabel(stmt.condition.replace(/[()]/g, '').trim())}`);
                    stack.push({ type: 'switch', firstCase: true });
                    break;
                case 'case': {
                    const parent = stack[stack.length - 1];
                    if (parent && parent.type === 'switch' && parent.firstCase) {
                        parent.firstCase = false;
                    } else {
                        lines.push(`    else case ${this._escapeMermaidLabel(stmt.condition.replace(/[():]/g, '').trim())}`);
                    }
                    break;
                }
                case 'default':
                    lines.push('    else default');
                    break;
                case 'return': {
                    const returnVal = stmt.value ? stmt.value.trim() : '';
                    if (returnVal) {
                        const calls = this._extractMethodCalls(returnVal, name);
                        for (const call of calls) {
                            if (call.object !== name) {
                                lines.push(`    ${name}->>+${call.object}: ${call.method}()`);
                                lines.push(`    ${call.object}-->>-${name}: result`);
                            } else {
                                lines.push(`    ${name}->>${name}: ${call.method}()`);
                            }
                        }
                    }
                    lines.push(`    ${name}-->>Caller: ${returnVal || 'void'}`);
                    pendingReturn = true;
                    break;
                }
                case 'break':
                    lines.push(`    Note over ${name}: break`);
                    break;
                case 'statement': {
                    let text = stmt.content.replace(/[;{}]/g, '').trim();
                    const calls = this._extractMethodCalls(text, name);
                    if (calls.length > 0) {
                        for (const call of calls) {
                            if (call.object !== name) {
                                lines.push(`    ${name}->>+${call.object}: ${call.method}()`);
                                lines.push(`    ${call.object}-->>-${name}: result`);
                            } else {
                                lines.push(`    ${name}->>${name}: ${call.method}()`);
                            }
                        }
                    } else {
                        const simplified = this._simplifyStatement(text);
                        if (simplified && simplified.length > 0) {
                            lines.push(`    Note over ${name}: ${simplified}`);
                        }
                    }
                    break;
                }
                case 'close_brace': {
                    if (stmt.hasElse || stmt.hasCatch || stmt.hasFinally) break;
                    const block = stack.pop();
                    if (block) lines.push('    end');
                    break;
                }
            }
        }

        while (stack.length > 0) {
            stack.pop();
            lines.push('    end');
        }

        if (!pendingReturn) lines.push(`    ${name}-->>Caller: void`);
        lines.push(`    deactivate ${name}`);

        return lines.join('\n');
    }

    _cleanMermaidCond(cond) {
        let cleaned = this._cleanExpression(cond.trim());
        while (cleaned.startsWith('(') && cleaned.endsWith(')')) {
            let depth = 0, matching = true;
            for (let ci = 0; ci < cleaned.length - 1; ci++) {
                if (cleaned[ci] === '(') depth++;
                else if (cleaned[ci] === ')') depth--;
                if (depth === 0 && ci < cleaned.length - 2) { matching = false; break; }
            }
            if (matching) cleaned = cleaned.substring(1, cleaned.length - 1).trim();
            else break;
        }
        return this._escapeMermaidLabel(cleaned);
    }
}

module.exports = SequenceProvider;
