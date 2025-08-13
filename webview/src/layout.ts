import dagre from 'dagre';
import ELK from 'elkjs/lib/elk.bundled.js';

export function dagreLayout(nodes: any[], edges: any[], direction: 'LR' | 'TB' = 'LR') {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction });
    g.setDefaultEdgeLabel(() => ({}));
    nodes.forEach(n => g.setNode(n.id, { width: n.style?.width || 300, height: n.style?.height || 120 }));
    edges.forEach(e => g.setEdge(e.source, e.target));
    dagre.layout(g);
    return nodes.map(n => { const p = g.node(n.id); return { ...n, position: { x: p.x, y: p.y } }; });
}

const elk = new ELK();
export async function elkLayout(nodes: any[], edges: any[]) {
    const graph = {
        id: 'root',
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        children: nodes.map(n => ({ id: n.id, width: n.style?.width || 300, height: n.style?.height || 120 })),
        edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] }))
    } as any;
    const res = await elk.layout(graph);
    const pos: Record<string, { x: number; y: number }> = {};
    res.children?.forEach((c: any) => { pos[c.id] = { x: c.x, y: c.y }; });
    return nodes.map(n => ({ ...n, position: pos[n.id] || n.position }));
}