/**
 * Core Module - Language-agnostic function parsing and statement extraction
 * Refactored to use modular providers.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const zlib = require('zlib');
const net = require('net');
const registry = require('./Registry');
const LineParser = require('./providers/utils/LineParser');
const _lineParser = new LineParser();
const extractStatements = (body, language) => _lineParser.parseStatements(body, language);

/* =========================
   DELEGATED PARSING
   ========================= */

function parseCFunctions(sourceCode) {
    return registry.getLanguageProvider('c').parseFunctions(sourceCode);
}

function parseJavaFunctions(sourceCode) {
    return registry.getLanguageProvider('java').parseFunctions(sourceCode);
}

function parseJavaScriptFunctions(sourceCode) {
    return registry.getLanguageProvider('javascript').parseFunctions(sourceCode);
}

function parsePythonFunctions(sourceCode) {
    return registry.getLanguageProvider('python').parseFunctions(sourceCode);
}

/* =========================
   DELEGATED DIAGRAM GENERATION
   ========================= */

function generateFlowchart(name, body, language, format = 'plantuml') {
    return registry.getDiagramProvider('flowchart', format).generate(name, body, language);
}

function generateSequenceDiagram(name, body, language, format = 'plantuml') {
    return registry.getDiagramProvider('sequence', format).generate(name, body, language);
}

function parseJavaClasses(sourceCode) {
    return registry.getLanguageProvider('java').parseClasses(sourceCode);
}

function parsePythonClasses(sourceCode) {
    return registry.getLanguageProvider('python').parseClasses(sourceCode);
}

function parseJavaScriptClasses(sourceCode) {
    return registry.getLanguageProvider('javascript').parseClasses(sourceCode);
}

function parseTypeScriptClasses(sourceCode) {
    return registry.getLanguageProvider('typescript').parseClasses(sourceCode);
}

function parseCppClasses(sourceCode) {
    return registry.getLanguageProvider('cpp').parseClasses(sourceCode);
}

function generateClassDiagram(targetClassName, classes, language, format = 'plantuml') {
    return registry.getDiagramProvider('class', format).generate(targetClassName, classes, language);
}

function generateStateDiagram(targetName, allFunctions, language, selectedStateVar = null, format = 'plantuml') {
    return registry.getDiagramProvider('state', format).generate(targetName, allFunctions, language, selectedStateVar);
}

/* =========================
   PLANTUML SVG GENERATOR
   ========================= */

async function findAvailablePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(findAvailablePort(startPort + 1));
            } else {
                reject(err);
            }
        });
        server.listen(startPort, () => {
            const { port } = server.address();
            server.close(() => {
                resolve(port);
            });
        });
    });
}

function encode6bit(b) {
    if (b < 10) return String.fromCharCode(48 + b);
    if (b < 36) return String.fromCharCode(65 + b - 10);
    if (b < 62) return String.fromCharCode(97 + b - 36);
    if (b === 62) return '-';
    if (b === 63) return '_';
    return '?';
}

function append3bytes(b1, b2, b3) {
    let c1 = b1 >> 2;
    let c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
    let c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
    let c4 = b3 & 0x3F;
    let r = "";
    r += encode6bit(c1 & 0x3F);
    r += encode6bit(c2 & 0x3F);
    r += encode6bit(c3 & 0x3F);
    r += encode6bit(c4 & 0x3F);
    return r;
}

function encode64(data) {
    let r = "";
    for (let i = 0; i < data.length; i += 3) {
        if (i + 2 === data.length) {
            r += append3bytes(data[i], data[i + 1], 0);
        } else if (i + 1 === data.length) {
            r += append3bytes(data[i], 0, 0);
        } else {
            r += append3bytes(data[i], data[i + 1], data[i + 2]);
        }
    }
    return r;
}

function plantumlEncode(text) {
    const data = Buffer.from(text, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    return encode64(compressed);
}

const logger = require('./Logger');

async function generatePlantUMLSVGServer(plantUmlCode, serverUrl) {
    const encoded = plantumlEncode(plantUmlCode);
    const url = `${serverUrl}/svg/${encoded}`;
    logger.log(`core.generatePlantUMLSVGServer: requesting ${url}`);
    
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'Connection': 'close' }
        };
        const req = http.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                logger.log(`core.generatePlantUMLSVGServer: status=${res.statusCode}, data.length=${data.length}`);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`Server responded with ${res.statusCode}`));
                }
            });
        });
        req.on('error', (err) => {
            logger.error(`core.generatePlantUMLSVGServer: ${err.message}`);
            reject(err);
        });
        req.setTimeout(5000, () => {
            logger.warn('core.generatePlantUMLSVGServer: request timeout');
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function generatePlantUMLSVGLocal(plantUmlCode, javaPath, jarPath) {
    const cmd = `"${javaPath}" -Djava.awt.headless=true -jar "${jarPath}" -tsvg -pipe`;
    const result = await new Promise((resolve, reject) => {
        const child = require('child_process').exec(
            cmd,
            { maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            }
        );
        child.stdin.write(plantUmlCode);
        child.stdin.end();
    });

    if (result && result.trim().length > 0) {
        return result;
    }

    throw new Error('SVG not generated');
}

async function generatePlantUMLSVG(plantUmlCode, context, serverUrl) {
    if (serverUrl) {
        try {
            return await generatePlantUMLSVGServer(plantUmlCode, serverUrl);
        } catch (err) {
            console.error('PlantUML Server Error (falling back):', err.message);
        }
    }

    let javaPath = 'java';
    try {
        const vscode = require('vscode');
        const config = vscode.workspace.getConfiguration('liveUmlEvo');
        javaPath = config.get('javaPath', 'java');
    } catch (e) {
        javaPath = 'java';
    }
    const jarPath = path.join(__dirname, '..', 'plantuml', 'plantuml.jar');

    if (!fs.existsSync(jarPath)) {
        throw new Error('Java or PlantUML jar missing');
    }

    try {
        return await generatePlantUMLSVGLocal(plantUmlCode, javaPath, jarPath);
    } catch (err) {
        return `<svg width="400" height="100">
        <text x="10" y="50" fill="red">Java/PlantUML Error: ${err.message}</text>
        </svg>`;
    }
}

function cleanExpression(expr) {
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

module.exports = {
    parseCFunctions,
    parseJavaFunctions,
    parseJavaScriptFunctions,
    parsePythonFunctions,
    extractStatements,
    cleanExpression,
    generateFlowchart,
    generateSequenceDiagram,
    generateClassDiagram,
    generateStateDiagram,
    parseJavaClasses,
    parsePythonClasses,
    parseJavaScriptClasses,
    parseTypeScriptClasses,
    parseCppClasses,
    generatePlantUMLSVG,
    generatePlantUMLSVGLocal,
    generatePlantUMLSVGServer,
    findAvailablePort,
    plantumlEncode
};
