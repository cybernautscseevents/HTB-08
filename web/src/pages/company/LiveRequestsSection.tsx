/**
 * LiveRequestsSection — C-04 & C-05:
 * "Live requests: two-column.
 *  Left: Simulator with big buttons ("Run credit check", "Send marketing SMS", "Share with bureau")
 *  firing real requests calling /v1/demo/fire.
 *  Right: feed with ALLOWED/BLOCKED, reason code, latency. Blocked rows use block left border
 *  and show "451 · Consent withdrawn"."
 */

import { useState, useMemo, type ReactNode } from "react";
import {
  DEMO_PRINCIPAL,
  REASON_CODES,
  type AccessReason,
  type Decision,
  type SeedFiduciary,
  type StoredAccessLogEntry,
} from "@sammati/shared";
import { StatusChip, HashLabel } from "../../ui";
import { demoFire } from "../../api";

interface LiveRequestsSectionProps {
  company: SeedFiduciary;
  accessLogs: StoredAccessLogEntry[];
  newLogIds: Set<string>;
}

interface SimulatorButtonConfig {
  label: string;
  sublabel: string;
  purposeCode: string;
  endpoint: string;
  icon: string;
}

const COMPANY_BUTTONS: Record<string, SimulatorButtonConfig[]> = {
  quickloan: [
    {
      label: "Run credit check",
      sublabel: "Core service — checks credit eligibility",
      purposeCode: "credit_check",
      endpoint: "GET /customers/4821/credit-profile",
      icon: "💳",
    },
    {
      label: "Send marketing SMS",
      sublabel: "Promotional loan offers — requires marketing consent",
      purposeCode: "marketing",
      endpoint: "POST /marketing/campaign/sms",
      icon: "📱",
    },
    {
      label: "Share with bureau",
      sublabel: "Downstream sharing with CreditBureauX",
      purposeCode: "bureau_share",
      endpoint: "POST /bureau/sync",
      icon: "🏛",
    },
  ],
  medicare: [
    {
      label: "Access treatment records",
      sublabel: "Doctor diagnosis & medical history",
      purposeCode: "treatment",
      endpoint: "GET /patients/4821/treatment-record",
      icon: "🩺",
    },
    {
      label: "File insurance claim",
      sublabel: "Submit billing & medical proof to InsureCo",
      purposeCode: "insurance_claim",
      endpoint: "POST /claims/file",
      icon: "📑",
    },
    {
      label: "Export to research lab",
      sublabel: "Anonymised records to ResearchLab",
      purposeCode: "research",
      endpoint: "POST /research/export",
      icon: "🔬",
    },
  ],
  foodrush: [
    {
      label: "Access delivery location",
      sublabel: "Live GPS tracking for delivery rider",
      purposeCode: "delivery",
      endpoint: "GET /orders/current/location",
      icon: "🛵",
    },
    {
      label: "Personalise food ads",
      sublabel: "AdNetworkZ targeting based on order history",
      purposeCode: "ad_targeting",
      endpoint: "POST /ads/recommendations",
      icon: "🍕",
    },
    {
      label: "Share with restaurant partner",
      sublabel: "Kitchen receipt details to restaurant",
      purposeCode: "partner_share",
      endpoint: "POST /orders/partner-dispatch",
      icon: "🍳",
    },
  ],
};

function formatReasonLabel(decision: Decision, reason: AccessReason): string {
  if (decision === "ALLOWED") return "200 · Allowed";
  switch (reason) {
    case "CONSENT_WITHDRAWN":
      return "451 · Consent withdrawn";
    case "CONSENT_EXPIRED":
      return "451 · Consent expired";
    case "NO_CONSENT":
      return "451 · No consent";
    case "LEDGER_UNAVAILABLE":
      return "451 · Ledger unavailable";
    case "NO_PRINCIPAL":
      return "451 · Missing principal identity";
    default:
      return `451 · ${reason}`;
  }
}

