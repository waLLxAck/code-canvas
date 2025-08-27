# Code Canvas — Visual Code Graph for VS Code

## Overview
Code Canvas is a Visual Studio Code extension that turns your workspace into an interactive canvas of files and relationships. It scans your project for JavaScript/TypeScript and Python files, builds a file-level dependency graph (based on imports), and renders it in a webview using React Flow and ELK layout. Each file node shows an inline, syntax‑highlighted code preview and line‑anchored edges. Explore, focus, expand, and open files directly from the canvas.

- Visualize file relationships (imports) for JS/TS and Python
- Group files by folders; hierarchical groups auto-size to contain children
- Inline code previews with syntax highlighting and line anchors
- Expand from selected nodes; load more to increase graph size
- Open changed files from Git; live updates on file save and Git state changes
- Jump to definition and fetch references via VS Code LSP


## Requirements
- Node.js 18+ (Vite 7 requires Node 18 or newer)
- VS Code 1.90+ (as per extension engine)
- Git (optional but recommended; used to detect changed files)

This repo uses npm workspaces with two packages:
- `extension/` — the VS Code extension (TypeScript, bundled with tsup)
- `webview/` — the webview UI (React, Vite, React Flow, ELK)


## Install and Build (from source)
1) Install dependencies at the repository root (installs both workspaces):
```bash
npm install
```

2) Build the webview and the extension:
```bash
npm run build
```
This produces the webview build into `extension/media/` and the extension bundle into `extension/dist/`.

3) Launch the extension for development in VS Code:
- Open the repository in VS Code
- Press F5 (Run and Debug → “Extension”) to launch a new Extension Development Host
- In the dev host, run “Code Canvas: Open” to show the canvas panel

Notes for rapid iteration:
- The default root watch script starts Vite’s dev server for the webview, which doesn’t feed the extension’s `extension/media/` folder. For quickest feedback inside the extension, prefer a build‑watch for the webview:
  - Terminal A: `cd webview && npx vite build --watch`
  - Terminal B: `npm -w extension run watch`
  - Reload the Extension Development Host window to pick up changes if needed

Root scripts for convenience:
- `npm run build` — build `webview` then `extension`
- `npm run watch` — runs `webview dev` and `extension watch` in parallel (dev server for webview; see note above)
- `npm run package` — package the extension VSIX via `vsce`


## Packaging and Installation (VSIX)
Create a `.vsix` package:
```bash
npm run package
```
This generates a file like `extension/code-canvas-0.0.1.vsix`.

Install the VSIX locally:
```bash
code --install-extension extension/code-canvas-0.0.1.vsix
```
Or via VS Code: Extensions view → “…” menu → Install from VSIX…


## Using Code Canvas
Open the canvas:
- Command Palette → “Code Canvas: Open”

Toolbar (in the webview):
- Relayout — recompute layout (ELK; falls back to a simple row layout if ELK fails)
- Load 25 more — increase the node cap (+25)
- Open Changed (⇧O) — add files detected as changed in Git
- Reload — reload current graph from the index
- Expand (E) — grow the graph from the selected nodes
- Refs (R) — toggle reference lookups when selecting tokens in code
- Wrap/Unwrap — toggle code wrapping in previews
- Hide/Show Edges — toggle edge visibility
- Toggle Edges (Global) — request global edge visibility toggle from the extension
- Seed Folder… — choose a folder to use as the seed set
- Clear Focus — exit focus mode

Interaction tips:
- Click a file node’s header to open it in the editor
- Click an edge to highlight/scroll to the corresponding source/target lines
- Select text inside a CodeCard to request references and jump to definition
- Press E to expand from selection; Delete removes selected nodes/groups
- Hold Space to pan; zoom in to reveal inline code (below a zoom threshold nodes render placeholders)

Seeds and growth:
- Initial seeds are the active editor file plus up to 5 changed files
- Use “Load 25 more” to incrementally reveal more of the graph (default max 300)
- “Seed Folder…” lets you build a view scoped to a specific folder


