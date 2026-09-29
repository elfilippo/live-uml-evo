const LanguageProvider = require('./LanguageProvider');
const StatementParser = require('../utils/StatementParser');

const VISIBILITY_SYMBOLS = {
    public: '+',
    private: '-',
    protected: '#',
    package: '~',
    internal: '~'
};

class BaseLanguageProvider extends LanguageProvider {
    constructor(language) {
        super(language);
    }

    parseFunctions(sourceCode) {
        const functions = [];
        const rawLines = sourceCode.split('\n');
        const cleanedLines = StatementParser.removeComments(sourceCode).split('\n');

        let i = 0;
        while (i < cleanedLines.length) {
            const funcMatch = this.matchFunctionStart(cleanedLines[i]);
            if (funcMatch) {
                const funcBody = this.extractFunctionBody(cleanedLines, i);
                if (funcBody) {
                    // Extract raw body from original source to preserve string content
                    const rawBody = rawLines.slice(i, funcBody.endLine + 1).join('\n');
                    functions.push({
                        name: funcMatch.name,
                        startLine: i,
                        body: funcBody.body,
                        rawBody: rawBody,
                        endLine: funcBody.endLine
                    });
                    i = funcBody.endLine + 1;
                    continue;
                }
            }
            i++;
        }
        return functions;
    }

    parseClasses(sourceCode) {
        const classes = [];
        const cleanedLines = StatementParser.removeComments(sourceCode).split('\n');

        let i = 0;
        while (i < cleanedLines.length) {
            let line = cleanedLines[i];
            let classMatch = this.matchClassStart(line);

            // Handle multi-line class declarations (e.g., implements/extends spanning multiple lines)
            if (classMatch && !line.includes('{')) {
                let j = i + 1;
                while (j < cleanedLines.length) {
                    const nextLine = cleanedLines[j];
                    line += ' ' + nextLine.trim();
                    classMatch = this.matchClassStart(line);
                    if (nextLine.includes('{') && classMatch) {
                        break;
                    }
                    j++;
                }
            }

            if (classMatch) {
                const classBody = this.extractClassBody(cleanedLines, i);
                if (classBody) {
                    const members = this.extractMembers(classBody.body, classMatch);
                    // A class is abstract either because the language's own keyword said so
                    // (Java/TS "abstract class") or, for languages with no such keyword
                    // (C++), because it declares at least one pure-virtual/abstract method.
                    const isAbstract = !!classMatch.isAbstract || members.methods.some(m => m.isAbstract);
                    classes.push({
                        name: classMatch.name,
                        parent: classMatch.parent || null,
                        extraParents: classMatch.extraParents || [],
                        interfaces: classMatch.interfaces || [],
                        supertypeArgs: classMatch.supertypeArgs || {},
                        isInterface: classMatch.isInterface || false,
                        isEnum: classMatch.isEnum || false,
                        isAbstract: isAbstract,
                        startLine: i,
                        body: classBody.body,
                        endLine: classBody.endLine,
                        methods: members.methods,
                        fields: members.fields
                    });
                    i = classBody.endLine + 1;
                    continue;
                }
            }
            i++;
        }
        return classes;
    }

