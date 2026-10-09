/**
 * A company's customer portal state machine (trd.md §6.10, ui.md §3.1).
 *
 * Pure TypeScript with injected I/O: the page drives it with the browser's fetch and the live WebSocket, and
 * `pnpm e2e` drives the very same code with real answers and a headless wallet, so what is tested is what runs.
 *
 * It never sees a sensitive field. Nothing here asks for one, stores one or shows one; and every frame it receives
 * is searched for profile values, so a leak would stop the journey instead of reaching the screen.
 */

import { scanForPlaintext } from "./privacy";

/** The company the page speaks for, read from Core's directory (trd.md §6.10). */
export interface PortalCompany {
  address: string;
  name: string;
  /** The purpose the main checkbox asks for (`credit_check` by default). */
  loanPurpose: string;
  /** Every other purpose of the company; each starts unticked (ui.md §3.1). */
  optionalPurposes: readonly string[];
}

const PAN_SHAPE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const MAX_ALIAS = 40;

export type Stage = "logged-out" | "home" | "form" | "awaiting-scan" | "consent-received" | "data-submitted" | "decided" | "withdrawn" | "error";

export interface Decision {
  decision: "approved" | "declined";
  limit: number | null;
  reasonCodes: string[];
}

export interface JourneyState {
  stage: Stage;
  alias: string | null;
  /** Optional purposes the customer has ticked (locked once the QR exists). */
  optional: string[];
  request: { id: string; qrPayload: string; createdAtMs: number } | null;
  principal: string | null;
  txHash: string | null;
  vault: { handle: string; ciphertextHash: string } | null;
  /** The Processor erased the details (after a withdrawal). */
  dataErased: boolean;
  decision: Decision | null;
  applying: boolean;
  /** A message that is not a failure: a refused login, a refusal from the company. */
  notice: string | null;
  error: string | null;
  /** Where "Try again" returns to. */
  resumeStage: Stage | null;
}

export const initialJourney: JourneyState = {
  stage: "logged-out",
  alias: null,
  optional: [],
  request: null,
  principal: null,
  txHash: null,
  vault: null,
  dataErased: false,
  decision: null,
  applying: false,
  notice: null,
  error: null,
  resumeStage: null,
};

export interface JourneyDeps {
  company: PortalCompany;
  /** `POST /v1/fiduciaries/:fid/requests`. */
  createRequest(alias: string, purposes: string[]): Promise<{ requestId: string; qrPayload: unknown }>;
  /** `GET /v1/fiduciaries/:fid/consents`: the company's own table, which knows the alias of each customer. */
  /** The rows of this customer (a hosted company backend returns only theirs; Core returns all of the company's). */
  consentRows(alias?: string, principal?: string): Promise<Array<{ principal: string; customerAlias: string | null }>>;
  /** `POST <the company's backend>/customers/<alias>/apply` with the principal in the header. */
  apply(alias: string, principal: string): Promise<{ status: number; body: unknown }>;
  now(): number;
  /** Waits; injected so tests need no real time. */
  wait?(ms: number): Promise<void>;
}

const DATA_STAGES: readonly Stage[] = ["consent-received", "data-submitted", "decided"];
const lc = (s: string): string => s.toLowerCase();

export type AliasCheck = { ok: true; alias: string } | { ok: false; message: string };

