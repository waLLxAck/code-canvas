"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode5 = __toESM(require("vscode"));
var fs3 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/util.ts
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
function htmlForWebview(panel2, context) {
  const media = vscode.Uri.joinPath(context.extensionUri, "media");
  const index = vscode.Uri.joinPath(media, "index.html");
  let html = fs.readFileSync(index.fsPath, "utf8");
  const fix = (p) => panel2.webview.asWebviewUri(vscode.Uri.joinPath(media, p)).toString();
  html = html.replace(/((?:src|href)=["'])\.?\/assets\//g, (_m, p1) => `${p1}${fix("assets/")}`).replace(/__CSP__/g, panel2.webview.cspSource);
  return html;
}

// src/graph.ts
var import_fast_glob = __toESM(require("fast-glob"));
var path = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
var vscode3 = __toESM(require("vscode"));

// src/lsp.ts
var vscode2 = __toESM(require("vscode"));
async function getReferences(uri, position) {
  const locs = await vscode2.commands.executeCommand(
    "vscode.executeReferenceProvider",
    uri,
    position
  );
  return (locs || []).map((l) => ({
    uri: l.uri.toString(),
    range: { start: l.range.start, end: l.range.end }
  }));
}
async function getDefinition(uri, position) {
  const defs = await vscode2.commands.executeCommand("vscode.executeDefinitionProvider", uri, position);
  return defs;
}
async function getDocumentSymbols(uri) {
  try {
    const symbols = await vscode2.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri
    );
    if (!symbols || !Array.isArray(symbols)) return [];
    const out = [];
    const visit = (items) => {
      for (const s of items) {
        out.push({ name: s.name, kind: s.kind, range: s.selectionRange || s.range });
        if (s.children && s.children.length) visit(s.children);
      }
    };
    visit(symbols);
    return out;
  } catch {
    return [];
  }
}

// src/graph.ts
var JS_GLOB = ["**/*.{js,jsx,ts,tsx}"];
var PY_GLOB = ["**/*.py"];
function normalizePath(p) {
  try {
    let out = path.resolve(p);
    if (process.platform === "win32") {
      out = path.normalize(out);
      out = out.replace(/^([A-Z]):\\/, (m, d) => `${d.toLowerCase()}:\\`);
    }
    return out;
  } catch {
    return p;
  }
}
async function buildIndex(root) {
  const excludes = vscode3.workspace.getConfiguration("codeCanvas").get("excludeGlobs") || [];
  const rawFiles = Array.from(/* @__PURE__ */ new Set([
    ...await (0, import_fast_glob.default)(JS_GLOB, { cwd: root, absolute: true, ignore: excludes }),
    ...await (0, import_fast_glob.default)(PY_GLOB, { cwd: root, absolute: true, ignore: excludes })
  ]));
  const files = rawFiles.map((f) => normalizePath(f));
  const lang = /* @__PURE__ */ new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    lang.set(
      f,
      ext === ".py" ? "py" : ext === ".ts" || ext === ".tsx" ? "ts" : ext === ".js" || ext === ".jsx" ? "js" : "other"
    );
  }
  const imports = /* @__PURE__ */ new Map();
  const importLines = /* @__PURE__ */ new Map();
  const importEntries = /* @__PURE__ */ new Map();
  for (const f of files) {
    const src = safeRead(f);
    const specs = lang.get(f) === "py" ? parsePyImportsWithLines(src) : parseJsTsImportsWithLines(src);
    const targets = /* @__PURE__ */ new Set();
    const lineMap = /* @__PURE__ */ new Map();
    importEntries.set(f, specs);
    for (const { spec, line } of specs) {
      const r = lang.get(f) === "py" ? resolvePy(root, f, spec) : resolveJsTs(root, f, spec);
      if (!r) continue;
      const rNorm = normalizePath(r);
      targets.add(rNorm);
      const arr = lineMap.get(rNorm) || [];
      arr.push(line);
      lineMap.set(rNorm, arr);
    }
    imports.set(f, targets);
    importLines.set(f, lineMap);
  }
  return { nodes: new Set(files), imports, importLines, lang, importEntries };
}
async function subgraph(index, seeds, maxNodes) {
  const seen = /* @__PURE__ */ new Set();
  const q = [];
  for (const s of seeds) {
    const sNorm = normalizePath(s);
    if (index.nodes.has(sNorm)) {
      seen.add(sNorm);
      q.push(sNorm);
    }
  }
  if (q.length === 0) {
    for (const f of Array.from(index.nodes).slice(0, Math.min(10, index.nodes.size))) {
      seen.add(f);
      q.push(f);
    }
  }
  while (q.length && seen.size < maxNodes) {
    const cur = q.shift();
    const out = index.imports.get(cur) || /* @__PURE__ */ new Set();
    for (const t of out) {
      if (seen.size >= maxNodes) break;
      const tNorm = normalizePath(t);
      if (!index.nodes.has(tNorm)) continue;
      if (!seen.has(tNorm)) {
        seen.add(tNorm);
        q.push(tNorm);
      }
    }
    for (const [f, outs] of index.imports) {
      if (outs.has(cur) && !seen.has(f)) {
        if (seen.size >= maxNodes) break;
        seen.add(f);
        q.push(f);
      }
    }
  }
  const nodes = Array.from(seen).map((f) => ({
    id: makeSafeId(f),
    label: path.basename(f),
    path: f,
    lang: index.lang.get(f) || "other"
  }));
  const nodeIdByPath = /* @__PURE__ */ new Map();
  for (const n of nodes) nodeIdByPath.set(n.path, n.id);
  const edges = [];
  const symbolCache = /* @__PURE__ */ new Map();
  const getSymbols = async (file) => {
    if (!symbolCache.has(file)) {
      const uri = vscode3.Uri.file(file);
      symbolCache.set(file, await getDocumentSymbols(uri));
    }
    return symbolCache.get(file);
  };
  for (const s of seen) {
    const lineMap = index.importLines.get(s) || /* @__PURE__ */ new Map();
    const entries = index.importEntries.get(s) || [];
    for (const t of index.imports.get(s) || /* @__PURE__ */ new Set()) {
      if (seen.has(t)) {
        const sid = nodeIdByPath.get(s);
        const tid = nodeIdByPath.get(t);
        const lines = lineMap.get(t) || [];
        const sourceLine = lines.length ? lines[0] : void 0;
        const links = [];
        try {
          const syms = await getSymbols(t);
          for (const { spec, line } of entries) {
            const resolved = index.lang.get(s) === "py" ? resolvePy(path.dirname(s), s, spec) : resolveJsTs(path.dirname(s), s, spec);
            const resolvedNorm = resolved ? normalizePath(resolved) : void 0;
            if (resolvedNorm !== t) continue;
            let targetLine = 0;
            const topLevel = syms.filter((sy) => sy.range?.start?.line != null);
            if (topLevel.length === 1) targetLine = topLevel[0].range.start.line;
            else if (topLevel.length > 1) {
              const preferred = topLevel.find((sy) => sy.kind === vscode3.SymbolKind.Class || sy.kind === vscode3.SymbolKind.Function || sy.kind === vscode3.SymbolKind.Method) || topLevel[0];
              targetLine = preferred.range.start.line;
            }
            links.push({ symbolName: void 0, targetLine });
          }
        } catch {
        }
        edges.push({ id: `e_${hashString(s + "->" + t + "#" + (sourceLine ?? -1))}`, source: sid, target: tid, kind: "import", sourceLine, targetLine: links[0]?.targetLine ?? 0, links });
      }
    }
  }
  return { nodes, edges };
}
function safeRead(p) {
  try {
    return fs2.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function parseJsTsImportsWithLines(code) {
  const out = [];
  const patterns = [
    /import\s+[^'\"]+from\s+['\"]([^'\"]+)['\"]/g,
    /import\s+['\"]([^'\"]+)['\"]/g,
    /export\s+[^'\"]*\s+from\s+['\"]([^'\"]+)['\"]/g
  ];
  for (const r of patterns) {
    let m;
    while (m = r.exec(code)) {
      const idx = m.index ?? 0;
      const line = code.slice(0, idx).split("\n").length - 1;
      out.push({ spec: m[1], line });
    }
  }
  return out;
}
function parsePyImportsWithLines(code) {
  const out = [];
  let m;
  const r1 = /^\s*import\s+([\w\.]+)/gm;
  const r2 = /^\s*from\s+([\w\.]+)\s+import\s+[\w\*,\s]+/gm;
  while (m = r1.exec(code)) {
    const idx = m.index ?? 0;
    const line = code.slice(0, idx).split("\n").length - 1;
    out.push({ spec: m[1], line });
  }
  while (m = r2.exec(code)) {
    const idx = m.index ?? 0;
    const line = code.slice(0, idx).split("\n").length - 1;
    out.push({ spec: m[1], line });
  }
  return out;
}
function resolveJsTs(root, fromFile, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return;
  const base = path.resolve(path.dirname(fromFile), spec);
  const tries = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
  for (const t of tries) {
    const p = base + t;
    if (fs2.existsSync(p)) return normalizePath(p);
  }
}
function resolvePy(root, _from, mod) {
  const parts = mod.split(".");
  const candidates = [
    path.resolve(root, ...parts) + ".py",
    path.resolve(root, ...parts, "__init__.py")
  ];
  for (const p of candidates) if (fs2.existsSync(p)) return normalizePath(p);
}
function hashString(input) {
  let hash = 0 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash = hash * 31 + input.charCodeAt(i) >>> 0;
  }
  return hash.toString(36);
}
function makeSafeId(raw) {
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `n_${safe}_${hashString(raw)}`;
}

// src/git.ts
var vscode4 = __toESM(require("vscode"));
async function getChangedFiles() {
  const gitExt = vscode4.extensions.getExtension("vscode.git");
  if (gitExt) {
    const api = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
    const repo = api.repositories[0];
    if (repo) {
      const files = [
        ...repo.state.workingTreeChanges,
        ...repo.state.mergeChanges,
        ...repo.state.indexChanges
      ].map((c) => c.uri.fsPath);
      return Array.from(new Set(files));
    }
  }
  try {
    const cp = await import("child_process");
    const { stdout } = cp.spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    return stdout.split("\n").filter(Boolean).map((line) => line.slice(3)).filter(Boolean);
  } catch {
    return [];
  }
}
function watchGitState(onChange) {
  const gitExt = vscode4.extensions.getExtension("vscode.git");
  if (!gitExt) return () => {
  };
  const add = async () => {
    const api = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
    const repo = api.repositories[0];
    if (!repo) return () => {
    };
    const d1 = repo.state.onDidChange(onChange);
    const d2 = api.onDidOpenRepository(onChange);
    const d3 = api.onDidChangeState(onChange);
    return () => {
      d1.dispose();
      d2.dispose();
      d3.dispose();
    };
  };
  add();
  return () => {
  };
}

// src/extension.ts
var panel;
var idxPromise;
var lastSeeds = [];
var lastCap = 0;
function activate(context) {
  context.subscriptions.push(
    vscode5.commands.registerCommand("codeCanvas.open", () => openPanel(context)),
    vscode5.commands.registerCommand("codeCanvas.openChanged", async () => {
      await ensurePanel(context);
      const files = await getChangedFiles();
      panel?.webview.postMessage({ type: "openChanged", files });
    }),
    vscode5.commands.registerCommand("codeCanvas.layout.custom", () => panel?.webview.postMessage({ type: "layout", algo: "custom" })),
    vscode5.commands.registerCommand("codeCanvas.layout.dagre", () => panel?.webview.postMessage({ type: "layout", algo: "dagre" })),
    vscode5.commands.registerCommand("codeCanvas.layout.elk", () => panel?.webview.postMessage({ type: "layout", algo: "elk" })),
    vscode5.commands.registerCommand("codeCanvas.layout.force", () => panel?.webview.postMessage({ type: "layout", algo: "force" })),
    vscode5.commands.registerCommand("codeCanvas.toggleRefs", () => panel?.webview.postMessage({ type: "toggleRefs" })),
    vscode5.commands.registerCommand("codeCanvas.seedFolder", async () => {
      await ensurePanel(context);
      const picked = await vscode5.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Use Folder as Seed" });
      if (!picked || !picked[0]) return;
      const folder = picked[0].fsPath;
      const root = vscode5.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root && !idxPromise) idxPromise = buildIndex(root);
      const index = await idxPromise;
      if (!index) return;
      const folderNorm = path2.resolve(folder);
      const seeds = Array.from(index.nodes).filter((p) => isSubPath(folderNorm, p));
      if (!seeds.length) {
        vscode5.window.showInformationMessage("Code Canvas: No files found under selected folder.");
        return;
      }
      const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
      const initialCapCfg = vscode5.workspace.getConfiguration("codeCanvas").get("initialCap") ?? 25;
      const cap = Math.min(maxNodes, initialCapCfg);
      lastSeeds = seeds;
      lastCap = cap;
      const g = await subgraph(index, seeds, cap);
      panel?.webview.postMessage({ type: "graph", graph: g });
    }),
    vscode5.commands.registerCommand("codeCanvas.loadMore", async () => {
      await ensurePanel(context);
      if (!lastSeeds.length) return;
      const root = vscode5.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root && !idxPromise) idxPromise = buildIndex(root);
      const index = await idxPromise;
      if (!index) return;
      const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
      const nextCap = Math.min(maxNodes, lastCap + 25);
      lastCap = nextCap;
      const g = await subgraph(index, lastSeeds, nextCap);
      panel?.webview.postMessage({ type: "graph", graph: g });
    })
  );
  vscode5.workspace.onDidChangeTextDocument(async (e) => {
    if (!panel) return;
    panel.webview.postMessage({ type: "docChanged", file: e.document.uri.fsPath });
  });
  watchGitState(async () => {
    if (!panel) return;
    const files = await getChangedFiles();
    panel.webview.postMessage({ type: "gitChanged", files });
  });
}
async function ensurePanel(context) {
  if (!panel) openPanel(context);
}
function openPanel(context) {
  const column = vscode5.ViewColumn.Beside;
  panel = vscode5.window.createWebviewPanel("codeCanvas", "Code Canvas", column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode5.Uri.joinPath(context.extensionUri, "media")]
  });
  panel.webview.html = htmlForWebview(panel, context);
  panel.onDidDispose(() => panel = void 0);
  const ws = vscode5.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) idxPromise = buildIndex(ws);
  setTimeout(() => sendInitial(ws), 150);
  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "requestGraph":
        await sendInitial(ws);
        break;
      case "expand":
        await sendExpansion(msg.ids || []);
        break;
      case "loadMore": {
        const root = vscode5.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root && !idxPromise) idxPromise = buildIndex(root);
        const index = await idxPromise;
        if (!index || !lastSeeds.length) break;
        const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
        const nextCap = Math.min(maxNodes, lastCap + 25);
        lastCap = nextCap;
        const g = await subgraph(index, lastSeeds, nextCap);
        panel?.webview.postMessage({ type: "graph", graph: g });
        break;
      }
      case "openFile": {
        const uri = vscode5.Uri.file(msg.path);
        vscode5.window.showTextDocument(uri, { preview: false });
        break;
      }
      case "toggleEdges": {
        panel?.webview.postMessage({ type: "toggleEdges" });
        break;
      }
      case "requestChanged": {
        const files = await getChangedFiles();
        panel?.webview.postMessage({ type: "changedFiles", files });
        break;
      }
      case "requestRefs": {
        const { path: path3, line, character } = msg;
        const uri = vscode5.Uri.file(path3);
        const refs = await getReferences(uri, new vscode5.Position(line, character));
        panel?.webview.postMessage({ type: "refs", at: { path: path3, line, character }, refs });
        break;
      }
      case "requestDefOpen": {
        const { path: path3, line, character } = msg;
        const fromUri = vscode5.Uri.file(path3);
        const defs = await getDefinition(fromUri, new vscode5.Position(line, character));
        const loc = Array.isArray(defs) ? defs[0] : defs;
        if (loc) {
          let openUri;
          let range;
          const anyLoc = loc;
          if (anyLoc.targetUri) {
            openUri = toUri(anyLoc.targetUri);
            range = anyLoc.targetSelectionRange || anyLoc.targetRange;
          } else if (anyLoc.uri) {
            openUri = toUri(anyLoc.uri);
            range = anyLoc.range;
          }
          if (openUri) await vscode5.window.showTextDocument(openUri, { preview: false, selection: range });
        }
        break;
      }
      case "requestCode": {
        const { path: path3 } = msg;
        const maxBytes = vscode5.workspace.getConfiguration("codeCanvas").get("maxPreviewBytes") ?? 1e5;
        const content = safeRead2(path3, maxBytes);
        panel?.webview.postMessage({ type: "code", path: path3, content });
        break;
      }
      case "requestCodeMany": {
        const { paths } = msg;
        const maxBytes = vscode5.workspace.getConfiguration("codeCanvas").get("maxPreviewBytes") ?? 1e5;
        const entries = (paths || []).map((p) => ({ path: p, content: safeRead2(p, maxBytes) }));
        panel?.webview.postMessage({ type: "codeMany", entries });
        break;
      }
    }
  });
}
async function sendInitial(ws) {
  if (!panel) return;
  if (!ws) {
    panel.webview.postMessage({ type: "empty", reason: "no-workspace" });
    return;
  }
  const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
  const initialCapCfg = vscode5.workspace.getConfiguration("codeCanvas").get("initialCap") ?? 25;
  const active = vscode5.window.activeTextEditor?.document.uri.fsPath;
  const changed = (await getChangedFiles()).slice(0, 5);
  const seeds = Array.from(new Set([active, ...changed].filter(Boolean)));
  panel.webview.postMessage({ type: "progress", msg: "Indexing\u2026" });
  const index = await (idxPromise ?? buildIndex(ws));
  panel.webview.postMessage({ type: "progress", msg: null });
  const initialCap = Math.min(maxNodes, initialCapCfg);
  lastSeeds = seeds;
  lastCap = initialCap;
  const g = await subgraph(index, seeds, initialCap);
  if (!g.nodes.length) panel.webview.postMessage({ type: "empty", reason: "no-matched-files" });
  else panel.webview.postMessage({ type: "graph", graph: g });
}
async function sendExpansion(ids) {
  if (!panel) return;
  const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
  const index = await idxPromise;
  if (!index) return;
  const g = await subgraph(index, ids, maxNodes);
  panel?.webview.postMessage({ type: "expandResult", graph: g });
}
function deactivate() {
}
function toUri(u) {
  try {
    if (!u) return void 0;
    if (u instanceof vscode5.Uri) return u;
    const anyU = u;
    if (typeof anyU === "object" && typeof anyU.scheme === "string") {
      return vscode5.Uri.from(anyU);
    }
    if (typeof u === "string") {
      const s = u;
      if (/^[a-zA-Z]:[\\/]/.test(s)) {
        return vscode5.Uri.file(s);
      }
      return vscode5.Uri.parse(s);
    }
  } catch {
  }
  return void 0;
}
function isSubPath(parent, child) {
  try {
    const parentNorm = path2.resolve(parent);
    const childNorm = path2.resolve(child);
    if (process.platform === "win32") {
      const p = parentNorm.replace(/[\\/]+$/, "") + path2.sep;
      const c = childNorm;
      return c.toLowerCase().startsWith(p.toLowerCase());
    } else {
      const p = parentNorm.endsWith(path2.sep) ? parentNorm : parentNorm + path2.sep;
      return childNorm.startsWith(p);
    }
  } catch {
    return false;
  }
}
function safeRead2(p, _limit) {
  try {
    return fs3.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
