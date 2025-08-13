import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { highlight } from './highlight';

export default function CodeCard({ file, lang, content, onTokenClick, onMeasured, wrap, onLinePositions, highlightLine, scrollToLine }: {
    file: string; lang: 'ts' | 'js' | 'py' | 'other'; content: string; onTokenClick: (payload: { path: string; line: number; character: number; token: string }) => void; onMeasured?: (size: { width: number; height: number }) => void; wrap?: boolean;
    onLinePositions?: (positions: { line: number; top: number }[]) => void; highlightLine?: number; scrollToLine?: number;
}) {
    const rawHtml = useMemo(() => highlight(content, lang), [content, lang]);
    const html = useMemo(() => {
        const parts = rawHtml.split('\n');
        return parts.map((line, i) => `<span class="code-line" data-line="${i}">${line === '' ? '&nbsp;' : line}</span>`).join('\n');
    }, [rawHtml]);
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
        return () => ro.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html, onMeasured]);

    function computeLinePositions() {
        try {
            const pre = preRef.current;
            const root = containerRef.current?.closest('.file-node') as HTMLElement | null;
            if (!pre || !root) return;
            const rootTop = root.getBoundingClientRect().top;
            const spans = Array.from(pre.querySelectorAll('span.code-line')) as HTMLElement[];
            const positions = spans.map((sp, idx) => {
                const r = sp.getBoundingClientRect();
                const top = r.top - rootTop + r.height / 2;
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

    const onClick: React.MouseEventHandler<HTMLPreElement> = (e) => {
        const sel = window.getSelection();
        if (!sel || sel.toString().length === 0) return;
        const token = sel.toString();
        const range = sel.getRangeAt(0);
        const pre = range.startContainer.ownerDocument?.getElementById(`code-${file}`);
        if (!pre) return;
        const text = pre.textContent || '';
        const before = text.slice(0, text.indexOf(token));
        const line = before.split('\n').length - 1;
        const character = before.split('\n').pop()!.length;
        onTokenClick({ path: file, line, character, token });
    };

    return (
        <div className="code-card" ref={containerRef}>
            <div className="file-title">{file}</div>
            <pre ref={preRef} id={`code-${file}`} className={`hljs${wrap ? ' wrap' : ''}`} onMouseUp={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}