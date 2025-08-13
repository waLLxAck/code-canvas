import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '',
    build: {
        outDir: path.resolve(__dirname, '../extension/media'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'index.html')
        }
    }
});