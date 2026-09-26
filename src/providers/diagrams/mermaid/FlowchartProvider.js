const MermaidDiagramProvider = require('./MermaidDiagramProvider');

class FlowchartProvider extends MermaidDiagramProvider {
    generate(name, body, language) {
        const statements = this.parser.parseStatements(body, language);
        const lines = [];
        let nodeId = 0;
        const nextId = () => `N${++nodeId}`;

        lines.push('---');
        lines.push(`title: ${this._escapeMermaidLabel(name)}`);
        lines.push('---');
        lines.push('flowchart TD');

        const startId = nextId();
        lines.push(`    ${startId}((●))`);
        lines.push(`    style ${startId} fill:#333,stroke:#333,stroke-width:4px,color:#333`);
        let currentNode = startId;
        const stack = [];
        let decisionEndStack = [];
        let returnEncountered = false;
        let pendingDoWhile = null;
        const decisionNodes = [];
        const mergeNodes = []
        let pendingBranchLabel = null;
        const pendingBranchEnds = [];
        const pendingExitEdges = [];

        const addEdge = (from, to, label) => {
            if (!from) return;
            let finalLabel = label;
            if (!finalLabel && pendingBranchLabel && decisionNodes.includes(from)) {
                finalLabel = pendingBranchLabel;
                pendingBranchLabel = null;
            }
            if (finalLabel) {
                lines.push(`    ${from} -->|${this._escapeMermaidLabel(finalLabel)}| ${to}`);
            } else {
                lines.push(`    ${from} --> ${to}`);
            }
        };

        const resolvePendingExit = (toId) => {
            while (pendingExitEdges.length > 0) {
                const exit = pendingExitEdges.shift();
                addEdge(exit.fromId, toId, exit.label);
            }
        };

        for (const stmt of statements) {
            if (returnEncountered && stmt.type !== 'close_brace' && !['else', 'elseif', 'catch', 'finally'].includes(stmt.type)) {
                let resumed = false;
                while (stack.length > 0) {
                    const b = stack[stack.length - 1];
                    if (b.type === 'if' && !b.hadElse) {
                        const block = stack.pop();
                        const branches = decisionEndStack.pop() || [];
                        if (block.type === 'if') {
                            while (pendingBranchEnds.length > 0) {
                                const pe = pendingBranchEnds.shift();
                                if (!branches.includes(pe)) branches.push(pe);
                            }
                            if (currentNode && !branches.includes(currentNode)) {
                                branches.push(currentNode);
                            }
                        }
                        if (branches.length >= 2) {
                            const mergeId = nextId();
                            mergeNodes.push(mergeId);
                            lines.push(`    ${mergeId}{" "}`);
                            for (const branch of branches) {
                                addEdge(branch, mergeId);
                            }
                            currentNode = mergeId;
                        } else if (branches.length === 1) {
                            if (!block.hadElse) {
                                const mergeId = nextId();
                                mergeNodes.push(mergeId);
                                lines.push(`    ${mergeId}{" "}`);
                                addEdge(branches[0], mergeId);
                                addEdge(block.decisionId, mergeId, 'no');
                                currentNode = mergeId;
                            } else {
                                currentNode = branches[0];
                            }
                        } else if (block.type === 'if') {
                            currentNode = block.decisionId;
                            pendingBranchLabel = 'no';
                        }
                        returnEncountered = false;
                        resumed = true;
                    } else if (b.type === 'loop') {
                        const loopEntry = stack.pop();
                        decisionEndStack.pop();
                        pendingExitEdges.push({ fromId: loopEntry.loopId, label: 'no' });
                        currentNode = null;
                        returnEncountered = false;
                        resumed = true;
                        break;
                    } else {
                        break;
                    }
                }
                if (!resumed) continue;
            }

            switch (stmt.type) {
                case 'if': {
                    let cond = this._cleanMermaidCond(stmt.condition);
                    const decisionId = nextId();
                    decisionNodes.push(decisionId);
                    lines.push(`    ${decisionId}{"${cond}"}`);
                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(decisionId);
                    } else {
                        addEdge(currentNode, decisionId);
                    }
                    currentNode = decisionId;
                    pendingBranchLabel = 'yes';
                    stack.push({ type: 'if', decisionId, hadElse: false });
                    decisionEndStack.push([]);
                    break;
                }
                case 'elseif': {
                    let cond = this._cleanMermaidCond(stmt.condition);
                    const oldDecision = stack[stack.length - 1];
                    if (oldDecision) oldDecision.hadElse = true;

                    const altLabel = nextId();
                    decisionNodes.push(altLabel);
                    lines.push(`    ${altLabel}{"${cond}"}`);
                    addEdge(oldDecision.decisionId, altLabel, 'no');
                    currentNode = altLabel;
                    pendingBranchLabel = 'yes';
                    returnEncountered = false;
                    stack.push({ type: 'if', decisionId: altLabel, hadElse: false });
                    decisionEndStack.push([]);
                    break;
                }
                case 'else': {
                    const oldDecision = stack[stack.length - 1];
                    if (oldDecision) oldDecision.hadElse = true;
                    currentNode = oldDecision ? oldDecision.decisionId : currentNode;
                    pendingBranchLabel = 'no';
                    returnEncountered = false;
                    break;
                }
                case 'close_brace': {
                    if (stmt.hasElse || stmt.hasCatch || stmt.hasFinally) {
                        if (currentNode) pendingBranchEnds.push(currentNode);
                        const top2 = stack[stack.length - 1];
                        if (top2 && top2.type === 'if') {
                            currentNode = top2.decisionId;
                        } else if (top2 && top2.type === 'try') {
                            currentNode = top2.tryId;
                        }
                        break;
                    }

                    if (stmt.hasWhile) {
                        const top = stack[stack.length - 1];
                        if (top && top.type === 'doloop') {
                            pendingDoWhile = stack.pop();
                            decisionEndStack.pop();
                            break;
                        }
                    }

                    const top = stack[stack.length - 1];
                    if (top && top.type === 'loop') {
                        const loopEntry = stack.pop();
                        decisionEndStack.pop();
                        addEdge(currentNode, loopEntry.loopId);
                        pendingExitEdges.push({ fromId: loopEntry.loopId, label: 'no' });
                        currentNode = null;
                        returnEncountered = false;
                        break;
                    }

                    const block = stack.pop();
                    if (block) {
                        const branches = decisionEndStack.pop() || [];
                        if (block.type === 'if' || block.type === 'try') {
                            while (pendingBranchEnds.length > 0) {
                                const pe = pendingBranchEnds.shift();
                                if (!branches.includes(pe)) branches.push(pe);
                            }
                            if (currentNode && !branches.includes(currentNode)) {
                                branches.push(currentNode);
                            }
                        }
                        if (branches.length >= 2) {
                            const mergeId = nextId();
                            mergeNodes.push(mergeId);
                            lines.push(`    ${mergeId}{" "}`);
                            for (const branch of branches) {
                                addEdge(branch, mergeId);
                            }
                            currentNode = mergeId;
                            returnEncountered = false;
                        } else if (branches.length === 1) {
                            if (block.type === 'if' && !block.hadElse) {
                                const mergeId = nextId();
                                mergeNodes.push(mergeId);
                                lines.push(`    ${mergeId}{" "}`);
                                addEdge(branches[0], mergeId);
                                addEdge(block.decisionId, mergeId, 'no');
                                currentNode = mergeId;
                            } else {
                                currentNode = branches[0];
                            }
                            returnEncountered = false;
                        } else if (block.type === 'if') {
                            currentNode = block.decisionId;
                            pendingBranchLabel = 'no';
                            returnEncountered = false;
                        }
                    }
                    break;
                }
                case 'while':
                case 'for': {
                    let cond = '';
                    if (stmt.type === 'while') {
                        cond = this._cleanMermaidCond(stmt.condition);
                    } else {
                        cond = this._cleanMermaidCond(stmt.condition).replace(/;/g, ', ');
                    }

                    if (pendingDoWhile) {
                        const doInfo = pendingDoWhile;
                        pendingDoWhile = null;
                        const loopId = nextId();
                        decisionNodes.push(loopId);
                        lines.push(`    ${loopId}{"${cond}"}`);
                        addEdge(currentNode, loopId);
                        addEdge(loopId, doInfo.bodyEntryId || doInfo.doId, 'yes');
                        pendingExitEdges.push({ fromId: loopId, label: 'no' });
                        currentNode = null;
                    } else {
                        const loopId = nextId();
                        const exitId = nextId();
                        decisionNodes.push(loopId);
                        lines.push(`    ${loopId}{"${cond}"}`);
                        if (!currentNode && pendingExitEdges.length > 0) {
                            resolvePendingExit(loopId);
                        } else {
                            addEdge(currentNode, loopId);
                        }
                        currentNode = loopId;
                        pendingBranchLabel = 'yes';
                        stack.push({ type: 'loop', loopId, exitId });
                        decisionEndStack.push([]);
                    }
                    break;
                }
                case 'do': {
                    const doId = nextId();
                    stack.push({ type: 'doloop', doId, bodyEntryId: null });
                    decisionEndStack.push([]);
                    break;
                }
                case 'switch': {
                    const switchId = nextId();
                    decisionNodes.push(switchId);
                    const label = this._escapeMermaidLabel(stmt.condition.replace(/[()]/g, '').trim());
                    lines.push(`    ${switchId}{"switch: ${label}"}`);
                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(switchId);
                    } else {
                        addEdge(currentNode, switchId);
                    }
                    currentNode = switchId;
                    stack.push({ type: 'switch', switchId });
                    break;
                }
                case 'case': {
                    const caseId = nextId();
                    const label = stmt.condition.replace(/[():]/g, '').trim();
                    lines.push(`    ${caseId}["case: ${this._escapeMermaidLabel(label)}"]`);
                    const parent = stack[stack.length - 1];
                    if (parent) {
                        addEdge(parent.switchId || parent.decisionId, caseId);
                    }
                    currentNode = caseId;
                    break;
                }
                case 'default': {
                    const defId = nextId();
                    lines.push(`    ${defId}["default"]`);
                    const parent = stack[stack.length - 1];
                    if (parent) {
                        addEdge(parent.switchId || parent.decisionId, defId, 'default');
                    }
                    currentNode = defId;
                    break;
                }
                case 'try': {
                    const tryId = nextId();
                    lines.push(`    ${tryId}{" "}`);
                    decisionNodes.push(tryId);
                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(tryId);
                    } else {
                        addEdge(currentNode, tryId);
                    }
                    currentNode = tryId;
                    stack.push({ type: 'try', tryId });
                    decisionEndStack.push([]);
                    break;
                }
                case 'catch': {
                    const label = stmt.condition.replace(/[();]/g, '').trim();
                    const tryBlock = [...stack].reverse().find(b => b.type === 'try');
                    if (tryBlock) {
                        pendingBranchLabel = label;
                        currentNode = tryBlock.tryId;
                    }
                    returnEncountered = false;
                    break;
                }
                case 'finally': {
                    const tryBlock = [...stack].reverse().find(b => b.type === 'try');
                    if (tryBlock) {
                        pendingBranchLabel = 'finally';
                        currentNode = tryBlock.tryId;
                    }
                    returnEncountered = false;
                    break;
                }
                case 'throw': {
                    const throwId = nextId();
                    const val = stmt.value ? stmt.value.trim() : '';
                    lines.push(`    ${throwId}["throw ${this._escapeMermaidLabel(val)}"]`);
                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(throwId);
                    } else {
                        addEdge(currentNode, throwId);
                    }
                    currentNode = throwId;
                    break;
                }
                case 'return': {
                    const returnVal = stmt.value ? stmt.value.trim() : '';
                    const retId = nextId();
                    const retLabel = returnVal ? `return ${returnVal}` : 'return';
                    lines.push(`    ${retId}["${this._escapeMermaidLabel(retLabel)}"]`);
                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(retId);
                    } else {
                        addEdge(currentNode, retId);
                    }
                    currentNode = null;
                    returnEncountered = true;
                    break;
                }
                case 'statement': {
                    let text = this._simplifyStatement(stmt.content.replace(/[;{}]/g, '').trim());
                    if (!text) break;
                    const id = nextId();
                    const label = this._escapeMermaidLabel(text);
                    lines.push(`    ${id}["${label}"]`);

                    const top = stack[stack.length - 1];
                    if (top && top.type === 'doloop' && !top.bodyEntryId) {
                        top.bodyEntryId = id;
                    }

                    if (!currentNode && pendingExitEdges.length > 0) {
                        resolvePendingExit(id);
                    } else {
                        addEdge(currentNode, id);
                    }
                    currentNode = id;
                    break;
                }
                case 'goto': {
                    const gotoId = nextId();
                    lines.push(`    ${gotoId}["goto ${this._escapeMermaidLabel(stmt.condition || '')}"]`);
                    addEdge(currentNode, gotoId);
                    currentNode = gotoId;
                    break;
                }
                case 'label': {
                    const labelId = nextId();
                    lines.push(`    ${labelId}["${this._escapeMermaidLabel(stmt.condition || '')}"]`);
                    if (currentNode) {
                        addEdge(currentNode, labelId);
                    }
                    currentNode = labelId;
                    break;
                }
            }
        }

        if (currentNode) {
            const stopId = nextId();
            lines.push(`    ${stopId}((◎))`);
            lines.push(`    style ${stopId} fill:#fff,stroke:#333,stroke-width:4px,color:#fff`);
            addEdge(currentNode, stopId);
            resolvePendingExit(stopId);
        } else if (pendingExitEdges.length > 0) {
            const stopId = nextId();
            lines.push(`    ${stopId}((◎))`);
            lines.push(`    style ${stopId} fill:#fff,stroke:#333,stroke-width:4px,color:#fff`);
            resolvePendingExit(stopId);
        }

        for (const dId of decisionNodes) {
            lines.push(`    style ${dId} fill:#FFF3CD,stroke:#f39c12,stroke-width:2px`);
        }

        for (const mId of mergeNodes) {
            lines.push(`    style ${mId} fill:#FFF3CD,stroke:#f39c12,stroke-width:2px`);
        }

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

module.exports = FlowchartProvider;
