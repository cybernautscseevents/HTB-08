import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_FIDUCIARIES, purposeIdOf, type ConsentUpdatedEvent } from "@sammati/shared";
import { AppRoutes } from "./App";

// The console talks to two kinds of Core (the stub and the real one) and to the company backends directly.
// These tests pin what it must and must not do with each, with every HTTP answer scripted.

const hoisted = vi.hoisted(() => ({ consentListener: null as ((e: ConsentUpdatedEvent) => void) | null }));
vi.mock("./ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ws")>();
  return {
    ...actual,
    // lets a test deliver a consent.updated event, as Core's WebSocket would
    useConsentUpdated: (cb: (e: ConsentUpdatedEvent) => void) => {
      hoisted.consentListener = cb;
    },
  };
});

const QUICKLOAN = SEED_FIDUCIARIES[0]!;
const FAKE_TX = "0x4f2a7819cde4791b0198de76ab4102ef19459be1"; // what the old console invented when a grant failed
const COMPANY_URL = `http://localhost:${QUICKLOAN.port}`;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
let calls: { url: string; method: string }[] = [];

/** Answers by URL substring (first match wins); anything unlisted is a 404 so a stray call is visible. */
function mockHttp(mode: "stub" | "live", routes: [string, Route][] = []): void {
  const purposes = QUICKLOAN.purposes.map((p) => ({
    id: purposeIdOf(QUICKLOAN.address, p.code),
    code: p.code,
    title: p.title,
    description: p.description,
    dataCategories: p.dataCategories,
    retentionDays: p.retentionDays,
    sharesThirdParty: p.sharesThirdParty,
    required: p.required,
  }));
  const all: [string, Route][] = [
    ...routes,
    ["/v1/health", () => json(200, { ok: true, service: "sammati-core", mode, time: 1 })],
    [`/v1/fiduciaries/${QUICKLOAN.address}/purposes`, () => json(200, { fiduciary: QUICKLOAN.address, purposes })],
  ];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      for (const [needle, route] of all) if (url.includes(needle)) return route(url, init);
      return json(404, { error: { code: "NOT_FOUND", message: `unscripted: ${url}` } });
    }),
  );
}

