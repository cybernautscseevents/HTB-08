# TRD — Sammati

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Contracts | Solidity ^0.8.24, Hardhat, OpenZeppelin (`EIP712`, `ECDSA`) | TypeScript tests |
| Core service | Node 20, TypeScript, Express, `ethers` v6, `better-sqlite3`, `ws` | Single process: relayer + indexer + cache + anchor + cascade + audit API |
| Gateway SDK | TypeScript package `@sammati/gateway` | Express middleware |
| Sample lender | `examples/lender`: one Express app, any approved company (port 4310) | The reference integration of the gateway SDK and the Processor. It holds no customer data and returns no canned payload |
| Processor | Node 20, TypeScript, Express, `better-sqlite3`, `ethers` v6, Node `crypto` (X25519, HKDF-SHA256, AES-256-GCM), `ws` | Separate process on port 4200 (`processor/`). §4.4, §6.7 |
| Web | Vite + React + TypeScript + Tailwind, `recharts`, `react-router` | One app, routes `/company/:id` (`:id` is a company's slug), `/auditor`, `/portal/:slug`, `/join`, `/join/:applicationId` |
| Wallet | Flutter 3.x | See §5 |
| Chain | Hardhat node (chainId 31337) for live demo; Polygon Amoy (chainId 80002) for proof | |
| Tooling | pnpm workspaces | |

## 2. Repo layout

```
sammati/
  contracts/        # Hardhat project
  core/             # Node service
  gateway/          # @sammati/gateway SDK
  examples/
    lender/         # sample company backend (the gateway SDK plus the Processor); configured by env, no hard-coded company
  processor/        # Sammati Processor: vault + confidential evaluation (port 4200)
  web/              # company console + auditor + portal + join
  wallet/           # Flutter app
  shared/           # TS types, EIP-712 definitions, canonical JSON, merkle utils, vault envelope
  docs/             # these specs, and `integration.md` for companies joining Sammati
  core/examples/    # the quickstart sample app (R-03): `pnpm --filter @sammati/core sample:company`, also run by the e2e
```

## 3. Smart contracts

### 3.1 ConsentRegistry

```solidity
enum Status { None, Active, Withdrawn }

struct Consent {
  Status  status;
  uint64  grantedAt;
  uint64  expiresAt;
  uint64  updatedAt;
  bytes32 noticeHash;   // hash of the exact notice text the user saw
  uint32  noticeVersion;
}

struct Purpose {
  address fiduciary;
  bytes32 descHash;       // hash of plain-language description
  uint32  retentionDays;
  bool    sharesWithThirdParties;
  bool    active;
}

struct GrantConsent {
  address principal;
  address fiduciary;
  bytes32 purposeId;
  uint64  expiresAt;
  bytes32 noticeHash;
  uint256 nonce;
  uint64  deadline;
}

struct WithdrawConsent {
  address principal;
  address fiduciary;
  bytes32 purposeId;
  uint256 nonce;
  uint64  deadline;
}

// admin
function registerFiduciary(address fiduciary, string name, bytes32 metaHash) external;           // onlyAdmin
// fiduciary
function registerPurpose(bytes32 purposeId, bytes32 descHash, uint32 retentionDays, bool shares) external; // onlyFiduciary
function registerProcessor(bytes32 purposeId, address processor, bytes32 metaHash) external;     // onlyFiduciary
// anyone (relayer) with principal signature
function grantConsent(GrantConsent calldata req, bytes calldata sig) external;
function withdrawConsent(WithdrawConsent calldata req, bytes calldata sig) external;
// processors
function acknowledgeWithdrawal(address principal, address fiduciary, bytes32 purposeId) external; // onlyRegisteredProcessor
// fiduciary (owner of the purpose)
function setPurposeActive(bytes32 purposeId, bool active) external;                              // onlyFiduciary; withdrawal never needs an active purpose
// views
function admin() external view returns (address);
function isFiduciary(address fiduciary) external view returns (bool);
function isProcessor(bytes32 purposeId, address processor) external view returns (bool);
function getPurpose(bytes32 purposeId) external view returns (Purpose memory);
function hasValidConsent(address principal, address fiduciary, bytes32 purposeId) external view returns (bool);
function getConsent(address principal, address fiduciary, bytes32 purposeId) external view returns (Consent memory);
function ledgerHead() external view returns (bytes32);
function nonces(address principal) external view returns (uint256);
```

Rules:
- `purposeId = keccak256(abi.encodePacked(fiduciary, code))` where `code` is a short string like `"credit_check"`.
- Grant requires `block.timestamp <= deadline`, `req.nonce == nonces[principal]++`, `expiresAt > block.timestamp`, signer == `principal`, purpose active. Re-granting after withdrawal is allowed.
- Withdraw requires an Active consent. Withdrawal is immediate and unconditional.
- `hasValidConsent` = `status == Active && block.timestamp < expiresAt`.
- On every state change (registrations, purpose activation, grant, withdraw, acknowledgement): `ledgerHead = keccak256(abi.encode(ledgerHead, actionHash))`. `actionHash` and the numeric action types are defined in `drd.md` §2; `shared/src/ledger.ts` recomputes them off chain.
- `registerPurpose` requires a registered fiduciary and a new `purposeId`, and creates it active. The contract cannot check the `code` behind `purposeId`; Core derives it with `purposeIdOf`. `registerProcessor` requires the caller to own the purpose.
- `noticeVersion` is not signed: it counts grants of the same (principal, fiduciary, purpose), starting at 1.
- `acknowledgeWithdrawal` requires the caller to be a processor of the purpose and the consent to be `Withdrawn`, and works once per processor.
- Errors (custom): `NotAdmin`, `NotFiduciary`, `NotProcessor`, `ZeroAddress`, `FiduciaryAlreadyRegistered`, `PurposeAlreadyRegistered`, `ProcessorAlreadyRegistered`, `UnknownPurpose`, `WrongFiduciary`, `PurposeInactive`, `SignatureExpired`, `InvalidNonce`, `InvalidExpiry`, `InvalidSignature`, `NotActive`, `NotWithdrawn`, `AlreadyAcknowledged`.

Events:
```solidity
event FiduciaryRegistered(address indexed fiduciary, string name);
event PurposeRegistered(address indexed fiduciary, bytes32 indexed purposeId, bytes32 descHash);
event ProcessorRegistered(bytes32 indexed purposeId, address indexed processor);
event ConsentGranted(address indexed principal, address indexed fiduciary, bytes32 indexed purposeId, uint64 expiresAt, bytes32 noticeHash, bytes32 ledgerHead);
event ConsentWithdrawn(address indexed principal, address indexed fiduciary, bytes32 indexed purposeId, bytes32 ledgerHead);
event WithdrawalAcknowledged(address indexed principal, bytes32 indexed purposeId, address indexed processor, uint64 at);
event PurposeActiveChanged(address indexed fiduciary, bytes32 indexed purposeId, bool active);
```

### 3.2 AccessAnchor
```solidity
function anchorAccessBatch(bytes32 merkleRoot, uint64 fromSeq, uint64 toSeq, uint32 count) external; // onlyFiduciary
function getBatch(address fiduciary, uint256 index) external view returns (bytes32 root, uint64 fromSeq, uint64 toSeq, uint32 count, uint64 at);
function batchCount(address fiduciary) external view returns (uint256);
event AccessBatchAnchored(address indexed fiduciary, uint256 indexed index, bytes32 merkleRoot, uint64 fromSeq, uint64 toSeq, uint32 count);
```

Rules:
- Constructor takes the `ConsentRegistry` address; "onlyFiduciary" means `registry.isFiduciary(msg.sender)`.
- Batches are **contiguous**: the first batch of a fiduciary starts at `fromSeq = 1`, every later one at `previous toSeq + 1`, and `count == toSeq - fromSeq + 1`. This is stricter than "monotonic" on purpose: a gap in `seq` is a tamper signal (`drd.md` §7), so the chain refuses to anchor one. `merkleRoot` must be non-zero.
- Errors: `NotFiduciary`, `InvalidRoot`, `InvalidRange`, `NonContiguous`, `BatchNotFound`.

### 3.3 Tests (must pass before integration)
1. Valid signature grants; wrong signer, replayed nonce, expired deadline all revert.
2. Withdraw flips state; `hasValidConsent` false immediately.
3. Expiry makes `hasValidConsent` false without any transaction.
4. Re-grant after withdrawal works.
5. `ledgerHead` changes on each action and is deterministic.
6. Processor ack only from registered processors.
7. Anchor stores roots and enforces contiguous, non-overlapping `fromSeq`/`toSeq` per fiduciary (see §3.2 rules).

## 4. Signing

### 4.1 EIP-712 domain
```
name: "Sammati", version: "1", chainId: <chain>, verifyingContract: <ConsentRegistry>
```
Types: exactly the `GrantConsent` and `WithdrawConsent` structs above (field names and order are part of the spec; `shared/` holds the single definition used by contracts tests, Core and wallet).

### 4.2 Wallet key
- secp256k1 key generated on first launch, stored with `flutter_secure_storage`, usable only after `local_auth` success.
- Address shown as a short alias, never as the primary identity.
- The profile (W-15, W-16) has its own random key, kept beside the wallet key and released the same way (§5, "Profile vault"). Two keys, so that reading the profile never touches the signing key and signing never decrypts the profile.

### 4.3 Dart signing spike (hours 0–2, blocking)
- Try `eth_sig_util` `signTypedData` (V4) with the typed data above; verify the recovered address in a Hardhat test.
- **Fallback:** Core computes the EIP-712 digest and returns it; wallet signs the raw 32-byte digest with `web3dart`/`pointycastle` (no prefix). Contract still verifies with `ECDSA.recover(digest, sig)`. The wallet independently recomputes the notice hash and shows it, so the user is not signing blind.

### 4.4 Vault envelope (V-01)

Hybrid, ECIES-style encryption of a JSON payload for the Processor. Defined once in `shared/src/envelope.ts`; the Dart copy `wallet/lib/core/envelope.dart` matches it byte for byte, and both must pass `shared/test-vectors/envelope.json`.

```
Envelope = { v: 1, ephPub, nonce, ciphertext, tag }   // every binary field is lowercase 0x-hex
  ephPub      32 bytes   the wallet's ephemeral X25519 public key (fresh for every envelope)
  nonce       12 bytes   AES-GCM nonce, random
  ciphertext  n bytes    AES-256-GCM output, same length as the plaintext
  tag         16 bytes   AES-GCM tag
```

1. The Processor has an X25519 key pair `(p, P)`. `P` is published at `GET /v1/processor/pubkey`.
2. The wallet generates `(e, E)` and computes `shared = X25519(e, P)` (32 bytes). An all-zero `shared` is rejected.
3. `key = HKDF-SHA256(ikm = shared, salt = E ‖ P (64 bytes), info = utf8("sammati-vault-v1"), length = 32)`.
4. `plaintext = canonicalBytes(payload)` (`drd.md` §4.1: sorted keys, integers only). The payload is built per purpose by `profilePayload(profile, categories)` (§4.6): one entry, keyed by profile field name, for each data category of **that purpose**, and nothing else. For `credit_check` with the categories `financial.pan`, `financial.income_band`, `financial.employment` it is `{ employment, incomeBand, pan }`, exactly as before; a purpose that also declares `identity.name` adds `fullName`. A `score` is sent only if the user's own bureau data supplies one (the wallet has none). The vectors in `shared/test-vectors/envelope.json` use made-up values.
5. `AAD = canonicalBytes({ fiduciary, principal, purposeCode, v: 1 })` with both addresses lowercased. The envelope is therefore bound to one customer, one company and one purpose: moving it to another purpose or principal fails authentication. The AAD is not stored in the envelope; the Processor rebuilds it from the vault row.
6. `AES-256-GCM(key, nonce, plaintext, AAD)` gives `ciphertext` and `tag`.
7. `handle = keccak256(canonicalBytes(envelope))`. `ciphertextHash = keccak256(ciphertext ‖ tag)`.
8. Submission is signed by the principal: EIP-191 personal message `sammati-vault-submit:v2:<handle>:<requestId>:<version>` (`v1` without a version is retired; V-08), recovered address must equal `principal`. This is not an EIP-712 type and changes none of them (§4.1). It stops a stranger who knows an address from replacing that person's vault entry with junk, and `requestId` makes a replay of the same submission idempotent.

`shared/test-vectors/envelope.json`: `{ processor: { privateKey, publicKey }, cases: [{ name, ephemeralPrivateKey, nonce, fiduciary, principal, purposeCode, payload, aad, plaintext, envelope, handle, ciphertextHash }], negative: [{ name, envelope, aad, expect: "fail" }] }`. Sealing with the given ephemeral key and nonce must reproduce `envelope` exactly; opening with the processor key must reproduce `plaintext`; each negative case (flipped tag, flipped ciphertext, wrong AAD, wrong version, all-zero `ephPub`) must fail to open. Generated by `pnpm --filter @sammati/shared vectors`.

### 4.5 Signed messages for identity and request actions (N-01, N-02)

Registering a Sammati ID, declining a request and blocking a company are not consents and are never checked on chain, so they do **not** get an EIP-712 type (the types of §4.1 are unchanged). Each is an EIP-191 personal message, signed by the wallet key and verified by Core with `verifyMessage`:

| Action | Message |
|---|---|
| Register an ID | `sammati-id:v1:<handle>:<principal>:<issuedAt>` |
| Decline a request | `sammati-decline:v1:<requestId>:<principal>:<issuedAt>` |
| Block or unblock a company | `sammati-block:v1:<block\|unblock>:<fiduciary>:<principal>:<issuedAt>` |

`principal` and `fiduciary` are lower-case addresses, `issuedAt` unix seconds. Core accepts a message only if the recovered signer is `principal` and `|now - issuedAt| <= IDENTITY_FRESHNESS_SECONDS` (900). A replay inside that window repeats an action that is already in force, so it changes nothing: registration, decline and block are all states, not counters. Every signature prompts the user like any other.

### 4.6 Data category registry and the profile (W-13, W-15 to W-17, C-01)

`shared/src/categories.ts` exports `DATA_CATEGORIES`, an ordered, fixed list. Each entry is `{ id, group, field, kind, label: { en, hi, kn } }`; `field` is the wallet profile field the category maps to, `kind` says how it is entered and validated. The order below is the registry order. The Dart copy is `wallet/lib/core/data_categories.dart` and both must pass `shared/test-vectors/data-categories.json` (ids, order, fields, kinds, labels and `profilePayload` cases), generated by `pnpm --filter @sammati/shared vectors`.

| Category id | Group | Profile field | Kind and validation (on the phone, and again by the Processor where it has a rule) |
|---|---|---|---|
| `identity.name` | identity | `fullName` | text, 2 to 80 characters |
| `identity.dob` | identity | `dob` | date, stored as `YYYY-MM-DD`, a real date between 1900-01-01 and today |
| `identity.gender` | identity | `gender` | choice: `female`, `male`, `other`, `prefer_not_to_say` |
| `contact.mobile` | contact | `mobile` | text, 10 digits starting 6 to 9 (Indian mobile), stored without `+91` |
| `contact.email` | contact | `email` | text, `local@domain.tld`, at most 120 characters |
| `contact.address` | contact | `address` | multi-line text, 5 to 200 characters |
| `financial.pan` | financial | `pan` | text, `^[A-Z]{5}[0-9]{4}[A-Z]$` (upper-cased as typed) |
| `financial.income_band` | financial | `incomeBand` | choice: `0-3 LPA`, `3-6 LPA`, `6-9 LPA`, `9+ LPA` |
| `financial.employment` | financial | `employment` | choice: `salaried`, `self-employed`, `student`, `unemployed` |
| `financial.employer` | financial | `employer` | text, 2 to 80 characters |
| `health.blood_group` | health | `bloodGroup` | choice: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-` |
| `health.allergies` | health | `allergies` | multi-line text, 2 to 200 characters |
| `health.insurance_policy` | health | `insurancePolicy` | text, 4 to 30 letters, digits or dashes |
| `prefs.food` | prefs | `foodPreference` | choice: `vegetarian`, `non_vegetarian`, `vegan` |
| `prefs.delivery_address` | prefs | `deliveryAddress` | multi-line text, 5 to 200 characters |

Helpers in the same file: `isCategoryId(id)`, `normalizeCategories(ids)` (drops duplicates, orders by registry order; used when an application is stored, so the notice hash does not depend on the order a company typed), `profilePayload(profile, categories)` (the entries of `profile` whose field belongs to one of `categories`; a missing field is simply absent) and `missingFields(profile, categories)`.

Rules. (1) A purpose's `dataCategories` are registry ids only; an application with any other string is refused with 400 `BAD_APPLICATION` naming `purposes[i].dataCategories` (§6.12). (2) The notice's `dataCategories` are the stored list, already in registry order; the wallet hashes what it received (`drd.md` §4.2) and shows an id it does not know as the raw id (a newer registry), treating it as a field it cannot supply. (3) A `choice` value is the English code above, never the translated label, so the Processor and the vectors agree in every language. (4) Values are stored trimmed (the wallet trims before it validates; `isValidFieldValue` refuses leading or trailing space). The profile is a flat map of `field` to string. No field is required by the wallet; a purpose's categories decide what is needed, when it is needed.

## 5. Wallet technical notes
Packages: `flutter_riverpod`, `go_router`, `dio`, `web_socket_channel`, `mobile_scanner`, `flutter_secure_storage`, `local_auth`, `web3dart`, `eth_sig_util`, `flutter_local_notifications`, `flutter_localizations` + `intl`, `url_launcher`, `cryptography` (V-01: X25519, HKDF and AES-GCM in pure Dart, which also runs on web; chosen because `web3dart` has none of the three and `pointycastle` has no X25519).
- State: Riverpod providers for `consents`, `activity`, `cascade`, `locale`.
- Networking: REST for actions, one WebSocket for live updates, auto-reconnect.
- Config: `CORE_URL` and `CHAIN_EXPLORER_URL` in a build-time `.env`; QR "dev settings" screen to change the Core URL on the phone without rebuilding.
- Build: `flutter build apk --release`; install via `adb install`.
- **Profile vault (W-16).** `wallet/lib/core/profile_store.dart`. The profile document is JSON `{ v: 1, fields: { <field>: <string> }, shares: [...] }` (`drd.md` §3b). It is encrypted with AES-256-GCM (`cryptography`, already a dependency) under a random 32-byte **profile key**, with AAD `sammati-profile-v1`, a fresh 12-byte nonce on every save, and stored as one blob in `flutter_secure_storage` (`profile_blob`: nonce ‖ ciphertext ‖ tag, base64). The key is stored in `flutter_secure_storage` too (`profile_key`) but the code reads it **only after `UserPresence.confirm` succeeds**, the same seam that gates the wallet key (§4.2). The decrypted profile is held in memory by a Riverpod notifier for the foreground session and dropped when the app goes to the background; the next view prompts again. A failed or cancelled prompt leaves the profile locked and shows nothing. A blob that fails authentication is treated as lost (the screen says so) and is never half-shown. On the Chrome build the same code runs without a prompt, as for the wallet key (`wallet_platform.dart`); the key then sits in browser storage, which is a development convenience and not production security.
- **Account setup (W-15).** The router keeps a wallet that has not finished setup on `/create-account` (a non-secret `account_setup_done` flag in `shared_preferences`). Steps: choose an ID (`GET /v1/identities/availability`), create the wallet (device-credential prompt), register the ID (`POST /v1/identities`, one more prompt because every signature prompts), fill the profile (optional, skippable). If registration fails after the wallet exists (Core unreachable, ID taken in the meantime) the step shows the reason with Retry and "Choose another"; the wallet is never created twice. "Choose later" on step 1 skips the ID and leaves registration to W12.
- **What is sent where.** The profile is read only by the screens of W-15 to W-17 and by `VaultFlow` when it builds an envelope. It is never put in a `CoreApi` call, a log line, a route parameter or `extra`, a WebSocket subscription or an error message; `wallet/test/profile_privacy_test.dart` records every request the wallet makes in an account-and-share flow and fails if any body, query or header contains a profile value, other than the Processor submit whose body is the envelope (checked to contain none either).

## 6. Core service APIs

Base: `http://<lan-ip>:4000`. JSON everywhere. Errors: `{ "error": { "code": "...", "message": "..." } }`.

### 6.1 Consent flow
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/fiduciaries/:fid/requests` | Body `{ purposes:[code], customerAlias }` returns `{ requestId, qrPayload }` |
| GET | `/v1/health` | Liveness: `{ ok, service, time }` |
| GET | `/v1/requests/:requestId?principal=0x..` | Wallet fetches notice: fiduciary, purposes (localised text), noticeHash, typed-data template, nonce (the principal's current on-chain nonce; `"0"` if `principal` omitted) |
| POST | `/v1/consents/grant` | Body `{ request: GrantConsent, signature }` returns `{ txHash, status }` |
| POST | `/v1/consents/withdraw` | Body `{ request: WithdrawConsent, signature }` returns `{ txHash, status }` |
| GET | `/v1/principals/:addr/consents` | All consents grouped by fiduciary (each consent carries its purpose's `dataCategories`, registry ids in registry order, so the wallet can tell what a consent needs, W-13), plus `nonce` (the principal's current on-chain nonce, decimal string) and `domain` (the EIP-712 domain). The wallet needs both to sign a withdraw, which has no request to read them from |
| GET | `/v1/principals/:addr/activity?limit=` | Access feed |
| POST | `/v1/rights` | Data-rights request (W-10, `prd.md`). Body `{ principal, fiduciary, type: "access" \| "correction" \| "erasure" \| "grievance", note? }`; returns 201 and the record `{ id, principal, fiduciary, type, note, status: "open", createdAt, updatedAt }`. 400 for an unknown `type`, a malformed address or a non-text `note`; 404 `FIDUCIARY_NOT_FOUND` for a company that does not exist. Stored in `rights_requests` (`drd.md` §3); a status record only, it never touches the chain |
| GET | `/v1/principals/:addr/rights` | `{ principal, rights: [record + fiduciaryName] }`, oldest first. `status` moves `open` → `in_progress` → `resolved` (nothing advances it yet) |
| GET | `/v1/principals/:addr/cascade/:purposeId` | Processor acknowledgements |
| GET | `/v1/proof/consent/:txHash` | Event data, ledger head, explorer link |
| GET | `/v1/proof/access/:entryId` | Entry, Merkle path, anchor tx |
| POST | `/v1/identities` | Register a Sammati ID. Body `{ handle, principal, issuedAt, signature }` (§4.5). 201 `{ handle, principal }`; 200 if that wallet already has that handle; 400 `BAD_HANDLE`, `BAD_SIGNATURE`, `STALE_SIGNATURE`; 409 `HANDLE_TAKEN` for another wallet's handle. A wallet that registers a new handle gives up its old one |
| GET | `/v1/identities/availability?handle=&principal=` | Used by the account-creation step 1 (W-15). `{ handle, available }`: `handle` is lower-cased; `available` is true when nobody holds it, or when `principal` (optional) already holds it. 400 `BAD_HANDLE`; 429 `RATE_LIMITED` with `Retry-After` (`HANDLE_CHECKS_PER_MINUTE`, default 30, per client address). It answers nothing but availability: no address, no timestamp. See the limit below |
| GET | `/v1/principals/:addr/identity` | `{ handle: string \| null }`: the wallet's own handle |
| GET | `/v1/principals/:addr/requests` | The inbox: open requests addressed to this wallet, newest first: `{ requests: [{ requestId, fiduciary: { address, name, color, sector? }, purposes: [{ code, title }], message, createdAt, expiresAt, status }] }`. Open means Sent or Seen, not expired, company not blocked |
| POST | `/v1/requests/:requestId/decline` | Body `{ principal, issuedAt, signature }` (§4.5). 200 `{ status: "declined" }` (also when it already is); 404 for a request not addressed to this wallet, indistinguishable from an unknown one |
| GET | `/v1/principals/:addr/blocks` | `{ blocked: [{ fiduciary: { address, name }, blockedAt }] }` |
| POST | `/v1/principals/:addr/blocks` | Body `{ fiduciary, action: "block" \| "unblock", issuedAt, signature }` (§4.5). 200 `{ blocked: boolean }`. Blocking also declines that company's open requests |
| GET | `/v1/processor` | `{ url }`: where the wallet finds the Processor (`PROCESSOR_PUBLIC_URL`, §10). Core only points at it: it holds no key and never sees an envelope |
| POST | `/v1/events/vault` | The Processor reports a vault or processing event (§6.5) for Core to fan out. Header `x-sammati-processor-key: <PROCESSOR_EVENT_KEY>`, else 401 `UNAUTHORIZED`. Core copies only the allow-listed fields of the event (handles, hashes, codes, timings), so even a misbehaving sender cannot push other data through the hub. 202 `{ ok: true }`; 400 `BAD_EVENT` for an unknown event name or a missing field |

**Availability is a lookup, said plainly.** Anyone can already learn that a handle is taken by trying to register it (`409 HANDLE_TAKEN`), so the availability call adds convenience, not a new leak; the per-address rate limit is the only control. It does not change §6.11: a company that addresses a handle still gets the same answer in every case, and the SDK never calls this route. A company could use it to test whether a name is registered, which §6.11 already lists under what is not prevented.

Multi-purpose grants: the contract needs consecutive nonces, so the wallet signs the i-th purpose the user switched on (in notice order) with `nonce + i` and posts the grants one after another. A purpose the user left off does not consume a nonce. Before signing, the wallet re-fetches the notice (fresh nonce) and refuses if its `noticeHash` differs from the one shown.

`qrPayload` (JSON in QR): `{ "v":1, "core":"http://...", "requestId":"...", "fiduciary":"0x..", "name":"<company name>" }`.

### 6.2 Company and gateway
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/console/login` | Operator login (C-10). Body `{ email, password }` returns `{ token, operatorEmail, fiduciaries: [{ address, slug }] }` |
| GET | `/v1/console/me` | Authenticate operator. Header `Authorization: Bearer <token>` |
| GET | `/v1/fiduciaries/:fid/purposes` | List registered purposes |
| POST | `/v1/fiduciaries/:fid/purposes` | Register purpose (writes chain) |
| POST | `/v1/fiduciaries/:fid/processors` | Register downstream processor |
| GET | `/v1/fiduciaries/:fid/processors` | The processors a company declared: `{ fiduciary, processors: [{ name, address, purposeCode }] }`. The console's Processors section reads it, so a company that joined through R-01 shows its own |
| GET | `/v1/fiduciaries/:fid/purposes` | The company's purposes: `{ fiduciary, purposes: NoticePurpose[] }` (id, code, localised title and description, data categories, retention, sharing flag, `required`) |
| POST | `/v1/fiduciaries/:fid/requests/targeted` | Ask a specific customer (§6.11). Body `{ handle, purposes: [code], message?, expiresInHours? }`. **201 `{ requestId, status: "sent", expiresAt }` in every case where the handle is well formed**, whether or not it exists. 400 `BAD_HANDLE`, `BAD_REQUEST`, 404 `PURPOSE_NOT_FOUND`; 429 `RATE_LIMITED` (with `Retry-After`) when the company is over its own limit. Real mode only (501 in the stub) |
| GET | `/v1/fiduciaries/:fid/requests/targeted` | The company's sent requests, newest first: `{ requests: [{ requestId, handle, purposes, message, status, createdAt, expiresAt }] }`. `handle` is the text the company typed; there is no principal in it |
| GET | `/v1/fiduciaries/:fid/requests/targeted/:requestId` | One request's `{ requestId, status, expiresAt }`; 404 if it is another company's |
| GET | `/v1/fiduciaries/:fid/consents` | Console table |
| GET | `/v1/fiduciaries/:fid/access?limit=` | Console feed and history, newest first (the SDK reads `limit=1` to resume `seq`/`prevHash`) |
| POST | `/v1/gateway/log` | SDK posts each decision entry |
| GET | `/v1/gateway/consent-state?principal=&fid=&purpose=` | SDK fallback check |
| POST | `/v1/fiduciaries/:fid/export` | Compliance pack (C-08) |
| GET | `/v1/fiduciaries/:fid/rights` | List rights requests (erasure, grievance) for the company |
| POST | `/v1/fiduciaries/:fid/rights/:id/resolve` | Resolve a rights request (company marks it done) |

### 6.2a Company authentication (R-03)

A company's server proves who it is with its **API key**, header `x-sammati-api-key`. Core stores only `SHA-256(key)` (`drd.md` §3, `fiduciary_credentials`); the key is 32 random bytes, so a fast hash is enough and a lookup by hash is exact. A key identifies exactly one fiduciary.

| Endpoint | Key |
|---|---|
| `POST /v1/gateway/log`, `GET /v1/gateway/consent-state`, `GET /v1/gateway/whoami` | **Required.** The entry's `fiduciary` (log) or `fid` (consent-state) must be the key's company, else 403 `FIDUCIARY_MISMATCH`. No header or an unknown key: 401 `INVALID_API_KEY` |
| `POST /v1/fiduciaries/:fid/requests`, `.../requests/targeted`, `GET .../requests/targeted*` | Optional. If the header is present it must belong to `:fid` (403 `FIDUCIARY_MISMATCH`); an unknown key is 401. Without it the call is the demo console's, which has no login in this build (disclosed in `demo.md`) |
| `GET /v1/fiduciaries/:fid/access` and every other read | none, as before |

- `GET /v1/gateway/whoami` returns `{ fiduciary, slug, name, sandbox }`. The Processor uses it to resolve a key it does not know from its own configuration (§6.7).
- **Errors of the regulator routes.** 400 `BAD_NOTE` (a note over 280 characters, or missing when rejecting); 404 `FIDUCIARY_NOT_FOUND` for an unknown company.
- **Rate limit.** Calls that carry a key are counted per fiduciary over a rolling 60 s (`GATEWAY_RATE_PER_MINUTE`, default 600): over it, 429 `RATE_LIMITED` with `Retry-After`. The targeted-request limit of §6.11 is separate and unchanged.
- **Fail closed, clearly.** A missing, unknown or unapproved key is 401 `INVALID_API_KEY` with the message "This API key is not recognised. A company can use Sammati only after the regulator approves its registration." The SDK turns any such answer into `451 LEDGER_UNAVAILABLE` (it cannot verify consent) with that message, and logs one clear warning (§7).
- **No company has a built-in key.** Every key is generated at approval (R-02) and shown once; none is built in (X-01).

### 6.3 Auditor
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/audit/fiduciaries` | List with scorecards |
| GET | `/v1/audit/ledger?fid=&principal=&type=` | Ledger explorer |
| POST | `/v1/audit/verify/:fid` | Recompute chain and roots vs anchors, returns per-batch results |
| GET | `/v1/audit/report/:fid` | Report JSON (PDF rendered client side) |

#### Audit semantics (real mode)
- **Anchor job.** Core anchors each company's pending log entries every 10 s (`ANCHOR_INTERVAL_MS`), or as soon as 20 are waiting, in batches of at most 100: Merkle root over the stored `entry.hash` values, then `anchorAccessBatch` from the company's own key (a disclosed demo shortcut, `shared/seed.ts`). The next batch always starts at the chain's last `toSeq + 1`, so a hole in the stored log stops anchoring instead of being papered over; the indexer then fills `anchor_batches` and `access_logs.batch_index`.
- **Verify** (`POST /v1/audit/verify/:fid`) reads the batches from the **chain**, not from Core's tables, and checks each stored row three ways: its `hash` against `keccak256(prevHash || canonical entry)`; its `prevHash` against the previous row's `hash`; and `seq` for gaps. Each batch's Merkle root is rebuilt from the *recomputed* hashes and compared with the on-chain root and `count`. `firstMismatch` is the lowest `seq` with a row-level problem: `HASH_MISMATCH` (a row was edited), `BROKEN_LINK` (the row after an edit that was re-hashed, or after a deletion), `MISSING_ENTRY` (a gap); when every row is self-consistent but a root differs it is `ROOT_MISMATCH` with `seq: null` and the `batchIndex`. A failed verification pushes `tamper.alert`.
- **Scorecard.** `integrity` is the result of the last verify (`unverified` until one runs). `violations` counts `ALLOWED` log entries that happened with no valid consent, judged against the ledger with a one-second tolerance in the company's favour (an entry in the same second as a grant or withdrawal is not a violation). `avgWithdrawalToBlockSeconds` is, over withdrawals followed by at least one request, how long after the withdrawal the company still allowed access (0 = blocked from the first request after it). `unacknowledgedCascades` counts processors that have not acknowledged a withdrawal older than 30 s.
- **Proofs.** `GET /v1/proof/access/:entryId` returns the entry, the Merkle path built from the stored rows, and the root of the on-chain batch. A client checks two things: that `keccak256(prevHash || canonical entry)` equals the entry's `hash` (this catches an edited row), and that the path leads from that hash to the on-chain root (this catches a row whose hash was rewritten to match).

### 6.4 Dev tools (CLI only, `DEV_TOOLS=true`)
There is **no HTTP endpoint** that resets state, edits a log, signs for a customer or fabricates an access decision (X-01). Core and the Processor have no `/v1/demo/*` routes. What a developer needs for testing is two command-line scripts, enabled only when `DEV_TOOLS=true`:

| Command | Does |
|---|---|
| `pnpm dev:reset` | Resets the local chain (`hardhat_reset`), redeploys the contracts, funds the relayer, syncs the chain clock, and deletes Core's SQLite database and the Processor's vault files when no process holds them open. A Core or Processor that is still running notices the replaced chain (Core's chain fingerprint, the Processor's sweep) and wipes the rows that described it. Registers nothing: no company, purpose, processor or customer exists afterwards |
| `pnpm dev:tamper -- <fiduciary> <seq>` | Opens Core's SQLite file directly and flips the `decision` of the stored access-log row `seq` of that company (an address or a slug), leaving its hash untouched, like an insider hiding a refusal. The Auditor's real **Verify** then reports the batch and record that no longer match the on-chain anchor. It prints the row it changed and refuses a row that does not exist |

Rules: both scripts refuse to run unless `DEV_TOOLS=true` is set in the environment of that one command (inline: `DEV_TOOLS=true pnpm dev:tamper -- …`; a value that only came from a `.env` file is ignored, §10.8); Core and the Processor **fail to start** if `DEV_TOOLS=true` and `NODE_ENV=production`; neither script is reachable over HTTP or from any UI, and no server code imports them. They act on files and the local chain, so they leave no back door in a running service.

### 6.5 WebSocket `/ws`
Subscribe message: `{ "sub": ["principal:0x..", "fiduciary:0x..", "auditor"] }`.
Core answers a subscribe message with an acknowledgement `{ "event": "subscribed", "topics": [...] }` once the topics are active (the gateway trusts its consent cache only after this; other clients may ignore it).
Events: `consent.updated`, `access.logged`, `cascade.updated`, `anchor.posted`, `tamper.alert`, `consent.requested`, `request.updated`, the notification events (`consent.expiring`, `consent.expired`, `consent.renewal_requested`, `data.erased`, `cascade.acknowledged`, §6.12) and the confidential-processing events below.

- `consent.requested` (to `principal:<addr>` only): `{ event, principal, requestId, fiduciary, fiduciaryName, purposeCodes, message, expiresAt, at }`. The wallet refetches its inbox when it arrives.
- `request.updated` (to `fiduciary:<addr>` only): `{ event, fiduciary, requestId, status, at }`. It carries **no principal**: a company hears that its request was seen, granted, declined or expired, never who the customer is (they appear in the consents table only once consent exists, as before).
Payloads include the entity ids and the minimal fields the UI renders.

Confidential-processing events (V-06). The Processor posts them to Core (`POST /v1/events/vault`), Core publishes them to `principal:<principal>`, `fiduciary:<fiduciary>` and `auditor`. **No payload ever carries plaintext, an envelope or a ciphertext**: only addresses, the `handle`, hashes, purpose code, timings and the decision. Common fields: `principal`, `fiduciary`, `purposeCode`, `handle`, `at` (unix seconds) and `atMs` (unix milliseconds, the same instant: the Data Flow Inspector's timeline needs finer than a second).

| Event | When | Extra fields |
|---|---|---|
| `vault.encrypted` | The Processor received a well-formed envelope with a valid principal signature (still ciphertext; consent not yet checked) | `ciphertextHash`, `sizeBytes` |
| `vault.stored` | The consent was verified on chain and the ciphertext persisted | `ciphertextHash`, `sizeBytes` |
| `processor.requested` | A company's authenticated evaluate call for a known handle was accepted | `action`, `requestedAt` (ms) |
| `processor.decrypting` | Consent verified; the envelope is being opened in memory | `decryptingAt` (ms) |
| `processor.decided` | The call finished | `decision` (`approved`, `declined`, `blocked` or `error`), `limit` (integer INR or `null`), `reasonCodes` (decision codes, §6.7, or for `blocked` the one consent reason code), `entryId` (the access-log entry), `durationMs` |
| `vault.erased` | The ciphertext was erased | `cause` (`withdrawn`, `expired`, `no_consent` or `superseded`) |

`decision` here is the Processor's outcome and is not the ALLOWED/BLOCKED of `access.logged`. A blocked evaluate emits both.

### 6.12 Company onboarding (R-01, R-02, R-03)

**Directory.** `GET /v1/fiduciaries` → `{ fiduciaries: [{ address, slug, name, sector, color, sandbox }] }`: every approved company, oldest first. `slug` is the lower-case name with runs of non-alphanumerics turned into `-` (2 to 30 characters, unique across companies and pending applications); the console route is `/company/<slug>`. `color` is `#16173F` (`ink`) for every company, so no new colour exists.

**Public (no key, no login).**

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/registrations` | Body `ApplicationInput` below. 201 `{ applicationId, status: "pending" }`. 400 `BAD_APPLICATION` (message names the field); 409 `NAME_TAKEN`; 429 `RATE_LIMITED` (`REGISTRATIONS_PER_HOUR` per client address, default 5) or `TOO_MANY_PENDING` (`MAX_PENDING_APPLICATIONS`, default 50). `applicationId` is 16 random bytes, hex: it is the applicant's bearer secret for the status page |
| GET | `/v1/registrations/:applicationId` | `{ applicationId, name, sector, status, note, createdAt, decidedAt, result }`. 404 `APPLICATION_NOT_FOUND`. `result` is null until approved; then `{ fiduciary, slug, sandbox, apiKey }` where `apiKey` is the key **the first time it is read** and `null` afterwards, with `apiKeyShown: true` |

```ts
ApplicationInput = {
  name: string,                  // 2 to 60 characters, no control characters
  sector: string,                // 2 to 40
  contactEmail: string,          // looks like an email, at most 120; kept only in the application row (drd.md §3)
  purposes: Array<{              // 1 to 8; codes unique within the application
    code: string,                // ^[a-z][a-z0-9_]{2,31}$
    title: LocalizedText,        // en, hi, kn all required, 1 to 60 characters each
    description: LocalizedText,  // en, hi, kn all required, 1 to 200 characters each
    dataCategories: string[],    // 1 to 8 ids from the registry of §4.6; duplicates removed, stored in registry order; any other string is refused
    retentionDays: number,       // integer 1 to 3650
    sharesThirdParty: boolean,
    required: boolean,
  }>,
  processors: Array<{ name: string, purposeCode: string }>,   // 0 to 6; name 2 to 40; purposeCode is one of the application's
}
```

**Regulator** (header `x-sammati-regulator-key: <REGULATOR_KEY>`; missing or wrong is 401 `UNAUTHORIZED`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/regulator/registrations?status=` | `{ applications: [ApplicationView + contactEmail] }`, newest first; `status` is `pending`, `approved` or `rejected` |
| POST | `/v1/regulator/registrations/:id/approve` | Body `{ note?, sandbox? }` (`sandbox` defaults to true). Runs the approval below. 200 `{ application, fiduciary: { address, slug }, txHashes: [Hex] }`. 409 `ALREADY_DECIDED`; 502 `REGISTRATION_FAILED` (a chain step failed; nothing is half-visible, and the same call can be repeated) |
| POST | `/v1/regulator/registrations/:id/reject` | Body `{ note }`, 1 to 280 characters. 200 `{ application }`. 409 `ALREADY_DECIDED` |
| POST | `/v1/regulator/fiduciaries/:fid/sandbox` | Body `{ sandbox: boolean }`. Promote (`false`) or demote (`true`). 200 `{ fiduciary, sandbox }` |
| POST | `/v1/regulator/fiduciaries/:fid/operator` | Body `{ email, password }` (password at least 8 characters). Creates, or replaces the password of, a console operator who may sign in to that company's console (`POST /v1/console/login`, C-10). For a company approved without a console login (an application that carried no password). 200 `{ ok: true }`, 404 `FIDUCIARY_NOT_FOUND`, 400 for a bad email or short password. The password is stored as a hash and never returned |
| POST | `/v1/regulator/fiduciaries/:fid/reissue-key` | Replaces the company's API key (the old one stops working at once) and holds the new one for the applicant's next read of `GET /v1/registrations/:id`. 200 `{ ok: true }`. The regulator never sees the key |
| GET / POST / DELETE | `/v1/regulator/test-principals` (`/:principal`) | The sandbox's test customers. GET `{ principals: [{ principal, handle, addedAt }] }`; POST body `{ handle }` or `{ principal }` answers 201 `{ principals, added }` (a handle must be registered, else 404 `HANDLE_NOT_FOUND`: only the regulator can ask, so this leaks nothing to a company); DELETE removes one and answers `{ principals }`. The demo principal (`DEMO_PRINCIPAL`) and `SANDBOX_TEST_PRINCIPALS` are always test customers |

**Approval, step by step** (`core/src/real/registration.ts`; one approval at a time):
1. Nothing changes in the directory yet. Generate the company's key pair (`ethers.Wallet.createRandom()`), store it in `fiduciary_keys` and the address on the application row (so a retry reuses it). For each processor generate a key pair the same way (`processor_keys`).
2. The admin account sends the company `REGISTRATION_FUNDING_ETH` (default 1) and each processor 0.1 ETH of the local chain's test ether, if they are below that.
3. Admin: `registerFiduciary(address, name, fiduciaryMetaHash)`. Company key: `registerPurpose(purposeId, descHash, retentionDays, shares)` for each purpose; `registerProcessor(purposeId, processor, processorMetaHash)` for each processor. A step whose effect is already on chain (`isFiduciary`, a purpose with an owner, `isProcessor`) is skipped, which makes a retry safe.
4. In one database transaction: insert the `fiduciaries` (with `slug`, `sandbox`), `purposes` and `processors` rows, insert `fiduciary_credentials` with the hash of a fresh API key, set the application `approved`, store the note, set `decided_at` and erase the contact email. Hold the plain key in memory for the applicant's one read (lost if Core restarts: the regulator reissues).
5. Run the indexer so the registrations are in the ledger explorer immediately, and publish `fiduciary.registered` (below).

Reject: set `rejected`, store the note and erase the email. Nothing else exists for that company, so `POST /v1/fiduciaries/<anything>/requests` has no company to find: 404 `FIDUCIARY_NOT_FOUND`.

**Sandbox rules** (Core policy, enforced at the relayer and the request routes; the contracts are unchanged, and the policy says so honestly in `architecture.md` §5.7). A sandbox company:
- cannot address a customer who is not a test customer: `POST .../requests/targeted` still answers 201 `sent` (the anti-enumeration rule of §6.11), but the request is not delivered, exactly like an unknown handle;
- cannot obtain a notice for a non-test customer: `GET /v1/requests/:id?principal=` answers 403 `SANDBOX_COMPANY` ("This company is in the Sammati test sandbox and can only ask test customers");
- cannot receive a grant from a non-test customer: `POST /v1/consents/grant` answers 403 `SANDBOX_COMPANY` before anything is relayed.
Withdrawals are never refused. Promotion removes all three checks.

**New events.** `fiduciary.registered` `{ event, fiduciary, slug, name, sandbox, at }` to the `auditor` topic and `fiduciary:<address>`; `fiduciary.updated` (sandbox changed) `{ event, fiduciary, slug, sandbox, at }` to the same. The web console and Stage refresh their directory on either.

**Env (Core).** `REGULATOR_KEY` (default `demo-regulator-key`, a disclosed shared secret; set your own anywhere that is not a local machine), `ADMIN_KEY` (default Hardhat account #0, the admin the deploy script uses), `REGISTRATION_FUNDING_ETH` (1), `REGISTRATIONS_PER_HOUR` (5), `MAX_PENDING_APPLICATIONS` (50), `GATEWAY_RATE_PER_MINUTE` (600), `SANDBOX_TEST_PRINCIPALS` (comma-separated addresses). **Dependencies:** none new (`node:crypto` for hashing and random bytes, `ethers` for keys).

### 6.6 Core's runtime
Core has one mode. It is backed by SQLite (`drd.md` §3), the chain and a relayer wallet.
- **Grant/withdraw:** the relayer submits `grantConsent` / `withdrawConsent` and waits for the receipt, so `status` is `"confirmed"`. Contract reverts map to HTTP errors: `InvalidSignature` → 400 `BAD_SIGNATURE`, `InvalidNonce` → 409 `BAD_NONCE`, `SignatureExpired` → 400 `DEADLINE_PASSED`, `InvalidExpiry` → 400 `BAD_EXPIRY`, `UnknownPurpose` → 404 `PURPOSE_NOT_FOUND`, `WrongFiduciary` → 400 `WRONG_FIDUCIARY`, `PurposeInactive` → 409 `PURPOSE_INACTIVE`, `NotActive` → 409 `NOT_ACTIVE`. An unreachable node is 503 `LEDGER_UNAVAILABLE`.
- **Indexer:** polls chain events into `ledger_events` and `consents_cache` (and `anchor_batches`, `cascade_acks`), pushes `consent.updated`, `cascade.updated` and `anchor.posted`, and resumes from `indexer_state`. It also ingests the receipt of every relayed transaction immediately; the unique `(tx_hash, log_index)` key makes the two paths agree.
- **`/v1/gateway/consent-state`** reads the chain directly (the cache can lag), and answers 503 `LEDGER_UNAVAILABLE` when it cannot, which the SDK treats as BLOCKED (fail closed).
- **Request notices:** `GET /v1/requests/:id` expires a request after `REQUEST_TTL_SECONDS` (default 1800) with 410 `REQUEST_EXPIRED`.
- **Not built yet in real mode (501 `NOT_IMPLEMENTED`):** `POST /v1/fiduciaries/:fid/purposes` and `/processors` (a company declares its purposes and processors in its application, §6.12). The cascade engine (§9) is built and acknowledges on chain. The audit report is not signed (A-04 asks for it); `reportHash` and signing are future work.
- **Config:** `CHAIN_RPC` (default `http://127.0.0.1:8545`), `CHAIN_NETWORK` (the key in `shared/deployments.json`, default `localhost`), `RELAYER_KEY` (default the public local-chain relayer key; Core refuses it on a public network), `DB_PATH` (default `./data/sammati.sqlite`). Core waits for the chain and contracts at startup rather than exiting. Start it with `pnpm demo:up`.

### 6.7 Sammati Processor (`processor/`, port 4200)

A separate process from Core and from every company. It is the only place where a vault envelope is opened. Base `http://<lan-ip>:4200`. Errors `{ "error": { "code", "message" } }`, except consent refusals, which are `451 { "code": <reason code>, "message" }` like the gateway's.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/processor/pubkey` | none | `{ v: 1, alg: "X25519", publicKey: "0x…", mode: "simulated-enclave" }`. `mode` is shown in the wallet and the console: the Processor is not a real enclave (`architecture.md` §5.5) |
| POST | `/v1/vault/submit` | principal signature | Body `{ principal, fiduciary, purposeCode, envelope, requestId, signature }`. Returns 201 `{ handle, ciphertextHash }` (200 with the same body when the handle already exists) |
| GET | `/v1/vault/:handle` | none | `{ handle, principal, fiduciary, purposeCode, ciphertextHash, status: "stored" \| "erased", createdAt, erasedAt, envelope }`; `envelope` is `null` once erased. Never plaintext, for anyone |
| POST | `/v1/processor/evaluate` | company API key | Body `{ handle, fiduciary, purposeCode, action: "loan_decision" }`. 200 `{ decision, limit, reasonCodes, entryId }`; header `x-sammati-entry-id` |
| GET | `/health` | none | `{ ok, service: "processor", mode: "simulated-enclave", time }` |
| POST | `/v1/processor/callback` | company API key | Body `{ url }` (http or https). The company says where to POST `stored` and `erased` notices (§ Company webhook). Memory only: the sample lender registers again every 30 s and after a Processor restart. 401 without a valid key, 400 for a bad url. 204 |

**Submit.** (1) Validate shape: lowercase-hex fields of the right length (`ephPub` 32, `nonce` 12, `tag` 16), `v == 1`, `purposeCode` a short code, envelope at most 4 KiB; else 400 `BAD_ENVELOPE`. (2) Compute `handle`; verify the EIP-191 signature (§4.4.8): else 400 `BAD_SIGNATURE`. Emit `vault.encrypted`. (3) Read `hasValidConsent(principal, fiduciary, purposeIdOf(fiduciary, purposeCode))` **from the chain**, not from Core: Core cannot make the Processor accept data. (Chain access needs `shared/deployments.json` and the registry ABI, like Core.) Not valid: 451 with the reason (`NO_CONSENT`, `CONSENT_WITHDRAWN`, `CONSENT_EXPIRED`); chain unreachable: 451 `LEDGER_UNAVAILABLE`. (4) Store `{ handle, principal, fiduciary, purposeCode, ciphertextHash, ciphertext }` (`drd.md` §3); erase older live rows for the same principal, fiduciary and purpose (`cause: "superseded"`) so one live copy exists. Emit `vault.stored`. (5) Tell the company's webhook (below). The Processor does **not** open the envelope at submit: a malformed ciphertext is discovered at evaluate, which answers `CIPHERTEXT_INVALID`.

**Evaluate.** (1) `x-sammati-api-key` identifies a fiduciary (`FIDUCIARY_API_KEYS`; a key not in that map is looked up with Core's `GET /v1/gateway/whoami`, §6.2a, and remembered for 60 s, so a company registered through R-01 can call the Processor with the key it got; a Core that cannot be reached means the key is unknown); unknown key 401 `UNAUTHORIZED`; `fiduciary` in the body must be that company, `action` must be `loan_decision` (else 400 `UNSUPPORTED_ACTION`). (2) Unknown handle, or a handle of another company: 404 `HANDLE_NOT_FOUND` (the two are indistinguishable). Emit `processor.requested`. (3) Consent, from the chain, for the **requested** `purposeCode`: not valid, or the handle was submitted for a different purpose, is refused with 451 and the reason code (a different purpose answers `NO_CONSENT`); chain unreachable is `LEDGER_UNAVAILABLE` and **erases nothing**. (4) A refusal writes a BLOCKED access-log entry and emits `processor.decided` (`blocked`). When the reason is `CONSENT_WITHDRAWN` or `NO_CONSENT`, the ciphertext is erased now (`vault.erased`); for `CONSENT_EXPIRED` it is erased only once the grace period (below, Erasure) has passed. (5) Consent valid but the row is already erased: 410 `VAULT_ERASED` (the customer must submit again). (6) Emit `processor.decrypting`; open the envelope in memory. Authentication failure or a payload that is not the expected JSON: 422 `CIPHERTEXT_INVALID`, `processor.decided` (`error`), never a guessed decision. (7) Run the rules below, drop the plaintext reference, respond. (8) Write an ALLOWED access-log entry (`endpoint: "POST /v1/processor/evaluate"`, `reason: "OK"`; an authentication failure is ALLOWED too, since consent was valid and the data was handled) and emit `processor.decided`.

**Rules (deterministic, `processor/src/rules.ts`).** Decision codes are not consent reason codes and never appear in `access_logs.reason`.

| Check | Outcome |
|---|---|
| `pan` does not match `^[A-Z]{5}[0-9]{4}[A-Z]$` | declined, `PAN_INVALID` |
| `incomeBand` not one of `0-3 LPA`, `3-6 LPA`, `6-9 LPA`, `9+ LPA` | declined, `INCOME_UNKNOWN` |
| `employment`, when present, is not one of `salaried`, `self-employed`, `student`, `unemployed` | declined, `EMPLOYMENT_UNKNOWN` |
| `employment` is `student` or `unemployed` | declined, `EMPLOYMENT_INELIGIBLE` |
| `score` absent (the wallet's manual entry has no credit score to give) | the Processor assumes 700 and adds the code `SCORE_ASSUMED` to the answer, so it is never mistaken for a measured score |
| `score < 650` (integer) | declined, `SCORE_LOW` |
| otherwise | approved. `base` = 100000, 250000, 500000 or 1000000 for the four bands. `score >= 750`: `limit = base`, code `SCORE_GOOD`. `650..749`: `limit = base * 60 / 100`, code `SCORE_FAIR` |

Details typed in the wallet carry no score, so for 6-9 LPA, salaried the answer is `approved`, `limit: 300000`, `["SCORE_FAIR", "SCORE_ASSUMED"]`; a payload that does carry `score: 742` gives `["SCORE_FAIR"]`. A declined answer has `limit: null`. The decision itself reveals coarse facts (a score band): that is the point of data minimisation, and `demo.md` says so.

**Withdrawals of registered companies.** The Processor also subscribes to Core's `auditor` topic, so it hears every `consent.updated`, including those of companies that joined after it started; the periodic sweep remains the backstop.

**Erasure.** A row is erased by overwriting `ciphertext` with `NULL` and setting `erased_at`; the metadata row stays so a later call can still be told why. Triggers: evaluate refusals above; the Processor's subscription to Core's `fiduciary:<address>` topic (a `consent.updated` that is no longer Active for a stored row erases it at once); a sweep every `PROCESSOR_SWEEP_MS` that re-checks every live row on chain (covers expiry and missed events); a newer submission. It never erases when the chain cannot be read. **Expiry has a grace period** (N-03): while a consent has expired but `now < expiresAt + EXPIRY_ERASURE_GRACE_SECONDS` (default 7 days) every evaluate is refused with 451 `CONSENT_EXPIRED`, nothing is decrypted, and the ciphertext is **kept**, so a renewal inside the window does not make the customer send the details again; after it, the next evaluate or sweep erases it (`vault.erased`, cause `expired`). Withdrawal has no grace: it erases at once. A renewal that arrives in time makes the kept ciphertext usable again (the purpose, and the customer's consent for it, are the same). The Processor reads `expiresAt` from the same on-chain read.

**Company webhook.** After `vault.stored` and `vault.erased` the Processor POSTs `{ event: "stored" \| "erased", handle, principal, purposeCode, ciphertextHash }` to the company's callback (`FIDUCIARY_CALLBACKS`, default `http://localhost:<company port>/vault/events`) with the company's API key in `x-sammati-api-key`, 3 s timeout, failures only warned about. QuickLoan keeps the handle and nothing else (§6.8).

**No plaintext outside the Processor, enforced.** The plaintext exists as a local variable inside one function (`evaluate`), is never assigned to a longer-lived object, never interpolated into a log line, error message or event, and is not in any thrown error (errors on the decrypt path carry fixed messages only). The request logger prints method, path, status and duration, never bodies. `processor/test` and `pnpm e2e` search for the demo PAN in logs, events, HTTP responses and database files (§11).

### 6.8 The sample lender and the Processor (V-05)

`examples/lender` is the reference integration: one app, configured by `CORE_URL`, `FIDUCIARY` (the company address), `SAMMATI_API_KEY`, `PROCESSOR_URL` and `LOAN_PURPOSE` (default `credit_check`). It names no company and holds no customer data, no payload and no key of its own. It never holds or returns a credit profile.
- `POST /vault/events`: the Processor's webhook (API key checked). Stores `{ handle, ciphertextHash, status }` per principal, in memory.
- `GET /customers/:id/credit-profile` (still `requireConsent("credit_check")`, the admin view): `{ handle, ciphertextHash, status: "stored" \| "erased" \| "none" }` and nothing else.
- `POST /customers/:id/apply` (principal in `x-sammati-principal`): calls the Processor's evaluate with the stored handle and the company's API key, and returns its answer or its refusal unchanged (a 451 keeps its reason code and `x-sammati-entry-id`). It is **not** wrapped in `requireConsent`: the Processor checks consent and writes the log entry, so the access is logged once, by the party that touched the data. No handle on record: 409 `NO_SUBMISSION`. A request with no valid principal is `451 NO_PRINCIPAL`, logged BLOCKED through `gate.logAccess`, and goes no further. The apply answer of any status keeps the Processor's body, and `x-sammati-entry-id` when it sent one.

### 6.9 (removed, X-01)

The Data Flow Inspector and its replay mode are gone. That no plaintext reaches a company or a server is checked by `pnpm e2e` (§11).

### 6.10 Company customer portal (web, C-09)

A route of the web app, `/portal/:slug`, for any approved company that runs the sample lender (`?purpose=` names the loan purpose, default `credit_check`). It is a stand-in for the company's own website: it talks to Core for the consent request, to Core's WebSocket for what happens, and to the company's backend for Apply. It never talks to the Processor and never holds data.

**State machine** (`web/src/portal/journey.ts`, pure TypeScript with injected I/O, so `pnpm e2e` drives the very same code with real answers):

| Stage | Entered when | Page shows |
|---|---|---|
| `logged-out` | start, or sign out | a sign-in: one text input for the customer id (a company-side alias) |
| `form` | login | the loan application form: the checkbox "Allow {company} to use my data for loan purposes" (unticked), the purposes beneath it, Apply disabled |
| `awaiting-scan` | the checkbox is ticked and `POST /v1/fiduciaries/:fid/requests` answered | the QR inline (the request's `qrPayload`), "Waiting for you to approve in the Sammati app...", a live status. Unticking cancels and returns to `form` |
| `consent-received` | `consent.updated` Active for `credit_check` after the request was made, and the company-side table maps that principal to this alias | "Consent received", the short tx hash, and for each sensitive field (PAN, income, employment) "Provided securely in your Sammati app"; Apply disabled |
| `data-submitted` | `vault.stored` for this customer and purpose | "Data submitted securely", the handle and ciphertext hash only; Apply enabled |
| `decided` | Apply answered 200 | the decision card: Approved or Declined, the limit, the reason codes |
| `withdrawn` | `consent.updated` Withdrawn for this customer, or Apply answered 451 `CONSENT_WITHDRAWN` | "Consent withdrawn. Application cannot be processed"; Apply disabled |
| `error` | a request failed or Core is unreachable | what failed and how to retry; the form is kept |

- **Who the customer is.** The page never asks for an address. After a `consent.updated` Active it reads the company-side consents table (`GET /v1/fiduciaries/:fid/consents`, `customerAlias` per row, `trd.md` §6.2) and accepts the event only if the row of that principal carries this page's alias. Another customer consenting at the same time is ignored.
- **Optional purposes.** Every other purpose of the company is listed unticked; those the customer ticks before the main box go into the request. The loan purpose (`credit_check` by default) is what the main checkbox asks for. After the QR exists the boxes are locked.
- **Apply.** `POST <the company>/customers/<alias>/apply` with `x-sammati-principal` (`trd.md` §6.8). 200: the decision card from `{ decision, limit, reasonCodes }`. 451: `CONSENT_WITHDRAWN` moves to `withdrawn`, any other reason is shown as the refusal it is. 409 `NO_SUBMISSION` and everything else: `error`, with Apply still available.
- **Never plaintext.** The page has no field for a PAN or an income and no code that could display one. The sign-in refuses an alias shaped like a PAN ("That looks like a PAN. The company does not need it here."). Every frame the page receives is scanned (`web/src/portal/privacy.ts`) for field names only a profile has (`pan`, `incomeBand`, `score`, `plaintext`): if a profile value turns up in one, the page shows a plain warning and stops the journey (`error`) rather than render it.

**Wallet side (W-13, `ui.md` W10).** What the wallet encrypts is the profile entries a purpose's data categories name (§4.6), taken from the profile vault (W-16) and completed in the screen for any field the profile lacks. For the loan purpose that is `{ pan, incomeBand, employment }` (no score: the wallet has no bureau data; the Processor assumes one and says so with `SCORE_ASSUMED`). `employment` is one of `salaried`, `self-employed`, `student`, `unemployed`; `incomeBand` one of the four bands of §6.7. The wallet validates every field (PAN against `^[A-Z]{5}[0-9]{4}[A-Z]$`, and the others per §4.6) before it will send. Fields the Processor has no rule for are decrypted in memory with the rest, ignored, and discarded.

### 6.11 Targeted consent requests (N-01, N-02, W-14)

**Identity.** A handle is `<name>@sammati`, the name 3 to 30 characters of `a-z 0-9 . _ -` (lower-cased on entry), unique, one per wallet. It is pseudonymous: it names no one, and Core stores no phone number or email. It is never put on chain.

**Sending.** Core validates the handle's *format* and the purposes, then does exactly the same thing in every case: creates a request (the company's typed handle goes in `customer_alias`, which stays company-side data) and a `request_targets` row, and answers 201 with the same body. Only then does it differ, invisibly to the company: if the handle is registered, the company is not blocked by that customer and the customer has fewer than `MAX_OPEN_REQUESTS_PER_USER` open requests from this company, the row is addressed to the wallet and `consent.requested` is pushed; otherwise the row has no principal, nothing is pushed, and it simply expires. The company's status for such a request reads Sent until it reads Expired, like any request nobody answered.

| Situation | Answer to the company | Push |
|---|---|---|
| handle registered | 201, `sent` | yes |
| handle not registered | 201, `sent` | none |
| company blocked by that customer | 201, `sent` | none |
| customer already has the maximum open from this company | 201, `sent` | none |
| company over its own rate limit (independent of any handle) | 429 | none |

**Lifecycle.** `sent` (created) to `seen` (the customer's wallet fetched the notice, `GET /v1/requests/:id?principal=`, trd §6.1) to `granted` (a grant from that customer matching the request's notice hash arrived) or `declined` (signed decline, or the company was blocked); `sent` and `seen` become `expired` when `expiresAt` passes. Expiry is computed when read, so no timer is needed. `expiresInHours` is 1 to 168, default 72.

**Notice access.** For a targeted request the notice route answers only to the addressed wallet: any other `principal`, none at all, a dropped or expired request, or one already declined, is the same 404 or 410 as for an unknown id.

**Abuse controls and their settings.**

| Control | Setting | Notes |
|---|---|---|
| Rate limit per company | `TARGETED_RATE_PER_MINUTE`, default 20 | rolling 60 s window; counted before the handle is looked at |
| Open requests per customer per company | `MAX_OPEN_REQUESTS_PER_USER`, default 3 | silent: see the table |
| Message | at most 140 characters, plain text, control characters removed | shown to the customer as "Message from {company}", never as the company's identity |
| Expiry | 1 to 168 hours | default 72 |
| Decline | signed message | the request disappears from the inbox; the company sees Declined |
| Block this company | signed message, stored in `blocks` | the company's later requests are dropped silently; the company is told nothing; unblock is possible from the wallet |

**Not prevented, and said so.** A company can still tell a registered handle from an unregistered one if it can observe the customer, for instance by calling them. Timing differences between the branches are not closed beyond doing the same writes in each. A customer who never opens the wallet sees nothing until they do.

### 6.12 Expiry, renewal and notifications (N-03, N-04, N-05, W-11)

**Scheduler.** Core runs one timer (`EXPIRY_TICK_MS`, default 30000). Each tick reads the Active rows of `consents_cache`. For a consent that expires in `r` seconds:

- `r > 0`: the **smallest configured threshold that is at least `r`** fires `consent.expiring`, once. (A consent granted with 2 days left fires the 3-day threshold straight away, showing the real time left; one inside 1 day fires the 1-day one. It never fires two for one tick.) The remaining time shown is computed from `expiresAt`, not from the threshold.
- `r <= 0`, and expired no more than `EXPIRED_NOTIFY_SECONDS` ago (7 days; so an old database does not flood a wallet): `consent.expired`, once.

"Once" is a rule of the table, not of memory: every notification has a unique `dedupe_key` (`expiring:<principal>:<fiduciary>:<purposeId>:<expiresAt>:<threshold>`, `expired:<…>:<expiresAt>`), so a restart repeats nothing and a **renewed** consent (a new `expiresAt`) starts afresh. The scheduler uses Core's clock; on the local chain the chain's clock follows the wall clock (`pnpm e2e` checks it), and enforcement never depends on the scheduler: the gateway and the Processor read the chain.

| Setting | Default |
|---|---|
| `EXPIRY_TICK_MS` | 30000 |
| `EXPIRY_THRESHOLDS_SECONDS` | `259200,86400` (3 days, 1 day) |
| `EXPIRING_WINDOW_SECONDS` (the console's Expiring table looks this far ahead, and back) | 2592000 (30 days) |
| Processor `EXPIRY_ERASURE_GRACE_SECONDS` | 604800 (7 days) |
| Wallet expiry choices | 30 days, 6 months, 1 year; with **Short expiry for testing** on in the wallet's Developer settings, also 2 minutes and 10 minutes |

**Short expiry is the customer's choice, not a Core mode.** Core and the contracts treat a 2-minute `expiresAt` like any other: the customer signs it. The wallet shows the two short choices only when its local developer option is on (off by default), and labels every consent made with one **Developer option**. Tests that need faster reminders or erasure set the variables above explicitly (`pnpm e2e` does).

**Notifications.** One row per notification per customer (`drd.md` §3, `notifications`). A notification's body is data, not prose: the wallet writes the sentence in the customer's language from `type` and `payload`.

| `type` (also the WebSocket event name) | Created when | `payload` | Actions in the wallet |
|---|---|---|---|
| `consent.expiring` | scheduler, per threshold | `{ expiresAt, thresholdSeconds }` | Renew, Let expire, View proof |
| `consent.expired` | scheduler | `{ expiresAt }` | Renew, View proof |
| `consent.renewal_requested` | a company asks (below) | `{ expiresAt, message }` (message: at most 140 characters, optional) | Renew, Let expire, View proof |
| `data.erased` | the Processor reports `vault.erased` with cause `withdrawn` or `expired` (§6.5; `superseded` and `no_consent` are not announced) | `{ cause }` | View proof |
| `cascade.acknowledged` | a downstream processor acknowledged a withdrawal on chain (§9) | `{ processor, processorName }` | View proof |

`fiduciary` and `purposeId` name the company and purpose; the item carries the company's name and colour and the purpose's code. **No payload carries personal data**: addresses, codes, times and the company's 140-character message. Every notification is also published once, to `principal:<addr>` only, as `{ event: <type>, principal, notification, at }` where `notification` is the item below. Nothing here reaches a company.

`NotificationItem`: `{ id, key, type, fiduciary: { address, name, color }, purposeId, purposeCode, payload, createdAt, readAt, actionTaken }`. `key` is the dedupe key (the wallet uses it so a scheduled local notification and a live one are the same notification). `actionTaken` is `null`, `renewed` (set by Core when a grant for that company and purpose arrives), `let_expire` or `viewed_proof`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/principals/:addr/notifications?limit=` | `{ notifications: NotificationItem[], unread, config: { thresholdsSeconds } }`, newest first, limit 50 (max 200). `config` lets the wallet schedule its own local reminders |
| POST | `/v1/principals/:addr/notifications/read` | Marks every notification of this customer read. `{ ok: true, unread: 0 }` |
| POST | `/v1/principals/:addr/notifications/:id` | Body `{ read?: true, action?: "let_expire" \| "viewed_proof" }`. Returns the item. 404 `NOTIFICATION_NOT_FOUND` for an id that is not this customer's |
| POST | `/v1/principals/:addr/renewals` | Body `{ fiduciary, purposeCode }`. Returns `{ requestId }` of an open renewal request for this customer, company and purpose, creating one if there is none (a `self_renewal`, below). 404 `CONSENT_NOT_FOUND` if the customer has never consented to that purpose. This is what the wallet's **Renew** calls, then it opens the ordinary notice (W3) with `requestId` |
| POST | `/v1/fiduciaries/:fid/rights/:id` | Company API key. Body `{ status: "in_progress" \| "resolved", reply? }` (reply at most 280 characters, control characters stripped). Moves a customer's rights request along (W-10) and raises `rights.updated` (payload `rightsId`, `rightsType`, `rightsStatus`, `reply`) to the customer's socket and Alerts, once per change. 404 `RIGHTS_REQUEST_NOT_FOUND` if the request is not this company's, 403 `FIDUCIARY_MISMATCH` for another company's key, 400 for a bad status |
| GET | `/v1/fiduciaries/:fid/expiring` | The company's consents expiring within `EXPIRING_WINDOW_SECONDS` or expired within it: `{ rows: [{ principal, customerAlias, purposeCode, expiresAt, state: "expiring" \| "expired", renewal: null \| { requestId, status, requestedAt } }] }`. The company already has these principals in its consents table |
| POST | `/v1/fiduciaries/:fid/renewals` | Body `{ principal, purposeCode, message? }`. 201 `{ requestId, status: "sent", expiresAt }`. 404 `CONSENT_NOT_FOUND` if that principal has no consent with this company for that purpose (a company can only ask its own customers), 429 `RATE_LIMITED` (the company's limit is shared with §6.11). If the customer blocked the company, or already has the maximum open requests from it, the answer is the same 201 and nothing is delivered |

The wallet's notification calls are keyed by address like its other reads (a limit of this build: there are no sessions); marking read or choosing "Let expire" changes no consent.

**Renewal requests.** A renewal is an ordinary request (`requests` + `request_targets`, §6.11) for the one purpose, with a `kind`: `renewal` (a company asked), `self_renewal` (the customer pressed **Renew** on an expiry reminder), or `targeted` (§6.11, unchanged). Renewals reuse the lifecycle (Sent, Seen, Granted, Declined, Expired), the notice route (it answers only to the addressed wallet), the block list and the open-request cap. `self_renewal` rows are internal: they never appear in the company's "Requests sent" table nor the wallet's inbox, and do not count toward the cap. A company's `renewal` appears in the wallet's inbox like any request and also raises `consent.renewal_requested`. If a `self_renewal` is already open when the company asks, it is promoted to a `renewal` (same request id), so the company's status follows the customer's own action. Granting through the notice marks the matching notifications `renewed` and publishes `request.updated` to the company as usual.

**Revoke.** Withdrawing stays what it is (§3, signed `WithdrawConsent`, immediate). **Let expire** is not a withdrawal: it records `action_taken` and leaves the consent to run to its expiry. A renewal request that is declined (inbox Decline) is a decline of the request only.

**Delivery to the phone, honestly.**

| Path | What it covers | State |
|---|---|---|
| WebSocket (`principal:<addr>`) | every notification, instantly, while the app process is alive (foreground, or backgrounded and not yet killed by the OS) | built, tested |
| Local notification on a live event | the same, as a banner on the phone | built (Android, via `flutter_local_notifications`); tested in widget tests with a test double of the plugin, **not** tested on a real phone |
| Local scheduled notifications | `consent.expiring` and `consent.expired` for consents the wallet already knows, scheduled from `expiresAt` and `config.thresholdsSeconds`, so they fire **with the app closed** | built; **not** tested on a real phone |
| The list in Core | anything missed is on the Alerts tab the next time the app opens | built, tested |
| Firebase Cloud Messaging for a closed app (`POST /v1/principals/:addr/devices` and a sender in Core) | renewal requests, erasure and cascade confirmations with the app killed | **not built**: it needs a Firebase project, credentials and a real phone. Nothing in the product claims it |
| A foreground service that keeps the socket alive | same, on Android | **not built** (it would add a dependency and needs the same phone test). `demo.md` says the phone must stay awake or the app open for company-initiated alerts |

The Processor's erasure grace and `vault.erased` are specified in §6.7. Core turns `vault.erased` (cause `withdrawn` or `expired`) into a `data.erased` notification when the event arrives at `POST /v1/events/vault`.

### 6.14 QuickLoan (`companies/quickloan`, Q-01 to Q-04)

An Express app on port 4101 with its own SQLite file (`QUICKLOAN_DB`, default `./data/quickloan.sqlite`). Env: `CORE_URL`, `FIDUCIARY`, `SAMMATI_API_KEY`, `PROCESSOR_URL`, `LOAN_PURPOSE` (default `credit_check`), `STAFF_USER` and `STAFF_PASSWORD` (no default: staff routes are off without them), `PUBLIC_CORE_WS` (the browser's address for Core's WebSocket). Dependencies: `better-sqlite3`, `react`, `react-dom`, `qrcode.react` (server-side QR as SVG), all already used by the repo.

**Tables.** `users(username, password_hash NULL, principal, created_at)`, `sessions(token, username, expires_at)`, `signups(token, username, password_hash NULL, request_id, created_at)`, `vault(principal, handle, ciphertext_hash, status)` (from the Processor webhook), `applications(id, username, amount, tenure_months, loan_purpose, decision, limit_amount, rate_bp, reasons, status, handle, created_at)`. No column can hold a name, PAN, income, phone or email.

**Flow.** `POST /api/signup {username, password?}` checks the username, stores a `signups` row and creates a consent request with Core (`POST /v1/fiduciaries/:fid/requests`, all registered purposes, `customerAlias` = the signup token). The page shows the QR (`/qr.svg`) and listens on Core's `/ws` (`fiduciary:<address>`); on a `consent.updated` it asks `GET /api/signup/:token`, which reads the company's consents table from Core, and when the loan purpose and every required purpose are Active it creates the user bound to that principal and sets a session cookie. `POST /api/apply` needs a session, an Active loan purpose (checked on the company's table, fail closed) and a stored handle, then calls the Processor's evaluate with the handle; the rate is QuickLoan's own table by reason code. The dashboard re-reads consent status on every `consent.updated` for its principal, so Apply is disabled within 2 s of a withdrawal.

**Routes.** Pages: `GET /` (landing), `/signup`, `/login`, `POST /login`, `/logout`, `/dashboard`, `/qr.svg?d=` (server-side QR), `/health`. API: `POST /api/signup`, `GET /api/signup/:token`, `GET /api/me`, `POST /api/apply`. Processor webhook: `POST /vault/events` (the company's API key in `x-sammati-api-key`). Staff: `GET/POST /staff/login`, `GET /staff`, `GET /staff/customers/:username`, `GET /staff/rights`. Also `QUICKLOAN_PUBLIC_URL` (where the Processor reaches the webhook, default `http://localhost:4101`).

**Portal API for the customer portal (hosted).** The web's customer portal (`/portal/<company>`, §6.10) reads and writes Core with no key of its own, which a hosted Core refuses (§10.8). So QuickLoan, which holds the company's key and receives the Processor's vault events, answers the portal's three calls for it, for browsers on `PORTAL_ORIGINS` only (a comma-separated allowlist, like `CORS_ORIGINS`; no wildcard): `POST /portal/requests { purposes, customerAlias }` creates the consent request (answer as Core's, `{ requestId, qrPayload }`); `GET /portal/consents?alias=<customer id>&principal=<address>` returns only that one customer's rows (`principal, customerAlias, purposeCode, status, expiresAt`), never the company's customer list. Both parameters are required: Core attaches the typed id to a consent through the notice hash, which every customer of one purpose shares, so the id alone does not single a customer out and the address (which the page learns from the live consent event) does; `POST /customers/:alias/apply` with the `x-sammati-principal` header finds that customer's stored handle and asks the Processor for a decision (`{ amount?, tenureMonths? }` passed on), answering with the Processor's body and status unchanged (451 and its reason included). `409 NO_SUBMISSION` if no handle is stored. The web build uses these routes when it is a production build and `VITE_LENDER_URL` points at QuickLoan; in development it still calls Core directly (the sample lender, §6.8).

**Reusable company site (`companies/template`).** One app for any registered company: `SITE=<site file>`, `FIDUCIARY`, `SAMMATI_API_KEY`, `CORE_URL`, `PORT` (the site file's port: CareFirst 4102, TiffinBox 4103). `GET /` shows the company's purposes, `GET /api/<purpose>` is guarded by the SDK. `node scripts/register-company.mjs <site file>` registers it through the real flow. The sample lender (`examples/lender`) also reads `LENDER_PUBLIC_URL` (default `http://localhost:4310`) for its webhook.

**Sign-in challenge (specified, not built).** For strong auth QuickLoan would create a one-purpose request, the wallet would approve it, and QuickLoan would accept the login on the resulting Active consent; the existing request API already carries it.

**Staff.** `/staff` with HTTP form login against `STAFF_USER`/`STAFF_PASSWORD` (a limit of this build: one shared staff credential). Lists applications; `/staff/customers/:username` shows the protected-details card, handle, hash and consent status. There is no route that returns anything from the vault but its hash.

### 6.13 Per-purpose submission, evaluation and the usage record (V-08, V-09, W-18)

This section extends §6.7 and wins where they differ.

**Submit.** Body `{ principal, fiduciary, purposeCode, envelope, requestId, version, consentRef?, signature }`.
- `version`: integer 1 to 1,000,000, signed (§4.4.8). Versions of one (principal, company, purpose) strictly increase. The Processor keeps the highest version it has ever stored (live or erased) and answers 409 `STALE_VERSION` for a lower or equal version with a different handle; the same handle again is the idempotent replay of §6.7. Accepting version *n* erases every older live row of that triple (cause `superseded`). A correction of the profile (W-17) is a new version.
- `consentRef`: optional `0x` + 64 hex, the notice hash the customer signed. When given, the Processor compares it with the `noticeHash` of the on-chain consent and answers 409 `CONSENT_MISMATCH` if they differ, so a submission is bound to the notice the customer actually agreed to. The chain remains the only authority for validity.
- The payload inside the envelope is `profilePayload(profile, dataCategories)` (§4.6): only that purpose's fields.
- Response 201 `{ handle, ciphertextHash, version }`; `vault.stored` and `vault.encrypted` carry `version`.

**Evaluate.** `POST /v1/processor/evaluate`, company API key. Body `{ handle | handles, fiduciary, purposeCode, action: "loan_decision", application? }` where `handles` is 1 to 4 handles of the same customer and company (the sealed fields of several purposes are combined in memory) and `application` is `{ amount, tenureMonths }`, whole INR 10,000 to 5,000,000 and whole months 6 to 60 (else 400 `BAD_APPLICATION`). Consent is re-read from the chain for the requested purpose and for the purpose of every handle; the first failure refuses the call with 451 and its reason, and only a handle whose own consent is gone is erased (§6.7). Answer 200 `{ decision, limit, rateBps, reasonCodes, entryId }`: `rateBps` is the yearly rate in basis points (integer) or null. Nothing else, ever, leaves the Processor. The scoring rules are in `drd.md` §4.5.

**Usage record.** The Processor logs every evaluation, allowed or refused, through the company's gateway path (§7) as an access-log entry of the new format (`drd.md` §4.1): `dataCategories`, the registry ids (§4.6) of the fields the rules read (`[]` when nothing was opened), and `outcome`, one of `approved`, `declined`, `blocked`, `error`. Entries written by `requireConsent` use the same format with `dataCategories: []` and `outcome: ""`. `access.logged` carries both fields, `GET /v1/principals/:addr/activity` returns them on each item, and `processor.decided` carries `rateBps` and `dataCategories`. No value, handle or hash from the vault is in an entry; the wallet finds the ciphertext hash in its own record of what it sent (`drd.md` §3b, `shares[].ciphertextHash`).

**Chain epochs.** Core accepts an entry of the old format (no `outcome`) only while the company's chain has no entry of the new format; an old-format entry after a new-format one is 409 `FORMAT_OUTDATED`. The first new-format entry after old-format entries (or the first of all) must carry `prevHash` = 32 zero bytes: a new epoch. The SDK reads the last entry's format when it resumes and does this by itself. Verification (§6.3) checks the same rules and reports a mix as `FORMAT_MIXED`.

**Erasure and the wallet.** Withdrawal and expiry erase every live version for that purpose (`vault.erased`, one per row), Core turns the first into `data.erased` (§6.12), and the row stays as the erasure record (`drd.md` §3). The wallet words it from the purpose's categories ("QuickLoan no longer holds your PAN and yearly income").

## 7. Gateway SDK

```ts
import { sammati } from '@sammati/gateway';

const gate = sammati({ coreUrl, fiduciary: process.env.FIDUCIARY, apiKey: process.env.SAMMATI_API_KEY });

app.get('/customers/:id/credit-profile',
  gate.requireConsent({ purpose: 'credit_check', principalFrom: req => req.header('x-sammati-principal') }),
  handler);
```
Options: `coreUrl`, `fiduciary`, `apiKey` (R-03: sent as `x-sammati-api-key` on every call to Core except the WebSocket; required by Core's gateway endpoints, §6.2a), optional `signer`, `timeoutMs`, `cacheTtlMs`, `liveCache`, `maxQueuedLogs`.

Behaviour:
1. Resolve principal address. Missing or malformed principal returns 451 `NO_PRINCIPAL`.
2. Check the local consent cache. The SDK keeps a WebSocket to Core subscribed to `fiduciary:<address>`; each `consent.updated` replaces that consent's cache entry immediately. If the entry is missing or older than 5 s, call `/v1/gateway/consent-state`.
   - The cache is used **only while the WebSocket is subscribed and acknowledged**. While it is down (or before the acknowledgement) every request calls `/v1/gateway/consent-state`, and the cache is emptied on every (re)connect, because events may have been missed. Otherwise a withdrawal could be ignored for up to 5 s.
   - A `consent-state` answer that was in flight when an event for the same consent arrived is not cached.
3. Active and unexpired: `next()`. Otherwise respond `451 { code: "CONSENT_WITHDRAWN" | "CONSENT_EXPIRED" | "NO_CONSENT" | "LEDGER_UNAVAILABLE" | "NO_PRINCIPAL", message }`. If the state cannot be fetched (Core down, 5xx, timeout) the answer is `LEDGER_UNAVAILABLE`: fail closed. Every response, allowed or blocked, carries the log entry's id in the `x-sammati-entry-id` header.
4. Append a log entry (see `drd.md` §3) and POST it to Core asynchronously, after the response is sent, so logging never blocks it. The SDK owns the per-fiduciary `seq`/`prevHash`: it resumes from `GET /v1/fiduciaries/:fid/access?limit=1` and again after any rejection. At most 5000 entries wait for Core; beyond that new entries are dropped with a warning rather than growing memory without bound.
5. **Key errors.** If Core answers 401 or 403 to the key, the SDK treats consent as unverifiable (`451 LEDGER_UNAVAILABLE`, fail closed), the response message says why ("Sammati rejected this company's API key"), and the SDK logs one warning naming the cause (`INVALID_API_KEY` or `FIDUCIARY_MISMATCH`) and what to do, once per cause rather than once per request. An absent key is sent as no header and gets the same answer.
5a. `gate.close()` stops the WebSocket; `gate.flush()` resolves when queued log entries have been delivered.
6. Addresses an entry carries (the company's and the principal's) are written in EIP-55 form whatever case the caller used. Core stores them that way and re-derives each entry's hash from the stored row, so an entry hashed with a lower-case address would be rejected as out of sync with its chain.
7. `gate.logAccess({ purpose, principal, decision, reason, endpoint, latencyMs })` appends an entry decided by someone else to the same hash chain and queue, and returns its id. The Processor uses it: it decides from the chain itself (§6.7) and logs through the normal path. Two processes (a company's app and the Processor) may then write one fiduciary's chain; a sequence collision is rejected by Core (409) and the SDK resumes and retries (up to 5 attempts), so neither loses an entry in normal use.

## 8. Log hashing and anchoring
- Canonical JSON (sorted keys, no whitespace) of the entry without `hash`.
- `entry.hash = keccak256(prevHash || canonicalBytes)`; first entry uses a zero `prevHash` per fiduciary.
- Anchor job: every 10 seconds, or after 20 entries, build a Merkle tree over `entry.hash` values (sorted pairs, keccak), call `anchorAccessBatch`.
- Verification recomputes everything from stored rows and compares roots.

## 9. Cascade engine
On `ConsentWithdrawn`: look up processors for the purpose; for each, POST a signed notification to the processor's webhook (each processor is a record Core holds the key for: an in-process acknowledger, a disclosed shortcut). Each waits a random 1–3 s, signs an ack, and Core calls `acknowledgeWithdrawal` (processor keys are demo-held, disclosed in `demo.md`).

Real mode, in detail (`core/src/real/cascade.ts`):
1. **Trigger.** The indexer hands every *new* `ConsentWithdrawn` event to the engine, whoever relayed it. A background catch-up (at start and with each reconcile) also picks up withdrawn consents whose processors never acknowledged, so a Core restart does not lose a cascade.
2. **Skip what is already settled.** Before notifying, the engine dry-runs `acknowledgeWithdrawal` from the processor: `AlreadyAcknowledged` (a replay of old history), `NotWithdrawn` (re-granted meanwhile) or `NotProcessor` end the attempt silently. So re-reading the chain never re-notifies or double-acknowledges.
3. **Notify.** The company (its key is held by Core, like the processors') signs a notification `{ principal, fiduciary, purposeId, purposeCode, processor, withdrawalTx, withdrawnAt }` (EIP-191 over the keccak256 of its canonical JSON, `shared/src/cascade.ts`). `cascade_acks.notified_at` is set and `cascade.updated` is pushed with `ackedAt: null`: this is the wallet's "told, waiting" state (`ui.md` W-08).
4. **Acknowledge.** The in-process acknowledger checks the notification really is signed by the fiduciary, waits `CASCADE_DELAY_MS` (default `1000,3000`), then signs `{ principal, purposeId, processor, notificationDigest, ackedAt }`. Core checks that signature, then sends `acknowledgeWithdrawal` from the processor's key. The indexer sees `WithdrawalAcknowledged`, sets `acked_at` and `tx_hash`, and pushes `cascade.updated` again with the acknowledgement.
5. **Only built-in processors.** Webhook delivery to a processor Core holds no key for is not built: such a processor is skipped with a warning (`webhook_url` is unused for now).

## 10. Deployment and environment

| Item | Value |
|---|---|
| Local stack | `pnpm demo:up` runs a Hardhat node, Core, the Processor and the web app on one laptop; the phone joins the laptop's hotspot. It starts empty: companies join through `/join` and the regulator (R-01 to R-03). The sample lender (`examples/lender`) runs once a company has a key |
| Proof | `pnpm deploy:amoy` (`hardhat run scripts/deploy.ts --network amoy`). The network comes from the environment: `DEPLOYER_KEY` (a funded account) and optionally `AMOY_RPC_URL`. The addresses, the explorer base and links to both contracts and both deploy transactions go in `shared/deployments.json` under `amoy` |
| Env | `CHAIN_RPC`, `CHAIN_ID`, `RELAYER_KEY`, `ADMIN_KEY`, `PORT`, `DB_PATH`, `NODE_ENV`, `DEV_TOOLS` (`true` enables the two CLI scripts of §6.4 and nothing else; Core and the Processor refuse to start when it is `true` and `NODE_ENV=production`) |
| Env (Core, V-06) | `PROCESSOR_PUBLIC_URL` (what `GET /v1/processor` returns; `pnpm demo:up` sets it to the laptop's LAN address on port 4200 like `PUBLIC_CORE_URL`), `PROCESSOR_EVENT_KEY` (default `demo-processor-events`, a disclosed demo secret) |
| Env (Core, indexing) | `INDEXER_INTERVAL_MS` (1000: how often Core reads new chain events), `RECONCILE_INTERVAL_MS` (30000: how often it re-checks its cache against the chain), `CASCADE_DELAY_MS` (`1000,3000`) |
| Env (Core, N-03) | `EXPIRY_TICK_MS`, `EXPIRY_THRESHOLDS_SECONDS`, `EXPIRING_WINDOW_SECONDS`, `EXPIRED_NOTIFY_SECONDS` (604800); see §6.12 |
| Env (Processor, N-03) | `EXPIRY_ERASURE_GRACE_SECONDS` (604800) |
| Env (Core, N-02) | `TARGETED_RATE_PER_MINUTE` (20), `MAX_OPEN_REQUESTS_PER_USER` (3), `IDENTITY_FRESHNESS_SECONDS` (900), `HANDLE_CHECKS_PER_MINUTE` (30, W-15) |
| Env (Processor) | `PROCESSOR_PORT` (4200), `PROCESSOR_KEY` (`0x` + 64 hex: the X25519 private key; absent means generate at start outside production; in production it is required and the Processor never generates one (§10.2). Never logged, never sent anywhere), `VAULT_PATH` (`./data/processor.sqlite`), `CORE_URL`, `CHAIN_RPC`, `CHAIN_NETWORK` (as Core), `FIDUCIARY_API_KEYS` (JSON `{ "<key>": "<fiduciary address>" }`, optional: a company's key is otherwise learned from Core on its first call, §6.7), `FIDUCIARY_CALLBACKS` (JSON `{ "<address>": "<url>" }`, where to tell a company about stored and erased entries; the sample lender registers its own), `PROCESSOR_EVENT_KEY`, `PROCESSOR_SWEEP_MS` (30000), `DEV_TOOLS` |
| Env (Core, R-01 to R-03) | `REGULATOR_KEY`, `ADMIN_KEY`, `REGISTRATION_FUNDING_ETH`, `REGISTRATIONS_PER_HOUR`, `MAX_PENDING_APPLICATIONS`, `GATEWAY_RATE_PER_MINUTE`, `SANDBOX_TEST_PRINCIPALS` (§6.12) |
| Env (sample lender) | `CORE_URL`, `FIDUCIARY`, `SAMMATI_API_KEY`, `PROCESSOR_URL` (default `http://localhost:4200`), `LOAN_PURPOSE` (`credit_check`), `PORT` (4310) |
| Minimum seed | `pnpm seed` funds the relayer and nothing else (idempotent): no company, purpose, processor, customer or request is registered. The relayer is its own key (`RELAYER_KEY`, default `LOCAL_RELAYER_KEY`, public and for the local chain only), topped up to 100 ETH from the admin (account #0), which is also the regulator's chain account. Companies, their purposes and their processors arrive through R-01 to R-03 |
| Deployments | `shared/deployments.json`, keyed by network name: `{ "<network>": { chainId, admin, consentRegistry, accessAnchor, startBlock, [explorerUrl, links] } }`. `pnpm deploy:local` writes `localhost`, which is deterministic on a fresh node and has no explorer; `pnpm deploy:amoy` writes `amoy` with `explorerUrl` and `links { consentRegistry, accessAnchor, consentRegistryDeployTx, accessAnchorDeployTx }` |
| Explorer links | Proof responses (`/v1/proof/consent/:txHash`, `/v1/proof/access/:entryId`) and the ledger explorer carry `explorerUrl`: `<explorer>/tx/<hash>` when the deployment has an explorer (Amoy) or `CHAIN_EXPLORER_URL` is set, otherwise `null` (the local chain has none).  |
| Reset | `pnpm dev:reset` (§6.4; needs `DEV_TOOLS=true`) resets the chain, redeploys and funds the relayer, and removes Core's database and the Processor's vault when they are not in use. Core's reset (`clearAll`) empties **every** table, so Sammati IDs (`identities`), `blocks`, targeted and renewal requests (`request_targets`), `notifications`, rights requests, the access log, the consent cache, applications and every registered company go. `core/test/reset.test.ts` fails if a table is added and not wiped. The Processor's own sweep erases stale rows anyway, since the chain they referred to is gone |
| One command | `pnpm demo:up` starts everything (the Processor too, on :4200) and prints the address the QR code will give the phone: the laptop's LAN IPv4, or `PUBLIC_CORE_URL` if set. `pnpm dev:reset` resets state |

### 10.1 Production deployment targets (Render, Vercel, chain, wallet)

The local stack above is unchanged. The same code also runs in the cloud, with no change in product behaviour:

| Piece | Where | Notes |
|---|---|---|
| Core | Render web service `sammati-core`, region Singapore, persistent disk at `/var/data` | `DB_PATH=/var/data/sammati.sqlite`. One instance only (SQLite on a disk) |
| Processor | Render web service `sammati-processor`, Singapore, disk at `/var/data` | `VAULT_PATH=/var/data/processor.sqlite`; `PROCESSOR_KEY` from the environment |
| QuickLoan | Render web service `sammati-quickloan`, Singapore, disk at `/var/data` | `QUICKLOAN_DB=/var/data/quickloan.sqlite` |
| Second company site | Render web service `sammati-company2` (`companies/template`, e.g. `SITE=companies/template/sites/carefirst.json`), Singapore, no disk | Holds no data |
| Web (console, Auditor, `/join`, portal) | Vercel static site (`web/`), SPA rewrite to `/index.html` (`web/vercel.json`) | Build env `VITE_CORE_URL` (required: the build fails without it) |
| Chain | Polygon Amoy (`CHAIN_NETWORK=amoy`, `CHAIN_RPC` of a provider) with the contracts from `pnpm deploy:amoy` committed in `shared/deployments.json` | Core and the Processor use the same RPC provider account |
| Wallet | Android APK built by `.github/workflows/wallet-apk.yml` with `--dart-define=CORE_URL=<Core's public URL>` | The wallet's Developer settings can point it back at a laptop (`demo.md` §4) |
| Keep-alive | `.github/workflows/keepalive.yml` | Pings `/healthz` of each service on a schedule; only useful on Render instance types that sleep |

`render.yaml` at the repo root declares the four services (build `pnpm install --frozen-lockfile --prod=false`, because the runtime is `tsx` from the dev dependencies; start `pnpm --filter <package> start`), `healthCheckPath: /healthz`, the disks, and every secret as `sync: false`. A service with a disk needs a paid Render instance type (a disk cannot be attached to a free one) and cannot run two instances: a deploy restarts it, and it is briefly unavailable. `docs/deploy-guide.md` is the runbook.

### 10.2 Production environment

`NODE_ENV=production` switches every service to production rules. Each service checks its required variables **at startup** and exits with one message naming all that are missing or unusable (a value equal to a published default, such as `demo-regulator-key` or `local-processor-events`, or a public URL that is not `https://`, counts as unusable). Nothing in a production code path falls back to `localhost`, a LAN address, a Hardhat key or a built-in company.

| Service | Required in production | Optional (default) |
|---|---|---|
| Core | `PUBLIC_CORE_URL` (https; goes into every QR payload's `core` field), `PROCESSOR_PUBLIC_URL`, `CHAIN_RPC`, `CHAIN_NETWORK`, `RELAYER_KEY`, `ADMIN_KEY`, `REGULATOR_KEY`, `PROCESSOR_EVENT_KEY`, `CORS_ORIGINS`, `DB_PATH` | `PORT` (set by Render; bound on `0.0.0.0`), `INDEXER_INTERVAL_MS` (1000; 4000 in `render.yaml`), `RECEIPT_POLL_MS` (250; 2000 in `render.yaml`), `LOG_CHUNK_BLOCKS` (2000), `RPC_BACKOFF_MAX_MS` (60000), `GAS_PRIORITY_FEE_GWEI`, `GAS_MAX_FEE_GWEI`, `GAS_LIMIT_MULTIPLIER` (1.2), `CHAIN_EXPLORER_URL`, and the tuning variables above |
| Processor | `PROCESSOR_KEY`, `CORE_URL`, `CHAIN_RPC`, `CHAIN_NETWORK`, `PROCESSOR_EVENT_KEY`, `VAULT_PATH`, `CORS_ORIGINS` | `PORT` (in production; locally `PROCESSOR_PORT`, 4200, because a shared `.env` sets `PORT` for Core), `RPC_BACKOFF_MAX_MS`, `PROCESSOR_SWEEP_MS`, `EXPIRY_ERASURE_GRACE_SECONDS` |
| QuickLoan | `CORE_URL`, `PROCESSOR_URL`, `FIDUCIARY`, `SAMMATI_API_KEY`, `QUICKLOAN_PUBLIC_URL`, `QUICKLOAN_DB`, `STAFF_USER`, `STAFF_PASSWORD` | `PORT`, `LOAN_PURPOSE`, `PUBLIC_CORE_WS` (derived from `CORE_URL`), `PORTAL_ORIGINS` (the web origins that may use the portal API, §6.14; absent means none) |
| Company site (`companies/template`) | `SITE`, `CORE_URL`, `FIDUCIARY`, `SAMMATI_API_KEY` | `PORT` |
| Web (build time) | `VITE_CORE_URL` | `VITE_LENDER_URL` (the company backend the portal talks to: QuickLoan's URL when hosted, §6.14; absent means the portal says it is not available) |

Secrets (`RELAYER_KEY`, `ADMIN_KEY`, `REGULATOR_KEY`, `PROCESSOR_KEY`, `PROCESSOR_EVENT_KEY`, `SAMMATI_API_KEY`, `STAFF_PASSWORD`, `DEPLOYER_KEY`) are set in the Render dashboard or GitHub secrets, never in the repository, and never in a client bundle (the web and wallet builds receive public URLs only). `DEV_TOOLS` stays unset in production, and a service refuses to start with it beside `NODE_ENV=production` (§6.4).

### 10.3 Health endpoints

| Endpoint | Service | Behaviour |
|---|---|---|
| `GET /healthz` | Core, Processor, QuickLoan, company site | **200 `ok` immediately.** No chain call, no database read or write, no access-log entry, no anchoring, no WebSocket event, no log line. It answers even while Core is still connecting to the chain at start. This is Render's `healthCheckPath` and the keep-alive target |
| `GET /readyz` | Core, Processor | 200 `{ ready: true }` when the database answers `SELECT 1` and the chain answers `eth_blockNumber`; otherwise 503 `{ ready: false, reason }`. For a person or a monitor, **never** pinged by the platform or by keep-alive, because it spends an RPC call |
| `GET /v1/health`, `GET /health` | Core (the web's status chip), Processor, company sites | Unchanged, kept for the existing clients. Core's `/v1/health` means "Core can serve": it answers only after start-up (503 `STARTING` before), which is what the local stack and `pnpm e2e` wait for |

Until Core has opened its database and connected to the chain, every route other than `/healthz` answers 503 `STARTING` (`Retry-After: 2`), so a cold start is reported honestly instead of as a refused connection.

### 10.4 Persistence

| Data | Variable | Production path | If the disk is lost |
|---|---|---|---|
| Core's SQLite (and its `-wal`, `-shm`) | `DB_PATH` | `/var/data/sammati.sqlite` | Applications, company API-key hashes, **the company and processor keys Core holds (disclosed shortcut)**, requests, the access-log copy, notifications. The chain is intact, but the companies' accounts cannot sign again: keep disk snapshots |
| The vault (ciphertext only) | `VAULT_PATH` | `/var/data/processor.sqlite` | Stored ciphertext; customers submit again |
| QuickLoan's SQLite | `QUICKLOAN_DB` | `/var/data/quickloan.sqlite` | Its users and applications |

The Processor's X25519 key is **not** stored on disk: it comes from `PROCESSOR_KEY`. The Processor refuses to start in production without it and never generates one; the key must be backed up outside Render (a password manager), because losing it makes every stored ciphertext unreadable (`drd.md` §6). Migrations are idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN` only when the column is absent) and run on every start, so a restart or redeploy against an existing disk changes nothing it need not. The data directory is created when missing, so a first boot from an empty disk works.

### 10.5 Boot sequence, graceful shutdown, restart safety

Core: (1) read and validate the environment; (2) **bind `PORT` on `0.0.0.0` and start answering `/healthz`**, with everything else 503 `STARTING`; (3) open the database and run migrations; (4) connect to the chain, retrying with exponential backoff (1 s doubling to `RPC_BACKOFF_MAX_MS`) for up to two minutes, then exit non-zero so the platform restarts it; (5) compare the chain fingerprint (§10.7); (6) check the relayer balance (production logs a warning and goes on; the local stack waits for the seed); (7) start the indexer from its saved cursor, the anchor job, the expiry scheduler and the reconcile loop; (8) serve every route. `trust proxy` is `1`, so `req.ip` is the client Render's proxy saw and the per-address limits (registrations per hour, handle checks) work.

Processor, QuickLoan and the company site: validate, bind `PORT` on `0.0.0.0`, serve `/healthz`, then connect.

On `SIGTERM` (every deploy and restart) a service stops accepting connections, closes its WebSockets, stops its timers, lets in-flight requests finish for up to 10 s, closes its database and exits 0. Nothing waits on the chain to exit.

**Restart safety.** The indexer cursor (`last_block`) is in the database, so a restart resumes from the last indexed block; events are keyed by `(tx_hash, log_index)`, so a block read twice is applied once and announced once. Notifications are keyed by a dedupe key, so the expiry scheduler and the sender never raise one twice, whatever the number of restarts. The anchor job asks the chain where the last batch ended and continues from the next sequence number: no gap and no overlap. The cascade catch-up re-finds withdrawals no processor acknowledged. `core/test/restart.test.ts` restarts Core in the middle of the flow and checks consents, ledger, notifications and anchors.

### 10.6 CORS, WebSocket and headers

- `CORS_ORIGINS` is a comma-separated allowlist of exact origins (the Vercel URL, a custom domain). A request whose `Origin` is on it gets that origin back (`Vary: Origin`); one that is not on it gets no CORS headers, so the browser blocks it. Requests with **no** `Origin` (the Android wallet, company servers, curl) are not browser cross-origin requests and are not affected. `*` is accepted outside production only. Preflights answer 204.
- The WebSocket at `/ws` is `wss://` behind Render's TLS proxy, with the same origin check on the upgrade (a missing `Origin`, as from the wallet and the SDK, is allowed). Render's proxy drops a connection that is idle for about a minute, so Core sends a protocol **ping every 25 s** and terminates a client that did not answer the previous one. Clients answer pings by themselves.
- Clients reconnect by themselves: the web (`web/src/ws.tsx`) with exponential back-off from 0.5 s to 16 s; the wallet (`live_events.dart`) with its own ping every 5 s and a refetch of what it missed after each reconnect; the Gateway SDK empties its consent cache on every reconnect and calls `consent-state` while the socket is down (§7).
- Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` (production), `Cross-Origin-Resource-Policy: cross-origin`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API responses, and no `X-Powered-By`. The company sites that serve HTML allow their own inline styles only. Vercel adds the same set for the static web (`web/vercel.json`).

### 10.7 RPC friendliness and gas

A hosted RPC provider rate limits, so Core spends calls on purpose:
- `INDEXER_INTERVAL_MS` sets how often new blocks are read. A poll that finds no new block makes one call (`eth_blockNumber`); the check that the saved block is still on the chain runs when blocks arrived and otherwise every 20th tick. `LOG_CHUNK_BLOCKS` bounds an `eth_getLogs` range (public RPCs cap it).
- A failed poll backs off exponentially (the delay doubling up to `RPC_BACKOFF_MAX_MS`, with jitter) and returns to the normal interval after one success. A 429 or a timeout is only a failed poll: the cursor did not move and nothing is lost. Start-up retries the same way.
- `RECEIPT_POLL_MS` sets how often a relayed transaction is polled for its receipt.
- **The gateway hot path makes no chain call beyond what exists:** `POST /v1/gateway/log` touches only the database; the SDK answers from its WebSocket-fed cache and calls `GET /v1/gateway/consent-state` (two chain reads) only when the cache is cold or the socket is down, which is the fail-closed fallback.
- **The cache follows the receipt:** a grant or withdrawal relayed by Core is applied to `consents_cache` from the confirmed receipt before the response is sent (`indexer.ingestReceipt`); the poller later finds the same events and ignores them. A slow or rate-limited poll cannot leave the cache stale after Core's own transaction.
- **Gas and fees are configuration per network.** Core has built-in defaults by chain id (Polygon Amoy needs a priority fee of at least 25 gwei) and `GAS_PRIORITY_FEE_GWEI`, `GAS_MAX_FEE_GWEI`, `GAS_LIMIT_MULTIPLIER` override them. One fee policy covers every transaction Core sends: the relayer's, a company's anchor batch, a processor's acknowledgement and the admin's registrations.
- **A different chain never erases production data.** On the local stack a database that describes another chain is wiped (§10 "Reset"). With `NODE_ENV=production` Core refuses instead: at start it exits with `CHAIN_MISMATCH`, and while running the indexer reports it (`/readyz` stays up, the poll fails and backs off) and applies nothing until the RPC agrees with the database again, because a flaky RPC answer (a missing block) must not be mistaken for a replaced chain. In production a node that cannot answer for its genesis or deployment block produces no fingerprint at all (Core exits and the platform restarts it), where the local stack lets that gap count as a different chain.

### 10.8 Security for public hosting

- **Logins.** Company consoles need a console login (`/v1/console/login`, §6.12): in production `GET /v1/fiduciaries/:fid/consents` and `/access` need the operator's bearer token or that company's API key. The Auditor area needs the regulator's access code: in production every `/v1/audit/*` route requires the `x-sammati-regulator-key` header, and the web asks for the code before it shows the Auditor (`ui.md` §4). The web build in production mode always shows these gates; the local development build does not.
- **`/join`** (`POST /v1/registrations`) is rate limited per client address (`REGISTRATIONS_PER_HOUR`; with `trust proxy` set the address is the client's) and capped in total (`MAX_PENDING_APPLICATIONS`).
- **No endpoint can reset state, edit a log, or return vault plaintext.** The only code that does the first two is the two CLI scripts behind `DEV_TOOLS=true`; `core/test/surface.test.ts` lists every route of Core and the Processor and fails on one that could. `pnpm dev:tamper` and `pnpm dev:reset` run only when `DEV_TOOLS=true` is set **inline for that one command**: a `DEV_TOOLS=true` that came from a `.env` file does not count, and `NODE_ENV=production` always refuses.
- `POST /v1/console/login` is rate limited per client address (10 attempts per 15 minutes). The operator's password is stored as an unsalted SHA-256 hash (a limit of this build, below).
- No secret is in a client bundle: the web build reads `VITE_*` public URLs only, and the wallet gets `CORE_URL` only. A production web build contains no `localhost` address.

### 10.9 Running the e2e against a deployment

`pnpm e2e:remote` (`core/scripts/e2e-remote.ts`) plays the public-API flow against running services and starts nothing: `CORE_URL`, `PROCESSOR_URL`, `REGULATOR_KEY` (to approve its throwaway company) and optionally `QUICKLOAN_URL` and `COMPANY2_URL` (each must answer `/healthz`) and `PUBLIC_CORE_URL` (what the QR payload must say; defaults to `CORE_URL`). Steps: `/healthz` of every service → the Processor's public key → a throwaway company applies and the regulator approves it → its key reads `whoami` → a consent request → a headless wallet signs and the relayer grants it → ALLOWED → a purpose never consented to is BLOCKED → withdraw → BLOCKED → the Auditor's verify is clean. It cannot run `dev:tamper` (that edits a local file) nor search database files, and says so. It leaves a throwaway company in the deployment's directory, so use a staging deployment or accept that.

## 11. Quality gates
- Contract tests green (§3.3).
- E2E script `pnpm e2e` (`core/scripts/e2e.ts`) starts a throwaway stack (own chain, Core, Processor, temporary databases) and plays everything through the public APIs with a headless wallet client: register a company, regulator approval, create request → sign and grant → ALLOWED → unconsented purpose BLOCKED → withdraw → BLOCKED → processor acknowledgement → verify (clean) → `pnpm dev:tamper` on one record → verify (mismatch pinpointed to the exact batch and record), and checks the WebSocket feeds. It also plays: the confidential-processing story (seal, submit, decide, ciphertext-only admin view, erasure on withdrawal, with a search of every response, event, log and database file for the PAN it submitted), the customer portal journey, a targeted request (known and unknown ID, Seen, Granted, Decline, Block), and expiry: a short-expiry consent signed by the client, reminder, expiry, 451 `CONSENT_EXPIRED`, company renewal request, Renew, ALLOWED again, erasure after a short grace period (set by the e2e's own environment). Its companies, customers and the PAN are throwaway values defined in the script; nothing of them is in the app. It anchors by calling the anchor job directly rather than waiting for the timer, completes in under 45 s (`E2E_BUDGET_MS`) and exits non-zero naming the failing step. Run it before every change that touches a shared interface.
- Restart safety (§10.5): `core/test/restart.test.ts` stops Core in the middle of the flow (after a grant, before the anchor, with a notification raised) and starts a new Core on the same database and chain: the consents, ledger events, notifications and anchored batches are the same, nothing is duplicated and no notification is sent twice. `core/test/surface.test.ts` (§10.8) and the production-config tests (`core/test/production.test.ts`, `processor/test/production.test.ts`) run with the package tests.
- Deployment gate (§10.9): `pnpm e2e:remote` passes against the deployed services before a demo.
- Lint and type checks on every merge to `main`.
- Targeted requests (N-01, N-02, W-14) extend `pnpm e2e`: a customer registers an ID, a company sends to it and to an unregistered handle (the two answers are the same and only the first pushes `consent.requested` to the wallet's socket), the request is in the inbox, opening it makes the company's status Seen, granting makes it Granted and the consent shows in the consents list; a second request is declined and a third company is blocked, after which that company's requests are dropped silently; the rate limit answers 429.
- Confidential processing (V-01 to V-06) extends `pnpm e2e` with: wallet-side seal → `submit` → evaluate approved → the sample lender's admin view shows a handle and hash only → withdraw → evaluate answers 451 `CONSENT_WITHDRAWN` → the vault row is erased, and the run's WebSocket events, HTTP responses, process output and database files contain no trace of the PAN the script submitted. Package tests: envelope vectors (`shared`), no endpoint returns plaintext, tampered ciphertext gives `CIPHERTEXT_INVALID`, erasure rules, rules table (`processor`); the same vectors in Dart, plus a wallet integration test that seals with the Dart code and has the real Processor open it (`wallet/test/integration/real_processor_test.dart`, run with `--dart-define=CORE_URL=...` against `pnpm demo:up`). The e2e searches the stack's console output only when it started the stack itself; against a stack that was already running it searches responses, events and database files, and says so.

- Profile (W-15 to W-17) extends `pnpm e2e` and adds package tests. The e2e's headless wallet registers a handle after checking its availability, then submits envelopes built with `profilePayload` from a profile of distinctive made-up values (a name, date of birth, mobile, email, address, PAN, employer, blood group and a delivery address, none of which is a value used anywhere else), for a purpose declaring those categories. After the whole run it searches every Core and Processor log line, every WebSocket event, every response the script received and every database file (Core's and the Processor's, including the SQLite write-ahead log) for each value, in plain, upper and lower case and in the base64 and hex forms, and fails naming the value and where it was found. `shared` tests: the registry vectors and `profilePayload`. Core tests: registry-only categories in applications, availability and its rate limit, `dataCategories` in the consent view. Wallet tests: the vectors in Dart, the profile vault round trip (lock, unlock, tamper), the missing-field logic, the stale-share marker, and `profile_privacy_test.dart` (§5).
- Onboarding (R-01 to R-03) extends `pnpm e2e`: register a company, reject a second company, approve the first, read its API key once (a second read shows none), find it in the directory (sandbox) and in the ledger explorer, run the quickstart sample app with the key, send a targeted request to a test customer, grant, ALLOWED, withdraw, BLOCKED; then the refusals: a non-test customer cannot be targeted or grant, a key for another company's id is 403 `FIDUCIARY_MISMATCH`, no key is 401 `INVALID_API_KEY`, the rejected company has no requests. Package tests cover validation, the approval steps and their retry, the key lifecycle (hash only, once, reissue), sandbox promotion, rate limits and the web screens.

## 12. Security notes (say these out loud to judges)
- Replay protection via nonces, domain separation, deadlines.
- Relayer cannot forge consent.
- Fail-closed gateway on ledger outage.
- No personal data on chain; erasure of company-side data does not conflict with immutability.
- Nothing can reset or edit state over the network: the only tools that do are two CLI scripts behind `DEV_TOOLS=true`, which Core and the Processor refuse to run beside `NODE_ENV=production` (§6.4).
- Limits of the hosted setup, said plainly: the WebSocket topics (including `auditor`) carry only addresses, hashes, codes and decisions but are not authenticated, because the wallet and the Gateway SDK subscribe without a session; the Auditor's REST routes are what the regulator's code protects. Operator passwords are unsalted SHA-256 (a console login for a prototype, not an identity system). The regulator's access code is one shared secret.
- The two demo shortcuts: company and processor keys are held by Core, and the Processor is a simulated sealed service. Production would use company-held keys or HSMs, and a TEE with remote attestation.
- Limit of this build: the wallet talks to Core over plain HTTP on the venue LAN (Android `usesCleartextTraffic`, iOS `NSAllowsLocalNetworking`), because the laptop has no certificate. Production uses HTTPS only. The wallet sends only addresses, hashes and purpose ids to Core.
- The wallet key sits in secure storage and is read only after a device-credential prompt (app-level gate, not an OS key bound to biometrics).
- Onboarding: API keys are 32 random bytes, stored only as SHA-256 hashes, shown once; each key works for one company and is refused for any other id; each company is rate limited; a company with no approved registration has no key, and a gateway call without a valid key fails closed with a clear error. The shortcut, said out loud: Core generates and holds the new company's key pair and its processors' key pairs (production: the company generates its own and registers only the address). Limits: the regulator's access code is a shared secret, not an identity system; the company console has no login in this build, so the key is enforced on server-to-server calls only; sandbox is Core policy at the relayer, not a contract rule, so a determined user could still submit a signed grant to the chain directly.
- Profile (W-16): the profile exists in plaintext only on the phone, in memory, while the user has just passed the device check. At rest it is AES-256-GCM ciphertext; the key sits in the platform's secure storage and is read only after the prompt. Limit, said out loud: this is an app-level gate, not a hardware-bound key (as for the wallet key); a rooted phone, or a person who knows the device PIN, can open it. There is no recovery in this build: losing the phone loses the profile (`architecture.md` §5.9 gives the production path). Core, the chain and every other server never receive it.
- Confidential processing: only ciphertext leaves the phone, only the Processor can open it, and Core holds no decryption key. The other shortcut, said out loud: the Processor is an ordinary process with an in-memory key (a simulated enclave), so whoever administers that machine could read memory. The wallet fetches the Processor's public key over plain HTTP from the address Core names; production uses remote attestation of a TEE so the wallet encrypts only to a key the hardware vouches for (`architecture.md` §5.5). Use made-up data: this is a prototype.
