import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { highlight } from './highlight';

function wrapHighlightedHtmlPreserveLines(highlightedHtml: string): string {
    const container = document.createElement('div');
    container.innerHTML = highlightedHtml;

    const lines: string[] = [];
    let current = '';
    const stack: Element[] = [];

    const escapeHtml = (s: string) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const escapeAttr = (s: string) => s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');

    const startTag = (el: Element) => {
        const tag = el.tagName.toLowerCase();
        let attrs = '';
        for (const attr of Array.from(el.attributes)) {
            attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
        }
        return `<${tag}${attrs}>`;
    };
    const endTag = (el: Element) => `</${el.tagName.toLowerCase()}>`;
    const openAll = () => stack.map(startTag).join('');
    const closeAll = () => stack.slice().reverse().map(endTag).join('');

    const flushLine = () => { lines.push(current); current = ''; };

    const handleText = (text: string) => {
        const parts = text.split(/\r\n|\n/);
        for (let i = 0; i < parts.length; i++) {
            current += escapeHtml(parts[i]);
            if (i < parts.length - 1) {
                current += closeAll();
                flushLine();
                current += openAll();
            }
        }
    };

    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            handleText((node as Text).data);
            return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            current += startTag(el);
            stack.push(el);
            for (const child of Array.from(el.childNodes)) walk(child);
            stack.pop();
            current += endTag(el);
            return;
        }
        // Ignore other node types
    };

    for (const child of Array.from(container.childNodes)) walk(child);
    // Ensure at least one line
    if (current !== '' || lines.length === 0) flushLine();

    return lines
        .map((line, i) => `<span class="code-line" data-line="${i}">${line === '' ? '&nbsp;' : line}</span>`)
        .join('');
}

export default function CodeCard({ file, lang, content, onTokenClick, onMeasured, wrap, onLinePositions, highlightLine, scrollToLine }: {
    file: string; lang: 'ts' | 'js' | 'py' | 'other'; content: string; onTokenClick: (payload: { path: string; line: number; character: number; token: string }) => void; onMeasured?: (size: { width: number; height: number }) => void; wrap?: boolean;
    onLinePositions?: (positions: { line: number; top: number }[]) => void; highlightLine?: number; scrollToLine?: number;
}) {
    const effectiveLang = useMemo<'ts' | 'js' | 'py' | 'other'>(() => {
        if (lang && lang !== 'other') return lang;
        const lower = (file || '').toLowerCase();
        if (lower.endsWith('.py')) return 'py';
        if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'ts';
        if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
        return 'other';
    }, [file, lang]);

    const rawHtml = useMemo(() => highlight(content, effectiveLang), [content, effectiveLang]);
    const html = useMemo(() => wrapHighlightedHtmlPreserveLines(rawHtml), [rawHtml]);
    const preRef = useRef<HTMLPreElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        const el = preRef.current;
        if (!el) return;
        const notify = () => onMeasured?.({ width: el.scrollWidth, height: el.scrollHeight });
        notify();
        const ro = new ResizeObserver(() => {
            notify();
            computeLinePositions();
        });
        ro.observe(el);
        const cont = containerRef.current;
        const onScroll = () => computeLinePositions();
        cont?.addEventListener('scroll', onScroll, { passive: true } as any);
        return () => { ro.disconnect(); cont?.removeEventListener('scroll', onScroll as any); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html, onMeasured]);

    function computeLinePositions() {
        try {
            const pre = preRef.current;
            const container = containerRef.current;
            const root = container?.closest('.file-node') as HTMLElement | null;
            if (!pre || !container || !root) return;
            const rootRect = root.getBoundingClientRect();
            const spans = Array.from(pre.querySelectorAll('span.code-line')) as HTMLElement[];
            const positions = spans.map((sp, idx) => {
                const spRect = sp.getBoundingClientRect();
                const top = (spRect.top - rootRect.top) + spRect.height / 2;
                return { line: idx, top };
            });
            onLinePositions?.(positions);
        } catch { }
    }

    useLayoutEffect(() => { computeLinePositions(); }, [html]);

    useLayoutEffect(() => {
        if (highlightLine == null) return;
        const pre = preRef.current;
        const container = containerRef.current;
        if (!pre || !container) return;
        const all = pre.querySelectorAll('.code-line.highlight');
        all.forEach(n => n.classList.remove('highlight'));
        const target = pre.querySelector(`.code-line[data-line="${highlightLine}"]`) as HTMLElement | null;
        if (target) {
            target.classList.add('highlight');
        }
    }, [highlightLine]);

    useLayoutEffect(() => {
        if (scrollToLine == null) return;
        const pre = preRef.current;
        const container = containerRef.current;
        if (!pre || !container) return;
        const target = pre.querySelector(`.code-line[data-line="${scrollToLine}"]`) as HTMLElement | null;
        if (target) {
            target.scrollIntoView({ block: 'center' });
        }
    }, [scrollToLine]);

    const onClick: React.MouseEventHandler<HTMLPreElement> = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.toString().length === 0) return;
        const token = sel.toString();
        const range = sel.getRangeAt(0);
        const startNode = range.startContainer;
        const startEl: Element | null = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : (startNode.parentElement);
        if (!startEl) return;
        const lineEl = startEl.closest('.code-line') as HTMLElement | null;
        if (!lineEl) return;
        const lineAttr = lineEl.getAttribute('data-line');
        const line = lineAttr ? parseInt(lineAttr, 10) : 0;
        const headRange = document.createRange();
        headRange.selectNodeContents(lineEl);
        headRange.setEnd(range.startContainer, range.startOffset);
        const character = headRange.toString().length;
        onTokenClick({ path: file, line, character, token });
    };

    return (
        <div className="code-card" ref={containerRef}>
            <div className="file-title">{file}</div>
            <pre ref={preRef} id={`code-${file}`} className={`hljs${wrap ? ' wrap' : ''}`} onMouseUp={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}