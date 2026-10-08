import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";

// WsProvider opens a WebSocket which is not available in jsdom. Stub it so
// tests don't throw, while still exercising routing and rendering.
const MockWs = vi.fn().mockImplementation(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  readyState: 0, // CONNECTING
  CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
}));

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWs);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, mode: "stub" }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("routes", () => {
  it.each([
    ["/company/quickloan", "QuickLoan"],
    ["/company/medicare", "MediCare+"],
    ["/company/foodrush", "FoodRush"],
  ])("%s shows the company", (path, name) => {
    at(path);
    expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
  });

  it("/auditor loads", () => {
    at("/auditor");
    expect(screen.getByRole("heading", { level: 1, name: "Auditor" })).toBeTruthy();
  });

  it("/stage loads", () => {
    at("/stage");
    expect(screen.getByText("Citizen")).toBeTruthy();
  });

  it("unknown company and unknown paths fall back to QuickLoan", () => {
    at("/company/nope");
    expect(screen.getByRole("heading", { level: 1, name: "QuickLoan" })).toBeTruthy();
  });

  it("renders Company overview with stat cards and live feed", () => {
    at("/company/quickloan");
    expect(screen.getByText("Active consents")).toBeTruthy();
    expect(screen.getByText("Allowed today")).toBeTruthy();
    expect(screen.getByText("Blocked today")).toBeTruthy();
    expect(screen.getByText("Last anchor")).toBeTruthy();
    expect(screen.getByText("Live request feed")).toBeTruthy();
  });

  it("switches between console rail sections (purposes, new request, live requests, consents)", async () => {
    at("/company/quickloan");
    const { fireEvent } = await import("@testing-library/react");

    // Click Purposes
    fireEvent.click(document.getElementById("rail-purposes")!);
    expect(screen.getByRole("heading", { level: 2, name: /Purposes Registry/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Add purpose/i })).toBeTruthy(); // offered once Core says it is the stub

    // Click New request
    fireEvent.click(document.getElementById("rail-new-request")!);
    expect(screen.getByRole("heading", { level: 2, name: /New Consent Request/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate consent QR/i })).toBeTruthy();

    // Click Live requests
    fireEvent.click(document.getElementById("rail-live-requests")!);
    expect(screen.getByRole("heading", { level: 2, name: /Live Requests & Simulator/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run credit check/i })).toBeTruthy();

    // Click Consents
    fireEvent.click(document.getElementById("rail-consents")!);
    expect(screen.getByRole("heading", { level: 2, name: /Customer Consents/i })).toBeTruthy();
  });

  it("renders /auditor with scorecards and switches to ledger explorer", async () => {
    at("/auditor");
    const { fireEvent } = await import("@testing-library/react");

    expect(screen.getByRole("heading", { level: 1, name: "Auditor" })).toBeTruthy();
    expect(screen.getByText("Regulator Board")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scorecards (A-01)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ledger Explorer (A-02)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tamper demo/i })).toBeTruthy();

    // Switch to Ledger Explorer tab
    fireEvent.click(screen.getByRole("button", { name: "Ledger Explorer (A-02)" }));
    expect(screen.getByRole("heading", { level: 2, name: /Immutable Ledger Explorer/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search tx hash, principal, or ledger head/i)).toBeTruthy();
  });
});
