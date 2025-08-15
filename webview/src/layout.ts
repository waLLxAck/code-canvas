import ELK from 'elkjs/lib/elk.bundled.js';
import { Node, Edge } from 'reactflow';

const elk = new ELK();

const elkOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodeRanking.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.spacing.nodeNode': '160',
    'elk.layered.spacing.nodeNodeBetweenLayers': '160',
    'elk.layered.spacing.edgeNodeBetweenLayers': '80',
    'elk.spacing.edgeNode': '50',
    'elk.spacing.edgeEdge': '30',
    'elk.spacing.componentComponent': '240',
    'elk.layered.wrapping.correctionFactor': '1.2'
};

interface ElkNode {
    id: string;
    width: number;
    height: number;
    children?: ElkNode[];
    layoutOptions?: Record<string, string>;
    x?: number;
    y?: number;
    ports?: Array<{ id: string; layoutOptions?: Record<string, string> }>;
}

export const getLayoutedElements = (nodes: Node[], edges: Edge[]): Promise<Node[]> => {
    const elkNodeMap = new Map<string, ElkNode>();
    const elkNodes: ElkNode[] = [];
    const parentOf = new Map<string, string | null>();
    const sizeOf = new Map<string, { width: number; height: number }>();
    const childrenByParent = new Map<string, string[]>();
    const typeById = new Map<string, string>();

    // Create ELK nodes
    nodes.forEach(node => {
        const width = (node as any).width ?? 480;
        const height = (node as any).height ?? 280;
        const isGroup = node.type === 'group';
        const elkNode: ElkNode = {
            id: node.id,
            width,
            height,
            children: [],
            layoutOptions: isGroup ? { 'elk.padding': '[top=50,left=20,bottom=20,right=20]', 'elk.portConstraints': 'FIXED_SIDE' } : { 'elk.portConstraints': 'FIXED_SIDE' },
            ports: [
                { id: `${node.id}:in`, layoutOptions: { 'elk.port.side': 'WEST' } },
                { id: `${node.id}:out`, layoutOptions: { 'elk.port.side': 'EAST' } },
            ],
        };
        elkNodeMap.set(node.id, elkNode);
        sizeOf.set(node.id, { width, height });
        typeById.set(node.id, (node as any).type || 'file');
    });

    // Build hierarchy
    nodes.forEach(node => {
        const elkNode = elkNodeMap.get(node.id)!;
        if ((node as any).parentNode) {
            const parentId = (node as any).parentNode as string;
            const parent = elkNodeMap.get(parentId);
            if (parent) {
                if (!parent.children) parent.children = [];
                parent.children.push(elkNode);
                parentOf.set(node.id, parent.id);
                if (!childrenByParent.has(parent.id)) childrenByParent.set(parent.id, []);
                childrenByParent.get(parent.id)!.push(node.id);
            }
        } else {
            elkNodes.push(elkNode);
            parentOf.set(node.id, null);
        }
    });

    const graph = {
        id: 'root',
        layoutOptions: elkOptions,
        children: elkNodes,
        edges: edges.map(e => ({
            id: e.id,
            sources: [`${e.source}:out`],
            targets: [`${e.target}:in`]
        }))
    };

    return elk.layout(graph).then(async layoutedGraph => {
        const absPositions = new Map<string, { x: number, y: number }>();
        const relPositions = new Map<string, { x: number, y: number }>();

        function traverse(node: ElkNode, accAbs = { x: 0, y: 0 }) {
            const rel = { x: (node.x ?? 0), y: (node.y ?? 0) };
            const abs = { x: rel.x + accAbs.x, y: rel.y + accAbs.y };
            relPositions.set(node.id, rel);
            absPositions.set(node.id, abs);
            if (node.children) {
                node.children.forEach((child: ElkNode) => traverse(child, abs));
            }
        }

        if ((layoutedGraph as any).children) {
            (layoutedGraph as any).children.forEach((node: ElkNode) => traverse(node));
        }

        // Autosize groups to wrap their children (bottom-up so ancestors expand too)
        const groupSizes = new Map<string, { width: number; height: number }>();
        const PADDING = { top: 50, left: 20, right: 20, bottom: 20 };
        // one pass to compute direct children bounds
        childrenByParent.forEach((childIds, parentId) => {
            if (!childIds.length) return;
            let maxX = 0, maxY = 0;
            for (const cid of childIds) {
                const pos = relPositions.get(cid) || { x: 0, y: 0 };
                const childSize = groupSizes.get(cid) || sizeOf.get(cid) || { width: 480, height: 280 };
                maxX = Math.max(maxX, pos.x + childSize.width);
                maxY = Math.max(maxY, pos.y + childSize.height);
            }
            const width = Math.max(220, Math.ceil(maxX + PADDING.right));
            const height = Math.max(160, Math.ceil(maxY + PADDING.bottom));
            groupSizes.set(parentId, { width, height });
        });
        // propagate upward for 2 passes to cover grandparents etc.
        for (let pass = 0; pass < 2; pass++) {
            childrenByParent.forEach((childIds, parentId) => {
                if (!childIds.length) return;
                let maxX = 0, maxY = 0;
                for (const cid of childIds) {
                    const pos = relPositions.get(cid) || { x: 0, y: 0 };
                    const childSize = groupSizes.get(cid) || sizeOf.get(cid) || { width: 480, height: 280 };
                    maxX = Math.max(maxX, pos.x + childSize.width);
                    maxY = Math.max(maxY, pos.y + childSize.height);
                }
                const width = Math.max(220, Math.ceil(maxX + PADDING.right));
                const height = Math.max(160, Math.ceil(maxY + PADDING.bottom));
                groupSizes.set(parentId, { width, height });
            });
        }

        // Second pass: reposition the direct children of the top-level root group using
        // aggregated cross-child edges to reduce inter-group crossings and spread layout.
        const rootCandidates = Array.from(typeById.entries())
            .filter(([id, t]) => t === 'group' && parentOf.get(id) === null)
            .map(([id]) => id);
        const rootIds = rootCandidates.length ? rootCandidates : Array.from(parentOf.entries()).filter(([, p]) => p === null).map(([id]) => id);

        const topLevelPositions = new Map<string, { x: number; y: number }>();
        const rootsToProcess = rootIds.length ? rootIds : [];

        for (const rootId of rootsToProcess) {
            const rootChildren = new Set<string>(childrenByParent.get(rootId) || []);
            if (rootChildren.size === 0) continue;

            // Build container nodes with sizes from computed group/file sizes
            const containerNodes: ElkNode[] = [];
            for (const cid of rootChildren) {
                const isGroup = typeById.get(cid) === 'group';
                const size = isGroup ? (groupSizes.get(cid) || sizeOf.get(cid) || { width: 300, height: 200 }) : (sizeOf.get(cid) || { width: 480, height: 280 });
                containerNodes.push({
                    id: cid,
                    width: size.width,
                    height: size.height,
                    layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
                    ports: [
                        { id: `${cid}:in`, layoutOptions: { 'elk.port.side': 'WEST' } },
                        { id: `${cid}:out`, layoutOptions: { 'elk.port.side': 'EAST' } },
                    ],
                });
            }

            // Helper to ascend node to the direct child under given root
            const toRootChild = (id: string): string | null => {
                let cur: string | null = id;
                while (cur != null) {
                    const parentCandidate: string | null = (parentOf.get(cur) as string | null) ?? null;
                    if (parentCandidate === rootId) return cur;
                    cur = parentCandidate;
                }
                return null;
            };

            // Aggregate edges between root children
            const agg = new Map<string, number>();
            for (const e of edges) {
                const a = toRootChild(e.source);
                const b = toRootChild(e.target);
                if (!a || !b || a === b) continue;
                const key = `${a}->${b}`;
                agg.set(key, (agg.get(key) || 0) + 1);
            }

            const containerEdges = Array.from(agg.entries()).map(([key, w], i) => {
                const [a, b] = key.split('->');
                return {
                    id: `agg_${i}_${a}_${b}`,
                    sources: [`${a}:out`],
                    targets: [`${b}:in`],
                    // weight hint helps ranking in some cases
                    layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE', 'elk.priority.direction': '1' }
                } as any;
            });

            const stageGraph = {
                id: `root_stage_${rootId}`,
                layoutOptions: {
                    ...elkOptions,
                    'elk.spacing.nodeNode': '220',
                    'elk.layered.spacing.nodeNodeBetweenLayers': '220',
                    'elk.layered.spacing.edgeNodeBetweenLayers': '120',
                },
                children: containerNodes,
                edges: containerEdges,
            };

            const laid = await elk.layout(stageGraph as any);
            // Collect positions for these direct children
            const posMap = new Map<string, { x: number; y: number }>();
            const stack: any[] = (laid as any).children || [];
            for (const n of stack) posMap.set(n.id, { x: n.x || 0, y: n.y || 0 });
            posMap.forEach((v, k) => topLevelPositions.set(k, v));
        }

        return nodes.map(node => {
            const id = node.id;
            const isChild = !!(node as any).parentNode;
            // If this node is a direct child of any root group, place it using second pass
            const parent = parentOf.get(id);
            const isDirectChildOfAnyRoot = parent != null && (parentOf.get(parent) === null);

            const position = (() => {
                if (!isChild) {
                    // Top-level items (like workspace root) keep absolute pos from pass 1
                    return absPositions.get(id) || { x: 0, y: 0 };
                }
                if (isDirectChildOfAnyRoot) {
                    const p = topLevelPositions.get(id);
                    if (p) return p;
                }
                return relPositions.get(id) || { x: 0, y: 0 };
            })();

            if (node.type === 'group') {
                const g = groupSizes.get(id);
                if (g) {
                    return { ...node, position, style: { ...(node as any).style, width: g.width, height: g.height } } as any;
                }
            }
            return { ...node, position } as any;
        });
    });
};