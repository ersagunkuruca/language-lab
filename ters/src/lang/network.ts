// A request over the network and its response (BACKLOG L191): std's
// `Request` (method, url, headers, body) and `Response` (status, headers,
// body), as the evaluator and compiled JavaScript hold them, and the plain
// objects a world answers with. Both runtimes convert here, so they agree.
//
// `send request` is a Network operation, as `fetch text` is. The world
// sends each distinct request once per run and remembers its response, so
// a search that backtracks never sends twice (as fetch text fetches each
// address once): a POST made under a Choice is made once.
//
// A body is Bytes (L191c), the Uint8Array a world sends and gets back;
// bytes.ts converts it as it does a file's.
//
// Prior art: the Fetch standard's Request and Response (WHATWG), and
// Elm's Http, whose requests are values a runtime sends. CREDITS.md.

import { bytesValue, plainBytes } from "./bytes.ts";

export const REQUEST_V = "std.request.request";
export const RESPONSE_V = "std.response.response";
const CONS = "std.list.cons", NIL = "std.list.nil", PAIR_V = "std.tuple2.tuple";

export interface PlainRequest { method: string; url: string; headers: [string, string][]; body: Uint8Array }
export interface PlainResponse { status: number; headers: [string, string][]; body: Uint8Array }

type Data = { tag: string; fields: unknown[] };
const items = (l: unknown): unknown[] => { const out: unknown[] = []; for (let c = l as Data; c.tag === CONS; c = c.fields[1] as Data) out.push(c.fields[0]); return out; };
const list = (xs: unknown[]): Data => xs.reduceRight<Data>((t, h) => ({ tag: CONS, fields: [h, t] }), { tag: NIL, fields: [] });

export function plainRequest(v: unknown): PlainRequest {
  const [method, url, headers, body] = (v as Data).fields as [string, string, unknown, unknown];
  return { method, url, headers: items(headers).map((p) => (p as Data).fields as [string, string]), body: plainBytes(body) };
}
export function responseValue(r: PlainResponse): Data {
  return { tag: RESPONSE_V, fields: [r.status, list(r.headers.map(([k, x]) => ({ tag: PAIR_V, fields: [k, x] }))), bytesValue(r.body)] };
}
// What a world remembers a request by: everything in it.
export const requestKey = (r: PlainRequest) => JSON.stringify([r.method.toUpperCase(), r.url, r.headers, base64Of(r.body)]);
// Bytes as Base64, for a key and for sending them through JSON.
export function base64Of(b: Uint8Array): string { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
export function bytesOfBase64(t: string): Uint8Array { const s = atob(t); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
