import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import mysql from "mysql2/promise";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const staticDirectory = join(currentDirectory, "dist");
const indexFile = join(staticDirectory, "index.html");

const port = positiveInteger(process.env.PORT, 3000, 65_535);
const sessionDays = positiveInteger(process.env.SESSION_DAYS, 30, 365);
const cookieSecure = process.env.COOKIE_SECURE !== "false";
const registrationEnabled = process.env.REGISTRATION_ENABLED !== "false";
const sessionCookie = "today_session";

if (!existsSync(indexFile)) {
  throw new Error("Self-hosted frontend is missing. Run `npm run build:selfhost` first.");
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: positiveInteger(process.env.MYSQL_PORT, 3306, 65_535),
  database: process.env.MYSQL_DATABASE ?? "today_list",
  user: process.env.MYSQL_USER ?? "today_list_app",
  password: readSecret("MYSQL_PASSWORD"),
  connectionLimit: positiveInteger(process.env.MYSQL_CONNECTION_LIMIT, 10, 50),
  waitForConnections: true,
  queueLimit: 100,
  timezone: "Z",
  dateStrings: true,
  charset: "utf8mb4",
  enableKeepAlive: true,
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", positiveInteger(process.env.TRUST_PROXY, 1, 10));
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    hsts: cookieSecure ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(express.json({ limit: "32kb", strict: true }));
app.use(cookieParser());

app.use("/api", (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (!origin) return next();

  try {
    if (new URL(origin).host !== request.get("host")) {
      return response.status(403).json({ error: "请求来源无效" });
    }
  } catch {
    return response.status(403).json({ error: "请求来源无效" });
  }
  return next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "尝试次数过多，请 15 分钟后再试" },
});

let dummyPasswordHash = "";

app.get("/healthz", async (_request, response) => {
  await pool.query("SELECT 1");
  response.type("text/plain").send("ok");
});

