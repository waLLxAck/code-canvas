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

        // Autosize groups to wrap their children based on initial relative positions
        const groupSizes = new Map<string, { width: number; height: number }>();
        const PADDING = { top: 50, left: 20, right: 20, bottom: 20 };
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

        // Second pass: for every group, compute a layout of its direct children using
        // aggregated edges (between descendants under different children). This spreads
        // groups/files and reduces crossings at each hierarchy level.
        const positionOverride = new Map<string, { x: number; y: number }>();
        const groupsToProcess = Array.from(typeById.entries()).filter(([, t]) => t === 'group').map(([id]) => id);

        const toDirectChildUnder = (groupId: string, id: string): string | null => {
            let cur: string | null = id;
            while (cur != null) {
                const parentCandidate: string | null = (parentOf.get(cur) as string | null) ?? null;
                if (parentCandidate === groupId) return cur;
                cur = parentCandidate;
            }
            return null;
        };

        for (const gid of groupsToProcess) {
            const directChildren = new Set<string>(childrenByParent.get(gid) || []);
            if (directChildren.size === 0) continue;

            const containerNodes: ElkNode[] = [];
            for (const cid of directChildren) {
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

            const agg = new Map<string, number>();
            for (const e of edges) {
                const a = toDirectChildUnder(gid, e.source);
                const b = toDirectChildUnder(gid, e.target);
                if (!a || !b || a === b) continue;
                const key = `${a}->${b}`;
                agg.set(key, (agg.get(key) || 0) + 1);
            }

            const containerEdges = Array.from(agg.entries()).map(([key], i) => {
                const [a, b] = key.split('->');
                return {
                    id: `agg_${gid}_${i}_${a}_${b}`,
                    sources: [`${a}:out`],
                    targets: [`${b}:in`],
                    layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }
                } as any;
            });

            const stageGraph = {
                id: `stage_${gid}`,
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
            const laidChildren: any[] = (laid as any).children || [];
            for (const n of laidChildren) {
                positionOverride.set(n.id, { x: n.x || 0, y: n.y || 0 });
            }
        }

        // Recompute group sizes using override positions where available
        const updatedGroupSizes = new Map<string, { width: number; height: number }>();
        childrenByParent.forEach((childIds, parentId) => {
            if (!childIds.length) return;
            let maxX = 0, maxY = 0;
            for (const cid of childIds) {
                const pos = positionOverride.get(cid) || relPositions.get(cid) || { x: 0, y: 0 };
                const childSize = updatedGroupSizes.get(cid) || groupSizes.get(cid) || sizeOf.get(cid) || { width: 480, height: 280 };
                maxX = Math.max(maxX, pos.x + childSize.width);
                maxY = Math.max(maxY, pos.y + childSize.height);
            }
            const width = Math.max(220, Math.ceil(maxX + PADDING.right));
            const height = Math.max(160, Math.ceil(maxY + PADDING.bottom));
            updatedGroupSizes.set(parentId, { width, height });
        });

        // Return final positions: prefer override for direct children of a group; otherwise
        // keep original relative/absolute positions from pass 1.
        return nodes.map(node => {
            const id = node.id;
            const isChild = !!(node as any).parentNode;
            const parent = parentOf.get(id);

            const position = (() => {
                if (isChild) {
                    const o = positionOverride.get(id);
                    if (o) return o;
                    return relPositions.get(id) || { x: 0, y: 0 };
                }
                return absPositions.get(id) || { x: 0, y: 0 };
            })();

            if (node.type === 'group') {
                const g = updatedGroupSizes.get(id) || groupSizes.get(id);
                if (g) {
                    return { ...node, position, style: { ...(node as any).style, width: g.width, height: g.height } } as any;
                }
            }
            return { ...node, position } as any;
        });
    });
};