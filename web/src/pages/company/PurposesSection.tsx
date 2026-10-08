/**
 * PurposesSection — C-01:
 * "Purposes: table plus Add purpose drawer (code, plain description in 3 languages,
 * categories, retention, sharing flag)."
 */

import { useState, type ReactNode } from "react";
import type { NoticePurpose, SeedFiduciary } from "@sammati/shared";
import { DataTable, HashLabel, type Column } from "../../ui";
import { useCoreMode } from "../../core";
import { AddPurposeDrawer } from "./AddPurposeDrawer";

interface PurposesSectionProps {
  company: SeedFiduciary;
  purposes: NoticePurpose[];
  onRefreshPurposes: () => void;
}

export function PurposesSection({
  company,
  purposes,
  onRefreshPurposes,
}: PurposesSectionProps): ReactNode {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Real Core answers 501 to registering a purpose (the seed registers them on chain), so offer it only where it works.
  // Until the mode is known nothing is offered, so a click cannot reach the wrong kind of Core.
  const mode = useCoreMode();
  const canAddPurpose = mode === "stub";
  const [activeLang, setActiveLang] = useState<"en" | "hi" | "kn">("en");

  const columns: Column<NoticePurpose>[] = [
    {
      key: "code",
      header: "Code",
      width: "w-36",
      render: (p) => (
        <span className="font-mono text-xs font-bold text-ink">{p.code}</span>
      ),
    },
    {
      key: "title",
      header: "Purpose & Notice",
      render: (p) => {
        const title = p.title[activeLang] || p.title.en;
        const desc = p.description[activeLang] || p.description.en;
        return (
          <div className="space-y-0.5">
            <div className="font-bold text-ink">{title}</div>
            <div className="text-xs text-mute">{desc}</div>
          </div>
        );
      },
    },
    {
      key: "dataCategories",
      header: "Data categories",
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.dataCategories.map((cat) => (
            <span
              key={cat}
              className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-mute border border-line"
            >
              {cat}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "retentionDays",
      header: "Retention",
      width: "w-28",
      render: (p) => (
        <span className="text-xs font-semibold text-ink">
          {p.retentionDays} days
        </span>
      ),
    },
    {
      key: "sharesThirdParty",
      header: "3rd party",
      width: "w-28",
      render: (p) =>
        p.sharesThirdParty ? (
          <span className="rounded-pill bg-block/10 border border-block/20 px-2.5 py-0.5 text-xs font-bold text-block">
            Shared
          </span>
        ) : (
          <span className="text-xs text-mute">Internal</span>
        ),
    },
    {
      key: "required",
      header: "Requirement",
      width: "w-28",
      render: (p) =>
        p.required ? (
          <span className="rounded-pill bg-ink/10 border border-ink/20 px-2.5 py-0.5 text-xs font-bold text-ink">
            Needed
          </span>
        ) : (
          <span className="text-xs text-mute">Optional</span>
        ),
    },
    {
      key: "id",
      header: "Purpose ID",
      width: "w-36",
      render: (p) => (
        <HashLabel value={p.id} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-ink">Purposes Registry</h2>
          <p className="text-sm text-mute">
            Defined data purposes registered on-chain for {company.name}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Language toggle for descriptions */}
          <div className="flex items-center rounded-pill border border-line bg-surface p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveLang("en")}
              className={`rounded-pill px-2.5 py-1 font-bold transition-colors ${
                activeLang === "en" ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setActiveLang("hi")}
              className={`rounded-pill px-2.5 py-1 font-bold transition-colors ${
                activeLang === "hi" ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              हिन्दी
            </button>
            <button
              type="button"
              onClick={() => setActiveLang("kn")}
              className={`rounded-pill px-2.5 py-1 font-bold transition-colors ${
                activeLang === "kn" ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              ಕನ್ನಡ
            </button>
          </div>

          {canAddPurpose && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 rounded-row bg-ink px-4 py-2 text-sm font-bold text-paper transition-colors hover:bg-ink/90"
            >
              <span className="text-base text-marigold">+</span>
              Add purpose
            </button>
          )}
          {mode === "live" && (
            <span className="text-xs text-mute" title="Purposes are registered on chain by the seed. Registering from the console is not built yet.">
              Registered on chain by the seed
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-pass border border-line bg-surface p-4 shadow-sm">
        <DataTable
          columns={columns}
          rows={purposes}
          rowKey={(p) => p.id}
          caption={`${company.name} registered purposes`}
          emptyMessage="No purposes registered for this fiduciary."
        />
      </div>

      {/* Add Purpose Drawer */}
      {canAddPurpose && (
        <AddPurposeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          company={company}
          onPurposeAdded={onRefreshPurposes}
        />
      )}
    </div>
  );
}
