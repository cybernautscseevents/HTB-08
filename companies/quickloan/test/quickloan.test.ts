// QuickLoan against scripted stand-ins for Sammati's Core and Processor: the sign-up, the login, the application, the
// withdrawal, and the rule that nothing it stores or serves ever contains a name, PAN, income, phone or email.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { openDb } from "../src/db";
import { Sammati } from "../src/sammati";

// What the customer holds in the wallet. QuickLoan is never given these.
const KNOWN = ["Asha Rao", "ABCDE1234F", "6-9 LPA", "9876543210", "asha.rao@example.test"];
const FID = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KEY = "sk_test_quickloan";
const PRINCIPAL = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const HANDLE = "0x" + "ab".repeat(32);
const HASH = "0x" + "cd".repeat(32);

const purposes = [
  { id: "0x01", code: "credit_check", title: { en: "Credit check" }, description: { en: "Check your credit eligibility" }, dataCategories: ["financial.pan"], retentionDays: 365, sharesThirdParty: false, required: true },
  { id: "0x02", code: "marketing", title: { en: "Offers" }, description: { en: "Send you loan offers" }, dataCategories: ["contact.mobile"], retentionDays: 180, sharesThirdParty: true, required: false },
];

let rows: Array<Record<string, unknown>> = [];
const seen: string[] = []; // every body QuickLoan served
let dir: string;
let base: string;
const servers: Array<import("node:http").Server> = [];

async function listen(app: express.Express): Promise<string> {
  const server = await new Promise<import("node:http").Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "quickloan-"));
  const core = express();
  core.use(express.json());
  core.get(`/v1/fiduciaries/${FID}/purposes`, (_q, r) => void r.json({ fiduciary: FID, purposes }));
  core.get(`/v1/fiduciaries/${FID}/consents`, (_q, r) => void r.json({ fiduciary: FID, rows }));
  core.post(`/v1/fiduciaries/${FID}/requests`, (_q, r) => void r.status(201).json({ requestId: "req_abc12345", qrPayload: JSON.stringify({ v: 1, requestId: "req_abc12345" }) }));
  const processor = express();
  processor.use(express.json());
  processor.post("/v1/processor/evaluate", (q, r) => {
    const out = q.body.handle === HANDLE ? { decision: "approved", limit: 300000, reasonCodes: ["SCORE_FAIR"] } : { code: "NO_CONSENT", message: "no" };
    r.status(q.body.handle === HANDLE ? 200 : 451).json(out);
  });
  processor.post("/v1/processor/callback", (_q, r) => void r.sendStatus(204));
  const coreUrl = await listen(core);
  const processorUrl = await listen(processor);
  const app = createApp({
    db: openDb(join(dir, "quickloan.sqlite")),
    sammati: new Sammati({ coreUrl, processorUrl, fiduciary: FID, apiKey: KEY }),
    loanPurpose: "credit_check",
    coreWs: "ws://core.test/ws",
    staff: { user: "staff", password: "staff-pass" },
    fiduciary: FID,
    apiKey: KEY,
    portalOrigins: ["https://web.test"],
  });
  // record everything QuickLoan sends, for the search at the end
  const wrapped = express();
  wrapped.use((_q, res, next) => {
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    res.write = ((c: unknown, ...a: unknown[]) => {
      seen.push(String(c));
      return write(c as never, ...(a as []));
    }) as unknown as typeof res.write;
    res.end = ((c?: unknown, ...a: unknown[]) => {
      if (c) seen.push(String(c));
      return end(c as never, ...(a as []));
    }) as unknown as typeof res.end;
    next();
  });
  wrapped.use(app);
  base = await listen(wrapped);
});
afterAll(() => {
  for (const s of servers) s.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows keeps the SQLite file open a moment longer; it is a temp directory
  }
});

const post = (path: string, body: unknown, cookie = "") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
let cookie = "";
let token = "";

