/** Connects the portal's state machine to the browser: fetch for the three calls, the live socket for the events. */

import { useEffect, useRef, useState } from "react";
import type { CreateRequestResponse, FiduciaryConsentsResponse } from "@sammati/shared";
import { CORE_URL } from "../core";
import { useAnyWsFrame, useWsReadyState } from "../ws";
import { Journey, type JourneyDeps, type JourneyState, type PortalCompany } from "./journey";

/**
 * Where the company's own backend is (the sample lender listens on 4310). A hosted build has none unless
 * VITE_LENDER_URL says so, and then the customer portal says it is not available (trd.md §10.2).
 */
export const LENDER_URL: string = import.meta.env.VITE_LENDER_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4310");

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The browser's side of the three calls, for one company. */
export function makeBrowserDeps(company: PortalCompany, lenderUrl: string = LENDER_URL, viaCompany: boolean = import.meta.env.PROD): JourneyDeps {
  // Hosted: Core refuses these two calls without the company's key, so the company's own backend makes them (trd.md §6.14).
  const requestsUrl = viaCompany ? `${lenderUrl}/portal/requests` : `${CORE_URL}/v1/fiduciaries/${company.address}/requests`;
  return {
  company,
  async createRequest(alias, purposes) {
    const res = await fetch(requestsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purposes, customerAlias: alias }),
    });
    const body = (await json(res)) as (CreateRequestResponse & { error?: { message?: string } }) | null;
    if (!res.ok || !body?.requestId) throw new Error(body?.error?.message ?? `Sammati answered ${res.status}`);
    return { requestId: body.requestId, qrPayload: body.qrPayload };
  },
  async consentRows(alias, principal) {
    const url = viaCompany ? `${lenderUrl}/portal/consents?alias=${encodeURIComponent(alias ?? "")}&principal=${encodeURIComponent(principal ?? "")}` : `${CORE_URL}/v1/fiduciaries/${company.address}/consents`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sammati answered ${res.status}`);
    return ((await json(res)) as FiduciaryConsentsResponse).rows;
  },
  async apply(alias, principal) {
    const res = await fetch(`${lenderUrl}/customers/${encodeURIComponent(alias)}/apply`, {
      method: "POST",
      headers: { "x-sammati-principal": principal },
    });
    return { status: res.status, body: await json(res) };
  },
  now: () => Date.now(),
  };
}

export interface JourneyView {
  journey: Journey;
  state: JourneyState;
  /** The live socket is connected. */
  online: boolean;
}

export function useJourney(deps: JourneyDeps): JourneyView {
  const ref = useRef<Journey | null>(null);
  ref.current ??= new Journey(deps);
  const journey = ref.current;
  const [state, setState] = useState(journey.state);
  useEffect(() => journey.subscribe(setState), [journey]);
  useAnyWsFrame((frame) => void journey.onFrame(frame));
  return { journey, state, online: useWsReadyState() === WebSocket.OPEN };
}
