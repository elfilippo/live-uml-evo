const DiagramProvider = require('../DiagramProvider');
const LineParser = require('../../utils/LineParser');
const StateAnalyzer = require('../../utils/StateAnalyzer');

class PlantUMLDiagramProvider extends DiagramProvider {
    constructor() {
        super();
        this.parser = new LineParser();
        this.analyzer = new StateAnalyzer();
    }

    _cleanExpression(expr) {
        if (!expr) return '';
        let cleaned = expr;
        cleaned = cleaned.replace(/\(\s*(?:auto|int|float|double|char|byte|short|long|boolean|unsigned|signed|void|size_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t)\s*\*?\s*\)\s*/g, '');
        cleaned = cleaned.replace(/\b(auto|int|float|double|char|byte|short|long|boolean|var|let|const|unsigned|signed)\s+/g, '');
        cleaned = cleaned.replace(/(\w+(?:\.\w+)*)\s*\(([^)]*)\)/g, (match, func, args) => {
            if (args.trim()) return func + '(..)';
            return func + '()';
        });
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
    }

    _simplifyStatement(text) {
        if (!text) return text;

        let simplified = text;

        simplified = simplified.replace(/^(auto|int|float|double|char|byte|short|long|boolean|String|var|let|const|unsigned|signed|void)\s+/, '');
        simplified = simplified.replace(/^[A-Za-z_]\w*\s+\w+\s*=\s*(\w+\s*\()/, '$1');
        simplified = simplified.replace(/\(\s*(?:auto|int|float|double|char|byte|short|long|boolean|unsigned|signed|void|size_t)\s*\*?\s*\)\s*/g, '');

        simplified = simplified.replace(/\n/g, ' ');
        simplified = simplified.replace(/\s+/g, ' ');
        simplified = simplified.replace(/(\w+\.)*(\w+)\s*\(([^)]*)\)/g, (match, prefix, method, args) => {
            if (args.trim()) {
                return method + '(..)';
            }
            return method + '()';
        });

        simplified = simplified.replace(/^(\w+)\s*=\s*(.+)$/, (match, varName, expr) => {
            if (expr.match(/^\w+\(/)) {
                return expr;
            }
            if (expr.length > 30) {
                expr = expr.substring(0, 27) + '...';
            }
            return varName + ' = ' + expr;
        });

        simplified = simplified.replace(/^try\s*\(([^)]+)\)/, (match, resource) => {
            const cleanResource = resource.replace(/\w+\s+(\w+)\s*=.*/, '$1');
            return 'try (' + cleanResource + ')';
        });

        simplified = simplified.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

        if (simplified.length > 50) {
            simplified = simplified.substring(0, 47) + '...';
        }

        return simplified;
    }

    _extractMethodCalls(line, functionName) {
        const calls = [];
        const methodCallPattern = /(\w+(?:\.\w+)*)\([^)]*\)/g;
        let match;
        while ((match = methodCallPattern.exec(line)) !== null) {
            const fullCall = match[1];
            const parts = fullCall.split('.');
            if (parts.length >= 2) {
                const object = parts[0];
                const method = parts.slice(1).join('.');
                if (!['console', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number',
                       'System', 'Integer', 'Boolean', 'Float', 'Double', 'Character',
                       'Byte', 'Short', 'Long', 'this', 'super', 'Promise'].includes(object)) {
                    calls.push({ object, method });
                }
            } else if (parts.length === 1 && !['if', 'while', 'for', 'switch', 'return',
                                                 'else', 'elif', 'case', 'break', 'continue',
                                                 'print', 'println', 'printf', 'len', 'range',
                                                 'int', 'float', 'double', 'char', 'byte',
                                                 'short', 'long', 'boolean', 'void',
                                                 'sizeof', 'typeof', 'instanceof',
                                                 'throw', 'catch', 'try', 'finally',
                                                 'assert', 'delete', 'new'].includes(parts[0])) {
                calls.push({ object: functionName || 'System', method: parts[0] });
            }
        }
        return calls;
    }
}

module.exports = PlantUMLDiagramProvider;
