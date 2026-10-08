# DRD — Data Requirements (Sammati)

## 1. Data classification and the on-chain rule

| Class | Examples | On chain? | Where it lives |
|---|---|---|---|
| Pseudonymous identifier | Principal address, fiduciary address | Yes | Chain, Core DB |
| Consent metadata | Purpose id, status, expiry, notice hash | Yes | Chain, Core cache |
| Integrity artefacts | Ledger head, Merkle roots | Yes | Chain |
| Access log entries | Who requested what, decision, time | **Hash only** (via Merkle root) | Core DB (full entry) |
| Notice text | Plain-language purpose descriptions | **Hash only** | Core DB / console |
| Personal data | Name, phone, income, health record | **Never** | Company's own system (fake data in demo) |
| Company-side alias | "Customer #4821" mapped to a principal address | **Never** | Company's system only |

**Rule:** if a field could identify a real person on its own, it does not go on chain and does not go into Sammati's database.

## 2. On-chain data model
See `trd.md` §3 for Solidity structs. Keys:
- `consentKey = keccak256(abi.encode(fiduciary, purposeId))`, stored as `consents[principal][consentKey]`.
- `purposeId = keccak256(abi.encodePacked(fiduciary, code))`.
- `nonces[principal]` monotonic.
- `ledgerHead` single rolling hash, `bytes32(0)` at deployment: `ledgerHead = keccak256(abi.encode(ledgerHead, actionHash))`.
  `actionHash = keccak256(abi.encode(uint8 actionType, address principal, address fiduciary, bytes32 purposeId, uint64 expiresAtOrZero, uint64 blockTimestamp))`.
  Action types: `0` RegisterFiduciary, `1` RegisterPurpose, `2` RegisterProcessor, `3` SetPurposeActive, `4` Grant, `5` Withdraw, `6` Acknowledge. Slots by action (unused slots are zero): RegisterFiduciary → `fiduciary` = the new fiduciary. RegisterPurpose and SetPurposeActive → `fiduciary` = caller, `purposeId`. RegisterProcessor → `principal` = the processor address (the slot is reused), `fiduciary` = caller, `purposeId`. Grant and Withdraw → principal, fiduciary, purposeId. Acknowledge → principal, fiduciary, purposeId (the processor is in the event only). `expiresAtOrZero` is the consent expiry on Grant, 1 or 0 for SetPurposeActive (active or not), otherwise 0.

## 3. Off-chain schema (SQLite)

```sql
CREATE TABLE fiduciaries (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  color TEXT,
  registered_tx TEXT
);

CREATE TABLE purposes (
  id TEXT PRIMARY KEY,                 -- purposeId (bytes32 hex)
  fiduciary TEXT NOT NULL REFERENCES fiduciaries(address),
  code TEXT NOT NULL,                  -- e.g. credit_check
  title_en TEXT NOT NULL, title_hi TEXT, title_kn TEXT,
  desc_en TEXT NOT NULL, desc_hi TEXT, desc_kn TEXT,
  data_categories TEXT NOT NULL,       -- JSON array
  retention_days INTEGER NOT NULL,
  shares_third_party INTEGER NOT NULL DEFAULT 0,
  desc_hash TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0  -- core service purpose vs optional
);

CREATE TABLE processors (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose_id TEXT NOT NULL REFERENCES purposes(id),
  webhook_url TEXT
);

CREATE TABLE requests (                -- consent requests behind QR codes
  id TEXT PRIMARY KEY,
  fiduciary TEXT NOT NULL,
  purposes TEXT NOT NULL,              -- JSON array of purpose ids
  customer_alias TEXT NOT NULL,        -- company-side alias, shown only in console
  notice_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL                 -- open | used | expired
);

CREATE TABLE consents_cache (          -- mirror of chain state
  principal TEXT NOT NULL,
  fiduciary TEXT NOT NULL,
  purpose_id TEXT NOT NULL,
  status TEXT NOT NULL,                -- Active | Withdrawn
  granted_at INTEGER, expires_at INTEGER, updated_at INTEGER,
  notice_hash TEXT,
  last_tx TEXT,
  PRIMARY KEY (principal, fiduciary, purpose_id)
);

CREATE TABLE ledger_events (            -- indexed chain events for explorer
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                  -- granted | withdrawn | ack | anchor | purpose
  principal TEXT, fiduciary TEXT, purpose_id TEXT,
  tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
  ledger_head TEXT, at INTEGER NOT NULL,
  payload TEXT,                        -- JSON
  log_index INTEGER NOT NULL DEFAULT 0, -- position in the block; (tx_hash, log_index) makes indexing idempotent
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE indexer_state (            -- the indexer's cursor, so a restart resumes where it stopped
  key TEXT PRIMARY KEY,                -- last_block | last_block_hash
  value TEXT NOT NULL
);

CREATE TABLE access_logs (
  seq INTEGER NOT NULL,                -- per-fiduciary sequence
  fiduciary TEXT NOT NULL,
  id TEXT NOT NULL,                    -- uuid
  principal TEXT NOT NULL,
  purpose_code TEXT NOT NULL,
  decision TEXT NOT NULL,              -- ALLOWED | BLOCKED
  reason TEXT,                         -- OK | CONSENT_WITHDRAWN | CONSENT_EXPIRED | NO_CONSENT | LEDGER_UNAVAILABLE | NO_PRINCIPAL
  endpoint TEXT NOT NULL,
  latency_ms INTEGER,
  at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  batch_index INTEGER,                 -- set after anchoring
  PRIMARY KEY (fiduciary, seq)
);

CREATE TABLE anchor_batches (
  fiduciary TEXT NOT NULL,
  idx INTEGER NOT NULL,
  merkle_root TEXT NOT NULL,
  from_seq INTEGER NOT NULL, to_seq INTEGER NOT NULL, count INTEGER NOT NULL,
  tx_hash TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (fiduciary, idx)
);

CREATE TABLE cascade_acks (
  principal TEXT NOT NULL, purpose_id TEXT NOT NULL, processor TEXT NOT NULL,
  notified_at INTEGER, acked_at INTEGER, tx_hash TEXT,
  PRIMARY KEY (principal, purpose_id, processor)
);

CREATE TABLE rights_requests (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL, fiduciary TEXT NOT NULL,
  type TEXT NOT NULL,                  -- access | erasure | grievance
  note TEXT, status TEXT NOT NULL,     -- open | in_progress | resolved
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
```

