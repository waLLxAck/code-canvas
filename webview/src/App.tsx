import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, applyNodeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes, GroupNode } from './reactflow-node-types';
import CodeCard from './code/CodeCard';
import { getLayoutedElements } from './layout';

// VS Code webview API
declare global { interface Window { acquireVsCodeApi: any; __CODE_CACHE?: Record<string, string> } }
const vscode = window.acquireVsCodeApi?.();

type Node = { id: string; type?: 'file' | 'group'; position: { x: number; y: number }; data: any; style?: any; dragHandle?: string; parentNode?: string; width?: number; height?: number; extent?: any };

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
    const hasFitOnceRef = useRef<boolean>(false);
    const viewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
    const [zoomOk, setZoomOk] = useState<boolean>(true);
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
    const zoomSmoothTimerRef = useRef<number | null>(null);
    const moveSamplesRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
    const isFlingingRef = useRef<boolean>(false);
    const flingRafRef = useRef<number | null>(null);
    const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
    const lastInputRef = useRef<'wheel' | 'drag' | null>(null);
    const zoomActiveRef = useRef<boolean>(false);
    const lastZoomTimeRef = useRef<number>(0);
    const prevVpRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
    const gestureZoomedRef = useRef<boolean>(false);
    const gesturePannedRef = useRef<boolean>(false);
    const wheelCooldownUntilRef = useRef<number>(0);

    const WHEEL_COOLDOWN_MS = 450;   // ~ matches your 420ms smooth class removal
    const ZOOM_EPS = 1e-4;           // minimal zoom delta treated as "zoom happened"

    function cancelFling(): void {
        if (flingRafRef.current != null) {
            try { cancelAnimationFrame(flingRafRef.current); } catch { }
            flingRafRef.current = null;
        }
        isFlingingRef.current = false;
    }



    function startFling(initialVx: number, initialVy: number): void {
        cancelFling();
        isFlingingRef.current = true;
        velocityRef.current = { vx: initialVx, vy: initialVy };
        let last = performance.now();
        const damping = 3.0; // s^-1 exponential decay
        const stopThreshold = 30; // px/s
        const axisStopMin = 15; // px/s per-axis stop to avoid tiny oscillations
        const step = () => {
            if (!isFlingingRef.current) return;
            const now = performance.now();
            const dt = Math.max(0, (now - last) / 1000);
            last = now;
            const v = velocityRef.current;
            const decay = Math.exp(-damping * dt);
            const prevVx = v.vx; const prevVy = v.vy;
            v.vx *= decay; v.vy *= decay;
            // Stop an axis if it crosses zero or is very small
            if (Math.sign(prevVx) !== 0 && Math.sign(prevVx) !== Math.sign(v.vx)) v.vx = 0;
            if (Math.abs(v.vx) < axisStopMin) v.vx = 0;
            if (Math.sign(prevVy) !== 0 && Math.sign(prevVy) !== Math.sign(v.vy)) v.vy = 0;
            if (Math.abs(v.vy) < axisStopMin) v.vy = 0;
            const speed = Math.hypot(v.vx, v.vy);
            const vp = viewportRef.current;
            let nextX = vp.x + v.vx * dt;
            let nextY = vp.y + v.vy * dt;
            // Snap to integer pixels near stop to reduce subpixel shimmer
            if (speed < 80) { nextX = Math.round(nextX); nextY = Math.round(nextY); }
            try { rfInstanceRef.current?.setViewport?.({ x: nextX, y: nextY, zoom: vp.zoom }); } catch { }
            viewportRef.current = { x: nextX, y: nextY, zoom: vp.zoom };
            if (speed < stopThreshold) { cancelFling(); return; }
            flingRafRef.current = requestAnimationFrame(step);
        };
        flingRafRef.current = requestAnimationFrame(step);
    }

    function enqueueSizeUpdate(nodeId: string, size: { width: number; height: number }) {
        // Avoid style writes while viewport is animated to prevent flicker
        if (isFlingingRef.current || isDraggingViewRef.current) return;
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
                const paths = (msg.graph?.nodes || []).filter((n: any) => n.type === 'file' && n.path).map((n: any) => n.path);
                if (paths.length) startCodeLoadBatch(paths);
                setRawEdges(msg.graph?.edges || []);
            }
            else if (msg.type === 'expandResult') mergeGraph(msg.graph);
            else if (msg.type === 'changedFiles') {
                openFiles(msg.files);
            } else if (msg.type === 'openChanged') {
                openFiles(msg.files);
            } else if (msg.type === 'layout') {
                layout();
            } else if (msg.type === 'toggleRefs') {
                setShowRefs(s => !s);
            } else if (msg.type === 'toggleEdges') {
                setShowEdges(s => !s);
            } else if (msg.type === 'code') {
                codeCacheRef.current[msg.path] = msg.content || '';
                setNodes(prev => prev.map(n => (n.type === 'file' && n.data.path === msg.path) ? { ...n, style: computeStyleFromContent(codeCacheRef.current[msg.path]) } : n));
                onCodeArrived([msg.path]);
            } else if (msg.type === 'codeMany') {
                const updated = new Set<string>();
                for (const { path, content } of (msg.entries || [])) {
                    codeCacheRef.current[path] = content || '';
                    updated.add(path);
                }
                if (updated.size) setNodes(prev => prev.map(n => (n.type === 'file' && updated.has(n.data.path)) ? { ...n, style: computeStyleFromContent(codeCacheRef.current[n.data.path]) } : n));
                onCodeArrived(Array.from(updated));
            } else if (msg.type === 'seedFolder') {
                // The extension relays the path; filter current index graph by prefix and request code for those
                const folder: string = msg.folder;
                const selected = (graph.nodes || []).filter((n: any) => n.type === 'file' && (n.path || '').startsWith(folder));
                setNodes(prev => selected.map((n: any, i: number) => ({
                    id: n.id, type: n.type, position: { x: (i % 3) * 1200, y: Math.floor(i / 3) * 1000 },
                    parentNode: n.parentNode, style: computeStyleFromContent(codeCacheRef.current[n.path] || ''), dragHandle: '.file-node-header', data: { label: n.label, preview: (<div className="preview">{n.path}</div>), path: n.path, lang: n.lang }
                })));
                const paths = selected.map((n: any) => n.path);
                if (paths.length) startCodeLoadBatch(paths);
            }
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
    }, []);

    useEffect(() => { // build ReactFlow nodes
        const newNodes: Node[] = (graph.nodes || []).map((n: any) => ({
            id: n.id,
            type: n.type,
            position: { x: 0, y: 0 },
            parentNode: n.parentNode,
            extent: n.type === 'file' && n.parentNode ? 'parent' : undefined,
            dragHandle: n.type === 'file' ? '.file-node-header' : undefined,
            data: n.type === 'file'
                ? { label: n.label, preview: (<div className="preview">{n.path}</div>), path: n.path, lang: n.lang }
                : { label: n.label },
            style: n.type === 'group' ? { width: 300, height: 200 } : computeStyleFromContent(codeCacheRef.current[n.path] || ''),
            // Ensure files render above their groups for interaction & visibility
            zIndex: n.type === 'group' ? 0 : 1,
        }));
        const newEdges = (graph.edges || []).map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: { sourceLine: e.sourceLine, targetLine: e.targetLine },
            sourceHandle: (e.sourceLine ?? null) !== null && (e.sourceLine ?? undefined) !== undefined ? `line-${e.sourceLine}` : undefined,
            targetHandle: (e.targetLine ?? null) !== null && (e.targetLine ?? undefined) !== undefined ? `line-${e.targetLine}` : undefined
        }));
        setNodes(newNodes);
        setEdges(newEdges);
        setRawEdges(newEdges);
        if (newNodes.length > 0) {
            setTimeout(() => layout(), 50);
        }
        hasFitOnceRef.current = false;
    }, [graph]);

    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    useEffect(() => { edgesRef.current = edges; }, [edges]);

    function mergeGraph(g: any) {
        const newPaths: string[] = [];
        setNodes(prev => {
            const map = new Map(prev.map(n => [n.id, n]));
            for (const n of g.nodes) if (!map.has(n.id)) {
                if (n.type === 'file' && n.path) newPaths.push(n.path);
                map.set(n.id, {
                    id: n.id,
                    type: n.type,
                    position: { x: Math.random() * 800, y: Math.random() * 600 },
                    parentNode: n.parentNode,
                    extent: n.type === 'file' && n.parentNode ? 'parent' : undefined,
                    style: n.type === 'group' ? { width: 300, height: 200 } : computeStyleFromContent(codeCacheRef.current[n.path] || ''),
                    dragHandle: n.type === 'file' ? '.file-node-header' : undefined,
                    data: n.type === 'file'
                        ? { label: n.label, preview: <div className="preview">{n.path}</div>, path: n.path, lang: n.lang }
                        : { label: n.label },
                    zIndex: n.type === 'group' ? 0 : 1,
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
                .filter((n: any) => n.type === 'file' && paths.includes(n.path) && !ids.has(n.id))
                .map((n: any, i: number) => ({
                    id: n.id,
                    type: n.type,
                    position: { x: 50 + i * 30, y: 60 + i * 30 },
                    parentNode: n.parentNode,
                    extent: n.parentNode ? 'parent' : undefined,
                    style: { width: 480, height: 280 },
                    dragHandle: '.file-node-header',
                    data: { label: n.label, preview: <div className="preview">{n.path}</div>, path: n.path, lang: n.lang },
                    zIndex: 1,
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
        autoLayoutTimer.current = window.setTimeout(() => { layout(); }, 250);
    }

    // Track pending code loads and run one layout after all code in a batch has loaded
    const pendingCodePathsRef = useRef<Set<string>>(new Set());
    const afterFullLoadLayoutTimer = useRef<number | null>(null);
    const moveFrameRef = useRef<number | null>(null);
    const pendingVpRef = useRef<any | null>(null);
    const isDraggingViewRef = useRef<boolean>(false);

    function maybeRunLayoutAfterFullLoad() {
        if (pendingCodePathsRef.current.size !== 0) return;
        if (afterFullLoadLayoutTimer.current != null) {
            window.clearTimeout(afterFullLoadLayoutTimer.current);
        }
        // Give the DOM a moment so CodeCard measurements propagate before layout
        afterFullLoadLayoutTimer.current = window.setTimeout(() => {
            layout();
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

    const layout = async () => {
        const nodesToLayout = nodesRef.current.map(n => ({
            ...n,
            width: n.style?.width || measuredSizeRef.current[n.id]?.width || 480,
            height: n.style?.height || measuredSizeRef.current[n.id]?.height || 280,
            // React Flow expects children to be inside parent bounds, pass through parentNode for layout
            parentNode: (n as any).parentNode,
            type: (n as any).type,
        }));
        if (nodesToLayout.length === 0) return;
        try {
            const layoutedNodes = await getLayoutedElements(nodesToLayout, edgesRef.current);
            setNodes(layoutedNodes as any);
        } catch (error) {
            // Fallback to simple horizontal layout if ELK fails
            console.warn('ELK layout failed, using fallback:', error);
            let currentX = 40;
            const y = 60;
            const spacing = 20;
            const fallbackNodes = nodesToLayout.map(n => {
                const width = n.width || 480;
                const pos = { x: currentX, y };
                currentX += width + spacing;
                return { ...n, position: pos };
            });
            setNodes(fallbackNodes);
        }
    };

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

    const elevatedPairRef = useRef<{ edgeId: string | null; aId: string | null; bId: string | null }>({ edgeId: null, aId: null, bId: null });

    function getNodeWidth(id: string): number {
        const n = nodesRef.current.find(nn => nn.id === id);
        const measured = measuredSizeRef.current[id];
        return (n?.style?.width ?? measured?.width ?? 480);
    }

    function getNodeHeight(id: string): number {
        const n = nodesRef.current.find(nn => nn.id === id);
        const measured = measuredSizeRef.current[id];
        return (n?.style?.height ?? measured?.height ?? 280);
    }

    function computeRowPositions(list: Node[]): Map<string, { x: number; y: number }> {
        const pos = new Map<string, { x: number; y: number }>();
        const spacing = 20;
        let currentX = 40;
        const y = 60;
        for (const n of list) {
            pos.set(n.id, { x: currentX, y });
            const width = getNodeWidth(n.id);
            currentX += width + spacing;
        }
        return pos;
    }

    function elevateEdgePair(edge: any) {
        try {
            const aId: string | undefined = edge?.source;
            const bId: string | undefined = edge?.target;
            if (!aId || !bId) return;
            const prevPair = elevatedPairRef.current;
            const samePair = (prevPair.aId && prevPair.bId) && ((prevPair.aId === aId && prevPair.bId === bId) || (prevPair.aId === bId && prevPair.bId === aId));
            if (edge?.id && prevPair.edgeId === edge.id) return; // exact same link
            if (!edge?.id && samePair) return; // same endpoints

            const sharedIds = new Set<string>();
            if (prevPair.aId && (prevPair.aId === aId || prevPair.aId === bId)) sharedIds.add(prevPair.aId);
            if (prevPair.bId && (prevPair.bId === aId || prevPair.bId === bId)) sharedIds.add(prevPair.bId);

            const spacing = 20;
            const yRow = 60;

            // Temporarily freeze interactions; prevents internal auto panning/viewport changes during updates
            try { rfInstanceRef.current?.setInteractive?.(false); } catch { }

            setFocusIds(null);
            setNodes(prev => {
                // First: restore everyone to row positions except shared elevated node (if any)
                const posMap = computeRowPositions(prev as any);
                let next = prev.map(n => (sharedIds.has(n.id) ? n : ({ ...n, position: posMap.get(n.id)! } as any)));

                // Then: elevate the new pair
                if (sharedIds.has(aId)) {
                    const shared = next.find(n => n.id === aId)!;
                    const sharedX = (shared as any).position.x;
                    const sharedY = (shared as any).position.y;
                    const aWidth = getNodeWidth(aId);
                    const bWidth = getNodeWidth(bId);
                    const bHeight = getNodeHeight(bId);
                    const bX = sharedX + aWidth + spacing;
                    const bY = sharedY; // keep same vertical as shared for minimal movement
                    next = next.map(n => (n.id === bId ? ({ ...n, position: { x: bX, y: bY } } as any) : n));
                } else if (sharedIds.has(bId)) {
                    const shared = next.find(n => n.id === bId)!;
                    const sharedX = (shared as any).position.x;
                    const sharedY = (shared as any).position.y;
                    const aWidth = getNodeWidth(aId);
                    const aHeight = getNodeHeight(aId);
                    const aX = sharedX - aWidth - spacing;
                    const aY = sharedY;
                    next = next.map(n => (n.id === aId ? ({ ...n, position: { x: aX, y: aY } } as any) : n));
                } else {
                    // No shared node: elevate both newly, top-aligned
                    const aWidth = getNodeWidth(aId);
                    const aHeight = getNodeHeight(aId);
                    const bHeight = getNodeHeight(bId);
                    const aX = 40;
                    const topY = yRow - Math.max(aHeight, bHeight) - spacing;
                    const bX = aX + aWidth + spacing;
                    next = next.map(n => {
                        if (n.id === aId) return { ...n, position: { x: aX, y: topY } } as any;
                        if (n.id === bId) return { ...n, position: { x: bX, y: topY } } as any;
                        return n;
                    });
                }

                elevatedPairRef.current = { edgeId: edge?.id ?? `${aId}->${bId}`, aId, bId };
                return next;
            });

            // Re-enable interactions right after updates
            setTimeout(() => { try { rfInstanceRef.current?.setInteractive?.(true); } catch { } }, 0);
        } catch { }
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if ((e.key === 'e' || e.key === 'E')) expandSelection(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [nodes]);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                try { rfInstanceRef.current?.setPaneDragging?.(true); } catch { }
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                try { rfInstanceRef.current?.setPaneDragging?.(false); } catch { }
            }
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, []);

    // render code previews lazily inside each node

    const VISIBLE_ZOOM_THRESHOLD = 0.65; // below this, render placeholder

    const codeRefs = useRef<Record<string, React.RefObject<import('./code/CodeCard').CodeCardHandle>>>({});
    const hoveredIdsRef = useRef<Set<string>>(new Set());
    const [hoveredIds, setHoveredIds] = useState<Set<string>>(new Set());
    const [hoverOverlay, setHoverOverlay] = useState<{ id: string; label: string; x: number; y: number } | null>(null);

    function setHovered(id: string | null, on: boolean) {
        const next = new Set(hoveredIdsRef.current);
        if (id) {
            if (on) next.add(id); else next.delete(id);
        }
        hoveredIdsRef.current = next; setHoveredIds(next);
    }

    function updateHoverOverlay(nd: any | null) {
        if (!nd) { setHoverOverlay(null); return; }
        try {
            const el = document.querySelector(`.react-flow__node[data-id="${nd.id}"]`) as HTMLElement | null;
            if (!el) { setHoverOverlay(null); return; }
            const r = el.getBoundingClientRect();
            const hx = Math.round(r.left + 8);
            const hy = Math.round(r.top + 8);
            const label = (nd?.data as any)?.label ?? nd?.id;
            setHoverOverlay({ id: nd.id, label, x: hx, y: hy });
        } catch { setHoverOverlay(null); }
    }

    function computePlaceholderFontPx(label: string, widthPx: number | undefined): number {
        const width = Math.max(120, (widthPx ?? 480) * 0.9);
        const chars = Math.max(1, (label || '').length);
        const px = Math.min(96, Math.max(18, Math.floor(width / (chars * 0.55))));
        return px;
    }

    const nodeTypesLocal = useMemo(() => ({
        file: (p: any) => {
            const n = p.data;
            const content = codeCacheRef.current[n.path] ?? n.path;
            const shouldShowCode = zoomOk;
            if (!codeRefs.current[p.id]) codeRefs.current[p.id] = React.createRef();
            const handleLines: number[] = (() => {
                const s = new Set<number>();
                for (const e of edges as any[]) {
                    if (e.source === p.id && e.data?.sourceLine != null) s.add(e.data.sourceLine);
                    if (e.target === p.id && e.data?.targetLine != null) s.add(e.data.targetLine);
                }
                return Array.from(s).sort((a, b) => a - b).slice(0, 200);
            })();
            const isHover = hoveredIds.has(p.id) || !!p.selected;
            const placeholderSize = computePlaceholderFontPx(n.label, p.width ?? (measuredSizeRef.current[p.id]?.width ?? (p?.style?.width ?? 480)));
            return (
                <div className="file-node" style={{ opacity: n.dim ? 0.25 : 1 }}>
                    <div className="file-node-header label-fixed" onDoubleClick={() => onOpenFile(p)}>{n.label}</div>
                    <div className="hover-label label-constant" style={isHover ? { opacity: 1 } : undefined}>{n.label}</div>
                    {shouldShowCode ? (
                        <CodeCard
                            ref={codeRefs.current[p.id]}
                            key={n.path}
                            file={n.path}
                            lang={n.lang}
                            content={content}
                            onTokenClick={onTokenClick}
                            wrap={wrap}
                            onLinePositions={(positions) => { linePosRef.current[p.id] = positions; }}
                            onMeasured={({ width, height }) => {
                                if (isFlingingRef.current || isDraggingViewRef.current) return;
                                const last = measuredSizeRef.current[p.id];
                                if (last && last.width === width && last.height === height) return;
                                measuredSizeRef.current[p.id] = { width, height };
                                enqueueSizeUpdate(p.id, { width, height });
                            }}
                        />
                    ) : (
                        <div className="node-placeholder-body">
                            <div className="node-placeholder-title" style={{ fontSize: placeholderSize }}>{n.label}</div>
                            <div style={{ opacity: 0.75 }}>Zoom in to view code</div>
                        </div>
                    )}
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
        },
        group: (p: any) => {
            // Reuse default GroupNode visual but rely on global overlay for z-top label
            return GroupNode(p);
        },
    }), [edges, zoomOk, wrap, hoveredIds]);

    return (
        <div className="root">
            <div className="toolbar">
                <button onClick={() => layout()}>Relayout</button>
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
                panOnDrag={[1, 2]} /* left or middle mouse */
                panOnScroll={true}
                selectionOnDrag
                onNodeMouseEnter={(_e, nd) => { setHovered(nd.id, true); updateHoverOverlay(nd); }}
                onNodeMouseMove={(_e, nd) => { if (hoveredIds.has(nd.id)) updateHoverOverlay(nd); }}
                onNodeMouseLeave={(_e, nd) => { setHovered(nd.id, false); updateHoverOverlay(null); }}
                onlyRenderVisibleElements
                onInit={(inst) => {
                    rfInstanceRef.current = inst;
                    try {
                        const vp = inst?.getViewport?.();
                        if (vp) {
                            setZoomOk(vp.zoom >= VISIBLE_ZOOM_THRESHOLD);
                            viewportRef.current = { x: vp.x, y: vp.y, zoom: vp.zoom };
                            prevVpRef.current = { x: vp.x, y: vp.y, zoom: vp.zoom };
                            try { document.documentElement.style.setProperty('--rf-zoom', String(vp.zoom)); } catch { }
                        }
                        const container = document.querySelector('.react-flow') as HTMLElement | null;
                        const onWheel = (e: WheelEvent) => {
                            try {
                                const now = performance.now();
                                lastInputRef.current = 'wheel';
                                lastZoomTimeRef.current = now;
                                zoomActiveRef.current = true;

                                // NEW: this gesture has zoom; block fling until cooldown passes
                                gestureZoomedRef.current = true;
                                wheelCooldownUntilRef.current = now + WHEEL_COOLDOWN_MS;

                                const vpEl = document.querySelector('.react-flow__viewport');
                                if (!vpEl) return;
                                vpEl.classList.add('zoom-smooth');

                                // Zoom invalidates drag samples
                                moveSamplesRef.current = [];

                                if (zoomSmoothTimerRef.current) window.clearTimeout(zoomSmoothTimerRef.current);
                                zoomSmoothTimerRef.current = window.setTimeout(() => {
                                    vpEl.classList.remove('zoom-smooth');
                                    // let onMoveEnd clear zoomActive; we still have cooldown guard
                                }, 420);
                            } catch { }
                        };
                        container?.addEventListener('wheel', onWheel, { passive: true } as any);
                        (window as any).__rf_wheel_cleanup = () => container?.removeEventListener('wheel', onWheel as any);
                    } catch { }
                }}
                onNodeClick={(_e, node: any) => { setFocusIds(null); }}
                onNodeDragStart={(_evt, node) => {
                    try {
                        const el = document.querySelector(`.react-flow__node[data-id="${node.id}"]`);
                        el?.classList.add('no-animate');
                        const vpEl = document.querySelector('.react-flow__viewport');
                        vpEl?.classList.remove('zoom-smooth');
                        isDraggingViewRef.current = true;
                        lastInputRef.current = 'drag';
                        cancelFling();
                        moveSamplesRef.current = [];
                    } catch { }
                }}
                onNodeDragStop={(_evt, node) => {
                    try {
                        const el = document.querySelector(`.react-flow__node[data-id="${node.id}"]`);
                        el?.classList.remove('no-animate');
                        isDraggingViewRef.current = false;
                    } catch { }
                }}
                onMoveStart={() => {
                    // CHANGED: treat this as a new potential pan gesture; we'll detect zoom in onMove
                    cancelFling();
                    moveSamplesRef.current = [];
                    gestureZoomedRef.current = false; // NEW
                    gesturePannedRef.current = false; // NEW
                    zoomActiveRef.current = false;    // NEW
                    lastInputRef.current = 'drag';    // we assume pan until onMove proves zoom
                    isDraggingViewRef.current = true;

                    try {
                        const el = document.querySelector('.react-flow__viewport');
                        el?.classList.remove('zoom-smooth');
                    } catch { }
                }}
                onMove={(_evt, vp) => {
                    try {
                        if (!vp) return;
                        if (isFlingingRef.current) { viewportRef.current = { x: vp.x, y: vp.y, zoom: vp.zoom }; return; }

                        pendingVpRef.current = vp;
                        if (moveFrameRef.current != null) return;
                        moveFrameRef.current = window.requestAnimationFrame(() => {
                            moveFrameRef.current = null;
                            const latest = pendingVpRef.current; pendingVpRef.current = null;
                            if (!latest) return;

                            const now = performance.now();

                            // Keep zoom visibility threshold working
                            const nextZoomOk = latest.zoom >= VISIBLE_ZOOM_THRESHOLD;
                            if (nextZoomOk !== zoomOk) setZoomOk(nextZoomOk);
                            try { document.documentElement.style.setProperty('--rf-zoom', String(latest.zoom)); } catch { }

                            // Compute deltas vs previous viewport (or last stored)
                            const prev = prevVpRef.current ?? viewportRef.current;
                            const dz = latest.zoom - prev.zoom;
                            const dx = latest.x - prev.x;
                            const dy = latest.y - prev.y;

                            viewportRef.current = { x: latest.x, y: latest.y, zoom: latest.zoom };
                            prevVpRef.current = { x: latest.x, y: latest.y, zoom: latest.zoom }; // NEW

                            // NEW: if zoom changed at all in this gesture, mark as zoom and do not record pan samples
                            if (Math.abs(dz) > ZOOM_EPS) {
                                gestureZoomedRef.current = true;
                                zoomActiveRef.current = true;
                                lastInputRef.current = 'wheel';   // this wasn't a pure drag
                                lastZoomTimeRef.current = now;
                                moveSamplesRef.current = [];      // discard any pan samples
                                return;
                            }

                            // Otherwise, it's a pan delta
                            if (lastInputRef.current === 'drag') {
                                gesturePannedRef.current = true;
                                // Record movement sample for fling calculation
                                moveSamplesRef.current.push({ t: now, x: latest.x, y: latest.y });

                                // Keep only last ~120ms of drag samples
                                const cutoff = now - 120;
                                if (moveSamplesRef.current.length > 1) {
                                    let i = 0; while (i < moveSamplesRef.current.length && moveSamplesRef.current[i].t < cutoff) i++;
                                    if (i > 0) moveSamplesRef.current.splice(0, i);
                                }
                            }
                        });
                    } catch { }
                }}
                onMoveEnd={() => {
                    try {
                        isDraggingViewRef.current = false;
                        const now = performance.now();

                        // NEW: hard gates — if any zoom happened during this gesture or we're within wheel cooldown, do not fling
                        const inWheelCooldown = now < wheelCooldownUntilRef.current || (now - lastZoomTimeRef.current) < WHEEL_COOLDOWN_MS;
                        if (gestureZoomedRef.current || inWheelCooldown) {
                            cancelFling();
                            // reset gesture flags
                            gestureZoomedRef.current = false;
                            gesturePannedRef.current = false;
                            zoomActiveRef.current = false;
                            moveSamplesRef.current = [];
                            return;
                        }

                        // Only fling after a genuine drag gesture with samples
                        if (lastInputRef.current !== 'drag' || !gesturePannedRef.current) {
                            cancelFling();
                            gestureZoomedRef.current = false;
                            gesturePannedRef.current = false;
                            moveSamplesRef.current = [];
                            return;
                        }

                        const samples = moveSamplesRef.current;
                        if (!samples || samples.length < 2) {
                            cancelFling();
                            gestureZoomedRef.current = false;
                            gesturePannedRef.current = false;
                            return;
                        }

                        const first = samples[0];
                        const lastS = samples[samples.length - 1];
                        const dtMs = Math.max(1, lastS.t - first.t);

                        // Optional extra safety: require minimal drag duration & distance
                        const minDurationMs = 90; // require longer hold/move to allow fling
                        const minDistancePx = 40; // require meaningful travel
                        if (dtMs < minDurationMs || (Math.hypot(lastS.x - first.x, lastS.y - first.y) < minDistancePx)) {
                            cancelFling(); gestureZoomedRef.current = false; gesturePannedRef.current = false; return;
                        }

                        const vx = (lastS.x - first.x) / dtMs * 1000; // px/s
                        const vy = (lastS.y - first.y) / dtMs * 1000; // px/s
                        const speed = Math.hypot(vx, vy);
                        const startThreshold = 700; // increase fling threshold to avoid accidental flings

                        if (speed >= startThreshold) {
                            startFling(vx, vy);
                        } else {
                            cancelFling();
                        }

                        // reset gesture flags after deciding
                        gestureZoomedRef.current = false;
                        gesturePannedRef.current = false;
                    } catch { }
                }}
                onEdgeClick={(_e, edge: any) => {
                    const sl = (edge?.data?.sourceLine ?? 0);
                    const tl = (edge?.data?.targetLine ?? 0);
                    if (edge?.source) {
                        try {
                            const ref = codeRefs.current[edge.source];
                            ref?.current?.highlight(sl);
                            ref?.current?.scrollTo(sl);
                        } catch { }
                    }
                    if (edge?.target) {
                        try {
                            const ref = codeRefs.current[edge.target];
                            ref?.current?.highlight(tl);
                            ref?.current?.scrollTo(tl);
                        } catch { }
                    }
                    elevateEdgePair(edge);
                }}
                onSelectionChange={(p: any) => setSelectedIds((p?.nodes || []).map((n: any) => n.id))}
                onNodesChange={(changes) => setNodes((nds: any) => applyNodeChanges(changes as any, nds as any) as any)}
                minZoom={0.02}
                maxZoom={8}
            >
                <Background />
                <MiniMap pannable zoomable nodeStrokeColor={(n: any): string => (n.type === 'group' ? 'transparent' : '#4f46e5')} nodeColor={(n: any): string => (n.type === 'group' ? 'transparent' : '#4f46e5')} />
                <Controls />
            </ReactFlow>
            {/* Global hover overlay rendered above canvas to avoid clipping */}
            {hoverOverlay && (
                <div style={{ position: 'fixed', left: hoverOverlay.x, top: hoverOverlay.y, pointerEvents: 'none', zIndex: 9999 }} className="label-constant">
                    {hoverOverlay.label}
                </div>
            )}
            {progress && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', fontSize: 14, opacity: .8 }}>⚙ {progress}</div>}
            {emptyMsg && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 14, opacity: .8 }}>{emptyMsg}</div>}
        </div>
    );
}