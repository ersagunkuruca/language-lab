// The module editor/examplesPlugin.ts makes at build time (BACKLOG E205).
declare module "examples:files" {
  const files: Record<string, { code: unknown; names?: Record<string, string>; descriptive?: Record<string, string>; comments?: Record<string, string>; examples?: Record<string, unknown>; layout?: unknown; hints?: unknown }>;
  export default files;
}
