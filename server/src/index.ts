import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mysql, { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream as readFileStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const root = process.cwd();
const env = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  storageRoot: path.resolve(process.env.STORAGE_ROOT || path.join(root, "uploads")),
  requireVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  nodeEnv: process.env.NODE_ENV || "development",
};

if (!env.databaseUrl || !env.sessionSecret) {
  throw new Error("DATABASE_URL and SESSION_SECRET are required");
}

const pool: Pool = mysql.createPool({
  uri: env.databaseUrl,
  connectionLimit: 10,
  waitForConnections: true,
  namedPlaceholders: false,
  multipleStatements: true,
});

const migrationsDir = path.join(root, "database", "migrations");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sessionHash = (value: string) => sha256(`${env.sessionSecret}:${value}`);
const newToken = () => randomBytes(32).toString("base64url");

async function migrate() {
  const [baselineTables] = await pool.query<RowDataPacket[]>("SHOW TABLES LIKE 'users'");
  if (!baselineTables.length) {
    const baseline = await fs.readFile(path.join(root, "database", "schema.sql"), "utf8");
    await pool.query(baseline);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [rows] = await pool.query<RowDataPacket[]>("SELECT version, checksum FROM schema_migrations");
  const applied = new Map(rows.map((row) => [String(row.version), String(row.checksum)]));
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const checksum = sha256(sql);
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw new Error(`Migration checksum mismatch: ${file}`);
      continue;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)", [file, checksum]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

type User = { id: number; email: string; full_name: string | null; role: "admin" | "user"; status: string };
type AuthedRequest = Request & { user?: User; sessionId?: number };

async function recordActivity(userId: number | null, action: string, req: Request, description?: string, targetType?: string, targetId?: string) {
  await pool.query(
    `INSERT INTO activity_logs (user_id, action, module, description, target_type, target_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, action, "hazakban", description || null, targetType || null, targetId || null, req.ip, req.get("user-agent") || null],
  );
}

async function recordLogin(userId: number | null, email: string, status: "success" | "failed", reason: string | null, req: Request) {
  await pool.query(
    `INSERT INTO login_logs (user_id, email_attempted, login_status, failure_reason, ip_address, user_agent, browser, operating_system, device_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, email, status, reason, req.ip, req.get("user-agent") || null, "unknown", "unknown", "unknown"],
  );
}

async function loadUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.hazakban_session;
    if (!token) return next();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id AS session_id, u.id, u.email, u.full_name, u.role, u.status
       FROM active_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = ? AND s.status = 'active' AND u.status = 'active'
       LIMIT 1`,
      [sessionHash(token)],
    );
    if (rows[0]) {
      req.user = rows[0] as User;
      req.sessionId = Number(rows[0].session_id);
      await pool.query("UPDATE active_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?", [req.sessionId]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "15mb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    const configuredOrigin = process.env.APP_ORIGIN;
    const localOrigins = new Set(["http://localhost:3000", "http://localhost:5173"]);
    if (origin && configuredOrigin && origin !== configuredOrigin && !localOrigins.has(origin)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }
  }
  next();
});
app.use(loadUser);

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const passwordSchema = z.string().min(10).max(128);
const authSchema = z.object({ email: emailSchema, password: passwordSchema });
const commandSchema = z.object({ command: z.string().trim().min(1).max(80) });

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "HAZAKBAN" }));

app.get("/api/auth/me", (req: AuthedRequest, res) => {
  res.json({ user: req.user || null });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const parsed = authSchema.extend({ confirmPassword: z.string() }).parse(req.body);
    if (parsed.password !== parsed.confirmPassword) return res.status(400).json({ error: "Passwords do not match." });
    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [parsed.email]);
    if (existing.length) return res.status(409).json({ error: "An account with that email already exists." });
    const status = env.requireVerification ? "pending" : "active";
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES (?, ?, 'user', ?, ?)",
      [parsed.email, await argon2.hash(parsed.password), status, env.requireVerification ? null : new Date()],
    );
    if (env.requireVerification) {
      return res.status(201).json({ message: "Account created. Email verification is required before access." });
    }
    await recordActivity(result.insertId, "REGISTER", req, "User account created");
    res.status(201).json({ message: "Account created. You can access the terminal now." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  try {
    const { password } = authSchema.parse(req.body);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
    const user = rows[0];
    if (!user || !(await argon2.verify(String(user.password_hash), password))) {
      await recordLogin(user?.id || null, email, "failed", "Invalid credentials", req);
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (user.status !== "active") {
      await recordLogin(user.id, email, "failed", "Account is not active", req);
      return res.status(403).json({ error: "This account is not active." });
    }
    const token = newToken();
    const [session] = await pool.query<ResultSetHeader>(
      `INSERT INTO active_sessions (user_id, session_token_hash, ip_address, user_agent, browser, operating_system, device_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, sessionHash(token), req.ip, req.get("user-agent") || null, "unknown", "unknown", "unknown"],
    );
    await pool.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);
    await recordLogin(user.id, email, "success", null, req);
    await recordActivity(user.id, "LOGIN", req, "Successful login");
    res.cookie("hazakban_session", token, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      signed: false,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }, sessionId: session.insertId });
  } catch (error) {
    await recordLogin(null, email, "failed", "Invalid request", req).catch(() => undefined);
    next(error);
  }
});