    parseClassesLight(sourceCode) {
        const classes = [];
        const lines = sourceCode.split('\n');

        for (let i = 0; i < lines.length; i++) {
            let line = this._stripInlineComments(lines[i]);
            let classMatch = this.matchClassStart(line);

            // Handle multi-line class declarations
            if (classMatch && !line.includes('{')) {
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = this._stripInlineComments(lines[j]);
                    line += ' ' + nextLine.trim();
                    classMatch = this.matchClassStart(line);
                    if (nextLine.includes('{') && classMatch) {
                        break;
                    }
                    j++;
                }
            }

            if (classMatch) {
                classes.push({
                    name: classMatch.name,
                    parent: classMatch.parent || null,
                    extraParents: classMatch.extraParents || [],
                    interfaces: classMatch.interfaces || [],
                    supertypeArgs: classMatch.supertypeArgs || {},
                    isInterface: classMatch.isInterface || false,
                    isEnum: classMatch.isEnum || false,
                    isAbstract: classMatch.isAbstract || false,
                    methods: [],
                    fields: []
                });
            }
        }
        return classes;
    }

    extractMembers(body, classMatch = null) {
        const methods = [];
        const fields = [];
        const seenMethods = new Set();
        const seenSignatures = new Set();
        const seenFields = new Set();
        const lines = body.split('\n');
        const braceBased = this.language !== 'python';
        const state = this.createMemberState(body, classMatch);
        let depth = 0;

        for (const line of lines) {
            const depthBefore = depth;
            depth += this._braceDelta(line);

            // Members live at depth 1: inside the class body, not inside a method
            // body or a nested type. Depth is measured *before* this line's own
            // braces, so a method whose opening brace sits on the declaration
            // line is still seen.
            if (braceBased && depthBefore !== 1) continue;

            this.updateMemberState(line, state);

            const method = this.matchMemberFunction(line, state);
            if (method && method.name) {
                const signature = this.describeMethod(line, method, state);
                const key = `${signature.name}(${signature.params})`;
                if (!seenSignatures.has(key)) {
                    seenSignatures.add(key);
                    seenMethods.add(signature.name);
                    methods.push(signature);
                }
                continue;
            }

            const field = this.matchField(line, state);
            if (field && field.name && !seenFields.has(field.name)) {
                seenFields.add(field.name);
                fields.push(field);
            }
        }

        for (const extra of this.collectExtraFields(body, state)) {
            if (extra && extra.name && !seenFields.has(extra.name) && !seenMethods.has(extra.name)) {
                seenFields.add(extra.name);
                fields.push(extra);
            }
        }

        return { methods, fields };
    }

    extractMethods(body, classMatch = null) {
        return this.extractMembers(body, classMatch).methods;
    }

    extractFields(body, classMatch = null) {
        return this.extractMembers(body, classMatch).fields;
    }

    matchMemberFunction(line) {
        return this.matchFunctionStart(line);
    }

    describeMethod(line, match, state) {
        const modifiers = match.modifiers || '';
        return {
            name: match.name,
            type: match.returnType || '',
            params: match.params !== undefined && match.params !== null
                ? match.params
                : this.extractParams(line),
            visibility: match.visibility || this.defaultVisibility(state),
            isStatic: match.isStatic || /\bstatic\b/.test(modifiers),
            isAbstract: match.isAbstract || /\babstract\b/.test(modifiers)
        };
    }

    createMemberState() {
        return { visibility: null };
    }

    updateMemberState() { }

    defaultVisibility(state) {
        return (state && state.visibility) || '+';
    }

    matchField() {
        return null;
    }

    collectExtraFields() {
        return [];
    }

    visibilityOf(modifiers, fallback = '+') {
        if (!modifiers) return fallback;
        for (const key of Object.keys(VISIBILITY_SYMBOLS)) {
            if (new RegExp(`\\b${key}\\b`).test(modifiers)) return VISIBILITY_SYMBOLS[key];
        }
        return fallback;
    }

    extractParams(line) {
        const open = line.indexOf('(');
        if (open < 0) return '';
        let depth = 0;
        for (let i = open; i < line.length; i++) {
            if (line[i] === '(') depth++;
            else if (line[i] === ')') {
                depth--;
                if (depth === 0) return line.slice(open + 1, i).replace(/\s+/g, ' ').trim();
            }
        }
        return '';
    }

    matchClassStart(line) {
        return null;
    }

    _braceDelta(line) {
        let delta = 0;
        for (let ci = 0; ci < line.length; ci++) {
            if (line[ci] === '\\') { ci++; continue; }
            if (line[ci] === '{') delta++;
            else if (line[ci] === '}') delta--;
        }
        return delta;
    }

    _stripInlineComments(line) {
        const singleLineIdx = line.indexOf('//');
        if (singleLineIdx >= 0) line = line.substring(0, singleLineIdx);
        const blockStart = line.indexOf('/*');
        if (blockStart >= 0) {
            const blockEnd = line.indexOf('*/', blockStart + 2);
            if (blockEnd >= 0) {
                line = line.substring(0, blockStart) + line.substring(blockEnd + 2);
            }
        }
        return line;
    }

    extractClassBody(lines, startLine) {
        return this.extractFunctionBody(lines, startLine);
    }

    extractFunctionBody(lines, startLine) {
        if (this.language === 'python') {
            return this.extractPythonFunctionBody(lines, startLine);
        } else {
            return this.extractBraceFunctionBody(lines, startLine);
        }
    }

    extractPythonFunctionBody(lines, startLine) {
        const defLine = lines[startLine];
        const indentMatch = defLine.match(/^(\s*)/);
        const defIndent = indentMatch ? indentMatch[1].length : 0;
        let bodyLines = [defLine];

        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];
            const lineIndentMatch = line.match(/^(\s*)/);
            const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

            if (line.trim() === '' || line.trim().startsWith('#')) {
                bodyLines.push(line);
                continue;
            }
            if (lineIndent <= defIndent) {
                return { body: bodyLines.join('\n'), endLine: i - 1 };
            }
            bodyLines.push(line);
        }
        return { body: bodyLines.join('\n'), endLine: lines.length - 1 };
    }

    extractBraceFunctionBody(lines, startLine) {
        let braceCount = 0;
        let foundOpen = false;
        let bodyLines = [];

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            bodyLines.push(line);
            // Use index-based loop so we can skip escaped characters (e.g. \{ in regex literals)
            for (let ci = 0; ci < line.length; ci++) {
                if (line[ci] === '\\') { ci++; continue; } // skip escaped char
                if (line[ci] === '{') { braceCount++; foundOpen = true; }
                else if (line[ci] === '}') braceCount--;
            }
            if (foundOpen && braceCount === 0) {
                return { body: bodyLines.join('\n'), endLine: i };
            }
        }
        return null;
    }
}

BaseLanguageProvider.VISIBILITY_SYMBOLS = VISIBILITY_SYMBOLS;

module.exports = BaseLanguageProvider;
