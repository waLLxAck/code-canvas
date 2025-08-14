import hljs from 'highlight.js/lib/core';
import ts from 'highlight.js/lib/languages/typescript';
import js from 'highlight.js/lib/languages/javascript';
import py from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('typescript', ts);
hljs.registerLanguage('javascript', js);
// Increase the maximum length before Highlight.js bails out to plaintext so large Python files still get properly highlighted.
hljs.configure({ maxHighlightLength: 500_000 } as any);
hljs.registerLanguage('python', py);
hljs.registerLanguage('plaintext', plaintext);

// A mapping object is slightly cleaner than a long ternary chain.
const languageMap = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    other: 'plaintext'
};

export function highlight(code: string, lang: 'ts' | 'js' | 'py' | 'other') {
    const mapped = languageMap[lang] || 'plaintext';

    // 1. First, check if the language is explicitly supported.
    if (hljs.getLanguage(mapped)) {
        try {
            // 2. Attempt to highlight with the specified language.
            return hljs.highlight(code, { language: mapped, ignoreIllegals: true }).value;
        } catch (e) {
            // This catch block will run if highlighting fails catastrophically.
            console.error(`Highlighting failed for language "${mapped}"`, e);
        }
    }

    // 3. If specific highlighting fails, fallback to auto-detection.
    // This is safer than the original implementation's catch-all.
    try {
        return hljs.highlightAuto(code).value;
    } catch (e) {
        console.error('Auto-highlighting failed', e);
        // 4. As a last resort, return the code escaped to prevent breaking HTML.
        return code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}