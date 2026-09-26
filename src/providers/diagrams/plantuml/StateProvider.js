const PlantUMLDiagramProvider = require('./PlantUMLDiagramProvider');

class PlantUMLStateProvider extends PlantUMLDiagramProvider {
    generate(targetName, allFunctions, language, selectedStateVar = null) {
        const targetFunc = allFunctions.find(f => f.name === targetName);
        if (!targetFunc) {
            return {
                uml: '@startuml\nrectangle "No state transitions detected" as NA\n@enduml',
                eligible: false,
                externalGuesses: [],
                stateVars: [],
                activeStateVar: null
            };
        }

        const result = this.analyzer.analyze(targetName, targetFunc.body, allFunctions, language);
        if (!result.eligible) {
            return {
                uml: '@startuml\nrectangle "No state transitions detected" as NA\n@enduml',
                eligible: false,
                externalGuesses: result.externalGuesses || [],
                stateVars: [],
                activeStateVar: null
            };
        }

        // Group transitions by variable to find all candidates
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
            uml: this._buildStatePlantUML(targetName, result.transitions, result.extraStates || new Map(), activeStateVar, stateVars),
            eligible: true,
            externalGuesses: result.externalGuesses,
            stateVars,
            activeStateVar
        };
    }

    _buildStatePlantUML(targetName, transitions, extraStates, activeStateVar, stateVars) {
        const uml = [];
        uml.push('@startuml');
        uml.push('title ' + targetName + ' \u2014 ' + activeStateVar);
        uml.push('!pragma layout smetana');

        uml.push('skinparam state {');
        uml.push('  BackgroundColor #FEFEFE');
        uml.push('  ArrowColor #2980b9');
        uml.push('  BorderColor #2980b9');
        uml.push('  FontStyle bold');
        uml.push('}');
        uml.push('skinparam shadowing false');

        // Group transitions by variable
        const byVar = new Map();
        for (const t of transitions) {
            const varName = t.variable || 'state';
            if (!byVar.has(varName)) byVar.set(varName, []);
            byVar.get(varName).push(t);
        }

        // Also include variables that have case labels but no transitions (e.g., switch-only state vars)
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

        // Add extra states for switch case labels
        if (extraStates && extraStates.has(activeStateVar)) {
            for (const s of extraStates.get(activeStateVar)) stateSet.add(s);
        }

        initialStates.forEach(t => {
            uml.push('[*] --> ' + t.toState + ' : initial');
        });

        stateSet.forEach(s => {
            uml.push('state ' + s);
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
                uml.push(edge.fromState + ' --> ' + edge.toState + ' : ' + labels.join('\\n'));
            } else {
                uml.push(edge.fromState + ' --> ' + edge.toState);
            }
        });

        // Add Note listing other state variables if any
        const otherVars = stateVars.filter(v => v !== activeStateVar);
        if (otherVars.length > 0) {
            uml.push('');
            uml.push('note as N1');
            uml.push(`  <b>Active State:</b> ${activeStateVar}`);
            uml.push('  ..');
            uml.push('  <b>Click to switch:</b>');
            otherVars.forEach(v => {
                uml.push(`  * [[command:extension.selectStateVar?${v} ${v}]]`);
            });
            uml.push('end note');
        }

        uml.push('@enduml');
        return uml.join('\n');
    }
}
module.exports = PlantUMLStateProvider;