## 4. Canonical formats

### 4.1 Access log entry (hashed form)
```json
{"at":1760000000,"decision":"BLOCKED","endpoint":"GET /customers/:id/credit-profile","fiduciary":"0x..","id":"uuid","latencyMs":12,"principal":"0x..","purposeCode":"credit_check","reason":"CONSENT_WITHDRAWN","seq":42}
```
Sorted keys, no whitespace, UTF-8. `hash = keccak256(prevHash || bytes(canonical))`, where `prevHash` is the 32 raw bytes of the previous entry's hash (32 zero bytes for the first entry). `prevHash` and `hash` are stored on the row but are **not** part of the canonical bytes. Integers only (no floats); `reason` is `OK` for ALLOWED entries.

### 4.2 Notice hash
`noticeHash = keccak256(canonicalJSON({ fiduciary, purposes:[{id, desc_en, desc_hi, desc_kn, dataCategories, retentionDays, sharesThirdParty}], version }))`.
The wallet recomputes this locally and compares with the server value before signing.

### 4.2a Description and metadata hashes
- `descHash = keccak256(canonicalJSON({ desc_en, desc_hi, desc_kn }))` of the purpose's plain-language text (the `descHash` passed to `registerPurpose`).
- `metaHash` for a fiduciary is `keccak256(canonicalJSON({ name, sector }))`, for a processor `keccak256(canonicalJSON({ name }))`. Helpers live in `shared/src/canonical.ts`.

### 4.3 Merkle tree
Leaves = `entry.hash`. Parent = `keccak256(min(a,b) || max(a,b))`. Odd node is promoted unchanged. Proof = list of sibling hashes.

## 5. Seed data (demo)

| Fiduciary | Sector | Purposes (code → plain description) | Downstream processors |
|---|---|---|---|
| **QuickLoan** | Fintech lending | `credit_check` → Check your credit eligibility (PAN, income, 12 months). `marketing` → Send you loan offers (phone, email). `bureau_share` → Share repayment history with credit bureaus | CreditBureauX (for `bureau_share`), AdPartnerQ (for `marketing`) |
| **MediCare+** | Health | `treatment` → Use your records for your treatment. `insurance_claim` → Share records with your insurer for claims. `research` → Use anonymised data for medical research | InsureCo (for `insurance_claim`), ResearchLab (for `research`) |
| **FoodRush** | Food delivery | `delivery` → Use your location to deliver orders. `ad_targeting` → Personalise ads from your order history. `partner_share` → Share your orders with restaurant partners | AdNetworkZ (for `ad_targeting`) |

Hindi and Kannada titles and descriptions for these nine purposes are drafted for native-speaker review in `docs/copy-hi-kn.md`; until they are applied the seed carries `[hi]` / `[kn]` placeholders.

Required (core) purposes such as `delivery` and `treatment` are marked `required`; the wallet shows them as "needed for the service" but still records and allows withdrawal (withdrawing stops the service use, the UI explains the effect).

Demo principal: one seeded wallet address is not used; the real phone generates its own key. A dedicated demo relayer key pays gas; the seed funds it from the admin account.

Fake customer payloads (examples returned by guarded endpoints):
- QuickLoan `credit-profile`: `{ pan: "ABCDE1234F", incomeBand: "6-9 LPA", score: 742 }` (fictional)
- MediCare+ `records`: `{ bloodGroup: "B+", lastVisit: "2026-08-14", note: "Routine checkup" }`
- FoodRush `profile`: `{ homeArea: "Indiranagar", lastOrders: 14 }`

## 6. Retention and deletion
- Chain data is permanent by design and contains no personal data.
- Core DB logs are demo data; `POST /v1/demo/reset` wipes everything.
- Erasure rights requests are tracked as status records; they do not touch the chain.

## 7. Integrity rules
- `access_logs.seq` strictly increasing per fiduciary with no gaps. A gap is a tamper signal.
- `hash` must equal recomputation from `prev_hash` and canonical entry.
- Every `batch_index` set implies a row in `anchor_batches` whose root matches recomputation.
- `consents_cache` must equal `getConsent` on chain; a reconciliation job runs every 30 s, logs drift, and repairs the cache from the chain (the chain wins).
- If the chain is behind the indexer cursor, or the block at the cursor has a different hash (a reset node), the indexer discards everything it derived from the chain and re-reads from the start block.