app.post("/api/auth/register", authLimiter, async (request, response) => {
  if (!registrationEnabled) {
    return response.status(403).json({ error: "当前已暂停新用户注册" });
  }
  const email = normalizeEmail(request.body?.email);
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const displayName = cleanDisplayName(request.body?.displayName, email);

  if (!email) return response.status(400).json({ error: "请输入有效邮箱" });
  if (!validPassword(password)) {
    return response.status(400).json({ error: "密码长度需要在 10 到 128 位之间" });
  }
  if (!displayName) return response.status(400).json({ error: "请输入显示名称" });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  try {
    const [result] = await pool.execute(
      `INSERT INTO users
        (email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [email, passwordHash, displayName],
    );
    const user = { id: result.insertId, email, displayName };
    await issueSession(response, request, user);
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ error: "该邮箱已经注册，请直接登录" });
    }
    throw error;
  }
});

app.post("/api/auth/login", authLimiter, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!email || !password) {
    return response.status(400).json({ error: "请输入邮箱和密码" });
  }

  const [rows] = await pool.execute(
    `SELECT id, email, password_hash, display_name, is_active
       FROM users
      WHERE email = ?
      LIMIT 1`,
    [email],
  );
  const record = rows[0];
  const passwordMatches = await argon2.verify(record?.password_hash ?? dummyPasswordHash, password);
  if (!record || !passwordMatches || !record.is_active) {
    return response.status(401).json({ error: "邮箱或密码不正确" });
  }

  const user = { id: record.id, email: record.email, displayName: record.display_name };
  await pool.execute(
    "UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [record.id],
  );
  await issueSession(response, request, user);
  return response.json({ user: publicUser(user) });
});

app.all("/api/auth/logout", async (request, response) => {
  const token = request.cookies?.[sessionCookie];
  if (typeof token === "string" && token.length >= 32) {
    await pool.execute(
      "UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ?",
      [hashToken(token)],
    );
  }
  clearSessionCookie(response);
  if (request.method === "GET") return response.redirect(303, "/login");
  return response.status(204).end();
});

app.get("/api/auth/me", requireUser, (request, response) => {
  response.json({ user: publicUser(request.authUser) });
});

app.get("/api/tasks", requireUser, async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, title, completed, priority, due_date, created_at, updated_at, version
       FROM tasks
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY completed ASC, (due_date IS NULL) ASC, due_date ASC, created_at DESC`,
    [request.authUser.id],
  );
  return response.json({ tasks: rows.map(taskFromRow), user: publicUser(request.authUser) });
});

app.post("/api/tasks", requireUser, async (request, response) => {
  const title = cleanTitle(request.body?.title);
  const priority = cleanPriority(request.body?.priority);
  const due = cleanDueDate(request.body?.due);
  const completed = request.body?.completed === true;
  if (!title) return response.status(400).json({ error: "任务内容不能为空" });

  const id = randomUUID();
  await pool.execute(
    `INSERT INTO tasks
      (id, user_id, title, completed, priority, due_date, sort_order, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, request.authUser.id, title, completed ? 1 : 0, priority, due, Date.now()],
  );
  const task = await findTask(id, request.authUser.id);
  return response.status(201).json({ task });
});

app.delete("/api/tasks", requireUser, async (request, response) => {
  const [result] = await pool.execute(
    `UPDATE tasks
        SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3), version = version + 1
      WHERE user_id = ? AND completed = 1 AND deleted_at IS NULL`,
    [request.authUser.id],
  );
  return response.json({ deleted: result.affectedRows });
});

app.post("/api/tasks/import", requireUser, async (request, response) => {
  const source = Array.isArray(request.body?.tasks) ? request.body.tasks.slice(0, 200) : [];
  const tasks = source
    .map((item) => ({
      id: randomUUID(),
      title: cleanTitle(item?.title),
      completed: item?.completed === true,
      priority: cleanPriority(item?.priority),
      due: cleanDueDate(item?.due),
    }))
    .filter((task) => task.title);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [index, task] of tasks.entries()) {
      await connection.execute(
        `INSERT INTO tasks
          (id, user_id, title, completed, priority, due_date, sort_order, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [
          task.id,
          request.authUser.id,
          task.title,
          task.completed ? 1 : 0,
          task.priority,
          task.due,
          Date.now() + index,
        ],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const imported = [];
  for (const task of tasks) imported.push(await findTask(task.id, request.authUser.id));
  return response.status(201).json({ tasks: imported, imported: imported.length });
});

app.patch("/api/tasks/:id", requireUser, async (request, response) => {
  const id = cleanTaskId(request.params.id);
  const version = Number(request.body?.version);
  if (!id) return response.status(404).json({ error: "任务不存在" });
  if (!Number.isInteger(version) || version < 1) {
    return response.status(400).json({ error: "任务版本无效" });
  }

  const assignments = ["updated_at = UTC_TIMESTAMP(3)", "version = version + 1"];
  const values = [];

  if (Object.hasOwn(request.body ?? {}, "title")) {
    const title = cleanTitle(request.body.title);
    if (!title) return response.status(400).json({ error: "任务内容不能为空" });
    assignments.push("title = ?");
    values.push(title);
  }
  if (typeof request.body?.completed === "boolean") {
    assignments.push("completed = ?");
    values.push(request.body.completed ? 1 : 0);
  }
  if (["high", "medium", "low"].includes(request.body?.priority)) {
    assignments.push("priority = ?");
    values.push(request.body.priority);
  }
  if (Object.hasOwn(request.body ?? {}, "due")) {
    const due = cleanDueDate(request.body.due);
    if (request.body.due && !due) return response.status(400).json({ error: "截止日期无效" });
    assignments.push("due_date = ?");
    values.push(due);
  }

  values.push(id, request.authUser.id, version);
  const [result] = await pool.execute(
    `UPDATE tasks SET ${assignments.join(", ")}
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`,
    values,
  );
  if (result.affectedRows === 1) {
    return response.json({ task: await findTask(id, request.authUser.id) });
  }

  const current = await findTask(id, request.authUser.id);
  if (!current) return response.status(404).json({ error: "任务不存在" });
  return response.status(409).json({ error: "任务已在另一台设备上更新", task: current });
});

app.delete("/api/tasks/:id", requireUser, async (request, response) => {
  const id = cleanTaskId(request.params.id);
  const version = Number(request.query.version);
  if (!id) return response.json({ deleted: true });
  if (!Number.isInteger(version) || version < 1) {
    return response.status(400).json({ error: "任务版本无效" });
  }

  const [result] = await pool.execute(
    `UPDATE tasks
        SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3), version = version + 1
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`,
    [id, request.authUser.id, version],
  );
  if (result.affectedRows === 1) return response.json({ deleted: true });

  const current = await findTask(id, request.authUser.id);
  if (!current) return response.json({ deleted: true });
  return response.status(409).json({ error: "任务已在另一台设备上更新" });
});

app.use(
  express.static(staticDirectory, {
    index: false,
    etag: true,
    maxAge: "1h",
    setHeaders(response, filePath) {
      if (filePath.includes(`${join("assets", "")}`)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
  response.setHeader("Cache-Control", "no-cache");
  return response.sendFile(indexFile);
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error("request_failed", {
    method: request.method,
    path: request.path,
    code: error?.code,
    message: error?.message,
  });
  const status = error?.type === "entity.too.large" ? 413 : 500;
  return response.status(status).json({
    error: status === 413 ? "请求内容过大" : "服务暂时不可用，请稍后再试",
  });
});

async function requireUser(request, response, next) {
  try {
    const token = request.cookies?.[sessionCookie];
    if (typeof token !== "string" || token.length < 32) {
      clearSessionCookie(response);
      return response.status(401).json({ error: "请先登录", authMode: "email" });
    }

    const [rows] = await pool.execute(
      `SELECT s.id AS session_id, u.id, u.email, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > UTC_TIMESTAMP(3)
          AND u.is_active = 1
        LIMIT 1`,
      [hashToken(token)],
    );
    const record = rows[0];
    if (!record) {
      clearSessionCookie(response);
      return response.status(401).json({ error: "登录已过期，请重新登录", authMode: "email" });
    }

    request.authUser = {
      id: record.id,
      email: record.email,
      displayName: record.display_name,
    };
    void pool.execute(
      `UPDATE sessions
          SET last_seen_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND last_seen_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE`,
      [record.session_id],
    ).catch(() => {});
    return next();
  } catch (error) {
    return next(error);
  }
}

async function issueSession(response, request, user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000);
  const ipAddress = normalizeIp(request.ip);
  const userAgent = String(request.get("user-agent") ?? "").slice(0, 512) || null;

  await pool.execute(
    `INSERT INTO sessions
      (id, user_id, token_hash, ip_address, user_agent, expires_at, last_seen_at, created_at)
     VALUES (?, ?, ?, INET6_ATON(?), ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [randomUUID(), user.id, hashToken(token), ipAddress, userAgent, mysqlDate(expiresAt)],
  );
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionDays * 86_400_000,
  });
}

function clearSessionCookie(response) {
  response.clearCookie(sessionCookie, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
  });
}

async function findTask(id, userId) {
  const [rows] = await pool.execute(
    `SELECT id, title, completed, priority, due_date, created_at, updated_at, version
       FROM tasks
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? taskFromRow(rows[0]) : null;
}

function taskFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    completed: Boolean(row.completed),
    priority: row.priority,
    due: row.due_date ?? "",
    createdAt: mysqlDateToIso(row.created_at),
    updatedAt: mysqlDateToIso(row.updated_at),
    version: Number(row.version),
  };
}

function publicUser(user) {
  return { displayName: user.displayName, email: user.email, fullName: null };
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

function cleanDisplayName(value, email) {
  const supplied = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return supplied || email.split("@")[0]?.slice(0, 80) || "";
}

function cleanTitle(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function cleanPriority(value) {
  return ["high", "medium", "low"].includes(value) ? value : "medium";
}

function cleanDueDate(value) {
  if (value === "" || value == null) return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanTaskId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
}

function normalizeIp(value) {
  if (!value) return null;
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mysqlDate(date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function mysqlDateToIso(value) {
  if (!value) return "";
  const text = String(value);
  return text.includes("T") ? (text.endsWith("Z") ? text : `${text}Z`) : `${text.replace(" ", "T")}Z`;
}

function readSecret(name) {
  if (process.env[name]) return process.env[name];
  const file = process.env[`${name}_FILE`];
  if (!file) throw new Error(`${name} or ${name}_FILE is required`);
  const value = readFileSync(file, "utf8").trim();
  if (!value) throw new Error(`${name}_FILE is empty`);
  return value;
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

async function start() {
  dropPrivileges();
  dummyPasswordHash = await argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  await pool.query("SELECT 1");
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`today-list self-hosted server listening on ${port}`);
  });

  async function shutdown(signal) {
    console.log(`received ${signal}, shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

function dropPrivileges() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return;
  const uid = positiveInteger(process.env.APP_UID, 1000, 60_000);
  const gid = positiveInteger(process.env.APP_GID, 1000, 60_000);
  process.setgroups([]);
  process.setgid(gid);
  process.setuid(uid);
  if (process.getuid() === 0 || process.getgid() === 0) {
    throw new Error("Application process failed to drop root privileges");
  }
}

start().catch((error) => {
  console.error("startup_failed", error?.message ?? error);
  process.exit(1);
});
