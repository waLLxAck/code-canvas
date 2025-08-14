import fg from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { Graph, EdgeLink } from './util';
import { getDocumentSymbols } from './lsp';

const JS_GLOB = ['**/*.{js,jsx,ts,tsx}'];
const PY_GLOB = ['**/*.py'];

// Normalize paths to a canonical absolute form used for all map/set keys
function normalizePath(p: string): string {
    try {
        let out = path.resolve(p);
        if (process.platform === 'win32') {
            out = path.normalize(out);
            // Lowercase drive letter for consistency
            out = out.replace(/^([A-Z]):\\/, (m, d) => `${d.toLowerCase()}:\\`);
        }
        return out;
    } catch {
        return p;
    }
}

type Index = {
    nodes: Set<string>;
    imports: Map<string, Set<string>>; // file -> imported file paths (resolved)
    importLines: Map<string, Map<string, number[]>>; // file -> (resolved -> lines)
    lang: Map<string, 'js' | 'ts' | 'py' | 'other'>;
    // Detailed import entries to enable symbol-level mapping
    importEntries: Map<string, { spec: string; line: number }[]>; // per source file
};

export async function buildIndex(root: string): Promise<Index> {
    const excludes: string[] = vscode.workspace.getConfiguration('codeCanvas').get('excludeGlobs') || [];
    const rawFiles = Array.from(new Set([
        ...await fg(JS_GLOB, { cwd: root, absolute: true, ignore: excludes }),
        ...await fg(PY_GLOB, { cwd: root, absolute: true, ignore: excludes }),
    ]));
    const files = rawFiles.map(f => normalizePath(f));

    const lang = new Map<string, 'js' | 'ts' | 'py' | 'other'>();
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        lang.set(
            f,
            ext === '.py' ? 'py'
                : (ext === '.ts' || ext === '.tsx') ? 'ts'
                    : (ext === '.js' || ext === '.jsx') ? 'js'
                        : 'other'
        );
    }

    const imports = new Map<string, Set<string>>();
    const importLines = new Map<string, Map<string, number[]>>();
    const importEntries = new Map<string, { spec: string; line: number }[]>();
    for (const f of files) {
        const src = safeRead(f);
        const specs = lang.get(f) === 'py' ? parsePyImportsWithLines(src) : parseJsTsImportsWithLines(src);
        const targets = new Set<string>();
        const lineMap = new Map<string, number[]>();
        importEntries.set(f, specs);
        for (const { spec, line } of specs) {
            const r = lang.get(f) === 'py' ? resolvePy(root, f, spec) : resolveJsTs(root, f, spec);
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

// Build a subgraph with BFS from seeds up to max nodes/edges.
export async function subgraph(index: Index, seeds: string[], maxNodes: number): Promise<Graph> {
    const seen = new Set<string>();
    const q: string[] = [];
    for (const s of seeds) {
        const sNorm = normalizePath(s);
        if (index.nodes.has(sNorm)) { seen.add(sNorm); q.push(sNorm); }
    }

    // If no valid seeds, pick up to 10 random-ish files to start
    if (q.length === 0) {
        for (const f of Array.from(index.nodes).slice(0, Math.min(10, index.nodes.size))) {
            seen.add(f); q.push(f);
        }
    }

    while (q.length && seen.size < maxNodes) {
        const cur = q.shift()!;
        const out = index.imports.get(cur) || new Set();
        for (const t of out) {
            if (seen.size >= maxNodes) break;
            const tNorm = normalizePath(t);
            if (!index.nodes.has(tNorm)) continue;
            if (!seen.has(tNorm)) { seen.add(tNorm); q.push(tNorm); }
        }
        // add a bit of reverse reachability (files importing cur)
        for (const [f, outs] of index.imports) {
            if (outs.has(cur) && !seen.has(f)) {
                if (seen.size >= maxNodes) break;
                seen.add(f); q.push(f);
            }
        }
    }

    const nodes = Array.from(seen).map(f => ({
        id: makeSafeId(f),
        label: path.basename(f),
        path: f,
        lang: (index.lang.get(f) || 'other') as any
    }));

    const nodeIdByPath = new Map<string, string>();
    for (const n of nodes) nodeIdByPath.set(n.path, n.id);

    const edges: Graph['edges'] = [];
    const symbolCache = new Map<string, Awaited<ReturnType<typeof getDocumentSymbols>>>();
    const getSymbols = async (file: string) => {
        if (!symbolCache.has(file)) {
            const uri = vscode.Uri.file(file);
            symbolCache.set(file, await getDocumentSymbols(uri));
        }
        return symbolCache.get(file)!;
    };

    for (const s of seen) {
        const lineMap = index.importLines.get(s) || new Map();
        const entries = index.importEntries.get(s) || [];
        for (const t of (index.imports.get(s) || new Set())) {
            if (seen.has(t)) {
                const sid = nodeIdByPath.get(s)!;
                const tid = nodeIdByPath.get(t)!;
                const lines = lineMap.get(t) || [];
                const sourceLine = lines.length ? lines[0] : undefined;

                // Compute per-symbol target lines for this src->t relationship
                const links: EdgeLink[] = [];
                try {
                    const syms = await getSymbols(t);
                    // Find all import statements for this target file and map names heuristically
                    for (const { spec, line } of entries) {
                        const resolved = (index.lang.get(s) === 'py') ? resolvePy(path.dirname(s), s, spec) : resolveJsTs(path.dirname(s), s, spec);
                        const resolvedNorm = resolved ? normalizePath(resolved) : undefined;
                        if (resolvedNorm !== t) continue;
                        // Heuristic: try to split last path part as module name, but prefer matching symbols by name presence in the source file near import
                        // For Phase 2 scope, we will not fully parse named specifiers; instead, map to best top-level symbol (class/func/var) if unique, else fallback 0
                        let targetLine = 0;
                        const topLevel = syms.filter(sy => sy.range?.start?.line != null);
                        if (topLevel.length === 1) targetLine = topLevel[0].range.start.line;
                        else if (topLevel.length > 1) {
                            // pick first non-trivial symbol (Class, Function) if present
                            const preferred = topLevel.find(sy => sy.kind === vscode.SymbolKind.Class || sy.kind === vscode.SymbolKind.Function || sy.kind === vscode.SymbolKind.Method) || topLevel[0];
                            targetLine = preferred.range.start.line;
                        }
                        links.push({ symbolName: undefined, targetLine });
                    }
                } catch {
                    // Fallback: keep empty links
                }

                edges.push({ id: `e_${hashString(s + '->' + t + '#' + (sourceLine ?? -1))}`, source: sid, target: tid, kind: 'import', sourceLine, targetLine: links[0]?.targetLine ?? 0, links });
            }
        }
    }

    return { nodes, edges };
}

function safeRead(p: string) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function parseJsTsImportsWithLines(code: string): { spec: string; line: number }[] {
    const out: { spec: string; line: number }[] = [];
    const patterns = [
        /import\s+[^'\"]+from\s+['\"]([^'\"]+)['\"]/g,
        /import\s+['\"]([^'\"]+)['\"]/g,
        /export\s+[^'\"]*\s+from\s+['\"]([^'\"]+)['\"]/g
    ];
    for (const r of patterns) {
        let m: RegExpExecArray | null;
        while ((m = r.exec(code))) {
            const idx = m.index ?? 0;
            const line = code.slice(0, idx).split('\n').length - 1;
            out.push({ spec: m[1], line });
        }
    }
    return out;
}
function parsePyImportsWithLines(code: string): { spec: string; line: number }[] {
    const out: { spec: string; line: number }[] = [];
    let m: RegExpExecArray | null;
    const r1 = /^\s*import\s+([\w\.]+)/gm;
    const r2 = /^\s*from\s+([\w\.]+)\s+import\s+[\w\*,\s]+/gm;
    while ((m = r1.exec(code))) {
        const idx = m.index ?? 0;
        const line = code.slice(0, idx).split('\n').length - 1;
        out.push({ spec: m[1], line });
    }
    while ((m = r2.exec(code))) {
        const idx = m.index ?? 0;
        const line = code.slice(0, idx).split('\n').length - 1;
        out.push({ spec: m[1], line });
    }
    return out;
}

function resolveJsTs(root: string, fromFile: string, spec: string): string | undefined {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return; // skip packages
    const base = path.resolve(path.dirname(fromFile), spec);
    const tries = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
    for (const t of tries) { const p = base + t; if (fs.existsSync(p)) return normalizePath(p); }
}
function resolvePy(root: string, _from: string, mod: string): string | undefined {
    const parts = mod.split('.');
    const candidates = [
        path.resolve(root, ...parts) + '.py',
        path.resolve(root, ...parts, '__init__.py')
    ];
    for (const p of candidates) if (fs.existsSync(p)) return normalizePath(p);
}

function hashString(input: string): string {
    let hash = 0 >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

function makeSafeId(raw: string): string {
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `n_${safe}_${hashString(raw)}`;
}