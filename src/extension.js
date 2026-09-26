const vscode = require("vscode");
const core = require("./core.js");
const registry = require("./registry");
const { spawn } = require("child_process");
const { getWebviewHtml } = require("./webview");
const crypto = require("crypto");
const path = require("path");
const tsProvider = require("./providers/utils/TreeSitterProvider");
const Visualizer = require("./visualizer");
const logger = require("./logger");
const RelationshipAnalyzer = require("./providers/analysis/RelationshipAnalyzer");
const MermaidProjectClassProvider = require("./providers/diagrams/mermaid/ProjectClassProvider");
const PlantUMLProjectClassProvider = require("./providers/diagrams/plantuml/ProjectClassProvider");
const { getProjectWebviewHtml } = require("./projectWebview");

let sidebarProvider = null;
let currentLanguage = "";
let plantUmlServer = null;
let _typingInProgress = false;

class PlantUmlServerManager {
    constructor() {
        this.process = null;
        this.port = null;
    }

    async start() {
        const config = vscode.workspace.getConfiguration("liveUmlEvo");
        const javaPath = config.get("javaPath", "java");
        const jarPath = path.join(__dirname, "..", "plantuml", "plantuml.jar");

        try {
            this.port = await core.findAvailablePort(8080);
            logger.log(`Starting PlantUML server on port ${this.port} with java=${javaPath}`);
            console.log(`Live Uml Evo: Starting PlantUML server on port ${this.port}`);

            this.process = spawn(javaPath, ["-Djava.awt.headless=true", "-jar", jarPath, `-picoweb:${this.port}`]);

            this.process.stdout.on("data", (data) => {
                logger.log(`PlantUML Server stdout: ${data}`);
                console.log(`PlantUML Server: ${data}`);
            });
            this.process.stderr.on("data", (data) => {
                logger.warn(`PlantUML Server stderr: ${data}`);
                console.error(`PlantUML Server Error: ${data}`);
            });
            this.process.on("close", (code) => {
                logger.log(`PlantUML Server exited with code ${code}`);
                console.log(`PlantUML Server exited with code ${code}`);
                this.process = null;
                this.port = null;
            });

            await new Promise((resolve) => setTimeout(resolve, 1500));
            const url = this.getUrl();
            logger.log(`PlantUML server ready at ${url}`);
            return url;
        } catch (err) {
            logger.error(`Failed to start PlantUML server: ${err.message}`);
            console.error("Failed to start PlantUML server:", err);
            return null;
        }
    }

    stop() {
        logger.log("Stopping PlantUML server");
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.port = null;
        }
    }

    getUrl() {
        return this.port ? `http://localhost:${this.port}` : null;
    }
}

