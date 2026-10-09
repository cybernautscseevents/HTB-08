import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { cors, healthz, securityHeaders } from "@sammati/shared/src/server";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Db } from "./db";
import * as pages from "./pages";
import { Sammati, SammatiError, type ConsentRow, type Purpose } from "./sammati";

export interface AppOptions {
  db: Db;
  sammati: Sammati;
  /** The purpose the account and the loan decision stand on. */
  loanPurpose: string;
  /** Core's WebSocket as the browser reaches it. */
  coreWs: string;
  staff: { user: string; password: string } | null;
  /** The company's own address and API key (the Processor calls the webhook with the key). */
  fiduciary: string;
  apiKey: string;
  /** NODE_ENV=production: cookies are Secure and responses carry HSTS (trd.md §10.6). */
  production?: boolean;
  /** Web origins that may use the portal API (trd.md §6.14). None by default. */
  portalOrigins?: string[];
  now?: () => number;
}

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USERNAME = /^[a-z0-9_]{3,24}$/;
const SESSION_SECONDS = 86_400;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The rate QuickLoan offers, by the reasons the Processor gave. It is QuickLoan's own table. */
export function rateBp(reasons: string[]): number {
  if (reasons.includes("SCORE_GOOD")) return 1050;
  if (reasons.includes("SCORE_FAIR")) return 1300;
  return 1450;
}

function cookies(req: Request): Record<string, string> {
  return Object.fromEntries((req.header("cookie") ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2) as Array<[string, string]>);
}

