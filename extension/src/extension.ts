import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { htmlForWebview, Graph } from './util';
import { buildIndex, subgraph } from './graph';
import { getChangedFiles, watchGitState } from './git';
import * as lsp from './lsp';

let panel: vscode.WebviewPanel | undefined;
let idxPromise: ReturnType<typeof buildIndex> | undefined;
let lastSeeds: string[] = [];
let lastCap: number = 0;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('codeCanvas.open', () => openPanel(context)),
        vscode.commands.registerCommand('codeCanvas.openChanged', async () => {
            await ensurePanel(context);
            const files = await getChangedFiles();
            panel?.webview.postMessage({ type: 'openChanged', files });
        }),
        vscode.commands.registerCommand('codeCanvas.layout.custom', () => panel?.webview.postMessage({ type: 'layout', algo: 'custom' })),
        vscode.commands.registerCommand('codeCanvas.layout.dagre', () => panel?.webview.postMessage({ type: 'layout', algo: 'dagre' })),
        vscode.commands.registerCommand('codeCanvas.layout.elk', () => panel?.webview.postMessage({ type: 'layout', algo: 'elk' })),
        vscode.commands.registerCommand('codeCanvas.layout.force', () => panel?.webview.postMessage({ type: 'layout', algo: 'force' })),
        vscode.commands.registerCommand('codeCanvas.toggleRefs', () => panel?.webview.postMessage({ type: 'toggleRefs' })),
        vscode.commands.registerCommand('codeCanvas.seedFolder', async () => {
            await ensurePanel(context);
            const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use Folder as Seed' });
            if (!picked || !picked[0]) return;
            const folder = picked[0].fsPath;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (root && !idxPromise) idxPromise = buildIndex(root);
            const index = await idxPromise;
            if (!index) return;
            const folderNorm = path.resolve(folder);
            const seeds = Array.from(index.nodes).filter(p => isSubPath(folderNorm, p));
            if (!seeds.length) {
                vscode.window.showInformationMessage('Code Canvas: No files found under selected folder.');
                return;
            }
            const maxNodes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxNodes') ?? 300;
            const initialCapCfg: number = vscode.workspace.getConfiguration('codeCanvas').get('initialCap') ?? 25;
            const cap = Math.min(maxNodes, initialCapCfg);
            lastSeeds = seeds;
            lastCap = cap;
            const g: Graph = await subgraph(index, seeds, cap);
            panel?.webview.postMessage({ type: 'graph', graph: g });
        }),
        vscode.commands.registerCommand('codeCanvas.loadMore', async () => {
            await ensurePanel(context);
            if (!lastSeeds.length) return;
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (root && !idxPromise) idxPromise = buildIndex(root);
            const index = await idxPromise;
            if (!index) return;
            const maxNodes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxNodes') ?? 300;
            const nextCap = Math.min(maxNodes, lastCap + 25);
            lastCap = nextCap;
            const g: Graph = await subgraph(index, lastSeeds, nextCap);
            panel?.webview.postMessage({ type: 'graph', graph: g });
        })
    );

    vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (!panel) return;
        panel.webview.postMessage({ type: 'docChanged', file: e.document.uri.fsPath });
    });

    watchGitState(async () => {
        if (!panel) return;
        const files = await getChangedFiles();
        panel.webview.postMessage({ type: 'gitChanged', files });
    });
}

async function ensurePanel(context: vscode.ExtensionContext) { if (!panel) openPanel(context); }