describe("Q-01 sign up", () => {
  it("the landing page has the calculator, FAQs and a grievance officer, and the sign-up form asks for a username only", async () => {
    const landing = await (await fetch(base + "/")).text();
    expect(landing).toContain("EMI calculator");
    expect(landing).toContain("Grievance Officer");
    expect(landing).not.toMatch(/demo|simulat|fake/i);
    const form = await (await fetch(base + "/signup")).text();
    expect(form).toContain('name="username"');
    expect(form).toContain("Use my Sammati details for loan processing");
    expect(form).toMatch(/type="checkbox"(?![^>]*checked)/); // unticked
    for (const field of ["name=\"name\"", "pan", "income", "phone", "email"]) expect(form.toLowerCase()).not.toContain(`name=${field.replace(/name=/, "")}`);
    expect(form).toContain("Needed for your account");
    expect(form).toContain("Optional");
  });

  it("refuses a bad username, and creates a consent request for a good one", async () => {
    expect((await post("/api/signup", { username: "Asha Rao" })).status).toBe(400);
    const res = await post("/api/signup", { username: "asha", password: "secret1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; qrPayload: string };
    token = body.token;
    expect(body.qrPayload).toContain("req_abc12345");
    expect((await (await fetch(`${base}/qr.svg?d=${encodeURIComponent(body.qrPayload)}`)).text()).startsWith("<svg")).toBe(true);
  });
});

describe("Q-02 login after consent", () => {
  it("waits until the required purpose is active, then logs in as the username", async () => {
    expect(await (await fetch(`${base}/api/signup/${token}`)).json()).toMatchObject({ status: "waiting" });
    rows = [{ principal: PRINCIPAL, customerAlias: token, purposeCode: "credit_check", status: "Active", expiresAt: Math.floor(Date.now() / 1000) + 86_400 }];
    const res = await fetch(`${base}/api/signup/${token}`);
    expect(await res.json()).toEqual({ status: "ready" });
    cookie = cookieOf(res);
    const page = await (await fetch(base + "/dashboard", { headers: { cookie } })).text();
    expect(page).toContain("Hello, asha");
  });

  it("shows live consent status per purpose", async () => {
    const me = (await (await fetch(base + "/api/me", { headers: { cookie } })).json()) as { consents: Array<{ code: string; status: string }>; canApply: boolean };
    expect(me.consents.map((c) => [c.code, c.status])).toEqual([["credit_check", "Active"], ["marketing", "None"]]);
    expect(me.canApply).toBe(false); // no details stored yet
  });

  it("a returning user logs in with the password", async () => {
    expect((await post("/login", { username: "asha", password: "wrong" })).status).toBe(401);
    const ok = await post("/login", { username: "asha", password: "secret1" });
    expect(ok.status).toBe(302);
    expect(cookieOf(ok)).toContain("ql_user=");
  });
});

describe("Q-03 applying", () => {
  it("refuses until the details are stored, then returns a decision with no personal data", async () => {
    expect((await post("/api/apply", { amount: 150000, tenureMonths: 24, loanPurpose: "Travel" }, cookie)).status).toBe(409);
    const hook = await post("/vault/events", { event: "stored", principal: PRINCIPAL, purposeCode: "credit_check", handle: HANDLE, ciphertextHash: HASH });
    expect(hook.status).toBe(401); // the webhook needs the company's key
    const authed = await fetch(base + "/vault/events", { method: "POST", headers: { "content-type": "application/json", "x-sammati-api-key": KEY }, body: JSON.stringify({ event: "stored", principal: PRINCIPAL, purposeCode: "credit_check", handle: HANDLE, ciphertextHash: HASH }) });
    expect(authed.status).toBe(202);
    const res = await post("/api/apply", { amount: 150000, tenureMonths: 24, loanPurpose: "Travel" }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision: "approved", limit: 300000, rate: 13, reasons: ["SCORE_FAIR"] });
  });

  it("withdrawal disables Apply at once, keeps the stored decision and marks the details erased", async () => {
    rows = [{ principal: PRINCIPAL, customerAlias: token, purposeCode: "credit_check", status: "Withdrawn", expiresAt: 1 }];
    const blocked = await post("/api/apply", { amount: 150000, tenureMonths: 24, loanPurpose: "Travel" }, cookie);
    expect(blocked.status).toBe(451);
    expect(((await blocked.json()) as { message: string }).message).toBe("Consent withdrawn. We can no longer process your application.");
    const me = (await (await fetch(base + "/api/me", { headers: { cookie } })).json()) as { canApply: boolean; applications: unknown[] };
    expect(me.canApply).toBe(false);
    expect(me.applications).toHaveLength(1);
    await fetch(base + "/vault/events", { method: "POST", headers: { "content-type": "application/json", "x-sammati-api-key": KEY }, body: JSON.stringify({ event: "erased", principal: PRINCIPAL, purposeCode: "credit_check", handle: HANDLE, ciphertextHash: HASH }) });
  });
});

describe("Q-04 back-office", () => {
  it("needs a staff login, lists applications and shows only protected-details metadata", async () => {
    expect((await fetch(base + "/staff", { redirect: "manual" })).status).toBe(302);
    expect((await post("/staff/login", { user: "staff", password: "nope" })).status).toBe(401);
    const login = await post("/staff/login", { user: "staff", password: "staff-pass" });
    const staff = cookieOf(login);
    const home = await (await fetch(base + "/staff", { headers: { cookie: staff } })).text();
    expect(home).toContain("asha");
    const detail = await (await fetch(base + "/staff/customers/asha", { headers: { cookie: staff } })).text();
    expect(detail).toContain("Personal details: protected by Sammati");
    expect(detail).toContain(HANDLE);
    expect(detail).toContain(HASH);
    expect(await (await fetch(base + "/staff/rights", { headers: { cookie: staff } })).text()).toContain("Erasure acknowledgements");
  });
});

describe("what QuickLoan holds and serves", () => {
  it("never contains a name, PAN, income, mobile or email", () => {
    const files = readdirSync(dir).map((f) => readFileSync(join(dir, f), "latin1"));
    const everything = [...seen, ...files].join("\n");
    expect(everything.length).toBeGreaterThan(5000); // the search covered real traffic and the database
    expect(everything).toContain(HANDLE); // control: the search sees what is there
    for (const value of KNOWN) expect(everything, value).not.toContain(value);
  });
});

describe("hosting (trd.md §10.3, §10.6)", () => {
  it("/healthz answers ok at once, with the security headers", async () => {
    const res = await fetch(base + "/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("the portal API for the web (trd.md §6.14)", () => {
  const ORIGIN = "https://web.test";
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });

  it("creates a consent request for a customer id with the company's key, for the listed origin only", async () => {
    const ok = await call("POST", "/portal/requests", { purposes: ["credit_check"], customerAlias: "asha01" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ requestId: "req_abc12345" });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const stranger = await fetch(base + "/portal/requests", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ purposes: ["credit_check"], customerAlias: "x" }) });
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("POST", "/portal/requests", { purposes: [], customerAlias: "asha01" })).status).toBe(400);
  });

  it("returns only the asked-for customer's rows, needing both the id and the address, never the whole list", async () => {
    rows = [
      { principal: PRINCIPAL, customerAlias: "asha01", purposeCode: "credit_check", status: "Active", expiresAt: 4_000_000_000 },
      { principal: "0x" + "12".repeat(20), customerAlias: "someone_else", purposeCode: "credit_check", status: "Active", expiresAt: 4_000_000_000 },
    ];
    // Core gives every customer of a purpose the latest typed id, so the id alone must not be enough.
    rows = rows.map((r) => ({ ...r, customerAlias: "asha01" }));
    const res = await call("GET", `/portal/consents?alias=asha01&principal=${PRINCIPAL}`);
    const body = (await res.json()) as { rows: Array<{ principal: string }> };
    expect(body.rows.map((r) => r.principal.toLowerCase())).toEqual([PRINCIPAL.toLowerCase()]);
    expect((await call("GET", "/portal/consents?alias=asha01")).status).toBe(400);
    expect((await call("GET", "/portal/consents")).status).toBe(400);
  });

  it("applies for the customer behind the principal header: a decision from the Processor, 409 before details are sent, 451 without a principal", async () => {
    expect((await call("POST", "/customers/asha01/apply", {})).status).toBe(451);
    expect((await call("POST", "/customers/asha01/apply", {}, { "x-sammati-principal": PRINCIPAL })).status).toBe(409);
    openDb(join(dir, "quickloan.sqlite")).prepare("INSERT OR REPLACE INTO vault (principal, handle, ciphertext_hash, status) VALUES (?, ?, ?, 'stored')").run(PRINCIPAL.toLowerCase(), HANDLE, HASH);
    const ok = await call("POST", "/customers/asha01/apply", { amount: 200000, tenureMonths: 24 }, { "x-sammati-principal": PRINCIPAL });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ decision: "approved", limit: 300000, reasonCodes: ["SCORE_FAIR"] });
  });
});