app.post("/api/auth/logout", requireUser, async (req: AuthedRequest, res, next) => {
  try {
    if (req.sessionId) await pool.query("UPDATE active_sessions SET status = 'logged_out', logout_at = CURRENT_TIMESTAMP WHERE id = ?", [req.sessionId]);
    await recordActivity(req.user!.id, "LOGOUT", req, "User logged out");
    res.clearCookie("hazakban_session");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/terminal/commands", requireUser, async (req: AuthedRequest, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, command_text, display_name, action_type, description
       FROM command_definitions WHERE status = 'active' ORDER BY command_text`,
    );
    res.json({ commands: [{ command_text: "help", display_name: "Show available commands", action_type: "help" }, ...rows] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/terminal/execute", requireUser, async (req: AuthedRequest, res, next) => {
  try {
    const { command } = commandSchema.parse(req.body);
    await recordActivity(req.user!.id, "COMMAND_EXECUTED", req, `Command ${command}`, "command", command);
    if (command.toLowerCase() === "help") {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT command_text, display_name, description FROM command_definitions WHERE status = 'active' ORDER BY command_text");
      return res.json({ type: "help", lines: ["AVAILABLE COMMANDS", "------------------", ...rows.map((row) => `${row.command_text}  ${row.display_name}`)] });
    }
    const [commands] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM command_definitions WHERE command_text = ? AND status = 'active' LIMIT 1`, [command],
    );
    const definition = commands[0];
    if (!definition) return res.status(404).json({ error: "Command not found. Type: help" });
    if (definition.action_type === "download_folder") {
      const [permissions] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM file_permissions WHERE user_id = ? AND folder_id = ? AND permission IN ('read','download') LIMIT 1",
        [req.user!.id, definition.target_folder_id],
      );
      if (req.user!.role !== "admin" && !permissions.length) return res.status(403).json({ error: "Access denied." });
      const [files] = await pool.query<RowDataPacket[]>(
        "SELECT id, original_name, size FROM files WHERE folder_id = ? AND status = 'active' ORDER BY original_name",
        [definition.target_folder_id],
      );
      await recordActivity(req.user!.id, "FOLDER_ACCESSED", req, `Folder command ${command}`, "folder", String(definition.target_folder_id));
      return res.json({ type: "download_folder", command, target: definition.display_name, files });
    }
    const [files] = await pool.query<RowDataPacket[]>("SELECT * FROM files WHERE id = ? AND status = 'active' LIMIT 1", [definition.target_file_id]);
    const file = files[0];
    if (!file) return res.status(404).json({ error: "Target unavailable." });
    const [permissions] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM file_permissions WHERE user_id = ? AND (file_id = ? OR folder_id = ?) AND permission IN ('read','download') LIMIT 1",
      [req.user!.id, file.id, file.folder_id],
    );
    if (req.user!.role !== "admin" && !permissions.length) return res.status(403).json({ error: "Access denied." });
    await recordActivity(req.user!.id, "DOWNLOAD_STARTED", req, `Download ${file.original_name}`, "file", String(file.id));
    return res.json({ type: "download", downloadUrl: `/api/downloads/${file.id}`, file: { id: file.id, name: file.original_name, size: file.size } });
  } catch (error) {
    next(error);
  }
});

