const VERBOSE = false;

let _outputChannel = null;

function _vscode() {
    try { return require('vscode'); } catch (e) { return null; }
}

function getChannel() {
    if (!_outputChannel) {
        const vs = _vscode();
        if (vs) {
            _outputChannel = vs.window.createOutputChannel('Live Uml Evo');
        } else {
            _outputChannel = { appendLine: () => { } };
        }
    }
    return _outputChannel;
}

function _format(...args) {
    return args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
}

function log(...args) {
    if (!VERBOSE) return;
    const ts = new Date().toISOString().slice(11, 23);
    getChannel().appendLine(`[${ts}] ${_format(...args)}`);
}

function warn(...args) {
    if (!VERBOSE) return;
    const ts = new Date().toISOString().slice(11, 23);
    getChannel().appendLine(`[${ts}] WARN: ${_format(...args)}`);
}

function error(...args) {
    if (!VERBOSE) return;
    const ts = new Date().toISOString().slice(11, 23);
    getChannel().appendLine(`[${ts}] ERROR: ${_format(...args)}`);
}

module.exports = { log, warn, error, VERBOSE };
