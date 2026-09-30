const BaseLanguageProvider = require('./BaseLanguageProvider');
const StatementParser = require('../utils/StatementParser');

const ENUM_BASES = new Set(['Enum', 'IntEnum', 'StrEnum', 'Flag', 'IntFlag', 'ReprEnum']);

function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if (ch === '[' || ch === '(') depth++;
        else if (ch === ']' || ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

function normalizeAnnotation(text) {
    return text.trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/^(?:typing\.)?ClassVar\[([\s\S]*)\]$/, '$1')
        .replace(/^(?:typing\.)?Optional\[([\s\S]*)\]$/, '$1')
        .replace(/\s*\|\s*None\b|\bNone\s*\|\s*/g, '')
        .trim();
}

function inferType(expression, paramTypes) {
    const value = expression.replace(/\s+#.*$/, '').trim();
    if (!value) return '';
    const lead = /^(\w+)\s+(?:or|if)\b/.exec(value) || /^(\w+)$/.exec(value);
    if (lead && paramTypes.has(lead[1])) return paramTypes.get(lead[1]);
    const call = /\b([A-Z]\w*)\s*\(/.exec(value);
    if (value.startsWith('[')) return call ? `list[${call[1]}]` : 'list';
    if (value.startsWith('{')) return 'dict';
    if (/^[frbFRB]{0,2}['"]/.test(value)) return 'str';
    if (/^-?\d+$/.test(value)) return 'int';
    if (/^-?\d*\.\d+$/.test(value)) return 'float';
    if (/^(?:True|False)$/.test(value)) return 'bool';
    return call ? call[1] : '';
}

function fieldVisibility(name) {
    if (name.startsWith('__')) return '-';
    return name.startsWith('_') ? '#' : '+';
}

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
                    const fields = this.extractFields(classBody.body, classMatch);
                    const paramLists = this._paramLists(classBody.body);
                    // Python has no "abstract" keyword: a class reads as abstract when it
                    // derives from ABC/ABCMeta, or declares an @abstractmethod.
                    const bases = [classMatch.parent, ...(classMatch.extraParents || [])].filter(Boolean);
                    const isAbstract = bases.some(base => /(?:^|\.)(?:ABC|ABCMeta)$/.test(base))
                        || /\bmetaclass\s*=\s*(?:\w+\.)*ABCMeta\b/.test(line)
                        || /@abstractmethod\b/.test(classBody.body);
                    classes.push({
                        name: classMatch.name,
                        parent: classMatch.parent || null,
                        extraParents: classMatch.extraParents || [],
                        interfaces: [],
                        typeParams: classMatch.typeParams || [],
                        isInterface: classMatch.isInterface || false,
                        isEnum: classMatch.isEnum || false,
                        isAbstract: isAbstract,
                        startLine: i,
                        body: classBody.body,
                        endLine: classBody.endLine,
                        methods: methods,
                        fields: fields,
                        paramLists: paramLists,
                        language: this.language
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
        // matches: class MyClass(Parent1, pkg.Parent2, Generic[T], metaclass=Meta):
        const classPattern = /^\s*class\s+(\w+)(?:\s*\[([^\]]*)\])?\s*(?:\((.*)\))?\s*:(?:\s*#.*)?$/;
        const match = trimmed.match(classPattern);
        if (match) {
            const genericBase = match[3] ? splitTopLevel(match[3])
                .map(s => /^\s*(?:\w+\.)*(?:Generic|Protocol)\[([\s\S]*)\]\s*$/.exec(s))
                .find(Boolean) : null;
            const typeParams = this.parseTypeParameters(
                match[2] || (genericBase ? genericBase[1] : ''),
                param => (/^\**(\w+)/.exec(param) || [])[1]
            );
            const parents = match[3] ? splitTopLevel(match[3])
                .map(s => s.trim())
                .filter(s => s && !/^\*/.test(s) && !/^\w+\s*=(?!=)/.test(s))
                .map(s => s.replace(/\[[\s\S]*$/, '').trim())
                .filter(s => s && s.split('.').pop() !== 'Generic') : [];
            return {
                name: match[1],
                parent: parents[0] || null,
                extraParents: parents.slice(1),
                typeParams,
                isEnum: parents.some(p => ENUM_BASES.has(p.split('.').pop()))
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

    extractFields(body, classMatch = null) {
        const lines = body.split('\n');
        const classIndent = lines[0].match(/^(\s*)/)[1].length;
        const paramTypes = this._paramTypes(this._paramLists(body));
        const isEnum = !!(classMatch && classMatch.isEnum);
        const fields = [];
        const seen = new Set();
        const add = (name, type, isStatic) => {
            if (seen.has(name) || /^__\w+__$/.test(name)) return;
            seen.add(name);
            fields.push({ name, type, visibility: fieldVisibility(name), isStatic });
        };

        let bodyIndent = null;
        let inDocstring = false;
        for (const line of lines.slice(1)) {
            const quotes = (line.match(/"{3}|'{3}/g) || []).length;
            const wasInDocstring = inDocstring;
            if (quotes % 2 === 1) inDocstring = !inDocstring;
            if (wasInDocstring || quotes > 0) continue;

            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const indent = line.match(/^(\s*)/)[1].length;
            if (bodyIndent === null && indent > classIndent) bodyIndent = indent;

            if (indent === bodyIndent && !isEnum) {
                const annotated = /^(\w+)\s*:\s*([^=\s][^=]*?)\s*(?:=\s*(.*))?$/.exec(trimmed);
                if (annotated) {
                    add(annotated[1], normalizeAnnotation(annotated[2]), /^(?:typing\.)?ClassVar\b/.test(annotated[2]));
                    continue;
                }
                const plain = /^(\w+)\s*=(?!=)\s*(.*)$/.exec(trimmed);
                if (plain) {
                    add(plain[1], inferType(plain[2], paramTypes), true);
                    continue;
                }
            }

            const instance = /^self\.(\w+)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.*)$/.exec(trimmed);
            if (instance) {
                add(instance[1], instance[2] ? normalizeAnnotation(instance[2]) : inferType(instance[3], paramTypes), false);
            }
        }

        fields.forEach(field => {
            if (field.type && !/^(?:list|set|dict|tuple|deque)$/.test(field.type)) return;
            const element = this._elementType(body, field.name, paramTypes);
            if (element) field.type = `${field.type || 'list'}[${element}]`;
        });
        return fields;
    }

    _elementType(body, name, paramTypes) {
        const pattern = new RegExp(`\\bself\\.${name}\\s*\\.\\s*(?:append|appendleft|add|insert|extend)\\s*\\(([^\\n]*)\\)`, 'g');
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const argument = splitTopLevel(match[1]).pop().trim();
            const type = paramTypes.get(argument) || (/\b([A-Z]\w*)\s*\(/.exec(argument) || [])[1];
            if (type) return type;
        }
        return '';
    }

    _paramLists(body) {
        const lists = [];
        const pattern = /^[ \t]*(?:async\s+)?def\s+\w+\s*\(/gm;
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const open = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = open; i < body.length; i++) {
                if (body[i] === '(') depth++;
                else if (body[i] === ')' && --depth === 0) {
                    lists.push(body.slice(open + 1, i).replace(/\s+/g, ' ').trim());
                    break;
                }
            }
        }
        return lists;
    }

    _paramTypes(paramLists) {
        const types = new Map();
        paramLists.forEach(list => splitTopLevel(list).forEach(param => {
            const match = /^\*{0,2}(\w+)\s*:\s*([^=]+?)\s*(?:=.*)?$/.exec(param.trim());
            if (match && match[1] !== 'self' && match[1] !== 'cls' && !types.has(match[1])) {
                types.set(match[1], normalizeAnnotation(match[2]));
            }
        }));
        return types;
    }
}

module.exports = PythonLanguageProvider;