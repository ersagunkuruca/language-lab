#!/usr/bin/env node
// The Ters MCP server: an LLM reads, runs and tests a program through it
// (docs/design/tools/MCP.md). Model Context Protocol over standard input and
// output, one JSON-RPC message a line; written out here rather than taken
// from the SDK, since it is three methods.
//
//   node mcp/server.ts [program]     or   lab mcp [program]
//
// Responses are kept short on purpose: the text asked for, an error, no
// explanations around it. The one explanation is `instructions`, sent once.

import { createInterface } from "node:readline";
import { Session, LINES } from "./session.ts";

const INSTRUCTIONS = `Ters programs are trees with stable ids, not text. Names are a side table.
view prints a definition as text: gutter = id of the block starting on that line; name#id = where a name is bound; □#id = a hole; "…" = a block left out to keep it short (view its id).
Ids: any unique prefix; a definition's name works too.`;

type Args = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: object; call: (a: Args) => string }

let session: Session | null = null;
const program = (): Session => session ?? (() => { throw new Error("no program open: call open"); })();
const str = (description: string) => ({ type: "string", description });
const obj = (props: Record<string, object>, required: string[] = []) => ({ type: "object", properties: props, required });

export const TOOLS: Tool[] = [
  {
    name: "open",
    description: "Open a program: a folder (code.json + names) or a saved file. Lists its definitions.",
    inputSchema: obj({ path: str("folder or file") }, ["path"]),
    call: (a) => { session = new Session(String(a.path)); return `${session.title}\n${session.defs()}`; },
  },
  {
    name: "defs",
    description: "List definitions: id, name, type. ✗ = has errors.",
    inputSchema: obj({ filter: str("part of a name"), library: { type: "boolean", description: "include the standard library" } }),
    call: (a) => program().defs(a.filter as string | undefined, !!a.library),
  },
  {
    name: "view",
    description: `Show a definition, or one block of it, as text with ids.`,
    inputSchema: obj({ at: str("id or definition name"), depth: { type: "number", description: `nesting shown (default: as deep as fits ${LINES} lines)` } }, ["at"]),
    call: (a) => program().view(String(a.at), typeof a.depth === "number" ? a.depth : undefined),
  },
  {
    name: "check",
    description: "Type errors in the program, or ok.",
    inputSchema: obj({}),
    call: () => program().errors(),
  },
  {
    name: "run",
    description: "Run main (or another action or value). Returns what it prints and its exit code or value.",
    inputSchema: obj({ entry: str("definition (default main)"), args: { type: "array", items: { type: "string" } }, input: str("standard input") }),
    call: (a) => program().run((a.entry as string) ?? "main", (a.args as string[]) ?? [], (a.input as string) ?? ""),
  },
  {
    name: "test",
    description: "Run the tests: definitions that perform Check, and accepted answers.",
    inputSchema: obj({}),
    call: () => program().test(),
  },
  {
    name: "replace",
    description: "Replace a part with an expression written as view prints it (□ for a hole). Typechecked; saved; returns the diff.",
    inputSchema: obj({ at: str("id"), text: str("e.g. fall(b) + 1, (x) => x * 2, [1, 2], □"), find: str("optional: the exact text of a part inside at") }, ["at", "text"]),
    call: (a) => program().replace(String(a.at), String(a.text), a.find as string | undefined),
  },
  {
    name: "step",
    description: "Add a step `name = value` before a part (or first in a definition's body).",
    inputSchema: obj({ at: str("id of the part it goes before, or a definition"), name: str("the new name (_ if unused)"), value: str("expression; empty leaves a hole") }, ["at", "name"]),
    call: (a) => program().step(String(a.at), String(a.name), String(a.value ?? "")),
  },
  {
    name: "split",
    description: "Replace a part by a match on a variable: one case per variant, each a copy of the part.",
    inputSchema: obj({ at: str("id"), on: str("the variable's id"), find: str("optional: text of a part inside at") }, ["at", "on"]),
    call: (a) => program().split(String(a.at), String(a.on), a.find as string | undefined),
  },
  {
    name: "rename",
    description: "Rename a definition, variable, case or field. Uses follow (they point at the id).",
    inputSchema: obj({ at: str("id"), name: str("new name") }, ["at", "name"]),
    call: (a) => program().rename(String(a.at), String(a.name)),
  },
  {
    name: "comment",
    description: "Set (or with empty text, remove) the comment on a node.",
    inputSchema: obj({ at: str("id"), text: str("comment") }, ["at", "text"]),
    call: (a) => program().comment(String(a.at), String(a.text)),
  },
  {
    name: "define",
    description: "New definition with a hole body (function, value) or one case (type, effect, interface).",
    inputSchema: obj({ name: str("name"), kind: { type: "string", enum: ["function", "value", "type", "effect", "interface"] }, params: { type: "array", items: { type: "string" }, description: "function inputs" }, first: str("first case or operation") }, ["name", "kind"]),
    call: (a) => program().define(String(a.name), String(a.kind), (a.params as string[]) ?? [], String(a.first ?? "")),
  },
  {
    name: "add_input",
    description: "Add an input to a definition; each call gets a hole for it.",
    inputSchema: obj({ at: str("definition"), name: str("input name") }, ["at", "name"]),
    call: (a) => program().addInput(String(a.at), String(a.name)),
  },
  {
    name: "remove",
    description: "Remove a definition nothing uses.",
    inputSchema: obj({ at: str("definition") }, ["at"]),
    call: (a) => program().remove(String(a.at)),
  },
  {
    name: "undo",
    description: "Undo the last edit.",
    inputSchema: obj({}),
    call: () => program().undo(),
  },
  {
    name: "eval",
    description: "Evaluate an expression written as view prints it, using the program's definitions.",
    inputSchema: obj({ text: str("e.g. total(fall(scattered(3)))") }, ["text"]),
    call: (a) => program().eval(String(a.text)),
  },
];

export function call(name: string, args: Args): { text: string; error: boolean } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `no tool ${name}`, error: true };
  try { return { text: tool.call(args ?? {}), error: false }; } catch (e) { return { text: (e as Error).message, error: true }; }
}

type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

export function handle(m: Message): object | null {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      return reply({
        protocolVersion: (m.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "ters", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const r = call(String(m.params?.name), (m.params?.arguments ?? {}) as Args);
      return reply({ content: [{ type: "text", text: r.text }], isError: r.error });
    }
    default:
      // Notifications (no id) need no answer.
      return m.id === undefined ? null : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `no method ${m.method}` } };
  }
}

export function serve(path?: string) {
  if (path) session = new Session(path);
  // Anything the program or a library prints must not reach the protocol.
  console.log = (...a: unknown[]) => process.stderr.write(a.join(" ") + "\n");
  const send = (x: object) => process.stdout.write(JSON.stringify(x) + "\n");
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let m: Message;
    try { m = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } }); return; }
    const r = handle(m);
    if (r) send(r);
  }).on("close", () => process.exit(0));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) serve(process.argv[2]);