app.get("/api/downloads/:id", requireUser, async (req: AuthedRequest, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM files WHERE id = ? AND status = 'active' LIMIT 1", [Number(req.params.id)]);
    const file = rows[0];
    if (!file) return res.status(404).json({ error: "Target unavailable." });
    const [permissions] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM file_permissions WHERE user_id = ? AND (file_id = ? OR folder_id = ?) AND permission IN ('read','download') LIMIT 1",
      [req.user!.id, file.id, file.folder_id],
    );
    if (req.user!.role !== "admin" && !permissions.length) return res.status(403).json({ error: "Access denied." });
    const safeKey = path.basename(String(file.storage_key));
    const filePath = path.join(env.storageRoot, safeKey);
    if (!filePath.startsWith(`${env.storageRoot}${path.sep}`)) return res.status(400).json({ error: "Target unavailable." });
    res.type(String(file.mime_type));
    res.attachment(String(file.original_name).replace(/[^\w.\- ]/g, "_"));
    readFileStream(filePath).on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "Target unavailable." });
    }).pipe(res);
    await recordActivity(req.user!.id, "DOWNLOAD_COMPLETED", req, `Downloaded ${file.original_name}`, "file", String(file.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/summary", requireAdmin, async (_req, res, next) => {
  try {
    const [[users], [activeSessions], [commands], [files]] = await Promise.all([
      pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM users"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM active_sessions WHERE status = 'active'"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM command_definitions WHERE status = 'active'"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM files WHERE status = 'active'"),
    ]);
    res.json({ users: users[0].count, activeSessions: activeSessions[0].count, commands: commands[0].count, files: files[0].count });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id, email, full_name, role, status, email_verified_at, created_at, last_login_at FROM users ORDER BY created_at DESC");
    res.json({ users: rows });
  } catch (error) { next(error); }
});

app.get("/api/admin/logs/:kind", requireAdmin, async (req, res, next) => {
  try {
    const table = req.params.kind === "login" ? "login_logs" : req.params.kind === "activity" ? "activity_logs" : "";
    if (!table) return res.status(400).json({ error: "Unknown log type." });
    const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 100`);
    res.json({ rows });
  } catch (error) { next(error); }
});

app.get("/api/admin/sessions", requireAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, u.email, s.ip_address, s.browser, s.operating_system, s.device_type, s.login_at, s.last_activity_at, s.status
       FROM active_sessions s JOIN users u ON u.id = s.user_id ORDER BY s.last_activity_at DESC LIMIT 100`,
    );
    res.json({ sessions: rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/sessions/:id/revoke", requireAdmin, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query("UPDATE active_sessions SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(req.params.id)]);
    await recordActivity(req.user!.id, "SESSION_REVOKED", req, "Admin revoked a session", "session", String(req.params.id));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/commands", requireAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, f.original_name, fo.name AS folder_name FROM command_definitions c
       LEFT JOIN files f ON f.id = c.target_file_id LEFT JOIN folders fo ON fo.id = c.target_folder_id
       ORDER BY c.command_text`,
    );
    res.json({ commands: rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/commands", requireAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({
      commandText: z.string().trim().regex(/^[0-9]{2} [0-9]{2}$/),
      displayName: z.string().trim().min(1).max(180),
      actionType: z.enum(["download_folder", "download_file"]),
      targetFolderId: z.number().int().positive().nullable().optional(),
      targetFileId: z.number().int().positive().nullable().optional(),
      description: z.string().max(1000).nullable().optional(),
    }).parse(req.body);
    const isFolder = body.actionType === "download_folder";
    if (isFolder ? !body.targetFolderId || body.targetFileId : !body.targetFileId || body.targetFolderId) {
      return res.status(400).json({ error: "Choose exactly one target matching the action." });
    }
    await pool.query(
      `INSERT INTO command_definitions (command_text, display_name, action_type, target_folder_id, target_file_id, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.commandText, body.displayName, body.actionType, body.targetFolderId || null, body.targetFileId || null, body.description || null, req.user!.id],
    );
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.post("/api/admin/folders", requireAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(180), parentId: z.number().int().positive().nullable().optional() }).parse(req.body);
    await pool.query("INSERT INTO folders (parent_id, name, created_by) VALUES (?, ?, ?)", [body.parentId || null, body.name, req.user!.id]);
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/folders", requireAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id, parent_id, name, status, created_at FROM folders ORDER BY parent_id, name");
    res.json({ folders: rows });
  } catch (error) { next(error); }
});