export function LiveRequestsSection({
  company,
  accessLogs,
  newLogIds,
}: LiveRequestsSectionProps): ReactNode {
  const [targetPrincipal, setTargetPrincipal] = useState(DEMO_PRINCIPAL);
  const [firingPurpose, setFiringPurpose] = useState<string | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);
  const [lastFireResult, setLastFireResult] = useState<{
    purposeCode: string;
    endpoint: string;
    decision: Decision;
    reason: AccessReason;
    entryId?: string;
    payload?: unknown;
    statusText?: string;
  } | null>(null);

  // Filter for feed
  const [feedFilter, setFeedFilter] = useState<"all" | "allowed" | "blocked">("all");

  const buttons = COMPANY_BUTTONS[company.slug] ?? COMPANY_BUTTONS.quickloan!;

  /**
   * The browser calls the company's own guarded endpoint, so the gateway SDK decides and logs. Only if the
   * request cannot be made at all (a network error) does Core make it instead. Any answer the company does
   * give that is not a clear ALLOWED (200) or BLOCKED (451 with a reason code) is shown as an error: hiding
   * a crashed or misconfigured company app behind a simulated result would make the demo lie.
   */
  const handleFire = async (btn: SimulatorButtonConfig) => {
    setFiringPurpose(btn.purposeCode);
    setFireError(null);
    const [method, path] = btn.endpoint.split(" ");
    const companyUrl = `http://localhost:${company.port}${path}`;

    try {
      let res: Response;
      try {
        res = await fetch(companyUrl, {
          method: method || "GET",
          headers: {
            "Content-Type": "application/json",
            "x-sammati-principal": targetPrincipal,
          },
          body: method === "POST" ? JSON.stringify({ principal: targetPrincipal }) : undefined,
        });
      } catch {
        await fireThroughCore(btn);
        return;
      }

      if (res.status === 200) {
        const payload: unknown = await res.json().catch(() => undefined);
        setLastFireResult({
          purposeCode: btn.purposeCode,
          endpoint: btn.endpoint,
          decision: "ALLOWED",
          reason: "OK",
          payload,
          statusText: "HTTP 200 OK — Consent valid",
        });
        return;
      }

      const errData = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.status === 451 && errData?.code && (REASON_CODES as readonly string[]).includes(errData.code)) {
        setLastFireResult({
          purposeCode: btn.purposeCode,
          endpoint: btn.endpoint,
          decision: "BLOCKED",
          reason: errData.code as AccessReason,
          payload: errData,
          statusText: `HTTP 451 Unavailable For Legal Reasons — ${errData.code}`,
        });
        return;
      }

      setLastFireResult(null);
      setFireError(
        `${company.name}'s backend answered HTTP ${res.status} for ${btn.endpoint}` +
          `${res.status === 451 ? " without a reason code" : ""}, so the gateway made no decision. ` +
          "Check the company app's log (it may have crashed or be misconfigured).",
      );
    } finally {
      setFiringPurpose(null);
    }
  };

  /** The company's backend could not be reached from this browser: ask Core to make the request for us. */
  const fireThroughCore = async (btn: SimulatorButtonConfig) => {
    try {
      const coreRes = await demoFire({
        fiduciary: company.address,
        purposeCode: btn.purposeCode,
        principal: targetPrincipal,
        endpoint: btn.endpoint,
      });
      setLastFireResult({
        purposeCode: btn.purposeCode,
        endpoint: btn.endpoint,
        decision: coreRes.decision,
        reason: coreRes.reason,
        entryId: coreRes.entryId,
        statusText: `Core made the request (${coreRes.decision}): ${company.name}'s backend was not reachable from this browser`,
      });
    } catch (err) {
      setLastFireResult(null);
      setFireError(
        `${company.name}'s backend is not reachable, and Core could not make the request either` +
          `${err instanceof Error && err.message ? ` (${err.message})` : ""}. Is the company app running?`,
      );
    }
  };
  const filteredLogs = useMemo(() => {
    if (feedFilter === "allowed") {
      return accessLogs.filter((l) => l.decision === "ALLOWED");
    }
    if (feedFilter === "blocked") {
      return accessLogs.filter((l) => l.decision === "BLOCKED");
    }
    return accessLogs;
  }, [accessLogs, feedFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-ink">Live Requests & Simulator</h2>
        <p className="text-sm text-mute">
          Test real-time gateway policy enforcement against the consent ledger (C-04 / C-05).
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Simulator with big buttons (5 cols) */}
        <div className="rounded-pass border border-line bg-surface p-6 shadow-sm lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <h3 className="font-extrabold text-ink">Simulator</h3>
              <p className="text-xs text-mute">
                Fires real HTTP requests into {company.name}'s gateway
              </p>
            </div>
            <span className="rounded-pill bg-marigold/15 px-2.5 py-1 text-xs font-extrabold text-ink">
              DEMO_MODE
            </span>
          </div>

          {/* Principal Target Picker */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-mute mb-1">
              Target Principal
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={targetPrincipal}
                onChange={(e) => setTargetPrincipal(e.target.value)}
                className="w-full rounded-row border border-line bg-surface px-3 py-2 text-xs font-mono text-ink focus:border-marigold focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-mute mt-1">
              Default: Demo Principal Asha Sharma (<HashLabel value={DEMO_PRINCIPAL} />)
            </p>
          </div>

          {/* Big Action Buttons */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-mute">
              Action Endpoints
            </label>
            {buttons.map((btn) => {
              const isFiring = firingPurpose === btn.purposeCode;
              return (
                <button
                  key={btn.purposeCode}
                  type="button"
                  disabled={Boolean(firingPurpose)}
                  onClick={() => handleFire(btn)}
                  className="w-full text-left rounded-pass border-2 border-line bg-surface p-4 hover:border-marigold hover:bg-paper/40 transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{btn.icon}</span>
                      <div>
                        <div className="font-extrabold text-ink text-sm">
                          {btn.label}
                        </div>
                        <div className="text-xs text-mute mt-0.5">
                          {btn.sublabel}
                        </div>
                      </div>
                    </div>
                    {isFiring ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-marigold border-t-transparent" />
                    ) : (
                      <span className="text-mute font-mono text-xs">POST →</span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 border-t border-line/60 pt-2 text-[11px] text-mute font-mono">
                    <span className="rounded bg-paper px-1.5 py-0.5">{btn.endpoint}</span>
                    <span>purpose: {btn.purposeCode}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* A request that could not be decided at all: never dressed up as ALLOWED or BLOCKED */}
          {fireError && (
            <div role="alert" className="rounded-pass border border-block/30 bg-block/5 p-4 text-sm font-semibold text-block">
              {fireError}
            </div>
          )}
          {/* Last Fire Feedback */}
          {lastFireResult && (
            <div
              className={`rounded-pass border p-4 animate-feed-enter ${
                lastFireResult.decision === "ALLOWED"
                  ? "border-allow/30 bg-allow/5 text-allow"
                  : "border-block/30 bg-block/5 text-block"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Gateway Decision:
                </span>
                <span
                  className={`rounded-pill px-2.5 py-0.5 text-xs font-extrabold ${
                    lastFireResult.decision === "ALLOWED"
                      ? "bg-allow text-paper"
                      : "bg-block text-paper"
                  }`}
                >
                  {lastFireResult.decision}
                </span>
              </div>
              <div className="mt-2 text-xs font-mono font-bold">
                {formatReasonLabel(lastFireResult.decision, lastFireResult.reason)}
              </div>
              <div className="mt-1 text-[11px] text-mute font-mono">
                Endpoint: {lastFireResult.endpoint}
              </div>
              {lastFireResult.statusText && (
                <div className="mt-1 text-[11px] text-mute">{lastFireResult.statusText}</div>
              )}
              {lastFireResult.payload ? (
                <div className="mt-3 border-t border-line/40 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-mute mb-1">
                    {lastFireResult.decision === "ALLOWED"
                      ? "Guarded Data Payload (drd.md §5):"
                      : "DPDP 451 Block Response:"}
                  </div>
                  <pre className="max-h-36 overflow-y-auto rounded-row bg-ink p-2.5 text-[11px] font-mono text-paper">
                    {JSON.stringify(lastFireResult.payload, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Right Column: Live Feed with ALLOWED/BLOCKED (7 cols) */}
        <div className="rounded-pass border border-line bg-surface p-6 shadow-sm lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-allow" />
              <h3 className="font-extrabold text-ink">Live Enforcement Feed</h3>
            </div>

            {/* Filter pills */}
            <div className="flex items-center rounded-pill border border-line bg-surface p-1 text-xs">
              <button
                type="button"
                onClick={() => setFeedFilter("all")}
                className={`rounded-pill px-3 py-1 font-bold transition-colors ${
                  feedFilter === "all" ? "bg-ink text-paper" : "text-mute hover:text-ink"
                }`}
              >
                All ({accessLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter("allowed")}
                className={`rounded-pill px-3 py-1 font-bold transition-colors ${
                  feedFilter === "allowed" ? "bg-allow text-paper" : "text-mute hover:text-ink"
                }`}
              >
                Allowed
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter("blocked")}
                className={`rounded-pill px-3 py-1 font-bold transition-colors ${
                  feedFilter === "blocked" ? "bg-block text-paper" : "text-mute hover:text-ink"
                }`}
              >
                Blocked
              </button>
            </div>
          </div>

          {/* Feed List */}
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {filteredLogs.length === 0 ? (
              <div className="rounded-row border border-dashed border-line p-12 text-center text-sm text-mute">
                No request logs found for this filter.
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isBlocked = log.decision === "BLOCKED";
                const isNew = newLogIds.has(log.id);

                return (
                  <div
                    key={log.id}
                    className={`rounded-row border bg-surface p-3.5 shadow-sm transition-all animate-feed-enter ${
                      isBlocked
                        ? "border-l-4 border-l-block border-line"
                        : "border-l-4 border-l-allow border-line"
                    } ${isNew ? (isBlocked ? "animate-wash-block" : "animate-wash-allow") : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusChip
                            variant={isBlocked ? "blocked" : "allowed"}
                            label={log.decision}
                          />
                          <span
                            className={`text-xs font-extrabold ${
                              isBlocked ? "text-block" : "text-allow"
                            }`}
                          >
                            {formatReasonLabel(log.decision, log.reason)}
                          </span>
                        </div>
                        <div className="font-mono text-xs font-semibold text-ink">
                          {log.endpoint}
                        </div>
                      </div>

                      <div className="text-right text-xs">
                        <span className="font-mono font-bold text-ink">
                          {log.latencyMs}ms
                        </span>
                        <div className="text-[11px] text-mute">
                          {new Date(log.at * 1000).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-mute">
                      <div className="flex items-center gap-1.5">
                        <span>Principal:</span>
                        <HashLabel value={log.principal} />
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span>seq #{log.seq}</span>
                        <span>•</span>
                        <span>purpose: {log.purposeCode}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