export function createApp(o: AppOptions): Express {
  const { db, sammati, loanPurpose } = o;
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  // The pages carry their own inline style and script, so only framing, plugins and <base> are locked down.
  app.use(securityHeaders({ production: o.production ?? false, csp: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'" }));
  app.get("/healthz", healthz); // first route: answers at once and touches nothing (trd.md §10.3)
  app.use(express.json({ limit: "8kb" }));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));

  // --- sessions ---
  const startSession = (res: Response, kind: "user" | "staff", username: string): void => {
    const token = randomBytes(24).toString("base64url");
    db.prepare("INSERT INTO sessions (token, kind, username, expires_at) VALUES (?, ?, ?, ?)").run(token, kind, username, now() + SESSION_SECONDS);
    res.setHeader("Set-Cookie", `ql_${kind}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${o.production ? "; Secure" : ""}`);
  };
  const sessionOf = (req: Request, kind: "user" | "staff"): string | null => {
    const token = cookies(req)[`ql_${kind}`];
    if (!token) return null;
    const row = db.prepare("SELECT username FROM sessions WHERE token = ? AND kind = ? AND expires_at > ?").get(token, kind, now()) as { username: string } | undefined;
    return row?.username ?? null;
  };
  const user = (req: Request, res: Response, next: NextFunction): void => {
    const username = sessionOf(req, "user");
    if (!username) {
      res.status(401).json({ code: "NOT_LOGGED_IN", message: "Please log in." });
      return;
    }
    res.locals.username = username;
    next();
  };

  const purposeTitle = new Map<string, Purpose>();
  const loadPurposes = async (): Promise<Purpose[]> => {
    const list = await sammati.purposes();
    for (const p of list) purposeTitle.set(p.code, p);
    return list;
  };
  const userRow = (username: string) => db.prepare("SELECT username, password_hash, principal FROM users WHERE username = ?").get(username) as { username: string; password_hash: string | null; principal: string } | undefined;

  // --- public pages ---
  app.get("/", (_req, res) => void res.type("html").send(pages.landing()));
  app.get("/signup", async (_req, res) => {
    try {
      res.type("html").send(pages.signup(await loadPurposes(), o.coreWs));
    } catch {
      res.status(503).type("html").send(pages.shell("QuickLoan", '<section class="block"><div class="wrap"><h1>We are updating this page</h1><p>Please try again in a minute.</p></div></section>'));
    }
  });
  app.get("/qr.svg", (req, res) => {
    const data = String(req.query.d ?? "");
    if (!data || data.length > 2000) {
      res.sendStatus(400);
      return;
    }
    res.type("image/svg+xml").send(renderToStaticMarkup(createElement(QRCodeSVG, { value: data, size: 240, level: "M" })));
  });
  app.get("/login", (_req, res) => void res.type("html").send(pages.login()));
  app.post("/login", (req, res) => {
    const username = String(req.body.username ?? "").trim().toLowerCase();
    const row = userRow(username);
    const password = String(req.body.password ?? "");
    const ok = row && (row.password_hash ? checkPassword(password, row.password_hash) : false);
    if (!row || !ok) {
      res.status(401).type("html").send(pages.login("That username and password do not match."));
      return;
    }
    startSession(res, "user", username);
    res.redirect("/dashboard");
  });
  app.get("/logout", (req, res) => {
    const token = cookies(req).ql_user;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.setHeader("Set-Cookie", "ql_user=; Path=/; Max-Age=0");
    res.redirect("/");
  });
  app.get("/dashboard", (req, res) => {
    const username = sessionOf(req, "user");
    if (!username) return void res.redirect("/login");
    res.type("html").send(pages.dashboard(username, o.coreWs, userRow(username)!.principal));
  });

  // --- Q-01: sign up with Sammati ---
  app.post("/api/signup", async (req, res) => {
    const username = String(req.body.username ?? "").trim();
    const password = String(req.body.password ?? "");
    if (!USERNAME.test(username)) return void res.status(400).json({ code: "BAD_USERNAME", message: "Use 3 to 24 lowercase letters, numbers or underscores." });
    if (password && password.length < 6) return void res.status(400).json({ code: "BAD_PASSWORD", message: "A password needs at least 6 characters." });
    if (userRow(username)) return void res.status(409).json({ code: "USERNAME_TAKEN", message: "That username is taken. Try another." });
    try {
      const token = `su_${randomBytes(9).toString("hex")}`;
      const list = await loadPurposes();
      const created = await sammati.createRequest(token, list.map((p) => p.code));
      db.prepare("INSERT INTO signups (token, username, password_hash, request_id, created_at) VALUES (?, ?, ?, ?, ?)").run(token, username, password ? hashPassword(password) : null, created.requestId, now());
      res.json({ token, requestId: created.requestId, qrPayload: created.qrPayload, fiduciary: o.fiduciary });
    } catch (e) {
      res.status(502).json({ code: "SAMMATI_UNAVAILABLE", message: e instanceof SammatiError ? e.message : "Sammati could not be reached. Try again." });
    }
  });

  /** The company's own table: has the customer behind this signup token consented to everything required? */
  app.get("/api/signup/:token", async (req, res) => {
    const signup = db.prepare("SELECT token, username, password_hash FROM signups WHERE token = ?").get(req.params.token) as { token: string; username: string; password_hash: string | null } | undefined;
    if (!signup) return void res.status(404).json({ code: "UNKNOWN_SIGNUP", message: "This sign-up has expired." });
    try {
      const [rows, list] = await Promise.all([sammati.consentRows(), loadPurposes()]);
      const mine = rows.filter((r) => r.customerAlias === signup.token);
      const principal = mine[0]?.principal;
      const active = (code: string) => mine.some((r) => r.purposeCode === code && r.status === "Active" && (r.expiresAt ?? Infinity) > now());
      const needed = list.filter((p) => p.required || p.code === loanPurpose).map((p) => p.code);
      if (!principal || !needed.every(active)) return void res.json({ status: "waiting", message: "" });
      if (userRow(signup.username) || db.prepare("SELECT 1 FROM users WHERE principal = ?").get(principal.toLowerCase())) {
        return void res.status(409).json({ code: "ALREADY_REGISTERED", message: "This Sammati wallet already has a QuickLoan account. Please log in." });
      }
      db.prepare("INSERT INTO users (username, password_hash, principal, created_at) VALUES (?, ?, ?, ?)").run(signup.username, signup.password_hash, principal.toLowerCase(), now());
      db.prepare("DELETE FROM signups WHERE token = ?").run(signup.token);
      startSession(res, "user", signup.username);
      res.json({ status: "ready" });
    } catch (e) {
      res.status(502).json({ code: "SAMMATI_UNAVAILABLE", message: e instanceof SammatiError ? e.message : "Sammati could not be reached." });
    }
  });

  // --- Q-02 / Q-03: dashboard data and applying ---
  const loanState = (rows: ConsentRow[]): "Active" | "Withdrawn" | "expired" | "None" => {
    const r = rows.find((x) => x.purposeCode === loanPurpose);
    if (!r || r.status === "None") return "None";
    if (r.status === "Withdrawn") return "Withdrawn";
    return (r.expiresAt ?? Infinity) > now() ? "Active" : "expired";
  };

  app.get("/api/me", user, async (_req, res) => {
    const row = userRow(res.locals.username as string)!;
    try {
      const [rows, list] = await Promise.all([sammati.consentRows(), loadPurposes()]);
      const mine = rows.filter((r) => r.principal.toLowerCase() === row.principal);
      const held = db.prepare("SELECT status FROM vault WHERE principal = ?").get(row.principal) as { status: string } | undefined;
      const status = loanState(mine);
      res.json({
        username: row.username,
        loanStatus: status,
        hasData: held?.status === "stored",
        canApply: status === "Active" && held?.status === "stored",
        pending: false,
        consents: list.map((p) => {
          const r = mine.find((x) => x.purposeCode === p.code);
          return { code: p.code, title: p.description.en, required: p.required, status: r?.status ?? "None", expiresAt: r?.expiresAt ?? null };
        }),
        applications: db
          .prepare("SELECT amount, tenure_months AS tenureMonths, decision, created_at AS createdAt FROM applications WHERE username = ? ORDER BY created_at DESC")
          .all(row.username),
      });
    } catch {
      res.status(502).json({ code: "SAMMATI_UNAVAILABLE", message: "Sammati could not be reached." });
    }
  });

  app.post("/api/apply", user, async (req, res) => {
    const username = res.locals.username as string;
    const row = userRow(username)!;
    const amount = Number(req.body.amount);
    const tenure = Number(req.body.tenureMonths);
    const purpose = String(req.body.loanPurpose ?? "Other").slice(0, 40);
    if (!Number.isInteger(amount) || amount < 10_000 || amount > 1_000_000 || !Number.isInteger(tenure) || tenure < 6 || tenure > 60) {
      return void res.status(400).json({ code: "BAD_APPLICATION", message: "Choose an amount from ₹10,000 to ₹10,00,000 and 6 to 60 months." });
    }
    // Fail closed: consent is read from Sammati now, not remembered.
    let state: ReturnType<typeof loanState>;
    try {
      state = loanState((await sammati.consentRows()).filter((r) => r.principal.toLowerCase() === row.principal));
    } catch {
      return void res.status(503).json({ code: "LEDGER_UNAVAILABLE", message: "We cannot check your consent right now, so we cannot process your application." });
    }
    if (state !== "Active") return void res.status(451).json({ code: state === "expired" ? "CONSENT_EXPIRED" : "CONSENT_WITHDRAWN", message: "Consent withdrawn. We can no longer process your application." });
    const held = db.prepare("SELECT handle, status FROM vault WHERE principal = ?").get(row.principal) as { handle: string; status: string } | undefined;
    if (!held || held.status !== "stored") return void res.status(409).json({ code: "NO_DETAILS", message: "Send your details from the Sammati app first." });

    let outcome;
    try {
      outcome = await sammati.evaluate(held.handle, loanPurpose);
    } catch (e) {
      if (e instanceof SammatiError && e.status === 451) return void res.status(451).json({ code: e.code, message: "Consent withdrawn. We can no longer process your application." });
      return void res.status(502).json({ code: "DECISION_UNAVAILABLE", message: "We could not reach the decision service. Please try again." });
    }
    const reasons = [...outcome.reasonCodes];
    let limit = outcome.limit;
    if (outcome.decision === "approved" && limit !== null && amount > limit) reasons.push("AMOUNT_ABOVE_LIMIT");
    const rate = outcome.decision === "approved" ? rateBp(reasons) : null;
    const id = randomUUID();
    db.prepare("INSERT INTO applications (id, username, amount, tenure_months, loan_purpose, decision, limit_amount, rate_bp, reasons, status, handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, username, amount, tenure, purpose, outcome.decision, limit, rate, JSON.stringify(reasons), outcome.decision === "approved" ? "Offer made" : "Closed", held.handle, now(),
    );
    limit = outcome.decision === "approved" ? limit : null;
    res.json({ decision: outcome.decision, limit, rate: rate === null ? null : rate / 100, reasons });
  });

  // --- the Processor's webhook: a handle and a hash, never the details ---
  app.post("/vault/events", (req, res) => {
    if (req.header("x-sammati-api-key") !== o.apiKey) return void res.sendStatus(401);
    const e = req.body as Record<string, unknown>;
    if ((e?.event !== "stored" && e?.event !== "erased") || typeof e.principal !== "string" || !ADDRESS.test(e.principal) || typeof e.handle !== "string" || !BYTES32.test(e.handle) || typeof e.ciphertextHash !== "string" || !BYTES32.test(e.ciphertextHash) || e.purposeCode !== loanPurpose) {
      return void res.sendStatus(400);
    }
    const principal = e.principal.toLowerCase();
    if (e.event === "stored") {
      db.prepare("INSERT INTO vault (principal, handle, ciphertext_hash, status) VALUES (?, ?, ?, 'stored') ON CONFLICT(principal) DO UPDATE SET handle = excluded.handle, ciphertext_hash = excluded.ciphertext_hash, status = 'stored'").run(principal, e.handle, e.ciphertextHash);
    } else {
      db.prepare("UPDATE vault SET status = 'erased' WHERE principal = ? AND handle = ?").run(principal, e.handle);
      // Decisions already made stay on file; the details behind them are gone.
      db.prepare("UPDATE applications SET status = 'Details erased' WHERE handle = ?").run(e.handle);
    }
    res.status(202).json({ ok: true });
  });
  app.get("/health", (_req, res) => void res.json({ ok: true }));

  // --- the web's customer portal (trd.md §6.14): the company's key stays here, the browser never holds it ---
  app.use(["/portal", "/customers"], cors(o.portalOrigins ?? [], { headers: "content-type,x-sammati-principal", methods: "GET,POST,OPTIONS" }));

  app.post("/portal/requests", async (req, res) => {
    const alias = typeof req.body.customerAlias === "string" ? req.body.customerAlias.trim() : "";
    const purposes: unknown = req.body.purposes;
    if (!alias || alias.length > 40 || !Array.isArray(purposes) || purposes.length === 0 || purposes.length > 20 || !purposes.every((p) => typeof p === "string")) {
      return void res.status(400).json({ error: { code: "BAD_REQUEST", message: "Send a customer id and the purposes to ask for." } });
    }
    try {
      res.status(201).json(await sammati.createRequest(alias, purposes as string[]));
    } catch (e) {
      res.status(502).json({ error: { code: "SAMMATI_UNAVAILABLE", message: e instanceof SammatiError ? e.message : "Sammati could not be reached." } });
    }
  });

  /** One customer's own rows, never the company's customer list: both the typed id and the customer's address are needed. */
  app.get("/portal/consents", async (req, res) => {
    const alias = typeof req.query.alias === "string" ? req.query.alias : "";
    const principal = typeof req.query.principal === "string" ? req.query.principal.toLowerCase() : "";
    if (!alias || alias.length > 40 || !ADDRESS.test(principal)) return void res.status(400).json({ error: { code: "BAD_REQUEST", message: "Send the customer id and address as ?alias=&principal=." } });
    try {
      const rows = (await sammati.consentRows()).filter((r) => r.customerAlias === alias && r.principal.toLowerCase() === principal).map(({ principal, customerAlias, purposeCode, status, expiresAt }) => ({ principal, customerAlias, purposeCode, status, expiresAt }));
      res.json({ rows });
    } catch {
      res.status(503).json({ error: { code: "LEDGER_UNAVAILABLE", message: "Sammati could not be reached." } });
    }
  });

  app.post("/customers/:alias/apply", async (req, res) => {
    const principal = String(req.header("x-sammati-principal") ?? "").toLowerCase();
    if (!ADDRESS.test(principal)) return void res.status(451).json({ code: "NO_PRINCIPAL", message: "The request did not identify a data principal." });
    const held = db.prepare("SELECT handle, status FROM vault WHERE principal = ?").get(principal) as { handle: string; status: string } | undefined;
    if (!held || held.status !== "stored") return void res.status(409).json({ error: { code: "NO_SUBMISSION", message: "This customer has not sent their details yet" } });
    const { amount, tenureMonths } = (req.body ?? {}) as { amount?: number; tenureMonths?: number };
    try {
      // The Processor re-reads consent from the chain and refuses (451) a withdrawn or missing one.
      res.json(await sammati.evaluate(held.handle, loanPurpose, amount === undefined && tenureMonths === undefined ? undefined : { amount, tenureMonths }));
    } catch (e) {
      if (e instanceof SammatiError && e.status === 451) return void res.status(451).json({ code: e.code, message: e.message });
      res.status(502).json({ error: { code: "PROCESSOR_UNREACHABLE", message: "The decision service did not answer" } });
    }
  });

  // --- Q-04: back-office ---
  const staffOnly = (req: Request, res: Response, next: NextFunction): void => {
    if (!o.staff) return void res.status(404).send("Back-office is not configured.");
    if (!sessionOf(req, "staff")) return void res.redirect("/staff/login");
    next();
  };
  app.get("/staff/login", (_req, res) => void res.type("html").send(pages.staffLogin()));
  app.post("/staff/login", (req, res) => {
    const ok = o.staff && String(req.body.user) === o.staff.user && String(req.body.password) === o.staff.password;
    if (!ok) return void res.status(401).type("html").send(pages.staffLogin("Those details do not match."));
    startSession(res, "staff", o.staff!.user);
    res.redirect("/staff");
  });
  const appsOf = (where = "", ...args: string[]): pages.StaffApplication[] =>
    (db.prepare(`SELECT id, username, amount, tenure_months AS tenureMonths, decision, status, created_at AS createdAt FROM applications ${where} ORDER BY created_at DESC`).all(...args) as pages.StaffApplication[]);
  app.get("/staff", staffOnly, (_req, res) => void res.type("html").send(pages.staffHome(appsOf())));
  app.get("/staff/rights", staffOnly, (_req, res) => void res.type("html").send(pages.staffRights()));
  app.get("/staff/customers/:username", staffOnly, async (req, res) => {
    const row = userRow(String(req.params.username));
    if (!row) return void res.sendStatus(404);
    const held = db.prepare("SELECT handle, ciphertext_hash AS hash, status FROM vault WHERE principal = ?").get(row.principal) as { handle: string; hash: string; status: string } | undefined;
    let consents: Array<{ title: string; status: string }> = [];
    try {
      const [rows, list] = await Promise.all([sammati.consentRows(), loadPurposes()]);
      consents = list.map((p) => ({ title: p.description.en, status: rows.find((r) => r.principal.toLowerCase() === row.principal && r.purposeCode === p.code)?.status ?? "None" }));
    } catch {
      consents = [{ title: "Consent status", status: "unavailable right now" }];
    }
    res.type("html").send(pages.staffCustomer(row.username, { handle: held?.handle ?? null, hash: held?.hash ?? null, status: held?.status ?? "none" }, consents, appsOf("WHERE username = ?", row.username)));
  });

  return app;
}