## Commands and Keybindings
Contributed commands (Command Palette):
- Code Canvas: Open (`codeCanvas.open`)
- Code Canvas: Open Changed Files (`codeCanvas.openChanged`)
- Code Canvas: Layout – Custom (`codeCanvas.layout.custom`)
- Code Canvas: Layout – Dagre (`codeCanvas.layout.dagre`)
- Code Canvas: Layout – ELK (`codeCanvas.layout.elk`)
- Code Canvas: Layout – Force (`codeCanvas.layout.force`)
- Code Canvas: Toggle Refs (`codeCanvas.toggleRefs`)
- Code Canvas: Open Folder as Seed (`codeCanvas.seedFolder`)
- Code Canvas: Load 25 More (`codeCanvas.loadMore`)

Default keybindings:
- ⇧O — Open Changed Files
- ⇧+ — Load 25 More
- ⇧1 / ⇧2 / ⇧3 / ⇧4 — Layout: Custom / Dagre / ELK / Force
- R — Toggle Refs

Note: The current webview implementation lays out with ELK by default; layout selection commands are wired through but may not switch algorithms yet.


## Settings
User/workspace settings under `Code Canvas`:
- `codeCanvas.maxNodes` (number, default: 300) — Maximum nodes to render per subgraph
- `codeCanvas.excludeGlobs` (array<string>) — Extra glob patterns to exclude from indexing (defaults include `**/node_modules/**`, `**/dist/**`, etc.)
- `codeCanvas.maxPreviewBytes` (number, default: 100000) — Max bytes per file to send to the webview code preview
- `codeCanvas.initialCap` (number, default: 25) — Initial node cap when first rendering a graph


## How it works (Architecture)
- Indexing: The extension scans your workspace for JS/TS (`**/*.{js,jsx,ts,tsx}`) and Python (`**/*.py`) files using fast‑glob. It parses import statements and resolves relative dependencies (and Python modules within the workspace) to produce a file‑level graph.
- Subgraphs and seeds: A BFS builds a connected subgraph from seeds (active editor + changed files), limited by a node cap. “Load 25 more” and “Expand” increase coverage.
- Grouping: Files are grouped by folders into hierarchical group nodes; groups auto‑size to contain their children.
- Layout: The webview uses ELK (layered) for layout. If ELK fails, it falls back to a simple horizontal layout. Edge endpoints are connected to line‑anchored handles when available.
- Code previews: The webview highlights code with Highlight.js and preserves line structure so edges can anchor to exact lines. Selecting tokens requests references and opens definitions via VS Code’s built‑in LSP commands.
- Git integration: When Git state changes, the extension can surface changed files for quick opening on the canvas.


## Troubleshooting
- Nothing shows up: Make sure you opened a folder and have JS/TS or Python files that aren’t excluded by settings.
- Webview doesn’t update: If using watch mode, prefer `npx vite build --watch` instead of `vite dev` to feed `extension/media/` where the extension loads assets.
- Node version errors: Ensure Node 18+.
- Changed files missing: Verify the Git extension is enabled; otherwise the extension falls back to parsing `git status` output.
- Performance: Reduce `codeCanvas.maxNodes` and/or widen `codeCanvas.excludeGlobs`. Large files are truncated to `codeCanvas.maxPreviewBytes` for preview.


## Scripts (reference)
Root `package.json`:
```json
{
  "scripts": {
    "build": "npm -w webview run build && npm -w extension run build",
    "watch": "npm -w webview run dev & npm -w extension run watch",
    "package": "npm -w extension run package"
  },
  "workspaces": ["webview", "extension"]
}
```
Webview `package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```
Extension `package.json`:
```json
{
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "tsup src/extension.ts --format cjs --dts --out-dir dist --external vscode",
    "watch": "tsup src/extension.ts --watch --format cjs --out-dir dist",
    "package": "vsce package"
  }
}
```

Tip: For a webview build watch, run `npx vite build --watch` inside `webview/`.


## Roadmap / Ideas
- Multiple layout strategies switchable at runtime (ELK, Dagre, Force)
- Additional language parsers and richer edge types (calls/refs)
- Persisted layouts and named canvases
- Export/import views and screenshots


## License
ISC


## Acknowledgements
- React Flow for graph rendering
- ELK (Eclipse Layout Kernel) for layered layouts
- Highlight.js for syntax highlighting
- VS Code extension samples and APIs
