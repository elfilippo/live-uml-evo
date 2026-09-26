const PlantUMLDiagramProvider = require('./PlantUMLDiagramProvider');

class PlantUMLSequenceProvider extends PlantUMLDiagramProvider {
    generate(name, body, language) {
        const statements = this.parser.parseStatements(body, language);
        const uml = [];
        const stack = [];
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

        uml.push('@startuml');
        uml.push('!pragma layout smetana');
        uml.push('skinparam backgroundColor #FEFEFE');
        uml.push('skinparam titleFontSize 14');
        uml.push('skinparam titleFontColor #1a1a2e');
        uml.push('skinparam titleFontStyle bold');
        uml.push('skinparam actorFontSize 12');
        uml.push('skinparam actorFontColor #2c3e50');
        uml.push('skinparam actorFontStyle bold');
        uml.push('skinparam actorBorderColor #2980b9');
        uml.push('skinparam actorBackgroundColor #E8F4FD');
        uml.push('skinparam participantFontSize 11');
        uml.push('skinparam participantFontColor #1a1a2e');
        uml.push('skinparam participantFontStyle bold');
        uml.push('skinparam participantBorderColor #3498db');
        uml.push('skinparam participantBackgroundColor #EBF5FB');
        uml.push('skinparam arrowFontSize 10');
        uml.push('skinparam arrowFontColor #555555');
        uml.push('skinparam arrowColor #555555');
        uml.push('skinparam arrowThickness 1');
        uml.push('skinparam lifeLineBorderColor #3498db');
        uml.push('skinparam lifeLineBackgroundColor #EBF5FB');
        uml.push('skinparam noteFontSize 10');
        uml.push('skinparam noteFontColor #2c3e50');
        uml.push('skinparam noteBorderColor #f39c12');
        uml.push('skinparam noteBackgroundColor #FFF8E1');
        uml.push('skinparam sequenceGroupFontSize 11');
        uml.push('skinparam sequenceGroupFontColor #2c3e50');
        uml.push('skinparam sequenceGroupFontStyle bold');
        uml.push('skinparam sequenceGroupBorderColor #95a5a6');
        uml.push('skinparam sequenceGroupBackgroundColor #F2F3F4');
        uml.push('skinparam sequenceReferenceBorderColor #95a5a6');
        uml.push('skinparam sequenceReferenceBackgroundColor #F2F3F4');
        uml.push(`title ${name} - Sequence Diagram`);
        
        uml.push('actor "Caller" as Caller #E8F4FD');
        uml.push(`participant "${name}" as ${name} #EBF5FB`);
        for (const p of participants) {
            if (p !== name) uml.push(`participant "${p}" as ${p}`);
        }
        uml.push('');
        uml.push(`Caller -> ${name}: call()`);
        uml.push(`activate ${name}`);

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
                    const hasElse = ifHasElse[ifIdx] || false;
                    uml.push(hasElse ? `alt [${cond}]` : `opt [${cond}]`);
                    stack.push({ type: 'if', hasElse: false });
                    ifIdx++;
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
                    uml.push(`else [${cond}]`);
                    break;
                }
                case 'else':
                    uml.push('else');
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'try':
                    uml.push('alt [try]');
                    stack.push({ type: 'try', hasElse: false });
                    break;
                case 'catch':
                    uml.push(`else [catch(${stmt.condition.replace(/[();]/g, '').trim()})]`);
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'finally':
                    uml.push('else [finally]');
                    if (stack.length > 0) stack[stack.length - 1].hasElse = true;
                    break;
                case 'for':
                case 'while': {
                    let cond = stmt.condition.replace(/[()]/g, '').trim();
                    cond = cond.replace(/^\([\w\s*]+\)\s*/, '');
                    cond = cond.replace(/\b(auto|int|float|double|char|byte|short|long|boolean|var|let|const|unsigned|signed)\s+/g, '');
                    cond = cond.replace(/;\s*/g, ', ');
                    uml.push(`loop [${cond}]`);
                    stack.push({ type: 'loop' });
                    break;
                }
                case 'switch':
                    uml.push(`alt [switch: ${stmt.condition.replace(/[()]/g, '').trim()}]`);
                    stack.push({ type: 'switch' });
                    break;
                case 'case':
                    uml.push(`group [case ${stmt.condition.replace(/[():]/g, '').trim()}]`);
                    stack.push({ type: 'case' });
                    break;
                case 'default':
                    uml.push('else [default]');
                    break;
                case 'return': {
                    const returnVal = stmt.value ? stmt.value.trim() : '';
                    if (returnVal) {
                        const calls = this._extractMethodCalls(returnVal, name);
                        for (const call of calls) {
                            if (call.object !== name) {
                                uml.push(`${name} -> ${call.object}: ${call.method}()`);
                                uml.push(`activate ${call.object}`);
                                uml.push(`${call.object} --> ${name}: result`);
                                uml.push(`deactivate ${call.object}`);
                            } else {
                                uml.push(`${name} -> ${name}: ${call.method}()`);
                            }
                        }
                    }
                    uml.push(`${name} --> Caller: return ${returnVal || 'void'}`);
                    pendingReturn = true;
                    break;
                }
                case 'break':
                    uml.push('note right: break');
                    break;
                case 'statement': {
                    let text = stmt.content.replace(/[;{}]/g, '').trim();
                    const calls = this._extractMethodCalls(text, name);
                    if (calls.length > 0) {
                        for (const call of calls) {
                            if (call.object !== name) {
                                uml.push(`${name} -> ${call.object}: ${call.method}()`);
                                uml.push(`activate ${call.object}`);
                                uml.push(`${call.object} --> ${name}: result`);
                                uml.push(`deactivate ${call.object}`);
                            } else {
                                uml.push(`${name} -> ${name}: ${call.method}()`);
                            }
                        }
                    } else {
                        const simplified = this._simplifyStatement(text);
                        if (simplified && simplified.length > 0) {
                            uml.push(`${name} -> ${name}:`);
                            uml.push(`note right: ${simplified}`);
                        }
                    }
                    break;
                }
                case 'close_brace': {
                    if (stmt.hasElse || stmt.hasCatch || stmt.hasFinally) break;
                    const block = stack.pop();
                    if (block) uml.push('end');
                    break;
                }
            }
        }

        while (stack.length > 0) {
            stack.pop();
            uml.push('end');
        }

        if (!pendingReturn) uml.push(`${name} --> Caller: void`);
        uml.push(`deactivate ${name}`);
        uml.push('@enduml');

        return uml.join('\n');
    }
}
module.exports = PlantUMLSequenceProvider;
