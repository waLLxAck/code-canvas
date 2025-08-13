import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { highlight } from './highlight';

export default function CodeCard({ file, lang, content, onTokenClick, onMeasured, wrap }: {
    file: string; lang: 'ts' | 'js' | 'py' | 'other'; content: string; onTokenClick: (payload: { path: string; line: number; character: number; token: string }) => void; onMeasured?: (size: { width: number; height: number }) => void; wrap?: boolean;
}) {
    const html = useMemo(() => highlight(content, lang), [content, lang]);
    const preRef = useRef<HTMLPreElement | null>(null);

    useLayoutEffect(() => {
        const el = preRef.current;
        if (!el) return;
        const notify = () => onMeasured?.({ width: el.scrollWidth, height: el.scrollHeight });
        notify();
        // observe size changes if content renders async (syntax highlight)
        const ro = new ResizeObserver(() => notify());
        ro.observe(el);
        return () => ro.disconnect();
    }, [html, onMeasured]);

    const onClick: React.MouseEventHandler<HTMLPreElement> = (e) => {
        // lightweight token guess: find word under click using selection API
        const sel = window.getSelection();
        if (!sel || sel.toString().length === 0) return;
        const token = sel.toString();
        // estimate position: count lines and chars up to anchorNode
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
        <div className="code-card">
            <div className="file-title">{file}</div>
            <pre ref={preRef} id={`code-${file}`} className={`hljs${wrap ? ' wrap' : ''}`} onMouseUp={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}