// The repository's versions of an example, read from GitHub in the browser
// (E263): the Changes tab compares a program with a branch, a tag, a
// commit or a pull request. raw.githubusercontent.com serves a file at any
// revision and api.github.com a pull request's two commits, both to any
// page (CORS) and without signing in, so the site can do it as it is.
import { parseSaved } from "../ters/src/saved.ts";

export const REPO = "ersagunkuruca/language-lab";

// Which file holds which table, as examplesPlugin.ts reads a folder.
const TABLES: [string, string][] = [["code", "code"], ["names", "names.default"], ["names", "names.short"], ["descriptive", "names.descriptive"], ["comments", "comments"], ["examples", "examples"], ["layout", "layout"], ["hints", "hints"], ["signatures", "signatures"]];

// A folder under ters/examples, or from the repository's root with a slash.
const pathOf = (folder: string) => (folder.includes("/") ? folder : `ters/examples/${folder}`);

const get = async (url: string): Promise<Response> => {
  try { return await fetch(url); } catch { throw new Error("GitHub couldn't be reached"); }
};

// A folder's tables at `rev`: a branch, a tag or a commit. A table the
// folder hasn't then is left out; a folder with no code.json then isn't
// there, and that's an error.
export async function tablesAt(rev: string, folder: string): Promise<Record<string, unknown>> {
  const at = `https://raw.githubusercontent.com/${REPO}/${rev.split("/").map(encodeURIComponent).join("/")}/${pathOf(folder)}/`;
  const tables: Record<string, unknown> = {};
  await Promise.all(TABLES.map(async ([table, file]) => {
    const r = await get(`${at}${file}.json`);
    if (r.status === 404) return;
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${file}.json`);
    tables[table] = { ...(tables[table] as object | undefined), ...parseSaved<object>(await r.text()) };
  }));
  if (!tables.code) throw new Error(`${rev} has no ${pathOf(folder)}/code.json (or no such branch, tag or commit)`);
  return tables;
}

export interface PullRequest { number: number; title: string; base: string; head: string; url: string }

const api = async <T>(path: string, what: string): Promise<T> => {
  const r = await get(`https://api.github.com/repos/${REPO}/${path}`);
  if (r.status === 404) throw new Error(`There's no ${what}`);
  if (r.status === 403 || r.status === 429) throw new Error("GitHub's limit for reading without signing in is reached (60 an hour); try again later");
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${what}`);
  return await r.json() as T;
};

// A pull request's two commits: where its branch left the base (as GitHub's
// Files changed shows it, so the base's later commits aren't in it) and its
// newest.
export async function pullRequest(n: number): Promise<PullRequest> {
  const p = await api<{ number: number; title: string; html_url: string; base: { sha: string }; head: { sha: string } }>(`pulls/${n}`, `pull request #${n}`);
  const c = await api<{ merge_base_commit: { sha: string } }>(`compare/${p.base.sha}...${p.head.sha}`, `a common commit for pull request #${n}`);
  return { number: p.number, title: p.title, base: c.merge_base_commit.sha, head: p.head.sha, url: p.html_url };
}
