import ELK from 'elkjs/lib/elk.bundled.js';
import { Node, Edge } from 'reactflow';

const elk = new ELK();

const elkOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
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
}

export const getLayoutedElements = (nodes: Node[], edges: Edge[]): Promise<Node[]> => {
    const elkNodeMap = new Map<string, ElkNode>();
    const elkNodes: ElkNode[] = [];
    const parentOf = new Map<string, string | null>();
    const sizeOf = new Map<string, { width: number; height: number }>();
    const childrenByParent = new Map<string, string[]>();

    // Create ELK nodes
    nodes.forEach(node => {
        const width = (node as any).width ?? 480;
        const height = (node as any).height ?? 280;
        const elkNode: ElkNode = {
            id: node.id,
            width,
            height,
            children: [],
            layoutOptions: node.type === 'group' ? { 'elk.padding': '[top=50,left=20,bottom=20,right=20]' } : {},
        };
        elkNodeMap.set(node.id, elkNode);
        sizeOf.set(node.id, { width, height });
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
            sources: [e.source],
            targets: [e.target]
        }))
    };

    return elk.layout(graph).then(layoutedGraph => {
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

        // Autosize groups to wrap their children
        const groupSizes = new Map<string, { width: number; height: number }>();
        const PADDING = { top: 50, left: 20, right: 20, bottom: 20 };
        childrenByParent.forEach((childIds, parentId) => {
            if (!childIds.length) return;
            let maxX = 0, maxY = 0;
            for (const cid of childIds) {
                const pos = relPositions.get(cid) || { x: 0, y: 0 };
                const sz = sizeOf.get(cid) || { width: 480, height: 280 };
                maxX = Math.max(maxX, pos.x + sz.width);
                maxY = Math.max(maxY, pos.y + sz.height);
            }
            const width = Math.max(220, Math.ceil(maxX + PADDING.right));
            const height = Math.max(160, Math.ceil(maxY + PADDING.bottom));
            groupSizes.set(parentId, { width, height });
        });

        return nodes.map(node => {
            const isChild = !!(node as any).parentNode;
            const id = node.id;
            const position = isChild ? relPositions.get(id) : absPositions.get(id);
            if (node.type === 'group') {
                const g = groupSizes.get(id);
                if (g) {
                    return { ...node, position: position || { x: 0, y: 0 }, style: { ...(node as any).style, width: g.width, height: g.height } } as any;
                }
            }
            return { ...node, position: position || { x: 0, y: 0 } } as any;
        });
    });
};