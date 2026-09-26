/**
 * TreeSitterProvider — Singleton that manages web-tree-sitter WASM loading
 * and provides per-language CST parsers.
 *
 * Initialization is lazy — triggered on first call to `ready()`, `parse()`,
 * or `createQuery()`.  Call `ready()` to await completion.
 *
 * Language WASM files come from npm packages tree-sitter-{lang}.
 */

const path = require('path');
const mod = require('web-tree-sitter');
const Parser = mod.default.Parser;
const Language = mod.default.Language;
const Query = mod.default.Query;

const _WASM_DIR = path.resolve(__dirname, '..', '..', '..', 'node_modules');

const _LANG_MAP = {
  c:   { wasm: 'tree-sitter-c/tree-sitter-c.wasm' },
  cpp: { wasm: 'tree-sitter-cpp/tree-sitter-cpp.wasm' },
  java:{ wasm: 'tree-sitter-java/tree-sitter-java.wasm' },
  py:  { wasm: 'tree-sitter-python/tree-sitter-python.wasm' },
  js:  { wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm' },
  ts:  { wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm' },
};

class TreeSitterProvider {
  constructor() {
    this._ready = false;
    this._initError = null;
    this._parsers = new Map();
    this._initPromise = null;
  }

  async _init() {
    try {
      await Parser.init();
    } catch (e) {
      this._initError = e;
      console.warn('TreeSitterProvider: core init failed', e);
      return;
    }
    await Promise.all(Object.entries(_LANG_MAP).map(async ([norm, cfg]) => {
      const wasmPath = path.join(_WASM_DIR, cfg.wasm);
      if (!require('fs').existsSync(wasmPath)) {
        return; // skip silently — WASM not bundled (e.g. test env)
      }
      try {
        const lang = await Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(lang);
        this._parsers.set(norm, parser);
      } catch (e) {
        console.warn('TreeSitterProvider: failed to load ' + norm, e);
      }
    }));
    this._ready = true;
  }

  ready() {
    if (!this._initPromise) {
      this._initPromise = this._init();
    }
    return this._initPromise;
  }
  isReady() { return this._ready; }

  _normalize(language) {
    const MAP = { python: 'py', javascript: 'js', typescript: 'ts', tsx: 'ts' };
    return MAP[language.toLowerCase()] || language.toLowerCase();
  }

  /** Parse source code, returns Tree or null. */
  async parse(code, language) {
    await this.ready();
    const norm = this._normalize(language);
    const parser = this._parsers.get(norm);
    if (!parser) return null;
    try {
      return parser.parse(code);
    } catch (e) {
      console.warn('TreeSitterProvider: parse failed', e);
      return null;
    }
  }

  /** Create a Query for the given language. Returns Query or null. */
  async createQuery(language, pattern) {
    await this.ready();
    const norm = this._normalize(language);
    const parser = this._parsers.get(norm);
    if (!parser) return null;
    try {
      return new Query(parser.getLanguage(), pattern);
    } catch (e) {
      console.warn('TreeSitterProvider: createQuery failed for ' + norm, e);
      return null;
    }
  }
}

module.exports = new TreeSitterProvider();
