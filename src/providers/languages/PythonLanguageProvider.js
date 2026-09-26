const BaseLanguageProvider = require('./BaseLanguageProvider');
const StatementParser = require('../utils/StatementParser');

class PythonLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('python');
    }

    matchFunctionStart(line) {
        const trimmed = line.trim();
        // Match just the start of def: def name( or async def name(
        const funcPattern = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;
        const match = trimmed.match(funcPattern);
        
        if (match && match[1]) {
            const keywords = ['if', 'else', 'while', 'for', 'try', 'except', 'class', 'import', 'from', 'with', 'async', 'await'];
            if (!keywords.includes(match[1])) return { name: match[1] };
        }
        return null;
    }

    parseClasses(sourceCode) {
        const classes = [];
        const cleanedLines = StatementParser.removeComments(sourceCode).split('\n');
        
        let i = 0;
        while (i < cleanedLines.length) {
            let line = cleanedLines[i];
            
            // Handle multi-line Python class declarations (parentheses spanning multiple lines)
            if (/^\s*class\s/.test(line) && line.includes('(') && !line.trim().endsWith(':')) {
                let j = i + 1;
                while (j < cleanedLines.length) {
                    const nextLine = cleanedLines[j];
                    line += ' ' + nextLine.trim();
                    if (nextLine.trim().endsWith(':')) {
                        break;
                    }
                    j++;
                }
            }
            
            const classMatch = this.matchClassStart(line);
            if (classMatch) {
                const classBody = this.extractClassBody(cleanedLines, i);
                if (classBody) {
                    const methods = this.extractMethods(classBody.body);
                    // Python has no "abstract" keyword: a class reads as abstract when it
                    // derives from ABC/ABCMeta, or declares an @abstractmethod.
                    const bases = [classMatch.parent, ...(classMatch.interfaces || [])].filter(Boolean);
                    const isAbstract = bases.includes('ABC') || bases.includes('ABCMeta') || /@abstractmethod\b/.test(classBody.body);
                    classes.push({
                        name: classMatch.name,
                        parent: classMatch.parent || null,
                        interfaces: classMatch.interfaces || [],
                        isInterface: classMatch.isInterface || false,
                        isAbstract: isAbstract,
                        startLine: i,
                        body: classBody.body,
                        endLine: classBody.endLine,
                        methods: methods
                    });
                    i = classBody.endLine + 1;
                    continue;
                }
            }
            i++;
        }
        return classes;
    }

    matchClassStart(line) {
        const trimmed = line.trim();
        // matches: class MyClass(Parent1, Parent2):
        const classPattern = /^\s*class\s+(\w+)(?:\(([\w\s,]+)\))?\s*:(?:\s*#.*)?$/;
        const match = trimmed.match(classPattern);
        if (match) {
            const parents = match[2] ? match[2].split(',').map(s => s.trim()) : [];
            return {
                name: match[1],
                parent: parents[0] || null,
                interfaces: parents.slice(1)
            };
        }
        return null;
    }

    extractMethods(body) {
        const methods = [];
        const lines = body.split('\n');
        const seen = new Set();

        // Determine class body indent: the class declaration is line 0, its body is indented deeper
        const classIndent = lines[0].match(/^(\s*)/)[1].length;
        let bodyIndent = null;

        for (const line of lines) {
            if (bodyIndent === null) {
                const lineIndent = line.match(/^(\s*)/)[1].length;
                if (line.trim() && !line.trim().startsWith('#') && lineIndent > classIndent) {
                    bodyIndent = lineIndent;
                }
            }
            const lineIndent = line.match(/^(\s*)/)[1].length;
            if (bodyIndent !== null && lineIndent > bodyIndent) continue; // Inside nested scope

            const match = this.matchFunctionStart(line);
            if (match && match.name && !seen.has(match.name)) {
                methods.push(match.name);
                seen.add(match.name);
            }
        }
        return methods;
    }
}

module.exports = PythonLanguageProvider;