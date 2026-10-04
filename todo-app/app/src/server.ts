// A small todo list web app. Todos live in PostgreSQL; the connection comes
// from the standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
// PGDATABASE), which node-postgres reads on its own.
import http from "node:http";
import pg from "pg";
import { ABOUT } from "./about.js";
import { FONTS, THEME_CSS, THEME_SCRIPT, header } from "./theme.js";

const port = Number(process.env.PORT ?? 8080);
const pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 5000 });

interface Todo {
  id: number;
  title: string;
  done: boolean;
  created_at: string;
}

async function listTodos(): Promise<Todo[]> {
  const { rows } = await pool.query<Todo>(
    "SELECT id, title, done, created_at FROM todos ORDER BY done, created_at DESC",
  );
  return rows;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new HttpError(413, "body too large");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
  });
  res.end(text);
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const idMatch = url.pathname.match(/^\/api\/todos\/(\d+)$/);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE);
  if (req.method === "GET" && url.pathname === "/about") return send(res, 200, ABOUT);

  if (req.method === "GET" && url.pathname === "/healthz") {
    await pool.query("SELECT 1");
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/todos") {
    return send(res, 200, await listTodos());
  }

  if (req.method === "POST" && url.pathname === "/api/todos") {
    const { title } = await readJson(req);
    if (typeof title !== "string" || !title.trim()) throw new HttpError(400, "title is required");
    const { rows } = await pool.query<Todo>(
      "INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done, created_at",
      [title.trim().slice(0, 200)],
    );
    return send(res, 201, rows[0]);
  }

  if (req.method === "PATCH" && idMatch) {
    const { done } = await readJson(req);
    if (typeof done !== "boolean") throw new HttpError(400, "done must be a boolean");
    const { rows } = await pool.query<Todo>(
      "UPDATE todos SET done = $2 WHERE id = $1 RETURNING id, title, done, created_at",
      [Number(idMatch[1]), done],
    );
    if (!rows[0]) throw new HttpError(404, "not found");
    return send(res, 200, rows[0]);
  }

  if (req.method === "DELETE" && idMatch) {
    const { rowCount } = await pool.query("DELETE FROM todos WHERE id = $1", [Number(idMatch[1])]);
    if (!rowCount) throw new HttpError(404, "not found");
    res.writeHead(204).end();
    return;
  }

  throw new HttpError(404, "not found");
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err instanceof HttpError ? err.message : "internal error" });
  });
});

server.listen(port, "::", () => {
  console.log(`todo-app listening on [::]:${port}, database ${process.env.PGHOST}`);
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fcfdf7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1d31">
<title>Todos · Datum</title>
${THEME_SCRIPT}
${FONTS}
<style>${THEME_CSS}
  main { max-width: 680px; display: grid; gap: 16px; }
  .count { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  form { display: flex; gap: 8px; }
  form input { flex: 1; min-width: 0; }
  #error { color: var(--danger); margin: 10px 0 0; font-size: 13px; }
  #error:empty { display: none; }
  ul { list-style: none; margin: 14px 0 0; padding: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--border); }
  li input { width: 16px; height: 16px; margin: 0; accent-color: var(--live); cursor: pointer; }
  li span { flex: 1; overflow-wrap: anywhere; }
  li.done span { text-decoration: line-through; color: var(--muted); }
  li button { font: 12px var(--sans); color: var(--muted); background: none; border: 0; padding: 4px 6px; border-radius: 6px; cursor: pointer; opacity: 0; }
  li:hover button, li button:focus-visible { opacity: 1; }
  li button:hover { color: var(--danger); }
  .empty { color: var(--muted); padding: 12px 0 0; }
  .more { font-size: 13px; }
</style>
</head>
<body>
<div class="page">
${header("Todos", "A todo list on Datum Cloud: the app runs as a unikernel, its data lives in PostgreSQL on a private network.", '<span class="pill" id="status"><span class="dot"></span><span id="status-text">Connecting</span></span>')}
<main>
  <section class="panel">
    <div class="panel-head"><span class="label">Your list</span><span class="count" id="count"></span></div>
    <div class="panel-body">
      <form id="add"><input type="text" id="title" placeholder="What needs doing?" autocomplete="off" required aria-label="New todo"><button class="btn">Add</button></form>
      <p id="error"></p>
      <ul id="list"></ul>
    </div>
  </section>
  <p class="more"><a href="/about">About this app</a></p>
</main>
</div>
<script>
const list = document.getElementById("list");
const error = document.getElementById("error");
const count = document.getElementById("count");
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.status === 204 ? null : res.json();
}
async function refresh() {
  try {
    const todos = await api("GET", "/api/todos");
    if (todos.length) list.replaceChildren(...todos.map(render));
    else { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nothing to do."; list.replaceChildren(li); }
    const done = todos.filter((t) => t.done).length;
    count.textContent = (todos.length - done) + " open · " + done + " done";
    error.textContent = "";
  } catch (e) { error.textContent = e.message; }
}
function render(t) {
  const li = document.createElement("li");
  li.className = t.done ? "done" : "";
  const box = document.createElement("input");
  box.type = "checkbox"; box.checked = t.done; box.setAttribute("aria-label", "Done: " + t.title);
  box.onchange = () => api("PATCH", "/api/todos/" + t.id, { done: box.checked }).then(refresh);
  const span = document.createElement("span");
  span.textContent = t.title;
  const del = document.createElement("button");
  del.textContent = "Delete"; del.setAttribute("aria-label", "Delete " + t.title);
  del.onclick = () => api("DELETE", "/api/todos/" + t.id).then(refresh);
  li.append(box, span, del);
  return li;
}
async function status() {
  const pill = document.getElementById("status");
  const text = document.getElementById("status-text");
  try {
    const res = await fetch("/healthz");
    if (!res.ok) throw new Error();
    pill.classList.remove("down"); text.textContent = "Database connected";
  } catch { pill.classList.add("down"); text.textContent = "Database unavailable"; }
}
document.getElementById("add").onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById("title");
  try { await api("POST", "/api/todos", { title: input.value }); input.value = ""; refresh(); }
  catch (err) { error.textContent = err.message; }
};
refresh(); status(); setInterval(status, 30000);
</script>
</body>
</html>`;
