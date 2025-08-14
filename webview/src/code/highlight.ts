import hljs from 'highlight.js/lib/core';
import ts from 'highlight.js/lib/languages/typescript';
import js from 'highlight.js/lib/languages/javascript';
import py from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('typescript', ts);
hljs.registerLanguage('javascript', js);
hljs.registerLanguage('python', py);
hljs.registerLanguage('plaintext', plaintext);

export function highlight(code: string, lang: 'ts' | 'js' | 'py' | 'other') {
    const mapped = lang === 'ts' ? 'typescript' : lang === 'js' ? 'javascript' : lang === 'py' ? 'python' : 'plaintext';
    try {
        return hljs.highlight(code, { language: mapped, ignoreIllegals: true }).value;
    } catch {
        return hljs.highlightAuto(code).value;
    }
}