function openPanel(context: vscode.ExtensionContext) {
    const column = vscode.ViewColumn.Beside;
    panel = vscode.window.createWebviewPanel('codeCanvas', 'Code Canvas', column, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    panel.webview.html = htmlForWebview(panel, context);
    panel.onDidDispose(() => panel = undefined);

    // kick off indexing
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (ws) idxPromise = buildIndex(ws);

    setTimeout(() => sendInitial(ws), 150);

    panel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
            case 'requestGraph': await sendInitial(ws); break;
            case 'expand': await sendExpansion(msg.ids || []); break;
            case 'loadMore': {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (root && !idxPromise) idxPromise = buildIndex(root);
                const index = await idxPromise;
                if (!index || !lastSeeds.length) break;
                const maxNodes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxNodes') ?? 300;
                const nextCap = Math.min(maxNodes, lastCap + 25);
                lastCap = nextCap;
                const g: Graph = await subgraph(index, lastSeeds, nextCap);
                panel?.webview.postMessage({ type: 'graph', graph: g });
                break;
            }
            case 'openFile': {
                const uri = vscode.Uri.file(msg.path);
                vscode.window.showTextDocument(uri, { preview: false });
                break;
            }
            case 'toggleEdges': {
                panel?.webview.postMessage({ type: 'toggleEdges' });
                break;
            }
            case 'requestChanged': {
                const files = await getChangedFiles();
                panel?.webview.postMessage({ type: 'changedFiles', files });
                break;
            }
            case 'requestRefs': {
                const { path, line, character } = msg;
                const uri = vscode.Uri.file(path);
                const refs = await lsp.getReferences(uri, new vscode.Position(line, character));
                panel?.webview.postMessage({ type: 'refs', at: { path, line, character }, refs });
                break;
            }
            case 'requestDefOpen': {
                const { path, line, character } = msg;
                const fromUri = vscode.Uri.file(path);
                const defs = await lsp.getDefinition(fromUri, new vscode.Position(line, character));
                const loc = Array.isArray(defs) ? defs[0] : defs;
                if (loc) {
                    let openUri: vscode.Uri | undefined;
                    let range: vscode.Range | undefined;
                    const anyLoc = loc as any;
                    if (anyLoc.targetUri) {
                        openUri = toUri(anyLoc.targetUri);
                        range = (anyLoc.targetSelectionRange || anyLoc.targetRange) as vscode.Range | undefined;
                    } else if (anyLoc.uri) {
                        openUri = toUri(anyLoc.uri);
                        range = anyLoc.range as vscode.Range | undefined;
                    }
                    if (openUri) await vscode.window.showTextDocument(openUri, { preview: false, selection: range });
                }
                break;
            }
            case 'requestCode': {
                const { path } = msg;
                const maxBytes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxPreviewBytes') ?? 100_000;
                const content = safeRead(path, maxBytes);
                panel?.webview.postMessage({ type: 'code', path, content });
                break;
            }
            case 'requestCodeMany': {
                const { paths } = msg as { paths: string[] };
                const maxBytes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxPreviewBytes') ?? 100_000;
                const entries = (paths || []).map(p => ({ path: p, content: safeRead(p, maxBytes) }));
                panel?.webview.postMessage({ type: 'codeMany', entries });
                break;
            }
        }
    });
}

async function sendInitial(ws?: string) {
    if (!panel) return;
    if (!ws) { panel.webview.postMessage({ type: 'empty', reason: 'no-workspace' }); return; }

    const maxNodes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxNodes') ?? 300;
    const initialCapCfg: number = vscode.workspace.getConfiguration('codeCanvas').get('initialCap') ?? 25;

    // seeds = active editor + changed files
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const changed = (await getChangedFiles()).slice(0, 5);
    const seeds = Array.from(new Set([active, ...changed].filter(Boolean) as string[]));

    panel.webview.postMessage({ type: 'progress', msg: 'Indexing…' });
    const index = await (idxPromise ?? buildIndex(ws));
    panel.webview.postMessage({ type: 'progress', msg: null });

    const initialCap = Math.min(maxNodes, initialCapCfg);
    lastSeeds = seeds;
    lastCap = initialCap;
    const g: Graph = await subgraph(index, seeds, initialCap);
    if (!g.nodes.length) panel.webview.postMessage({ type: 'empty', reason: 'no-matched-files' });
    else panel.webview.postMessage({ type: 'graph', graph: g });
}

async function sendExpansion(ids: string[]) {
    if (!panel) return;
    const maxNodes: number = vscode.workspace.getConfiguration('codeCanvas').get('maxNodes') ?? 300;
    const index = await idxPromise;
    if (!index) return;
    const g: Graph = await subgraph(index, ids, maxNodes);
    panel?.webview.postMessage({ type: 'expandResult', graph: g });
}

export function deactivate() { }

function toUri(u: unknown): vscode.Uri | undefined {
    try {
        if (!u) return undefined;
        if (u instanceof vscode.Uri) return u;
        const anyU = u as any;
        if (typeof anyU === 'object' && typeof anyU.scheme === 'string') {
            return vscode.Uri.from(anyU);
        }
        if (typeof u === 'string') {
            const s = u as string;
            if (/^[a-zA-Z]:[\\/]/.test(s)) {
                return vscode.Uri.file(s);
            }
            return vscode.Uri.parse(s);
        }
    } catch { }
    return undefined;
}

function isSubPath(parent: string, child: string): boolean {
    try {
        const parentNorm = path.resolve(parent);
        const childNorm = path.resolve(child);
        if (process.platform === 'win32') {
            const p = parentNorm.replace(/[\\/]+$/, '') + path.sep; // ensure trailing sep
            const c = childNorm;
            return c.toLowerCase().startsWith(p.toLowerCase());
        } else {
            const p = parentNorm.endsWith(path.sep) ? parentNorm : parentNorm + path.sep;
            return childNorm.startsWith(p);
        }
    } catch {
        return false;
    }
}

function safeRead(p: string, _limit: number): string {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return '';
    }
}