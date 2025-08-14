import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, applyNodeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes } from './reactflow-node-types';
import CodeCard from './code/CodeCard';

// VS Code webview API
declare global { interface Window { acquireVsCodeApi: any; __CODE_CACHE?: Record<string, string> } }
const vscode = window.acquireVsCodeApi?.();

type Node = { id: string; type: 'file'; position: { x: number; y: number }; data: any; style?: any; dragHandle?: string };

export default function App() {
    const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<any[]>([]);
    const nodesRef = useRef<Node[]>([]);
    const edgesRef = useRef<any[]>([]);
    const [rawEdges, setRawEdges] = useState<any[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [emptyMsg, setEmptyMsg] = useState<string | undefined>(undefined);
    const [progress, setProgress] = useState<string | undefined>(undefined);
    const lastAlgo = useRef<'horizontal'>('horizontal');
    const [showRefs, setShowRefs] = useState(true);
    const [wrap, setWrap] = useState(false);
    const [showEdges, setShowEdges] = useState(true);
    const [focusIds, setFocusIds] = useState<Set<string> | null>(null);
    const rfInstanceRef = useRef<any | null>(null);
    const codeCacheRef = useRef<Record<string, string>>({});
    const measuredSizeRef = useRef<Record<string, { width: number; height: number }>>({});
    const pendingMeasureRef = useRef<Record<string, { width: number; height: number }>>({});
    const rafCommitRef = useRef<number | null>(null);
    const headerHeight = 30; // matches CSS: .code-card { height: calc(100% - 30px); }
    const prePaddingTop = 8; // matches CSS: pre.hljs { padding: 8px 10px; }
    const lineHeight = 16; // approx from font-size 12px and line-height 1.35
    const linePosRef = useRef<Record<string, { line: number; top: number }[]>>({});
    const highlightRef = useRef<Record<string, number | undefined>>({});
    const scrollRef = useRef<Record<string, number | undefined>>({});

    function enqueueSizeUpdate(nodeId: string, size: { width: number; height: number }) {
        pendingMeasureRef.current[nodeId] = size;
        if (rafCommitRef.current == null) {
            rafCommitRef.current = window.requestAnimationFrame(() => {
                const updates = pendingMeasureRef.current;
                pendingMeasureRef.current = {};
                rafCommitRef.current = null;
                setNodes(prev => prev.map((x: any) => updates[x.id] ? { ...x, style: updates[x.id] } : x));
            });
        }
    }

    function computeStyleFromContent(content: string) {
        // fallback rough estimate before exact measure arrives
        const text = content || '';
        const lines = text.split('\n');
        const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
        const rawWidth = Math.max(480, Math.floor(maxLen * 7 + 40));
        const rawHeight = Math.max(200, lines.length * 14 + 30);
        // clamp to avoid enormous nodes that can destabilize layout/rendering
        const width = Math.min(rawWidth, 1400);
        const height = Math.min(rawHeight, 900);
        return { width, height } as const;
    }

    useEffect(() => {
        vscode?.postMessage({ type: 'requestGraph' });
        vscode?.postMessage({ type: 'requestChanged' });
        const listener = (e: MessageEvent) => {
            const msg = e.data;
            if (msg.type === 'empty') setEmptyMsg(msg.reason === 'no-workspace'
                ? 'Open a folder to analyze your code.' : 'No JS/TS/Python files found.');
            else if (msg.type === 'progress') setProgress(msg.msg || undefined);
            else if (msg.type === 'graph') {
                setEmptyMsg(undefined); setProgress(undefined); setGraph(msg.graph);
                const paths = (msg.graph?.nodes || []).map((n: any) => n.path);
                if (paths.length) startCodeLoadBatch(paths);
                setRawEdges(msg.graph?.edges || []);
            }
            else if (msg.type === 'expandResult') mergeGraph(msg.graph);
            else if (msg.type === 'changedFiles') {
                openFiles(msg.files);
            } else if (msg.type === 'openChanged') {
                openFiles(msg.files);
            } else if (msg.type === 'layout') {
                layout('horizontal');
            } else if (msg.type === 'toggleRefs') {
                setShowRefs(s => !s);
            } else if (msg.type === 'toggleEdges') {
                setShowEdges(s => !s);
            } else if (msg.type === 'code') {
                codeCacheRef.current[msg.path] = msg.content || '';
                setNodes(prev => prev.map(n => n.data.path === msg.path ? { ...n, style: computeStyleFromContent(codeCacheRef.current[msg.path]) } : n));
                onCodeArrived([msg.path]);
            } else if (msg.type === 'codeMany') {
                const updated = new Set<string>();
                for (const { path, content } of (msg.entries || [])) {
                    codeCacheRef.current[path] = content || '';
                    updated.add(path);
                }
                if (updated.size) setNodes(prev => prev.map(n => updated.has(n.data.path) ? { ...n, style: computeStyleFromContent(codeCacheRef.current[n.data.path]) } : n));
                onCodeArrived(Array.from(updated));
            } else if (msg.type === 'seedFolder') {
                // The extension relays the path; filter current index graph by prefix and request code for those
                const folder: string = msg.folder;
                const selected = (graph.nodes || []).filter((n: any) => (n.path || '').startsWith(folder));
                setNodes(prev => selected.map((n: any, i: number) => ({
                    id: n.id, type: 'file', position: { x: (i % 3) * 1200, y: Math.floor(i / 3) * 1000 },
                    style: computeStyleFromContent(codeCacheRef.current[n.path] || ''), dragHandle: '.file-node-header', data: { label: n.label, preview: (<div className="preview">{n.path}</div>), path: n.path, lang: n.lang }
                })));
                const paths = selected.map((n: any) => n.path);
                if (paths.length) startCodeLoadBatch(paths);
            }
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
    }, []);

    useEffect(() => { // build ReactFlow nodes
        const initial: Node[] = graph.nodes.map((n: any, i: number) => ({
            id: n.id,
            type: 'file',
            position: { x: (i % 3) * 1200, y: Math.floor(i / 3) * 1000 },
            style: computeStyleFromContent(codeCacheRef.current[n.path] || ''),
            dragHandle: '.file-node-header',
            data: { label: n.label, preview: (<div className="preview">{n.path}</div>), path: n.path, lang: n.lang }
        }));
        const e = (graph.edges || []).map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: { sourceLine: e.sourceLine, targetLine: e.targetLine },
            sourceHandle: (e.sourceLine ?? null) !== null && (e.sourceLine ?? undefined) !== undefined ? `line-${e.sourceLine}` : undefined,
            targetHandle: (e.targetLine ?? null) !== null && (e.targetLine ?? undefined) !== undefined ? `line-${e.targetLine}` : undefined
        }));
        setNodes(initial); setEdges(e);
    }, [graph]);

    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    useEffect(() => { edgesRef.current = edges; }, [edges]);

    function mergeGraph(g: any) {
        const newPaths: string[] = [];
        setNodes(prev => {
            const map = new Map(prev.map(n => [n.id, n]));
            for (const n of g.nodes) if (!map.has(n.id)) {
                newPaths.push(n.path);
                map.set(n.id, {
                    id: n.id, type: 'file',
                    position: { x: Math.random() * 800, y: Math.random() * 600 },
                    style: computeStyleFromContent(codeCacheRef.current[n.path] || ''),
                    dragHandle: '.file-node-header',
                    data: { label: n.label, preview: <div className="preview">{n.path}</div>, path: n.path, lang: n.lang }
                } as any);
            }
            return Array.from(map.values());
        });
        setEdges(prev => {
            const ids = new Set(prev.map(e => e.id));
            const add = g.edges.filter((e: any) => !ids.has(e.id));
            return [...prev, ...add];
        });
        if (newPaths.length) requestMoreCode(newPaths);
    }

    function openFiles(paths: string[]) {
        setNodes(prev => {
            const ids = new Set(prev.map(p => p.id));
            const add: Node[] = graph.nodes
                .filter((n: any) => paths.includes(n.path) && !ids.has(n.id))
                .map((n: any, i: number) => ({
                    id: n.id,
                    type: 'file',
                    position: { x: 50 + i * 30, y: 60 + i * 30 },
                    style: { width: 480, height: 280 },
                    dragHandle: '.file-node-header',
                    data: { label: n.label, preview: <div className="preview">{n.path}</div>, path: n.path, lang: n.lang }
                }));
            return [...prev, ...add];
        });
        if (paths && paths.length) requestMoreCode(paths);
    }

    // Debounced auto-layout to avoid thrashing
    const autoLayoutTimer = useRef<number | null>(null);
    function scheduleAutoLayout() {
        if (autoLayoutTimer.current) {
            window.clearTimeout(autoLayoutTimer.current);
        }
        autoLayoutTimer.current = window.setTimeout(() => { layout('horizontal'); }, 250);
    }

    // Track pending code loads and run one layout after all code in a batch has loaded
    const pendingCodePathsRef = useRef<Set<string>>(new Set());
    const afterFullLoadLayoutTimer = useRef<number | null>(null);

    function maybeRunLayoutAfterFullLoad() {
        if (pendingCodePathsRef.current.size !== 0) return;
        if (afterFullLoadLayoutTimer.current != null) {
            window.clearTimeout(afterFullLoadLayoutTimer.current);
        }
        // Give the DOM a moment so CodeCard measurements propagate before layout
        afterFullLoadLayoutTimer.current = window.setTimeout(() => {
            layout('horizontal');
            afterFullLoadLayoutTimer.current = null;
        }, 120);
    }

    function startCodeLoadBatch(paths: string[]) {
        const toRequest = (paths || []).filter(p => !codeCacheRef.current[p]);
        pendingCodePathsRef.current = new Set(toRequest);
        if (toRequest.length) {
            vscode?.postMessage({ type: 'requestCodeMany', paths: toRequest });
        } else {
            maybeRunLayoutAfterFullLoad();
        }
    }

    function requestMoreCode(paths: string[]) {
        const toRequest = (paths || []).filter(p => !codeCacheRef.current[p]);
        if (toRequest.length) {
            toRequest.forEach(p => pendingCodePathsRef.current.add(p));
            vscode?.postMessage({ type: 'requestCodeMany', paths: toRequest });
        }
    }

    function onCodeArrived(paths: string[]) {
        let any = false;
        for (const p of paths) {
            if (pendingCodePathsRef.current.delete(p)) any = true;
        }
        if (any) maybeRunLayoutAfterFullLoad();
    }

    async function layout(_algo: 'horizontal') {
        lastAlgo.current = 'horizontal';
        const currentNodes = nodesRef.current as any as Node[];
        let currentX = 40;
        const y = 60;
        const spacing = 20;
        const laidOut = currentNodes.map(n => {
            const measured = measuredSizeRef.current[n.id];
            const width = (n?.style?.width ?? measured?.width ?? 480);
            const pos = { x: currentX, y };
            currentX += width + spacing;
            return { ...n, position: pos } as any;
        });
        setNodes(laidOut as any);
        // fit viewport after layout so nodes remain visible
        setTimeout(() => { try { rfInstanceRef.current?.fitView?.({ padding: 0.2 }); } catch { } }, 0);
    }

    function onOpenFile(n: Node) { vscode?.postMessage({ type: 'openFile', path: n.data.path }); }

    function onTokenClick({ path, line, character, token }: any) {
        if (!showRefs) return;
        vscode?.postMessage({ type: 'requestRefs', path, line, character, token });
        vscode?.postMessage({ type: 'requestDefOpen', path, line, character });
        // Focus connected nodes to the clicked file
        const base = nodes.find(n => n.data.path === path);
        if (base) focusNodesForId(base.id);
    }

    function expandSelection() {
        const ids = selectedIds.length ? selectedIds : (nodes as any).filter((n: any) => n.selected).map((n: any) => n.id);
        if (ids.length) vscode?.postMessage({ type: 'expand', ids });
    }

    function focusNodesForId(baseId: string) {
        const neighborIds = new Set<string>([baseId]);
        for (const e of edges as any[]) {
            if (e.source === baseId) neighborIds.add(e.target);
            if (e.target === baseId) neighborIds.add(e.source);
        }
        // Build vertical positions for focus lane
        const order: string[] = [baseId, ...Array.from(neighborIds).filter(id => id !== baseId).sort()];
        let currentY = 60;
        const x = 40;
        const spacing = 20;
        const nextPos = new Map<string, { x: number; y: number }>();
        for (const id of order) {
            const n = nodes.find(n => n.id === id);
            const h = (n?.style?.height ?? measuredSizeRef.current[id]?.height ?? 280);
            nextPos.set(id, { x, y: currentY });
            currentY += h + spacing;
        }
        setFocusIds(new Set(neighborIds));
        setNodes(prev => prev.map(n => {
            const inFocus = neighborIds.has(n.id);
            const pos = nextPos.get(n.id);
            if (inFocus && pos) {
                return { ...n, position: pos, data: { ...n.data, dim: false } } as any;
            }
            return { ...n, data: { ...n.data, dim: true } } as any;
        }));
    }

    function clearFocus() {
        setFocusIds(null);
        setNodes(prev => prev.map(n => ({ ...n, data: { ...n.data, dim: false } } as any)));
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if ((e.key === 'e' || e.key === 'E')) expandSelection(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [nodes]);

    // render code previews lazily inside each node

    const nodeTypesLocal = useMemo(() => ({
        file: (p: any) => {
            const n = p.data;
            const content = codeCacheRef.current[n.path] ?? n.path;
            const handleLines: number[] = (() => {
                const s = new Set<number>();
                for (const e of edges as any[]) {
                    if (e.source === p.id && e.data?.sourceLine != null) s.add(e.data.sourceLine);
                    if (e.target === p.id && e.data?.targetLine != null) s.add(e.data.targetLine);
                }
                return Array.from(s).sort((a, b) => a - b).slice(0, 200);
            })();
            return (
                <div className="file-node" style={{ opacity: n.dim ? 0.25 : 1 }}>
                    <div className="file-node-header" onDoubleClick={() => onOpenFile(p)}>{n.label}</div>
                    <CodeCard
                        key={n.path}
                        file={n.path}
                        lang={n.lang}
                        content={content}
                        onTokenClick={onTokenClick}
                        wrap={wrap}
                        highlightLine={highlightRef.current[p.id]}
                        scrollToLine={scrollRef.current[p.id]}
                        onLinePositions={(positions) => { linePosRef.current[p.id] = positions; }}
                        onMeasured={({ width, height }) => {
                            const last = measuredSizeRef.current[p.id];
                            if (last && last.width === width && last.height === height) return;
                            measuredSizeRef.current[p.id] = { width, height };
                            enqueueSizeUpdate(p.id, { width, height });
                        }}
                    />
                    {/* default center handles */}
                    <Handle type="source" position={Position.Right} id={`line-0`} />
                    <Handle type="target" position={Position.Left} id={`line-0`} />
                    {/* per-line handles anchored by top offset */}
                    {handleLines.map((ln) => {
                        const top = (linePosRef.current[p.id]?.find(x => x.line === ln)?.top) ?? (headerHeight + prePaddingTop + ln * lineHeight);
                        return (
                            <React.Fragment key={ln}>
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={`line-${ln}`}
                                    style={{ top }}
                                />
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={`line-${ln}`}
                                    style={{ top }}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            );
        }
    }), [edges]);

    return (
        <div className="root">
            <div className="toolbar">
                <button onClick={() => layout('horizontal')}>Relayout</button>
                <button onClick={() => vscode?.postMessage({ type: 'loadMore' })}>Load 25 more</button>
                <button onClick={() => vscode?.postMessage({ type: 'requestChanged' })}>Open Changed (⇧O)</button>
                <button onClick={() => vscode?.postMessage({ type: 'requestGraph' })}>Reload</button>
                <button onClick={expandSelection}>Expand (E)</button>
                <button onClick={() => vscode?.postMessage({ type: 'toggleRefs' })}>Refs (R)</button>
                <button onClick={() => setWrap(w => !w)}>{wrap ? 'Unwrap' : 'Wrap'}</button>
                <button onClick={() => setShowEdges(s => !s)}>{showEdges ? 'Hide Edges' : 'Show Edges'}</button>
                <button onClick={() => vscode?.postMessage({ type: 'toggleEdges' })}>Toggle Edges (Global)</button>
                <button onClick={() => vscode?.postMessage({ type: 'seedFolder' })}>Seed Folder…</button>
                {focusIds ? (<button onClick={clearFocus}>Clear Focus</button>) : null}
            </div>
            <ReactFlow
                nodes={nodes as any}
                edges={showEdges ? (focusIds ? (edges as any[]).filter(e => focusIds.has(e.source) && focusIds.has(e.target)) : edges) : []}
                nodeTypes={nodeTypesLocal as any}
                fitView
                onInit={(inst) => { rfInstanceRef.current = inst; }}
                onNodeClick={(_e, node: any) => focusNodesForId(node.id)}
                onEdgeClick={(_e, edge: any) => {
                    const sl = (edge?.data?.sourceLine ?? 0);
                    const tl = (edge?.data?.targetLine ?? 0);
                    if (edge?.source) {
                        highlightRef.current[edge.source] = sl;
                        scrollRef.current[edge.source] = sl;
                    }
                    if (edge?.target) {
                        highlightRef.current[edge.target] = tl;
                        scrollRef.current[edge.target] = tl;
                    }
                    // Force a refresh to pass updated props
                    setNodes(n => [...n]);
                    // Also focus on the edge's source node to reorganize
                    if (edge?.source) focusNodesForId(edge.source);
                }}
                onSelectionChange={(p: any) => setSelectedIds((p?.nodes || []).map((n: any) => n.id))}
                onNodesChange={(changes) => setNodes((nds: any) => applyNodeChanges(changes as any, nds as any) as any)}
                minZoom={0.02}
                maxZoom={8}
            >
                <Background />
                <MiniMap pannable zoomable />
                <Controls />
            </ReactFlow>
            {progress && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', fontSize: 14, opacity: .8 }}>⚙ {progress}</div>}
            {emptyMsg && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 14, opacity: .8 }}>{emptyMsg}</div>}
        </div>
    );
}