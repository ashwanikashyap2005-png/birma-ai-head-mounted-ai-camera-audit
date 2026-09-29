const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, "data", "birma-ai-audit.db");

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  workflow_id INTEGER,
  timestamp_seconds REAL NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  workflow_id INTEGER,
  source_name TEXT,
  frame_description TEXT,
  model TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
);
`);

const seed = db.prepare("SELECT COUNT(*) AS c FROM workflows").get();
if (seed.c === 0) {
  db.prepare("INSERT INTO workflows (name, description) VALUES (?, ?)").run(
    "Standard Footage Audit",
    "Review sampled footage, record events, and capture analysis results."
  );
}

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function ok(res, data) { res.json({ ok: true, data }); }
function fail(res, status, message) { res.status(status).json({ ok: false, error: message }); }

app.get("/api/health", (req, res) => ok(res, { service: "Birma AI Audit", status: "healthy" }));

app.get("/api/summary", (req, res) => {
  ok(res, {
    clients: db.prepare("SELECT COUNT(*) c FROM clients").get().c,
    workflows: db.prepare("SELECT COUNT(*) c FROM workflows").get().c,
    auditLogs: db.prepare("SELECT COUNT(*) c FROM audit_logs").get().c,
    analyses: db.prepare("SELECT COUNT(*) c FROM analyses").get().c
  });
});

app.get("/api/clients", (req, res) => ok(res, db.prepare("SELECT * FROM clients ORDER BY id DESC").all()));

app.post("/api/clients", (req, res) => {
  const { name, email = "", phone = "", company = "" } = req.body || {};
  if (!name?.trim()) return fail(res, 400, "Client name is required.");
  const info = db.prepare(
    "INSERT INTO clients (name,email,phone,company) VALUES (?,?,?,?)"
  ).run(name.trim(), email.trim(), phone.trim(), company.trim());
  ok(res, db.prepare("SELECT * FROM clients WHERE id=?").get(info.lastInsertRowid));
});

app.delete("/api/clients/:id", (req, res) => {
  db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id);
  ok(res, { deleted: true });
});

app.get("/api/workflows", (req, res) => ok(res, db.prepare("SELECT * FROM workflows ORDER BY id DESC").all()));

app.post("/api/workflows", (req, res) => {
  const { name, description = "" } = req.body || {};
  if (!name?.trim()) return fail(res, 400, "Workflow name is required.");
  const info = db.prepare("INSERT INTO workflows (name,description) VALUES (?,?)").run(name.trim(), description.trim());
  ok(res, db.prepare("SELECT * FROM workflows WHERE id=?").get(info.lastInsertRowid));
});

app.patch("/api/workflows/:id", (req, res) => {
  const { name, description, status } = req.body || {};
  db.prepare(`
    UPDATE workflows SET
      name=COALESCE(?,name),
      description=COALESCE(?,description),
      status=COALESCE(?,status)
    WHERE id=?
  `).run(name ?? null, description ?? null, status ?? null, req.params.id);
  ok(res, db.prepare("SELECT * FROM workflows WHERE id=?").get(req.params.id));
});

app.get("/api/audit-logs", (req, res) => ok(res, db.prepare(`
  SELECT a.*, c.name client_name, w.name workflow_name
  FROM audit_logs a
  LEFT JOIN clients c ON c.id=a.client_id
  LEFT JOIN workflows w ON w.id=a.workflow_id
  ORDER BY a.id DESC
  LIMIT 500
`).all()));

app.post("/api/audit-logs", (req, res) => {
  const { client_id=null, workflow_id=null, timestamp_seconds=0, event_type, notes="" } = req.body || {};
  if (!event_type?.trim()) return fail(res, 400, "Event type is required.");
  const info = db.prepare(`
    INSERT INTO audit_logs (client_id,workflow_id,timestamp_seconds,event_type,notes)
    VALUES (?,?,?,?,?)
  `).run(client_id || null, workflow_id || null, Number(timestamp_seconds) || 0, event_type.trim(), notes.trim());
  ok(res, db.prepare("SELECT * FROM audit_logs WHERE id=?").get(info.lastInsertRowid));
});

app.get("/api/analyses", (req, res) => ok(res, db.prepare(`
  SELECT a.*, c.name client_name, w.name workflow_name
  FROM analyses a
  LEFT JOIN clients c ON c.id=a.client_id
  LEFT JOIN workflows w ON w.id=a.workflow_id
  ORDER BY a.id DESC
  LIMIT 500
`).all()));

app.post("/api/analyses", (req, res) => {
  const { client_id=null, workflow_id=null, source_name="", frame_description="", model="manual", result="" } = req.body || {};
  const info = db.prepare(`
    INSERT INTO analyses (client_id,workflow_id,source_name,frame_description,model,result)
    VALUES (?,?,?,?,?,?)
  `).run(client_id || null, workflow_id || null, source_name, frame_description, model, result);
  ok(res, db.prepare("SELECT * FROM analyses WHERE id=?").get(info.lastInsertRowid));
});

// Optional Claude image analysis. The full video is never accepted here.
app.post("/api/analyze-frame", upload.single("frame"), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 503, "ANTHROPIC_API_KEY is not configured.");
  if (!req.file) return fail(res, 400, "A still image frame is required.");

  const mime = req.file.mimetype;
  if (!["image/jpeg","image/png","image/webp","image/gif"].includes(mime)) {
    return fail(res, 400, "Unsupported image type.");
  }

  try {
    const body = {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: req.file.buffer.toString("base64") } },
          { type: "text", text: "Analyze this sampled frame for an operational footage audit. Return concise JSON with keys: observed_activity, safety_or_compliance_flags, notable_objects, confidence. Do not identify people." }
        ]
      }]
    };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return fail(res, r.status, data?.error?.message || "AI service error.");
    ok(res, { model: body.model, text: data.content?.map(x => x.text || "").join("\n") || "" });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.get("/privacy-policy", (req, res) => res.sendFile(path.join(__dirname, "public", "privacy-policy.html")));
app.get("/404.html", (req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

app.listen(PORT, () => console.log(`Birma AI Audit running at http://localhost:${PORT}`));
