const CLanguageProvider = require('./providers/languages/CLanguageProvider');
const JavaLanguageProvider = require('./providers/languages/JavaLanguageProvider');
const JavaScriptLanguageProvider = require('./providers/languages/JavaScriptLanguageProvider');
const PythonLanguageProvider = require('./providers/languages/PythonLanguageProvider');
const RustLanguageProvider = require('./providers/languages/RustLanguageProvider');

const PlantUMLFlowchartProvider = require('./providers/diagrams/plantuml/FlowchartProvider');
const PlantUMLSequenceProvider = require('./providers/diagrams/plantuml/SequenceProvider');
const PlantUMLClassProvider = require('./providers/diagrams/plantuml/ClassProvider');
const PlantUMLStateProvider = require('./providers/diagrams/plantuml/StateProvider');

const MermaidFlowchartProvider = require('./providers/diagrams/mermaid/FlowchartProvider');
const MermaidSequenceProvider = require('./providers/diagrams/mermaid/SequenceProvider');
const MermaidClassProvider = require('./providers/diagrams/mermaid/ClassProvider');
const MermaidStateProvider = require('./providers/diagrams/mermaid/StateProvider');

class ProviderRegistry {
    constructor() {
        this.languages = {
            'c': new CLanguageProvider(),
            'cpp': new CLanguageProvider(),
            'java': new JavaLanguageProvider(),
            'javascript': new JavaScriptLanguageProvider(),
            'typescript': new JavaScriptLanguageProvider(),
            'typescriptreact': new JavaScriptLanguageProvider(),
            'python': new PythonLanguageProvider(),
            'rust': new RustLanguageProvider()
        };
        this.diagrams = {
            'plantuml_flowchart': new PlantUMLFlowchartProvider(),
            'plantuml_sequence': new PlantUMLSequenceProvider(),
            'plantuml_class': new PlantUMLClassProvider(),
            'plantuml_state': new PlantUMLStateProvider(),
            'mermaid_flowchart': new MermaidFlowchartProvider(),
            'mermaid_sequence': new MermaidSequenceProvider(),
            'mermaid_class': new MermaidClassProvider(),
            'mermaid_state': new MermaidStateProvider()
        };
    }

    getLanguageProvider(language) {
        return this.languages[language] || this.languages['javascript'];
    }

    getDiagramProvider(type, format = 'plantuml') {
        return this.diagrams[format + '_' + type];
    }
}

const registry = new ProviderRegistry();

module.exports = registry;