const MockWs = vi.fn().mockImplementation(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 0,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
}));

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWs);
  hoisted.consentListener = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(section: "purposes" | "new-request" | "live-requests") {
  render(
    <MemoryRouter initialEntries={["/company/quickloan"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  fireEvent.click(document.getElementById(`rail-${section}`)!);
}

describe("registering purposes from the console", () => {
  it("is offered on the stub", async () => {
    mockHttp("stub");
    open("purposes");
    expect(await screen.findByRole("button", { name: /Add purpose/i })).toBeTruthy();
  });

  it("is not offered on the real Core, where it would answer 501, and says why", async () => {
    mockHttp("live");
    open("purposes");
    expect(await screen.findByText(/Registered on chain by the seed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add purpose/i })).toBeNull();
  });

  it("is not offered until the mode is known (a click must not reach the wrong Core)", async () => {
    mockHttp("stub", [["/v1/health", () => new Promise<Response>(() => {})]]); // never answers
    open("purposes");
    await screen.findByRole("heading", { level: 2, name: /Purposes Registry/i });
    expect(screen.queryByRole("button", { name: /Add purpose/i })).toBeNull();
  });
});

describe("the new-request QR panel", () => {
  async function waitingForScan(mode: "stub" | "live", routes: [string, Route][] = []) {
    mockHttp(mode, [
      [
        `/v1/fiduciaries/${QUICKLOAN.address}/requests`,
        () => json(201, { requestId: "req_test", qrPayload: { v: 1, core: "http://x", requestId: "req_test", fiduciary: QUICKLOAN.address, name: "QuickLoan" } }),
      ],
      ...routes,
    ]);
    open("new-request");
    fireEvent.click(await screen.findByRole("button", { name: /Generate consent QR/i }));
    await screen.findByText(/Waiting for scan/);
  }

  it("has no simulate button on the real Core", async () => {
    await waitingForScan("live");
    await screen.findByText(/Waiting for scan/);
    expect(screen.queryByRole("button", { name: /without the wallet/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Simulate/i })).toBeNull();
  });

  it("on the stub, a refused grant shows Core's refusal, never a made-up success or transaction", async () => {
    await waitingForScan("stub", [
      ["/v1/requests/req_test", () => json(200, { purposes: [{ id: purposeIdOf(QUICKLOAN.address, "credit_check") }], noticeHash: "0x" + "ab".repeat(32), nonce: "0" })],
      ["/v1/consents/grant", () => json(400, { error: { code: "BAD_SIGNATURE", message: "Signature could not be parsed" } })],
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /without the wallet/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("BAD_SIGNATURE");
    expect(screen.queryByText(/Consent received/i)).toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_TX);
    expect(calls.filter((c) => c.url.includes("/v1/consents/grant"))).toHaveLength(1); // one honest attempt, no fallback
  });

  it("on the stub, an unreachable Core is reported, not turned into success", async () => {
    await waitingForScan("stub", [["/v1/requests/req_test", () => Promise.reject(new TypeError("Failed to fetch"))]]);
    fireEvent.click(await screen.findByRole("button", { name: /without the wallet/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach Core/);
    expect(screen.queryByText(/Consent received/i)).toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_TX);
  });

  it("shows 'Consent received' only for a grant, not for a withdrawal event", async () => {
    await waitingForScan("live");
    const event = (status: "Active" | "Withdrawn"): ConsentUpdatedEvent => ({
      event: "consent.updated",
      principal: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      fiduciary: QUICKLOAN.address,
      purposeId: purposeIdOf(QUICKLOAN.address, "marketing"),
      purposeCode: "marketing",
      status,
      expiresAt: 9_999_999_999,
      txHash: "0x" + "cd".repeat(32),
      at: 1_700_000_000,
    });

    hoisted.consentListener!(event("Withdrawn"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/Consent received/i)).toBeNull();
    expect(screen.getByText(/Waiting for scan/)).toBeTruthy();

    hoisted.consentListener!(event("Active"));
    expect(await screen.findByText(/Consent received/i)).toBeTruthy();
  });
});

describe("the simulator buttons", () => {
  const run = async (routes: [string, Route][]) => {
    mockHttp("live", routes);
    open("live-requests");
    fireEvent.click(await screen.findByRole("button", { name: /Run credit check/i }));
  };
  const companyCalls = () => calls.filter((c) => c.url.startsWith(COMPANY_URL));
  const coreFireCalls = () => calls.filter((c) => c.url.includes("/v1/demo/fire"));

  it("shows ALLOWED from the company's own 200, without involving Core", async () => {
    await run([[COMPANY_URL, () => json(200, { score: 742 })]]);
    expect(await screen.findByText("ALLOWED")).toBeTruthy();
    expect(screen.getByText(/HTTP 200 OK/)).toBeTruthy();
    expect(coreFireCalls()).toHaveLength(0);
  });

  it("shows BLOCKED with its reason from the company's own 451", async () => {
    await run([[COMPANY_URL, () => json(451, { code: "CONSENT_WITHDRAWN", message: "withdrawn" })]]);
    expect(await screen.findByText("BLOCKED")).toBeTruthy();
    expect(screen.getByText(/HTTP 451.*CONSENT_WITHDRAWN/)).toBeTruthy();
    expect(coreFireCalls()).toHaveLength(0);
  });

  it.each([
    ["a crashed app that answers 500", () => json(500, { error: "boom" }), /HTTP 500/],
    ["a 502 from something in front of it", () => json(502, {}), /HTTP 502/],
    ["a 451 with no reason code", () => json(451, { message: "no code" }), /without a reason code/],
    ["a 451 with an invented reason code", () => json(451, { code: "BECAUSE" }), /without a reason code/],
    ["a 404 (the route is gone)", () => json(404, {}), /HTTP 404/],
  ] as [string, Route, RegExp][])("shows %s as an error, and does not fall back to Core", async (_label, answer, message) => {
    await run([[COMPANY_URL, answer]]);
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(screen.queryByText("ALLOWED")).toBeNull();
    expect(screen.queryByText("BLOCKED")).toBeNull();
    expect(coreFireCalls()).toHaveLength(0); // the whole point: a broken company app stays visible
    expect(companyCalls()).toHaveLength(1);
  });

  it("falls back to Core only when the company cannot be reached at all, and says so", async () => {
    await run([
      [COMPANY_URL, () => Promise.reject(new TypeError("Failed to fetch"))],
      ["/v1/demo/fire", () => json(200, { decision: "BLOCKED", reason: "CONSENT_WITHDRAWN", entryId: "e1" })],
    ]);
    expect(await screen.findByText("BLOCKED")).toBeTruthy();
    expect(screen.getByText(/Core made the request/)).toBeTruthy();
    expect(coreFireCalls()).toHaveLength(1);
  });

  it("shows an error when the company is unreachable and Core's fallback fails too (real Core: COMPANY_UNREACHABLE)", async () => {
    await run([
      [COMPANY_URL, () => Promise.reject(new TypeError("Failed to fetch"))],
      ["/v1/demo/fire", () => json(502, { error: { code: "COMPANY_UNREACHABLE", message: "QuickLoan's backend did not answer; is it running?" } })],
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not reachable/);
    expect(alert.textContent).toMatch(/is it running/);
    expect(screen.queryByText("ALLOWED")).toBeNull();
    expect(screen.queryByText("BLOCKED")).toBeNull();
  });

  it("clears an earlier error when the next request succeeds", async () => {
    let answer: Response = json(500, {});
    mockHttp("live", [[COMPANY_URL, () => answer.clone()]]);
    open("live-requests");
    const button = await screen.findByRole("button", { name: /Run credit check/i });
    fireEvent.click(button);
    await screen.findByRole("alert");

    answer = json(200, { score: 1 });
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("ALLOWED")).toBeTruthy();
  });
});
