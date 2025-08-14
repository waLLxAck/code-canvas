import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '',
    build: {
        outDir: path.resolve(__dirname, '../extension/media'), // note ../
        emptyOutDir: true,
        sourcemap: 'inline',          // ← embed maps + sourcesContent
        minify: false,                // ← readable stack frames
        rollupOptions: {
            input: path.resolve(__dirname, 'index.html'),
            output: { sourcemapExcludeSources: false }
        },
        target: 'chrome120'
    }
});