function activate(context) {
    logger.log("Extension activating");
    console.log("Live Uml Evo Extension Active");

    plantUmlServer = new PlantUmlServerManager();
    plantUmlServer.start();

    // Tree-sitter WASM is loaded lazily on demand (only for state diagrams).
    // Eager loading all 6 language WASM files (~7 MB) at activation blocks
    // the event loop with WebAssembly compilation for ~20-30 seconds.
    // See generate() where !tsProvider.isReady() triggers lazy loading.
    sidebarProvider = new LiveUmlSidebar(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("liveUmlEvoSidebar-webview", sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("liveUmlEvo.refresh", () => {
            if (sidebarProvider && sidebarProvider.isViewVisible()) sidebarProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("extension.openClass", async (className) => {
            if (!className || !sidebarProvider) return;

            // Every class box in the diagram is clickable, including the currently
            // active one — clicking it (or clicking the same box twice) used to always
            // re-open its file and force a regenerate via the hash-clear below, which
            // is why the diagram appeared to "reload" on ordinary clicks in the
            // preview. If it's already what's showing, there's nothing to do.
            if (sidebarProvider.currentDiagramType === "class" && sidebarProvider.currentClassName === className) {
                logger.log(`extension.openClass: ${className} is already active, skipping`);
                return;
            }

            sidebarProvider.post({ type: "loading", name: className });

            // Determine the current language extension to avoid cross-language navigation
            const activeExt =
                vscode.window.activeTextEditor ? path.extname(vscode.window.activeTextEditor.document.uri.fsPath) : "";

            // Strategy 1: Fast Cache Lookup (O(1) after initial scan)
            let targetUri = null;
            if (activeExt) {
                if (sidebarProvider && sidebarProvider._classCache.has(activeExt)) {
                    const cachedClasses = sidebarProvider._classCache.get(activeExt);
                    const match = cachedClasses.find((c) => c.name === className);
                    if (match && match.fileUri) {
                        targetUri = match.fileUri;
                    }
                }

                // Strategy 2: Direct file search (Fallback if cache missed)
                if (!targetUri) {
                    try {
                        const langFiles = await vscode.workspace.findFiles(`**/*${activeExt}`, "**/node_modules/**");
                        const languageId =
                            activeExt === ".java" ? "java"
                            : activeExt === ".py" ? "python"
                            : activeExt === ".ts" ? "typescript"
                            : activeExt === ".cpp" || activeExt === ".cc" || activeExt === ".cxx" ? "cpp"
                            : "javascript";
                        const provider = registry.getLanguageProvider(languageId);

                        for (const file of langFiles) {
                            try {
                                const bytes = await vscode.workspace.fs.readFile(file);
                                const content = Buffer.from(bytes).toString("utf8");
                                const parsed = provider.parseClasses(content);
                                if (parsed.some((c) => c.name === className)) {
                                    targetUri = file;
                                    break;
                                }
                            } catch (e) {
                                /* skip unreadable files */
                            }
                        }
                    } catch (e) {
                        console.warn("Live Uml Evo: direct file search failed, falling back to symbol provider", e);
                    }
                }
            }

            // Strategy 2: Workspace symbol provider as fallback, scoped to the current language
            if (!targetUri) {
                let symbols = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", className);

                // Filter to the current language extension to prevent cross-language navigation
                const langSymbols =
                    activeExt ? symbols?.filter((s) => s.location.uri.fsPath.endsWith(activeExt)) : symbols;

                const candidates = langSymbols && langSymbols.length > 0 ? langSymbols : symbols;

                let symbol = candidates?.find((s) => {
                    const isTarget = s.name === className || s.name.endsWith("." + className);
                    const isCorrectKind =
                        s.kind === vscode.SymbolKind.Class ||
                        s.kind === vscode.SymbolKind.Interface ||
                        s.kind === vscode.SymbolKind.Struct;
                    return isTarget && isCorrectKind;
                });
                if (!symbol) {
                    symbol = candidates?.find((s) => s.name === className || s.name.endsWith("." + className));
                }
                if (symbol) targetUri = symbol.location.uri;
            }

            if (targetUri) {
                const doc = await vscode.workspace.openTextDocument(targetUri);

                // Claim the target before navigating. onDidChangeActiveTextEditor (below)
                // resets currentClassName whenever the URI it sees doesn't match what it
                // last knew about — which is exactly right for an unprompted file switch,
                // but here we already know precisely which class we're navigating to. Set
                // both first so that listener sees no mismatch, fires its own refresh() as
                // it normally would, but with the correct target already in place — instead
                // of it also seeing null and racing this handler's own refresh() below with
                // a fallback guess (whichever class happens to be first in the file).
                sidebarProvider._lastKnownEditorUri = targetUri.toString();
                sidebarProvider.currentClassName = className;
                sidebarProvider.currentDiagramType = "class";

                await vscode.window.showTextDocument(doc);

                // Clear hash state so the diagram always re-generates after navigation
                sidebarProvider._lastClassHash = null;
                sidebarProvider._lastClassName = null;
                // Small delay to let VS Code register the new active editor
                setTimeout(() => sidebarProvider.refresh(), 100);
            } else {
                // Not found — clear loading by re-generating current view
                sidebarProvider._lastClassHash = null;
                sidebarProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("extension.selectStateVar", async (stateVar) => {
            if (!stateVar || !sidebarProvider) return;
            const functionName = sidebarProvider.currentFunctionName;
            if (functionName) {
                sidebarProvider.selectedStateVars.set(functionName, stateVar);
            }
            sidebarProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("extension.openFunction", async (functionName) => {
            if (!functionName || !sidebarProvider) return;

            // Immediate visual feedback
            sidebarProvider.post({ type: "loading", name: functionName });

            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const functions = parseFunctions(editor.document);
                const func = functions.find((f) => f.name === functionName);
                if (func) {
                    const lines = editor.document.getText().split("\n");
                    const firstLine = func.body.split("\n")[0];
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes(firstLine)) {
                            editor.selection = new vscode.Selection(i, 0, i, 0);
                            editor.revealRange(new vscode.Range(i, 0, i, 0), vscode.TextEditorRevealType.InCenter);
                            break;
                        }
                    }
                    sidebarProvider.currentFunctionName = functionName;
                    sidebarProvider.refresh();
                    return;
                }
            }

            const symbols = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", functionName);
            if (symbols && symbols.length > 0) {
                // Support Java methods which might be package-qualified in the symbol list
                const symbol = symbols.find(
                    (s) =>
                        (s.name === functionName || s.name.endsWith("." + functionName)) &&
                        (s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function)
                );

                const target = symbol || symbols[0];
                const doc = await vscode.workspace.openTextDocument(target.location.uri);
                const editor = await vscode.window.showTextDocument(doc, {
                    selection: new vscode.Range(target.location.range.start, target.location.range.start)
                });

                sidebarProvider.currentFunctionName = functionName;
                sidebarProvider.refresh();
            }
        })
    );

    // --- Project-wide diagram: whole-project or current-package relationship view ---
    //
    // Scans and fully parses every matching file up front (needed for
    // RelationshipAnalyzer). `ext`/`languageId` are passed in explicitly rather
    // than derived from the active editor here, since this also runs for
    // refreshes and toggles triggered from inside the diagram panel itself —
    // by then focus has moved off the source file onto the panel (a real
    // editor-tab webview), so vscode.window.activeTextEditor is often
    // undefined at that point, not the original file.
    function getClassExcludeGlob() {
        const excludeDirs = (
            vscode.workspace
                .getConfiguration("liveUmlEvo")
                .get("classExcludePatterns", "node_modules, build, bin, dist, target") || ""
        )
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        return excludeDirs.length > 0 ? `{${excludeDirs.map((d) => `**/${d}/**`).join(",")}}` : undefined;
    }

    // Every distinct folder (relative to the workspace root) that directly
    // contains a matching source file — this is the same folder-as-package
    // notion the sidebar's original 📦 button used (the folder of whichever
    // file was active), just enumerated up front so the project editor's
    // scope dropdown can list every candidate instead of only "whichever
    // file happened to be open."
    async function listWorkspacePackages(ext) {
        if (!ext) return [];
        const files = await vscode.workspace.findFiles(`**/*${ext}`, getClassExcludeGlob());
        const folders = new Set();
        for (const file of files) {
            const rel = vscode.workspace.asRelativePath(vscode.Uri.joinPath(file, ".."), false);
            if (rel && rel !== ".") folders.add(rel);
        }
        return Array.from(folders).sort();
    }

    async function collectProjectClasses(scopeFolder, ext, languageId) {
        const provider = registry.getLanguageProvider(languageId);
        const excludeGlob = getClassExcludeGlob();
        const includeGlob = scopeFolder ? `${scopeFolder}/**/*${ext}` : `**/*${ext}`;

        const files = await vscode.workspace.findFiles(includeGlob, excludeGlob);
        const results = await Promise.all(
            files.map(async (file) => {
                try {
                    const bytes = await vscode.workspace.fs.readFile(file);
                    const content = Buffer.from(bytes).toString("utf8");
                    const parsed = provider.parseClasses(content);
                    parsed.forEach((c) => (c.fileUri = file));
                    return parsed;
                } catch (e) {
                    return [];
                }
            })
        );

        return { classes: [].concat(...results) };
    }

    function languageIdForExt(ext) {
        return (
            ext === ".java" ? "java"
            : ext === ".py" ? "python"
            : ext === ".ts" ? "typescript"
            : ext === ".cpp" || ext === ".cc" || ext === ".cxx" ? "cpp"
            : "javascript"
        );
    }

    class ProjectDiagramPanel {
        constructor(context) {
            this.context = context;
            this.panel = null;
            this.scopeFolder = null; // null = whole project
            this.ext = null;
            this.languageId = null;
            this.diagramMode = "plantuml";
            this.showDependencies = true;
            this.theme = "ocean";
            this.customColors = null;

            // Sidebar-editor override state. When customCodeActive is true, the
            // panel is showing hand-edited diagram source instead of anything
            // derived from the workspace, and regenerate() (source-driven) is a
            // no-op — see the guard at the top of regenerate().
            this.customCodeActive = false;
            this.customCode = null;
            this.customCodeMode = null;
            // Mirrors whatever the panel is currently displaying (custom or
            // auto-generated), so a newly-focused sidebar editor has something to
            // load. Kept in sync at the end of every successful render.
            this.lastDiagramText = "";
            this.lastDiagramMode = "plantuml";
        }

        currentScopeLabel() {
            return this.scopeFolder ? `Package: ${this.scopeFolder}` : "Whole Project";
        }

        // Tells the sidebar whether it should be showing the project code editor
        // right now. Deliberately keyed off `visible` (is this panel's tab the
        // one currently shown), not `active` (does it have keyboard focus) —
        // clicking into the sidebar to type in the editor moves focus away
        // from the panel, which flips `active` to false even though the panel
        // is still the visible tab. Gating on `active` made the editor vanish
        // the instant you clicked into it. Called on every view-state change
        // and on disposal.
        async _notifySidebar() {
            if (!sidebarProvider) return;
            if (this.panel && this.panel.visible) {
                const packages = await listWorkspacePackages(this.ext).catch(() => []);
                sidebarProvider.enterProjectEditMode(this, packages);
            } else {
                sidebarProvider.exitProjectEditMode(this);
            }
        }

        // Switches scope without requiring an active text editor — unlike
        // show(), which re-derives ext/languageId from vscode.window.activeTextEditor
        // and is meant for the sidebar's original 📦/📐 buttons (only ever
        // clicked while sitting in a class file). Switching scope from the
        // sidebar's own dropdown happens while the project panel itself has
        // focus, so there's usually no active text editor to derive from —
        // this reuses the ext/languageId already captured when the panel was
        // first opened instead.
        async changeScope(scopeFolder) {
            if (!this.panel) return;
            this.scopeFolder = scopeFolder || null;
            // A custom override written for the old scope wouldn't make sense
            // applied to a different package.
            this.customCodeActive = false;
            this.customCode = null;
            this.customCodeMode = null;
            await this.regenerate();
        }

        // Pushes the auto-generated diagram to the sidebar editor, but only if
        // it's currently idle (project edit mode active, no custom override, and
        // the person hasn't started typing an un-applied draft) — see the
        // matching noLocalDraft check in webview.js. Called after every
        // source-driven regenerate() so the sidebar mirrors live edits without
        // ever clobbering something the person is mid-editing.
        _syncSidebarIfIdle() {
            if (!sidebarProvider) return;
            sidebarProvider.post({
                type: "projectDiagramSync",
                code: this.lastDiagramText,
                diagramMode: this.lastDiagramMode
            });
        }

        // Applies hand-edited diagram source in place of anything derived from
        // the workspace. Used by the sidebar editor's Apply button.
        async applyCustomCode(code, diagramMode) {
            this.customCodeActive = true;
            this.customCode = code;
            // Captured at apply time rather than read live from this.diagramMode —
            // the panel's Mermaid/PlantUML tab is still clickable while an
            // override is showing (see the regenerate() guard above), and
            // shouldn't be able to make renderCustomCode() reinterpret PlantUML
            // text as Mermaid or vice versa.
            this.customCodeMode = diagramMode === "mermaid" ? "mermaid" : "plantuml";
            await this.renderCustomCode();
        }

        // Drops the override and goes back to live, source-driven generation.
        // Used by the sidebar editor's Reset button.
        async resetCustomCode() {
            this.customCodeActive = false;
            this.customCode = null;
            this.customCodeMode = null;
            await this.regenerate();
        }

        // Renders whatever's currently in this.customCode, bypassing workspace
        // scanning entirely. Mirrors the two diagram-mode branches of
        // regenerate() but with no source classes/relationships involved.
        async renderCustomCode() {
            if (!this.panel) return;
            this.panel.webview.postMessage({ type: "loading" });
            const scopeLabel = `${this.currentScopeLabel()} \u00B7 Custom code`;
            try {
                if (this.customCodeMode === "plantuml") {
                    const serverUrl = plantUmlServer ? plantUmlServer.getUrl() : null;
                    const svg = await core.generatePlantUMLSVG(this.customCode, this.context, serverUrl);
                    this.lastDiagramText = this.customCode;
                    this.lastDiagramMode = "plantuml";
                    this.panel.webview.postMessage({
                        type: "diagram",
                        diagramMode: "plantuml",
                        svg,
                        plantUml: this.customCode,
                        scopeLabel
                    });
                } else {
                    this.lastDiagramText = this.customCode;
                    this.lastDiagramMode = "mermaid";
                    this.panel.webview.postMessage({
                        type: "diagram",
                        diagramMode: "mermaid",
                        mermaidCode: this.customCode,
                        scopeLabel
                    });
                }
            } catch (e) {
                logger.error(`ProjectDiagramPanel.renderCustomCode(): ${e.message}`, e.stack);
                this.panel.webview.postMessage({ type: "error", message: e.message });
            }
        }

        // Handles the panel's own PlantUML/Mermaid tab click. A plain mode
        // switch just re-regenerates — but if a custom-code override is
        // currently applied, switching modes would silently discard it (the
        // override is tied to whichever mode it was written in). Rather than
        // block the switch outright, ask what to do with the unsaved edits.
        async handleChangeDiagramMode(diagramMode) {
            if (this.customCodeActive && diagramMode !== this.customCodeMode) {
                const currentLabel = this.customCodeMode === "mermaid" ? "Mermaid" : "PlantUML";
                const targetLabel = diagramMode === "mermaid" ? "Mermaid" : "PlantUML";
                const choice = await vscode.window.showWarningMessage(
                    `You have custom ${currentLabel} code applied to this diagram. Switching to ${targetLabel} will discard it.`,
                    { modal: true },
                    "Save & Switch",
                    "Discard & Switch"
                );

                if (!choice) {
                    // Cancelled — the panel already flipped to a loading spinner
                    // when the tab was clicked, so restore what it was actually
                    // showing instead of leaving it stuck there.
                    await this.renderCustomCode();
                    return;
                }

                if (choice === "Save & Switch") {
                    const saved = await this.saveCustomCodeToDisk();
                    if (!saved) {
                        await this.renderCustomCode();
                        return;
                    }
                }

                this.customCodeActive = false;
                this.customCode = null;
                this.customCodeMode = null;
            }

            this.diagramMode = diagramMode;
            await this.regenerate();
        }

        // Writes this.customCode out to a file the person picks, reusing the
        // same save-dialog flow as the sidebar editor's "Save…" button.
        async saveCustomCodeToDisk() {
            const ext = this.customCodeMode === "mermaid" ? "mmd" : "puml";
            const defaultUri =
                vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
                    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `project.${ext}`)
                    : undefined;
            const target = await vscode.window.showSaveDialog({
                defaultUri,
                filters: this.customCodeMode === "mermaid" ? { Mermaid: ["mmd"] } : { PlantUML: ["puml", "iuml"] }
            });
            if (!target) return false;
            try {
                await vscode.workspace.fs.writeFile(target, Buffer.from(this.customCode || "", "utf8"));
                vscode.window.showInformationMessage(`Saved diagram source to ${target.fsPath}`);
                return true;
            } catch (e) {
                logger.error(`saveCustomCodeToDisk: ${e.message}`, e.stack);
                vscode.window.showErrorMessage(`Couldn't save diagram source: ${e.message}`);
                return false;
            }
        }

        async show(scopeFolder) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(
                    "Open a file first so Live Uml Evo knows which language/project to diagram."
                );
                return;
            }
            // Captured once, here, while the source editor is still guaranteed
            // to be active — never re-derived from activeTextEditor again for
            // the rest of this panel's life (see collectProjectClasses above).
            this.scopeFolder = scopeFolder;
            this.ext = path.extname(editor.document.uri.fsPath);
            this.languageId = languageIdForExt(this.ext);

            if (this.panel) {
                // An already-open panel won't send a fresh 'ready' — its webview
                // script isn't reloading — so this is the only trigger it'll get
                // for the newly-selected scope.
                this.panel.reveal(vscode.ViewColumn.Active);
                await this.regenerate();
                await this._notifySidebar();
            } else {
                this.panel = vscode.window.createWebviewPanel(
                    "liveUmlEvoProjectDiagram",
                    "Live Uml Evo: Project Diagram",
                    vscode.ViewColumn.Active,
                    { enableScripts: true, retainContextWhenHidden: true }
                );
                this.panel.webview.html = getProjectWebviewHtml(
                    vscode.extensions.getExtension("bitlab.live-uml-evo")?.packageJSON?.version || "1.0.7",
                    // The webview has no way to know which side VS Code's own
                    // sidebar is docked on, so it's passed in from here — used
                    // to keep the floating zoom/sidebar-toggle widget on the
                    // same side as the sidebar, and to point its collapse icon
                    // the right way.
                    vscode.workspace.getConfiguration("workbench").get("sideBar.location", "left")
                );
                this.panel.onDidDispose(() => {
                    this.panel = null;
                    if (sidebarProvider) sidebarProvider.exitProjectEditMode(this);
                });
                this.panel.onDidChangeViewState(() => this._notifySidebar());
                this.panel.webview.onDidReceiveMessage(async (msg) => {
                    switch (msg.type) {
                        case "ready":
                        case "refresh":
                            await this.regenerate();
                            // A brand-new panel's first real render — this is the
                            // earliest point lastDiagramText/lastDiagramMode are
                            // populated, and also the panel's first chance to be
                            // "visible", so this covers both the initial sidebar
                            // sync and the first-open notification.
                            await this._notifySidebar();
                            break;
                        case "toggleDependencies":
                            this.showDependencies = msg.value;
                            await this.regenerate();
                            break;
                        case "changeDiagramMode":
                            await this.handleChangeDiagramMode(msg.diagramMode);
                            break;
                        case "changeTheme":
                            // Mermaid theming is applied entirely client-side (mermaid's
                            // own theme/themeVariables config, re-rendering the cached
                            // diagram text instantly) — this only matters, and only
                            // triggers a real regenerate, for PlantUML, since its colors
                            // are baked into the generated diagram source itself.
                            this.theme = msg.theme;
                            this.customColors = msg.customColors || null;
                            if (this.diagramMode === "plantuml") await this.regenerate();
                            break;
                        case "command":
                            vscode.commands.executeCommand(msg.command, msg.args);
                            break;
                    }
                });
                // Deliberately no regenerate() call here. The freshly-created
                // panel's webview script hasn't run yet — its 'ready' message
                // (handled above) is the only trigger for a brand-new panel's
                // first render. Calling regenerate() from both places used to
                // fire two overlapping PlantUML renders for the same panel: the
                // first (correct) result would display, and moments later the
                // second — racing against the same local PlantUML process/server
                // — could intermittently fail and stomp the good render with an
                // error, which is exactly the "renders fine, then gets replaced
                // by an error" symptom this fixes.
            }
        }

        async regenerate() {
            if (!this.panel) return;
            // A custom override is showing hand-edited source, not anything
            // derived from the workspace — every trigger that would normally
            // land here (refresh, toggling dependencies/theme/mode) just
            // re-renders that same custom code instead of silently discarding
            // it. Only resetCustomCode() (Reset in the sidebar editor) clears
            // customCodeActive and lets a real regenerate through.
            if (this.customCodeActive) return this.renderCustomCode();

            this.panel.webview.postMessage({ type: "loading" });
            try {
                const { classes } = await collectProjectClasses(this.scopeFolder, this.ext, this.languageId);
                if (classes.length === 0) {
                    this.panel.webview.postMessage({ type: "error", message: "No classes found in this scope." });
                    return;
                }
                const model = analyzer.analyze(classes);
                const isMermaid = this.diagramMode !== "plantuml";
                const options = {
                    showDependencies: this.showDependencies !== false,
                    theme: this.theme,
                    customColors: this.customColors
                };
                const scopeLabel = this.currentScopeLabel();

                if (isMermaid) {
                    const result = mermaidProjectProvider.generate(model, options);
                    this.lastDiagramText = result.mermaidCode;
                    this.lastDiagramMode = "mermaid";
                    this.panel.webview.postMessage({
                        type: "diagram",
                        diagramMode: "mermaid",
                        mermaidCode: result.mermaidCode,
                        classCount: result.classCount,
                        relationshipCount: model.relationships.length,
                        scopeLabel
                    });
                } else {
                    const serverUrl = plantUmlServer ? plantUmlServer.getUrl() : null;
                    const isBadOutput = (svg) => {
                        const looksLikeSvg = /<svg[\s>]/i.test(svg);
                        const looksLikeSmetanaCrash =
                            svg.includes("Sorry, the subproject Smetana is not finished yet") ||
                            svg.includes("It's never too late to be who you might have been") ||
                            svg.includes("PLANTUML_LIMIT_SIZE");
                        return !looksLikeSvg || looksLikeSmetanaCrash;
                    };
                    const tryRender = async (engineOptions) => {
                        const result = plantumlProjectProvider.generate(model, engineOptions);
                        const candidate = await core.generatePlantUMLSVG(result.uml, this.context, serverUrl);
                        if (isBadOutput(candidate)) throw new Error("bad output");
                        return { svg: candidate, uml: result.uml };
                    };

                    let svg = null;
                    let umlText = "";
                    let lastErr = null;

                    // Tier 1: Graphviz — PlantUML's default, mature engine. It
                    // doesn't have Smetana's crossing-minimization bug at all, and
                    // since PlantUML 1.2020.21+ it self-extracts a bundled minimal
                    // Graphviz distribution if none is found on the system, so this
                    // needs no setup in the common case. This used to be skipped
                    // entirely by forcing `!pragma layout smetana` unconditionally,
                    // which is what made Smetana's bug the norm here instead of a
                    // rare fallback case.
                    try {
                        const r = await tryRender({ ...options, engine: "graphviz" });
                        svg = r.svg;
                        umlText = r.uml;
                    } catch (e) {
                        lastErr = e.message;

                        // Tier 2: Smetana, retried with a different internal
                        // ordering each time. Its bug is order-sensitive — the
                        // exact same classes/relationships can crash it or not
                        // depending purely on declaration order, which is also why
                        // the same project crashes sometimes and not others
                        // (vscode.workspace.findFiles doesn't guarantee stable
                        // ordering between scans). Only reached if Graphviz itself
                        // isn't available at all.
                        const MAX_SMETANA_ATTEMPTS = 3;
                        for (let attempt = 0; attempt < MAX_SMETANA_ATTEMPTS && !svg; attempt++) {
                            try {
                                const r = await tryRender({ ...options, engine: "smetana", shuffleSeed: attempt });
                                svg = r.svg;
                                umlText = r.uml;
                            } catch (e2) {
                                lastErr = e2.message;
                            }
                        }
                    }

                    if (svg) {
                        this.lastDiagramText = umlText;
                        this.lastDiagramMode = "plantuml";
                        this.panel.webview.postMessage({
                            type: "diagram",
                            diagramMode: "plantuml",
                            svg,
                            plantUml: umlText,
                            classCount: model.classes.length,
                            relationshipCount: model.relationships.length,
                            scopeLabel
                        });
                    } else {
                        // Neither Graphviz nor several reordered Smetana attempts
                        // could render this diagram — genuinely too large/complex
                        // for either engine as currently set up, not something more
                        // retrying will fix. Rather than leave the person with
                        // nothing, fall back to Mermaid for this one render —
                        // clearly labeled as a fallback, and without changing their
                        // actual PlantUML/Mermaid tab selection, so switching away
                        // and back still tries PlantUML.
                        logger.warn(`PlantUML render failed (Graphviz and Smetana retries): ${lastErr}`);
                        const fallback = mermaidProjectProvider.generate(model, options);
                        this.lastDiagramText = fallback.mermaidCode;
                        this.lastDiagramMode = "mermaid";
                        this.panel.webview.postMessage({
                            type: "diagram",
                            diagramMode: "mermaid",
                            mermaidCode: fallback.mermaidCode,
                            classCount: fallback.classCount,
                            relationshipCount: model.relationships.length,
                            scopeLabel,
                            fallbackNotice:
                                "PlantUML couldn't render this diagram (tried Graphviz and Smetana with several layouts), so this is showing as Mermaid instead. Switching tabs and back will try PlantUML again."
                        });
                    }
                }
                this._syncSidebarIfIdle();
            } catch (e) {
                logger.error(`ProjectDiagramPanel.regenerate(): ${e.message}`, e.stack);
                this.panel.webview.postMessage({ type: "error", message: e.message });
            }
        }
    }

    const analyzer = new RelationshipAnalyzer();
    const mermaidProjectProvider = new MermaidProjectClassProvider();
    const plantumlProjectProvider = new PlantUMLProjectClassProvider();
    const projectDiagramPanel = new ProjectDiagramPanel(context);

    context.subscriptions.push(
        vscode.commands.registerCommand("liveUmlEvo.showProjectDiagram", async () => {
            await projectDiagramPanel.show(null);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("liveUmlEvo.showPackageDiagram", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage("Open a file first to diagram its package.");
                return;
            }
            const folderUri = vscode.Uri.joinPath(editor.document.uri, "..");
            const relFolder = vscode.workspace.asRelativePath(folderUri, false);
            await projectDiagramPanel.show(relFolder);
        })
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!sidebarProvider || !sidebarProvider.isViewVisible()) return;
            const uri = editor ? editor.document.uri.toString() : null;
            if (uri !== sidebarProvider._lastKnownEditorUri) {
                // Genuinely different file. currentClassName from the old file must not
                // survive — findWorkspaceClasses merges every class in the workspace by
                // name, so a stale name usually still "resolves" to the old file's class
                // and silently renders the wrong diagram instead of falling back.
                sidebarProvider.currentClassName = null;
                sidebarProvider._lastKnownEditorUri = uri;
            }
            return sidebarProvider.refresh();
        })
    );

    let selectionDebounceTimer = null;
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => {
            if (!sidebarProvider || !sidebarProvider.isViewVisible()) return;
            if (_typingInProgress) return;

            if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
            selectionDebounceTimer = setTimeout(() => {
                sidebarProvider.refresh({ selectionOnly: true });
            }, 300);
        })
    );

    let debounceTimer = null;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (!sidebarProvider || !sidebarProvider.isViewVisible()) return;
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
                _typingInProgress = true;
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    _typingInProgress = false;
                    sidebarProvider.refresh();
                }, 1200);
            }
        })
    );

    // Invalidate the class cache when source files are saved, created, deleted or renamed.
    // This ensures the workspace scan stays fresh without paying the cost on every keystroke.
    const invalidateCacheForUri = (uri) => {
        const ext = path.extname(uri.fsPath);
        const uriStr = uri.toString();
        if (sidebarProvider) {
            sidebarProvider._classCache.delete(`light:${ext}:${uriStr}`);
            sidebarProvider._classCache.delete(`full:${ext}:${uriStr}`);
            sidebarProvider._fileContentCache.delete(`content:${ext}:${uriStr}`);
            // Mark the extension dirty rather than deleting the aggregate cache
            // outright — findWorkspaceClasses then reconciles by re-reading only
            // this one file (its per-file cache entry is gone) instead of every
            // file of that extension in the workspace.
            sidebarProvider._dirtyExtensions.add(ext);
            sidebarProvider._workspaceFileCountCache = { ext: "", count: 0 };
        }
    };
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => invalidateCacheForUri(doc.uri)));
    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles((e) => e.files.forEach((f) => invalidateCacheForUri(f)))
    );
    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((f) => invalidateCacheForUri(f)))
    );
    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles((e) =>
            e.files.forEach((f) => {
                invalidateCacheForUri(f.oldUri);
                invalidateCacheForUri(f.newUri);
            })
        )
    );

    validateJavaOnActivation(context);
}

async function validateJavaOnActivation(context) {
    const config = vscode.workspace.getConfiguration("liveUmlEvo");
    const javaPath = config.get("javaPath", "java");

    try {
        await new Promise((resolve, reject) => {
            require("child_process").exec(`"${javaPath}" -version`, { timeout: 10000 }, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stderr || stdout);
            });
        });
    } catch (err) {
        const action = await vscode.window.showWarningMessage(
            `Live Uml Evo: Java not found at "${javaPath}". PlantUML diagram generation requires Java.`,
            "Open Settings",
            "Learn More"
        );
        if (action === "Open Settings") {
            vscode.commands.executeCommand("workbench.action.openSettings", "liveUmlEvo.javaPath");
        } else if (action === "Learn More") {
            vscode.window.showInformationMessage(
                "PlantUML requires Java. Please install it and set the path in settings."
            );
        }
    }
}

class LiveUmlSidebar {
    static _requestCounter = 0;

    constructor(context) {
        this.context = context;
        this.view = null;
        this.currentFunctionName = null;
        this.currentClassName = null;
        this.currentDiagramType = "flowchart";
        this.currentDiagramMode = "plantuml"; // 'mermaid' | 'plantuml'
        this._viewVisible = false;
        this._generationInProgress = false;
        this._lastFunctionHash = null;
        this._lastDiagramType = null;
        this._lastDocumentUri = null;
        this._lastClassName = null;
        this._lastClassHash = null;
        this._classCache = new Map(); // key: ext (combined) and `light:${ext}:${uri}` per file – ParsedClass[]; invalidated on file events
        this._fileContentCache = new Map(); // key: `content:${ext}:${uri}` – raw UTF-8 file content; invalidated alongside _classCache
        this._lastSelectedStateVar = null;
        this.selectedStateVars = new Map();
        this._workspaceFileCountCache = { ext: "", count: 0 };
        this._lastKnownEditorUri = null;
        this._dirtyExtensions = new Set();
        // Which ProjectDiagramPanel instance (if any) the sidebar is currently
        // acting as the code editor for. Only one at a time — the sidebar is a
        // single shared view. null when no project panel is focused.
        this._projectEditPanel = null;
    }

    isViewVisible() {
        return this._viewVisible;
    }

    _computeFunctionHash(body) {
        if (!body) return null;
        const cleaned = body
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/#.*$/gm, "")
            .replace(/"""[\s\S]*?"""/g, "")
            .replace(/'''[\s\S]*?'''/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return crypto.createHash("md5").update(cleaned).digest("hex");
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView;
        this._viewVisible = true;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.onDidChangeVisibility(() => {
            this._viewVisible = webviewView.visible;
            if (this._viewVisible) this.refresh();
        });

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            logger.log(
                `onDidReceiveMessage: type=${msg.type}${msg.functionName ? `, functionName=${msg.functionName}` : ""}${msg.className ? `, className=${msg.className}` : ""}`
            );
            switch (msg.type) {
                case "refresh":
                    this.refresh();
                    break;
                case "changeDiagramType":
                    logger.log(`changeDiagramType: ${msg.diagramType}`);
                    this.currentDiagramType = msg.diagramType;
                    // The Class diagram is keyed by class name, not function name — passing
                    // currentFunctionName here (as before) meant the target almost never
                    // matched any class, so the <<active>>/:::active highlight never applied
                    // until a later cursor-driven refresh picked the right class.
                    if (msg.diagramType === "class") {
                        if (this.currentClassName) {
                            await this.generate(this.currentClassName, "class");
                        } else {
                            // No class target tracked yet for this file (e.g. the very
                            // first tab switch on a freshly opened editor) — fall back to
                            // the same way refresh() picks a default, instead of silently
                            // doing nothing and leaving whatever was on screen before.
                            const editor = vscode.window.activeTextEditor;
                            const classes = editor ? parseClasses(editor.document) : [];
                            if (classes.length > 0) {
                                this.currentClassName = classes[0].name;
                                await this.generate(classes[0].name, "class");
                            }
                        }
                    } else if (this.currentFunctionName) {
                        await this.generate(this.currentFunctionName, msg.diagramType);
                    } else {
                        // Same fallback for function-based diagrams: don't leave a stale
                        // diagram (or a permanently-stuck loading state) on screen just
                        // because no function has been tracked for this file yet.
                        const editor = vscode.window.activeTextEditor;
                        const functions = editor ? parseFunctions(editor.document) : [];
                        if (functions.length > 0) {
                            this.currentFunctionName = functions[0].name;
                            await this.generate(functions[0].name, msg.diagramType);
                        }
                    }
                    break;
                case "changeDiagramMode":
                    logger.log(`changeDiagramMode: ${msg.diagramMode}`);
                    this.currentDiagramMode = msg.diagramMode;
                    this._lastFunctionHash = null;
                    this._lastClassHash = null;
                    this._lastClassName = null;
                    this._lastDiagramType = null;
                    this._lastDocumentUri = null;
                    this._lastSelectedStateVar = null;
                    if (this.currentFunctionName || this.currentClassName) {
                        await this.refresh();
                    }
                    break;
                case "selectFunction":
                    logger.log(`selectFunction: ${msg.functionName}`);
                    this.currentFunctionName = msg.functionName;
                    await this.generate(msg.functionName, this.currentDiagramType);
                    break;
                case "selectClass":
                    logger.log(`selectClass: ${msg.className}`);
                    this.currentClassName = msg.className;
                    await this.generate(msg.className, "class");
                    break;
                case "showInfo":
                    vscode.window.showInformationMessage(msg.message);
                    break;
                case "applyProjectDiagram":
                    if (this._projectEditPanel) {
                        await this._projectEditPanel.applyCustomCode(msg.code, msg.diagramMode);
                    }
                    break;
                case "resetProjectDiagram":
                    if (this._projectEditPanel) {
                        await this._projectEditPanel.resetCustomCode();
                    }
                    break;
                case "changeProjectScope":
                    if (this._projectEditPanel) {
                        await this._projectEditPanel.changeScope(msg.scopeFolder || null);
                    }
                    break;
                case "saveProjectDiagramSource": {
                    const ext = msg.diagramMode === "mermaid" ? "mmd" : "puml";
                    const defaultUri =
                        vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ?
                            vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `project.${ext}`)
                        :   undefined;
                    const target = await vscode.window.showSaveDialog({
                        defaultUri,
                        filters: msg.diagramMode === "mermaid" ? { Mermaid: ["mmd"] } : { PlantUML: ["puml", "iuml"] }
                    });
                    if (!target) break;
                    try {
                        await vscode.workspace.fs.writeFile(target, Buffer.from(msg.code || "", "utf8"));
                        vscode.window.showInformationMessage(`Saved diagram source to ${target.fsPath}`);
                    } catch (e) {
                        logger.error(`saveProjectDiagramSource: ${e.message}`, e.stack);
                        vscode.window.showErrorMessage(`Couldn't save diagram source: ${e.message}`);
                    }
                    break;
                }
                case "loadProjectDiagramSource": {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: {
                            "Diagram source": ["puml", "iuml", "mmd"],
                            PlantUML: ["puml", "iuml"],
                            Mermaid: ["mmd"],
                            "All files": ["*"]
                        }
                    });
                    if (!picked || picked.length === 0) break;
                    try {
                        const bytes = await vscode.workspace.fs.readFile(picked[0]);
                        const code = Buffer.from(bytes).toString("utf8");
                        const diagramMode = path.extname(picked[0].fsPath).toLowerCase() === ".mmd" ? "mermaid" : "plantuml";
                        this.view.webview.postMessage({ type: "projectDiagramLoaded", code, diagramMode });
                    } catch (e) {
                        logger.error(`loadProjectDiagramSource: ${e.message}`, e.stack);
                        vscode.window.showErrorMessage(`Couldn't load diagram source: ${e.message}`);
                    }
                    break;
                }
                case "openSettings":
                    this.view.webview.postMessage({
                        type: "showSettings",
                        settings: {
                            javaPath: vscode.workspace.getConfiguration("liveUmlEvo").get("javaPath", "java"),
                            classExcludePatterns: vscode.workspace
                                .getConfiguration("liveUmlEvo")
                                .get("classExcludePatterns", "node_modules, build, bin, dist, target")
                        }
                    });
                    break;
                case "saveSettings":
                    if (msg.settings.javaPath !== undefined) {
                        await vscode.workspace
                            .getConfiguration("liveUmlEvo")
                            .update("javaPath", msg.settings.javaPath, vscode.ConfigurationTarget.Global);
                    }
                    if (msg.settings.classExcludePatterns !== undefined) {
                        await vscode.workspace
                            .getConfiguration("liveUmlEvo")
                            .update(
                                "classExcludePatterns",
                                msg.settings.classExcludePatterns,
                                vscode.ConfigurationTarget.Global
                            );
                    }
                    this.view.webview.postMessage({ type: "settingsSaved" });
                    break;
                case "command":
                    if (msg.command === "extension.openClass") {
                        vscode.commands.executeCommand("extension.openClass", msg.args);
                    } else {
                        vscode.commands.executeCommand(msg.command, msg.args);
                    }
                    break;
            }
        });

        setTimeout(() => this.refresh(), 300);
    }

    // `selectionOnly` marks a refresh triggered purely by the cursor moving (no
    // text edit, no file switch, no explicit tab/selection action). In that case
    // the Class diagram is left completely untouched, since it isn't keyed to
    // cursor position and workspace-scanning it on every click was expensive and
    // pointless. (Whether the webview does a full or partial re-render is decided
    // entirely on its side, from whether the update actually changes the panel's
    // shape — not from a flag set here.)
    async refresh(options = {}) {
        const { selectionOnly = false } = options;
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            logger.log("refresh(): no active editor");
            this.post({ type: "noEditor" });
            return;
        }

        currentLanguage = editor.document.languageId;
        logger.log(
            `refresh(): language=${currentLanguage}, uri=${editor.document.uri.toString()}, selectionOnly=${selectionOnly}`
        );

        const functions = parseFunctions(editor.document);
        const classes = parseClasses(editor.document);
        const cursorLine = editor.selection.active.line;

        logger.log(`refresh(): ${functions.length} functions, ${classes.length} classes, cursor at line ${cursorLine}`);

        // Stats
        let totalFiles = 0;
        let ext = "";
        if (currentLanguage === "java") ext = ".java";
        else if (currentLanguage === "python") ext = ".py";
        else if (currentLanguage === "javascript") ext = ".js";
        else if (currentLanguage === "typescript") ext = ".ts";
        else if (currentLanguage === "cpp") ext = ".cpp";

        if (ext) {
            if (this._workspaceFileCountCache.ext !== ext) {
                const excludeDirs = (
                    vscode.workspace
                        .getConfiguration("liveUmlEvo")
                        .get("classExcludePatterns", "node_modules, build, bin, dist, target") || ""
                )
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                const excludeGlob =
                    excludeDirs.length > 0 ? `{${excludeDirs.map((d) => `**/${d}/**`).join(",")}}` : undefined;
                const files = await vscode.workspace.findFiles(`**/*${ext}`, excludeGlob);
                totalFiles = files.length;
                this._workspaceFileCountCache = { ext, count: totalFiles };
            } else {
                totalFiles = this._workspaceFileCountCache.count;
            }
        }

        const currentFunc = functions.find((f) => cursorLine >= f.startLine && cursorLine <= f.endLine);

        // A selection-only refresh never touches the Class diagram's target — it
        // stays exactly as the user last set it via the dropdown, a diagram click,
        // or switching to the Class tab.
        const currentCls =
            selectionOnly ? null : classes.find((c) => cursorLine >= c.startLine && cursorLine <= c.endLine);

        if (currentCls && this.currentDiagramType === "class") {
            this.currentClassName = currentCls.name;
        }

        const newFunctionName =
            currentFunc ? currentFunc.name
            : functions.length > 0 ? functions[0].name
            : null;
        const newClassName =
            selectionOnly ? this.currentClassName
            : currentCls ? currentCls.name
            : this.currentClassName || (classes.length > 0 ? classes[0].name : null);
        const newDocUri = editor.document.uri.toString();

        this.post({
            type: "update",
            functions: functions.map((f) => f.name),
            classes: classes.map((c) => c.name),
            currentFunction: newFunctionName,
            currentClass: newClassName,
            stats: {
                totalFiles: totalFiles,
                totalClasses: classes.length,
                language: currentLanguage
            },
            diagramType: this.currentDiagramType,
            diagramMode: this.currentDiagramMode,
            verbose: logger.VERBOSE
        });

        logger.log(
            `refresh(): will generate for target=${newFunctionName || newClassName}, type=${this.currentDiagramType}`
        );
        if (this.currentDiagramType === "class") {
            if (selectionOnly) {
                logger.log("refresh(): selection-only refresh on Class tab, skipping regeneration entirely");
                return;
            }
            if (newClassName) {
                this.currentClassName = newClassName;
                await this.generate(newClassName, "class");
            }
        } else {
            if (currentFunc) {
                this.currentFunctionName = currentFunc.name;
                await this.generate(currentFunc.name, this.currentDiagramType);
            } else if (functions.length > 0) {
                this.currentFunctionName = functions[0].name;
                await this.generate(functions[0].name, this.currentDiagramType);
            }
        }
    }

    post(msg) {
        if (this.view) this.view.webview.postMessage(msg);
    }

    // Called by ProjectDiagramPanel whenever it becomes the visible tab.
    // Switches the sidebar into "project code editor" mode. Re-entering with
    // the same panel (e.g. a redundant onDidChangeViewState firing) is cheap
    // to just re-send — the webview's own noLocalDraft check decides whether
    // to actually overwrite anything the person is mid-editing.
    enterProjectEditMode(panel, packages) {
        this._projectEditPanel = panel;
        this.post({
            type: "projectEditMode",
            active: true,
            diagramMode: panel.customCodeActive ? panel.customCodeMode : panel.lastDiagramMode,
            code: panel.customCodeActive ? panel.customCode : panel.lastDiagramText,
            isCustom: !!panel.customCodeActive,
            scopeLabel: panel.currentScopeLabel(),
            scopeFolder: panel.scopeFolder || null,
            packages: packages || []
        });
    }

    // Called when a project panel loses focus or is closed. `panel` is passed
    // so a stale panel's dispose/blur can't clear a *different* panel that
    // grabbed focus in between (only clear if it's still the active one).
    exitProjectEditMode(panel) {
        if (panel && this._projectEditPanel !== panel) return;
        this._projectEditPanel = null;
        this.post({ type: "projectEditMode", active: false });
    }

    async generate(targetName, type) {
        const requestId = ++LiveUmlSidebar._requestCounter;
        logger.log(
            `generate(${targetName}, ${type}) starting — requestId=${requestId}, generationInProgress=${this._generationInProgress}`
        );

        const visualizer = new Visualizer(this.currentDiagramMode);
        visualizer.setRequestId(requestId);
        this._currentVisualizer = visualizer;

        this._currentVisualizer.killProcess();
        logger.log("generate(): killed previous visualizer process");

        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                logger.log("generate(): no active editor, aborting");
                return;
            }

            let diagramCode = "";
            let hashSource = "";
            let classCount = 0;
            let externalGuesses = [];
            let stateVars = [];
            let activeStateVar = null;
            let serverUrl = null;

            if (type === "class") {
                logger.log("generate(): class diagram path");
                const ext = path.extname(editor.document.uri.fsPath);
                let classes = parseClasses(editor.document);
                logger.log(`generate(): ${classes.length} classes in current file`);

                const extraClasses = await this.findWorkspaceClasses(targetName, editor.document);
                if (extraClasses && extraClasses.length > 0) {
                    const existingNames = new Set(classes.map((c) => c.name));
                    extraClasses.forEach((c) => {
                        if (!existingNames.has(c.name)) {
                            classes.push(c);
                            existingNames.add(c.name);
                        }
                    });
                    logger.log(`generate(): +${extraClasses.length} workspace classes, total=${classes.length}`);
                }

                const firstResult = visualizer.generateClass(targetName, classes, currentLanguage);
                logger.log(`generate(): first-pass displayClassNames=${JSON.stringify(firstResult.displayClassNames)}`);

                if (firstResult.displayClassNames && firstResult.displayClassNames.length > 0) {
                    await this._resolveDisplayClassMethods(classes, firstResult.displayClassNames, ext);
                    logger.log("generate(): resolved display class methods");
                }

                const result = visualizer.generateClass(targetName, classes, currentLanguage);
                diagramCode = result.uml || result.mermaidCode || "";
                classCount = result.classCount;
                const currentHash = crypto.createHash("md5").update(diagramCode).digest("hex");
                logger.log(
                    `generate(): class hash check — lastHash=${this._lastClassHash?.slice(0, 8)}, newHash=${currentHash.slice(0, 8)}`
                );
                if (
                    this._lastClassHash === currentHash &&
                    this._lastClassName === targetName &&
                    this._lastDiagramType === type &&
                    this._lastDocumentUri === editor.document.uri.toString()
                ) {
                    logger.log("generate(): class hash unchanged, skipping render");
                    return;
                }
                this._lastClassHash = currentHash;
            } else if (type === "state") {
                logger.log("generate(): state diagram path");
                const functions = parseFunctions(editor.document);
                const func = functions.find((f) => f.name === targetName);
                if (!func) {
                    logger.log(`generate(): target function "${targetName}" not found`);
                    return;
                }
                const selectedStateVar = this.selectedStateVars.get(targetName) || null;
                logger.log(`generate(): selectedStateVar=${selectedStateVar}`);
                if (!tsProvider.isReady()) {
                    logger.log("generate(): waiting for tree-sitter WASM to be ready");
                    await tsProvider.ready();
                }
                const result = visualizer.generateState(targetName, functions, currentLanguage, selectedStateVar);
                externalGuesses = result.externalGuesses || [];
                diagramCode = result.uml || result.mermaidCode || "";
                stateVars = result.stateVars || [];
                activeStateVar = result.activeStateVar || null;
                logger.log(
                    `generate(): state result — eligible=${result.eligible}, stateVars=${JSON.stringify(stateVars)}, diagramCode.length=${diagramCode.length}`
                );
                if (!result.eligible) {
                    logger.log("generate(): state not eligible, sending empty diagram");
                    this._lastDiagramType = type;
                    this._lastDocumentUri = editor.document.uri.toString();
                    this._lastFunctionHash = null;
                    this._lastSelectedStateVar = null;
                    this.post({
                        type: "diagram",
                        name: targetName,
                        diagramType: type,
                        svg: '<div class="empty-state">No state transitions detected in this scope</div>',
                        plantUml: "",
                        mermaidCode: visualizer.isMermaid() ? diagramCode : "",
                        diagramMode: this.currentDiagramMode,
                        classCount: 0,
                        scopeWarning: false,
                        externalGuesses: [],
                        stateVars: [],
                        activeStateVar: null,
                        requestId
                    });
                    return;
                }
                hashSource = func.body;
                const newHash = this._computeFunctionHash(hashSource);
                logger.log(
                    `generate(): state hash check — lastHash=${this._lastFunctionHash?.slice(0, 8)}, newHash=${newHash.slice(0, 8)}`
                );
                if (
                    this._lastFunctionHash === newHash &&
                    this.currentFunctionName === targetName &&
                    this._lastDiagramType === type &&
                    this._lastDocumentUri === editor.document.uri.toString() &&
                    this._lastSelectedStateVar === activeStateVar
                ) {
                    logger.log("generate(): state hash unchanged, skipping render");
                    return;
                }
                this._lastFunctionHash = newHash;
                this._lastSelectedStateVar = activeStateVar;
            } else {
                logger.log(`generate(): ${type} diagram path`);
                const functions = parseFunctions(editor.document);
                const func = functions.find((f) => f.name === targetName);
                if (!func) {
                    logger.log(`generate(): target function "${targetName}" not found`);
                    return;
                }
                diagramCode = visualizer.generateFlowchart(func.name, func.body, currentLanguage);
                if (type === "sequence") {
                    diagramCode = visualizer.generateSequence(func.name, func.body, currentLanguage);
                }
                hashSource = func.body;
                const newHash = this._computeFunctionHash(hashSource);
                logger.log(
                    `generate(): ${type} hash check — lastHash=${this._lastFunctionHash?.slice(0, 8)}, newHash=${newHash?.slice(0, 8)}`
                );
                if (
                    this._lastFunctionHash === newHash &&
                    this.currentFunctionName === targetName &&
                    this._lastDiagramType === type &&
                    this._lastDocumentUri === editor.document.uri.toString()
                ) {
                    logger.log("generate(): hash unchanged, skipping render");
                    return;
                }
                this._lastFunctionHash = newHash;
            }

            // A newer request may have already started (and even finished) while
            // this one was doing its slow work above (e.g. the workspace scan for
            // a class diagram). Previously this line unconditionally overwrote
            // _currentRequestId, which let an old, already-superseded request keep
            // going, post its own 'loading', and finish minutes after the thing
            // the user is now actually looking at — which is exactly what caused
            // the diagram to revert to stale content and the status bar to get
            // stuck on "Generating diagram...".
            if (this._currentRequestId > requestId) {
                logger.log(
                    `generate(): superseded by a newer request (${this._currentRequestId} > ${requestId}), aborting before render`
                );
                return;
            }
            this._currentRequestId = requestId;
            logger.log(`generate(): set _currentRequestId=${requestId}, diagramCode.length=${diagramCode.length}`);

            this._generationInProgress = true;
            this.post({ type: "loading", name: targetName, diagramType: type, requestId });
            logger.log(`generate(): posted loading message for requestId=${requestId}`);

            serverUrl = plantUmlServer ? plantUmlServer.getUrl() : null;
            logger.log(`generate(): serverUrl=${serverUrl}, about to call visualizer.render()`);
            const rendered = await visualizer.render(diagramCode, this.context, serverUrl, requestId);
            logger.log(`generate(): visualizer.render() completed, svg.length=${rendered.svg?.length || 0}`);

            if (this._currentRequestId !== requestId) {
                logger.log("generate(): stale request (after render), aborting diagram post");
                return;
            }

            this._lastDiagramType = type;
            this._lastDocumentUri = editor.document.uri.toString();
            if (type === "class") this._lastClassName = targetName;

            logger.log(`generate(): posting diagram result for requestId=${requestId}`);
            this.post({
                type: "diagram",
                name: targetName,
                diagramType: type,
                svg: rendered.svg,
                plantUml: visualizer.isPlantUML() ? diagramCode : "",
                mermaidCode: visualizer.isMermaid() ? diagramCode : "",
                diagramMode: this.currentDiagramMode,
                classCount: classCount,
                scopeWarning: externalGuesses && externalGuesses.length > 0,
                externalGuesses,
                stateVars,
                activeStateVar,
                requestId
            });
        } catch (err) {
            if (err.name === "AbortError" || err.message === "Process killed") {
                logger.log(`generate(): caught ${err.name}: ${err.message} — returning silently`);
                return;
            }
            logger.error(`generate(): ${err.message}`, err.stack);
            console.error("Generation error:", err);
            this.post({ type: "error", message: err.message, diagramType: type, requestId });
        } finally {
            if (this._currentRequestId === requestId) {
                this._generationInProgress = false;
                this._currentVisualizer = null;
                logger.log(`generate(): finally — reset _generationInProgress for requestId=${requestId}`);
            } else {
                logger.log(
                    `generate(): finally — _currentRequestId (${this._currentRequestId}) !== requestId (${requestId}), skipping reset`
                );
            }
        }
    }

    async findWorkspaceClasses(targetName, currentDoc) {
        const ext = path.extname(currentDoc.uri.fsPath);

        const cacheKey = `${ext}`;
        if (this._classCache.has(cacheKey) && !this._dirtyExtensions.has(ext)) {
            logger.log(
                `findWorkspaceClasses(): cache hit for ${ext} (${this._classCache.get(cacheKey).length} classes)`
            );
            return this._classCache.get(cacheKey);
        }
        this._dirtyExtensions.delete(ext);
        logger.log(`findWorkspaceClasses(): cache miss/dirty for ${ext}, reconciling workspace...`);

        const languageId =
            ext === ".java" ? "java"
            : ext === ".py" ? "python"
            : ext === ".ts" ? "typescript"
            : ext === ".cpp" || ext === ".cc" || ext === ".cxx" ? "cpp"
            : "javascript";
        const provider = registry.getLanguageProvider(languageId);

        // Build exclude glob from user setting (comma-separated directory names)
        const excludeDirs = (
            vscode.workspace
                .getConfiguration("liveUmlEvo")
                .get("classExcludePatterns", "node_modules, build, bin, dist, target") || ""
        )
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const excludeGlob = excludeDirs.length > 0 ? `{${excludeDirs.map((d) => `**/${d}/**`).join(",")}}` : undefined;

        const files = await vscode.workspace.findFiles(`**/*${ext}`, excludeGlob);

        const results = await Promise.all(
            files.map(async (file) => {
                const lightKey = `light:${ext}:${file.toString()}`;
                // A save/create/rename only invalidates the *changed* file's cache entry
                // (see invalidateCacheForUri) — so on a "dirty" reconcile, everything
                // except that one file is still cached and doesn't need to be re-read
                // from disk or re-parsed. This is what was making every class diagram
                // pay for a full workspace re-scan after any save, however small.
                const cached = this._classCache.get(lightKey);
                if (cached) return cached;
                try {
                    const contentBytes = await vscode.workspace.fs.readFile(file);
                    const content = Buffer.from(contentBytes).toString("utf8");
                    // Light parse: extract class headers only (name, parent, interfaces)
                    // avoids expensive comment-removal, body-extraction, and method-scanning
                    // for every file in the workspace. Full parsing (including methods) is
                    // done lazily only for classes that end up in the diagram displaySet.
                    const parsed = provider.parseClassesLight(content);
                    parsed.forEach((c) => (c.fileUri = file)); // Attach URI for fast navigation
                    this._classCache.set(lightKey, parsed);
                    // Cache raw content for lazy method resolution
                    this._fileContentCache.set(`content:${ext}:${file.toString()}`, content);
                    return parsed;
                } catch (e) {
                    return [];
                }
            })
        );

        const allClasses = [].concat(...results);
        // Also store a combined cache for the extension for quick fallback
        this._classCache.set(cacheKey, allClasses);
        return allClasses;
    }

    // Resolve members for classes in the display set that came from the workspace
    // (light-parsed: headers only). Reads cached file content, full-parses the file,
    // and attaches methods and fields to each target class.
    async _resolveDisplayClassMethods(classes, displayClassNames, ext) {
        const languageId =
            ext === ".java" ? "java"
            : ext === ".py" ? "python"
            : ext === ".ts" ? "typescript"
            : ext === ".cpp" || ext === ".cc" || ext === ".cxx" ? "cpp"
            : "javascript";
        const provider = registry.getLanguageProvider(languageId);

        // Collect unique files that have displayed classes needing methods
        const fileUris = new Set();
        const classByFile = new Map();
        for (const name of displayClassNames) {
            const cls = classes.find((c) => c.name === name);
            // Classes from the current editor are already fully parsed; only light-parsed
            // workspace classes carry a fileUri and still need members resolved.
            if (cls && cls.fileUri && !cls._membersResolved) {
                const uriStr = cls.fileUri.toString();
                fileUris.add(uriStr);
                if (!classByFile.has(uriStr)) classByFile.set(uriStr, []);
                classByFile.get(uriStr).push(cls);
            }
        }

        await Promise.all(
            Array.from(fileUris).map(async (uriStr) => {
                const fileUri = vscode.Uri.parse(uriStr);
                const fileKey = `content:${ext}:${uriStr}`;

                // Get cached content or re-read
                let content = this._fileContentCache.get(fileKey);
                if (!content) {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(fileUri);
                        content = Buffer.from(bytes).toString("utf8");
                        this._fileContentCache.set(fileKey, content);
                    } catch (e) {
                        return;
                    }
                }

                // Full-parse the file to extract methods
                const fullParsed = provider.parseClasses(content);
                const fullKey = `full:${ext}:${uriStr}`;
                this._classCache.set(fullKey, fullParsed);

                // Attach methods to the light class objects
                const targetClasses = classByFile.get(uriStr);
                for (const targetCls of targetClasses) {
                    const match = fullParsed.find((c) => c.name === targetCls.name);
                    if (!match) continue;
                    targetCls.methods = match.methods || [];
                    targetCls.fields = match.fields || [];
                    targetCls.isAbstract = !!match.isAbstract;
                    targetCls._membersResolved = true;
                }
            })
        );
    }

    getHtml() {
        const extensionVersion = vscode.extensions.getExtension("bitlab.live-uml-evo")?.packageJSON?.version || "1.0.7";
        return getWebviewHtml(extensionVersion);
    }
}

function parseFunctions(document) {
    const text = document.getText();
    const languageId = document.languageId;
    const provider = registry.getLanguageProvider(languageId);
    const parsedFunctions = provider.parseFunctions(text);

    if (parsedFunctions.length === 0) {
        return [{ name: "file_content", body: text }];
    }
    return parsedFunctions;
}

function parseClasses(document) {
    const text = document.getText();
    const languageId = document.languageId;
    const provider = registry.getLanguageProvider(languageId);
    return provider.parseClasses(text);
}

module.exports = { activate };