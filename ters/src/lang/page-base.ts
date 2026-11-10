// Kept apart from page.ts so the C target's layout (compiler/src/c-layout.ts)
// can use the same sheet without pulling in the page code.
// What a page looks like before its own style: a readable font, some room,
// buttons and fields that look like the editor's. All of it in :where(), so
// it weighs nothing (specificity 0) and any rule of the page's own wins.
export const PAGE_BASE = [
  ":where(body) { margin: 0; padding: 16px; font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1d2229; background: #fff; }",
  ":where(h1) { font-size: 1.4em; margin: 0 0 0.5em; } :where(h2) { font-size: 1.15em; margin: 1em 0 0.4em; }",
  ":where(button) { font: inherit; font-size: 0.93em; padding: 5px 13px; margin: 2px 4px 2px 0; border: 1px solid #c8ced7; border-radius: 8px; background: #f3f5f8; color: inherit; cursor: pointer; }",
  ":where(button:hover) { background: #e7ebf1; } :where(button:active) { background: #dce2ea; }",
  ":where(input, select, textarea) { font: inherit; padding: 4px 8px; border: 1px solid #c8ced7; border-radius: 6px; }",
  ":where(img, svg, canvas, video) { max-width: 100%; }",
].join("\n");
