const MermaidDiagramProvider = require('./MermaidDiagramProvider');

class StateProvider extends MermaidDiagramProvider {
    generate(targetName, allFunctions, language, selectedStateVar = null) {
        const targetFunc = allFunctions.find(f => f.name === targetName);
        if (!targetFunc) {
            return {
                mermaidCode: '',
                eligible: false,
                externalGuesses: [],
                stateVars: [],
                activeStateVar: null
            };
        }

        const result = this.analyzer.analyze(targetName, targetFunc.body, allFunctions, language);
        if (!result.eligible) {
            return {
                mermaidCode: '',
                eligible: false,
                externalGuesses: result.externalGuesses || [],
                stateVars: [],
                activeStateVar: null
            };
        }

        const byVar = new Map();
        for (const t of result.transitions) {
            const varName = t.variable || 'state';
            if (!byVar.has(varName)) byVar.set(varName, []);
            byVar.get(varName).push(t);
        }
        if (result.extraStates) {
            for (const [varName] of result.extraStates) {
                if (!byVar.has(varName)) byVar.set(varName, []);
            }
        }

        const stateVars = Array.from(byVar.keys());
        let activeStateVar = null;
        if (stateVars.length > 0) {
            activeStateVar = (selectedStateVar && stateVars.includes(selectedStateVar))
                ? selectedStateVar
                : stateVars[0];
        }

        return {
            mermaidCode: this._buildStateMermaid(targetName, result.transitions, result.extraStates || new Map(), activeStateVar, stateVars),
            eligible: true,
            externalGuesses: result.externalGuesses,
            stateVars,
            activeStateVar
        };
    }

    _buildStateMermaid(targetName, transitions, extraStates, activeStateVar, stateVars) {
        const lines = [];
        lines.push('stateDiagram-v2');

        const byVar = new Map();
        for (const t of transitions) {
            const varName = t.variable || 'state';
            if (!byVar.has(varName)) byVar.set(varName, []);
            byVar.get(varName).push(t);
        }

        if (extraStates) {
            for (const [varName] of extraStates) {
                if (!byVar.has(varName)) byVar.set(varName, []);
            }
        }

        const singleTransitions = byVar.get(activeStateVar) || [];
        const stateSet = new Set();
        const initialStates = [];

        singleTransitions.forEach(t => {
            if (t.toState) stateSet.add(t.toState);
            if (t.isInitial) initialStates.push(t);
            if (t.fromState) stateSet.add(t.fromState);
        });

        if (extraStates && extraStates.has(activeStateVar)) {
            for (const s of extraStates.get(activeStateVar)) stateSet.add(s);
        }

        initialStates.forEach(t => {
            lines.push(`    [*] --> ${t.toState} : initial`);
        });

        stateSet.forEach(s => {
            lines.push(`    state ${s}`);
        });

        const edgeMap = new Map();
        singleTransitions.forEach(t => {
            if (t.isInitial) return;
            const key = t.fromState + '-->' + t.toState;
            if (!edgeMap.has(key)) {
                edgeMap.set(key, { fromState: t.fromState, toState: t.toState, causes: [] });
            }
            if (t.triggerCondition) {
                edgeMap.get(key).causes.push(t.triggerCondition.value);
            }
        });

        edgeMap.forEach(edge => {
            if (edge.causes.length > 0) {
                const labels = [...new Set(edge.causes)];
                lines.push(`    ${edge.fromState} --> ${edge.toState} : ${labels.join(', ')}`);
            } else {
                lines.push(`    ${edge.fromState} --> ${edge.toState}`);
            }
        });

        const otherVars = stateVars.filter(v => v !== activeStateVar);
        if (otherVars.length > 0) {
            lines.push('');
            lines.push('    note right of ' + activeStateVar);
            lines.push(`      <b>Active:</b> ${activeStateVar}`);
            lines.push('      <b>Switch to:</b>');
            otherVars.forEach(v => {
                lines.push(`      ${v}`);
            });
            lines.push('    end note');
        }

        return lines.join('\n');
    }
}

module.exports = StateProvider;