app.get("/api/admin/files", requireAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.folder_id, f.original_name, f.size, f.mime_type, f.checksum, f.status, f.created_at, fo.name AS folder_name
       FROM files f JOIN folders fo ON fo.id = f.folder_id ORDER BY f.created_at DESC`,
    );
    res.json({ files: rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/files", requireAdmin, async (req: AuthedRequest, res, next) => {
  let storageKey = "";
  try {
    const body = z.object({
      folderId: z.number().int().positive(),
      originalName: z.string().trim().min(1).max(255).regex(/^[^/\\]+$/),
      mimeType: z.string().trim().max(180).default("application/octet-stream"),
      contentBase64: z.string().min(1),
    }).parse(req.body);
    const content = Buffer.from(body.contentBase64, "base64");
    if (!content.length || content.length > env.maxUploadBytes) return res.status(413).json({ error: "File is too large or invalid." });
    const [folders] = await pool.query<RowDataPacket[]>("SELECT id FROM folders WHERE id = ? AND status = 'active' LIMIT 1", [body.folderId]);
    if (!folders.length) return res.status(404).json({ error: "Target unavailable." });
    storageKey = `${randomBytes(24).toString("hex")}.bin`;
    await fs.mkdir(env.storageRoot, { recursive: true });
    await fs.writeFile(path.join(env.storageRoot, storageKey), content, { flag: "wx" });
    await pool.query(
      `INSERT INTO files (folder_id, original_name, storage_key, size, mime_type, checksum, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.folderId, body.originalName, storageKey, content.length, body.mimeType, sha256(content), req.user!.id],
    );
    await recordActivity(req.user!.id, "FILE_UPLOADED", req, `Uploaded ${body.originalName}`, "folder", String(body.folderId));
    res.status(201).json({ ok: true });
  } catch (error) {
    if (storageKey) await fs.rm(path.join(env.storageRoot, storageKey), { force: true }).catch(() => undefined);
    next(error);
  }
});

app.post("/api/admin/permissions", requireAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({
      userId: z.number().int().positive(),
      folderId: z.number().int().positive().nullable().optional(),
      fileId: z.number().int().positive().nullable().optional(),
      permission: z.enum(["read", "download"]).default("download"),
    }).parse(req.body);
    if ((body.folderId ? 1 : 0) + (body.fileId ? 1 : 0) !== 1) {
      return res.status(400).json({ error: "Choose exactly one folder or file target." });
    }
    await pool.query(
      "INSERT INTO file_permissions (user_id, folder_id, file_id, permission, created_by) VALUES (?, ?, ?, ?, ?)",
      [body.userId, body.folderId || null, body.fileId || null, body.permission, req.user!.id],
    );
    await recordActivity(req.user!.id, "PERMISSION_GRANTED", req, "File access permission granted", "user", String(body.userId));
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(root, "dist/client")));
app.get("*splat", (_req, res) => res.sendFile(path.join(root, "dist/client/index.html")));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (res.headersSent) return;
  const status = error instanceof z.ZodError ? 400 : 500;
  res.status(status).json({ error: status === 400 ? "Invalid request." : "System error. Please try again later." });
});

await migrate();
await fs.mkdir(env.storageRoot, { recursive: true });
if (process.argv.includes("--migrate-only")) {
  await pool.end();
  process.exit(0);
}
app.listen(env.port, () => console.log(`HAZAKBAN listening on port ${env.port}`));