/** The login takes a customer name or ID and nothing else; it refuses what is shaped like a PAN. */
export function checkAlias(raw: string, company = "This company"): AliasCheck {
  const alias = raw.trim();
  if (alias === "") return { ok: false, message: "Enter your name or customer ID" };
  if (alias.length > MAX_ALIAS) return { ok: false, message: `Use at most ${MAX_ALIAS} characters` };
  if (PAN_SHAPE.test(alias.replace(/\s+/g, ""))) return { ok: false, message: `That looks like a PAN. ${company} does not need it here.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(alias)) return { ok: false, message: "Use letters and numbers only" };
  return { ok: true, alias };
}

function parseDecision(body: unknown): Decision | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.decision !== "approved" && b.decision !== "declined") return null;
  const limit = b.limit === null ? null : typeof b.limit === "number" && Number.isSafeInteger(b.limit) && b.limit >= 0 ? b.limit : undefined;
  if (limit === undefined || !Array.isArray(b.reasonCodes) || !b.reasonCodes.every((c) => typeof c === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(c))) return null;
  return { decision: b.decision, limit, reasonCodes: b.reasonCodes as string[] };
}

export class Journey {
  private current: JourneyState = initialJourney;
  private readonly listeners = new Set<(s: JourneyState) => void>();
  /** A vault.stored that arrived before we knew who the customer was. */
  private earlyVault = new Map<string, { handle: string; ciphertextHash: string }>();
  private halted = false;
  private epoch = 0;

  constructor(private readonly deps: JourneyDeps) {}

  private get loan(): string {
    return this.deps.company.loanPurpose;
  }

  get state(): JourneyState {
    return this.current;
  }

  subscribe(listener: (s: JourneyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<JourneyState>): void {
    this.current = { ...this.current, ...patch };
    for (const l of this.listeners) l(this.current);
  }

  private fail(message: string): void {
    this.set({ stage: "error", error: message, applying: false, resumeStage: this.current.stage === "error" ? this.current.resumeStage : this.current.stage });
  }

  // --- what the customer does ---

  login(rawAlias: string): boolean {
    if (this.current.stage !== "logged-out") return false;
    const checked = checkAlias(rawAlias, this.deps.company.name);
    if (!checked.ok) {
      this.set({ notice: checked.message });
      return false;
    }
    this.set({ ...initialJourney, stage: "home", alias: checked.alias });
    return true;
  }

  startApplication(): void {
    if (this.current.stage !== "home") return;
    this.set({ stage: "form" });
  }

  signOut(): void {
    this.epoch++;
    this.halted = false;
    this.earlyVault.clear();
    this.set({ ...initialJourney });
  }

  toggleOptional(code: string): void {
    if (this.current.stage !== "form" || !this.deps.company.optionalPurposes.includes(code)) return;
    const has = this.current.optional.includes(code);
    this.set({ optional: has ? this.current.optional.filter((c) => c !== code) : [...this.current.optional, code] });
  }

  /** Ticking the main checkbox: asks Core for a consent request and shows its QR. */
  async tick(): Promise<void> {
    if (this.current.stage !== "form" || this.current.alias === null) return;
    const epoch = ++this.epoch;
    const purposes = [this.loan, ...this.current.optional];
    try {
      const created = await this.deps.createRequest(this.current.alias, purposes);
      if (epoch !== this.epoch) return; // unticked or signed out while it was in flight
      this.set({
        stage: "awaiting-scan",
        request: { id: created.requestId, qrPayload: JSON.stringify(created.qrPayload), createdAtMs: this.deps.now() },
        notice: null,
      });
    } catch (err) {
      if (epoch === this.epoch) this.fail(err instanceof Error ? err.message : "Could not reach Sammati");
    }
  }

  untick(): void {
    if (this.current.stage !== "awaiting-scan") return;
    this.epoch++;
    this.set({ stage: "form", request: null });
  }

  async apply(): Promise<void> {
    const { stage, alias, principal } = this.current;
    if ((stage !== "data-submitted" && stage !== "decided") || alias === null || principal === null || this.current.applying) return;
    this.set({ applying: true, notice: null });
    try {
      const answer = await this.deps.apply(alias, principal);
      const body = answer.body as { code?: unknown; error?: { message?: unknown } } | null;
      if (answer.status === 200) {
        const decision = parseDecision(answer.body);
        if (!decision || scanForPlaintext(answer.body)) return this.fail(`${this.deps.company.name}'s answer could not be read`);
        this.set({ stage: "decided", decision, applying: false });
      } else if (answer.status === 451 && body?.code === "CONSENT_WITHDRAWN") {
        this.set({ stage: "withdrawn", applying: false, decision: null });
      } else if (answer.status === 451) {
        this.set({ applying: false, notice: `${this.deps.company.name} cannot process this: ${String(body?.code ?? "refused")}` });
      } else {
        const message = typeof body?.error?.message === "string" ? body.error.message : `${this.deps.company.name} answered ${answer.status}`;
        this.fail(message);
      }
    } catch {
      this.fail(`${this.deps.company.name}'s backend did not answer`);
    }
  }

  /** "Try again" after an error: back to where it happened, keeping what was entered. */
  retry(): void {
    if (this.current.stage !== "error") return;
    this.set({ stage: this.current.resumeStage ?? "form", error: null, resumeStage: null });
  }

  cancelApplication(): void {
    if (this.current.stage === "logged-out" || this.current.stage === "home") return;
    this.epoch++;
    this.set({ stage: "home", request: null, notice: null, error: null });
  }

  // --- what happens elsewhere, from the live socket ---

  async onFrame(frame: unknown): Promise<void> {
    if (this.halted || typeof frame !== "object" || frame === null) return;
    const leak = scanForPlaintext(frame);
    if (leak) {
      // Whatever sent this, the page must not be the one to show it.
      this.halted = true;
      this.set({ stage: "error", error: `A profile value appeared in a live event (${leak}). The page has stopped.`, applying: false, resumeStage: null });
      return;
    }
    const e = frame as Record<string, unknown>;
    switch (e.event) {
      case "consent.updated":
        return this.onConsent(e);
      case "vault.stored":
        return this.onStored(e);
      case "vault.erased":
        return this.onErased(e);
    }
  }

  private forMe(e: Record<string, unknown>): boolean {
    return typeof e.principal === "string" && this.current.principal !== null && lc(e.principal) === lc(this.current.principal) && e.purposeCode === this.loan;
  }

  private async onConsent(e: Record<string, unknown>): Promise<void> {
    if (typeof e.fiduciary !== "string" || lc(e.fiduciary) !== lc(this.deps.company.address) || e.purposeCode !== this.loan || typeof e.principal !== "string") return;
    const s = this.current;

    if (e.status === "Active" && s.stage === "awaiting-scan" && s.request && typeof e.at === "number" && e.at >= Math.floor(s.request.createdAtMs / 1000) - 1) {
      // Is this our customer? The company's own table says whose alias it is.
      const epoch = this.epoch;
      const principal = e.principal;
      for (let attempt = 0; attempt < 4; attempt++) {
        let rows: Awaited<ReturnType<JourneyDeps["consentRows"]>> = [];
        try {
          rows = await this.deps.consentRows(this.current.alias ?? undefined, principal);
        } catch {
          // try again below
        }
        if (epoch !== this.epoch || this.current.stage !== "awaiting-scan") return;
        if (rows.some((r) => lc(r.principal) === lc(principal) && r.customerAlias === this.current.alias)) {
          const early = this.earlyVault.get(lc(principal)) ?? null;
          this.set({
            stage: early ? "data-submitted" : "consent-received",
            principal,
            txHash: typeof e.txHash === "string" ? e.txHash : null,
            vault: early,
            dataErased: false,
          });
          return;
        }
        await (this.deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(250);
      }
      return;
    }

    if (!this.forMe(e)) return;
    if (e.status === "Withdrawn" && (DATA_STAGES.includes(s.stage) || s.stage === "error" || s.stage === "withdrawn" || s.stage === "home")) {
      this.epoch++;
      this.set({ stage: "home", request: null, vault: null, decision: null, notice: "Your data consent was withdrawn." });
    } else if (e.status === "Active" && s.stage === "withdrawn") {
      // Consent given again, e.g. by scanning a new code: the details must be sent again too.
      this.set({ stage: "consent-received", txHash: typeof e.txHash === "string" ? e.txHash : s.txHash, vault: null, decision: null });
    }
  }

  private onStored(e: Record<string, unknown>): void {
    if (e.purposeCode !== this.loan || typeof e.principal !== "string" || typeof e.handle !== "string" || typeof e.ciphertextHash !== "string") return;
    const vault = { handle: e.handle, ciphertextHash: e.ciphertextHash };
    if (this.current.principal === null) {
      this.earlyVault.set(lc(e.principal), vault);
      return;
    }
    if (!this.forMe(e) || !DATA_STAGES.includes(this.current.stage)) return;
    this.set({ stage: "data-submitted", vault, dataErased: false, decision: null });
  }

  private onErased(e: Record<string, unknown>): void {
    if (e.cause === "superseded" || !this.forMe(e)) return;
    const stage = this.current.stage;
    this.set({
      vault: null,
      dataErased: true,
      decision: null,
      stage: stage === "data-submitted" || stage === "decided" ? "consent-received" : stage,
    });
  }
}
