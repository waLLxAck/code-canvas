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
var vscode2 = __toESM(require("vscode"));
var JS_GLOB = ["**/*.{js,jsx,ts,tsx}"];
var PY_GLOB = ["**/*.py"];
async function buildIndex(root) {
  const excludes = vscode2.workspace.getConfiguration("codeCanvas").get("excludeGlobs") || [];
  const files = Array.from(/* @__PURE__ */ new Set([
    ...await (0, import_fast_glob.default)(JS_GLOB, { cwd: root, absolute: true, ignore: excludes }),
    ...await (0, import_fast_glob.default)(PY_GLOB, { cwd: root, absolute: true, ignore: excludes })
  ]));
  const lang = /* @__PURE__ */ new Map();
  for (const f of files) {
    lang.set(
      f,
      f.endsWith(".py") ? "py" : f.endsWith(".ts") || f.endsWith(".tsx") ? "ts" : "js"
    );
  }
  const imports = /* @__PURE__ */ new Map();
  for (const f of files) {
    const src = safeRead(f);
    const specs = lang.get(f) === "py" ? parsePyImports(src) : parseJsTsImports(src);
    const targets = /* @__PURE__ */ new Set();
    for (const s of specs) {
      const r = lang.get(f) === "py" ? resolvePy(root, f, s) : resolveJsTs(root, f, s);
      if (r) targets.add(r);
    }
    imports.set(f, targets);
  }
  return { nodes: new Set(files), imports, lang };
}
function subgraph(index, seeds, maxNodes) {
  const seen = /* @__PURE__ */ new Set();
  const q = [];
  for (const s of seeds) if (index.nodes.has(s)) {
    seen.add(s);
    q.push(s);
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
      if (!seen.has(t)) {
        seen.add(t);
        q.push(t);
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
  for (const s of seen) {
    for (const t of index.imports.get(s) || /* @__PURE__ */ new Set()) {
      if (seen.has(t)) {
        const sid = nodeIdByPath.get(s);
        const tid = nodeIdByPath.get(t);
        edges.push({ id: `e_${hashString(s + "->" + t)}`, source: sid, target: tid, kind: "import" });
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
function parseJsTsImports(code) {
  const out = [];
  const r1 = /import\s+[^'\"]+from\s+['\"]([^'\"]+)['\"]/g;
  const r2 = /import\s+['\"]([^'\"]+)['\"]/g;
  const r3 = /export\s+[^'\"]*\s+from\s+['\"]([^'\"]+)['\"]/g;
  let m;
  for (const r of [r1, r2, r3]) while (m = r.exec(code)) out.push(m[1]);
  return out;
}
function parsePyImports(code) {
  const out = [];
  let m;
  const r1 = /^\s*import\s+([\w\.]+)/gm;
  const r2 = /^\s*from\s+([\w\.]+)\s+import\s+[\w\*,\s]+/gm;
  while (m = r1.exec(code)) out.push(m[1]);
  while (m = r2.exec(code)) out.push(m[1]);
  return out;
}
function resolveJsTs(root, fromFile, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return;
  const base = path.resolve(path.dirname(fromFile), spec);
  const tries = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
  for (const t of tries) {
    const p = base + t;
    if (fs2.existsSync(p)) return p;
  }
}
function resolvePy(root, _from, mod) {
  const parts = mod.split(".");
  const candidates = [
    path.resolve(root, ...parts) + ".py",
    path.resolve(root, ...parts, "__init__.py")
  ];
  for (const p of candidates) if (fs2.existsSync(p)) return p;
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
var vscode3 = __toESM(require("vscode"));
async function getChangedFiles() {
  const gitExt = vscode3.extensions.getExtension("vscode.git");
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
  const gitExt = vscode3.extensions.getExtension("vscode.git");
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

// src/lsp.ts
var vscode4 = __toESM(require("vscode"));
async function getReferences(uri, position) {
  const locs = await vscode4.commands.executeCommand(
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
  const defs = await vscode4.commands.executeCommand("vscode.executeDefinitionProvider", uri, position);
  return defs;
}

// src/extension.ts
var panel;
var idxPromise;
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
      const seeds = Array.from(index.nodes).filter((p) => p.startsWith(folder));
      if (!seeds.length) {
        vscode5.window.showInformationMessage("Code Canvas: No files found under selected folder.");
        return;
      }
      const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
      const initialCapCfg = vscode5.workspace.getConfiguration("codeCanvas").get("initialCap") ?? 60;
      const cap = Math.min(maxNodes, initialCapCfg);
      const g = subgraph(index, seeds, cap);
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
        const { path: path2, line, character } = msg;
        const uri = vscode5.Uri.file(path2);
        const refs = await getReferences(uri, new vscode5.Position(line, character));
        panel?.webview.postMessage({ type: "refs", at: { path: path2, line, character }, refs });
        break;
      }
      case "requestDefOpen": {
        const { path: path2, line, character } = msg;
        const fromUri = vscode5.Uri.file(path2);
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
        const { path: path2 } = msg;
        const maxBytes = vscode5.workspace.getConfiguration("codeCanvas").get("maxPreviewBytes") ?? 1e5;
        const content = safeRead2(path2, maxBytes);
        panel?.webview.postMessage({ type: "code", path: path2, content });
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
  const initialCapCfg = vscode5.workspace.getConfiguration("codeCanvas").get("initialCap") ?? 60;
  const active = vscode5.window.activeTextEditor?.document.uri.fsPath;
  const changed = (await getChangedFiles()).slice(0, 5);
  const seeds = Array.from(new Set([active, ...changed].filter(Boolean)));
  panel.webview.postMessage({ type: "progress", msg: "Indexing\u2026" });
  const index = await (idxPromise ?? buildIndex(ws));
  panel.webview.postMessage({ type: "progress", msg: null });
  const initialCap = Math.min(maxNodes, initialCapCfg);
  const g = subgraph(index, seeds, initialCap);
  if (!g.nodes.length) panel.webview.postMessage({ type: "empty", reason: "no-matched-files" });
  else panel.webview.postMessage({ type: "graph", graph: g });
}
async function sendExpansion(ids) {
  if (!panel) return;
  const maxNodes = vscode5.workspace.getConfiguration("codeCanvas").get("maxNodes") ?? 300;
  const index = await idxPromise;
  if (!index) return;
  const g = subgraph(index, ids, maxNodes);
  panel.webview.postMessage({ type: "expandResult", graph: g });
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
function safeRead2(p, limit) {
  try {
    const buf = fs3.readFileSync(p, "utf8");
    return buf.length > limit ? buf.slice(0, limit) + "\n// ... truncated ..." : buf;
  } catch {
    return "";
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
