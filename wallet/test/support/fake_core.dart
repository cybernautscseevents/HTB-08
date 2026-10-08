import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:convert/convert.dart';
import 'package:eth_sig_util/eth_sig_util.dart';
import 'package:sammati/core/activity.dart';
import 'package:sammati/core/consents.dart';
import 'package:sammati/core/core_api.dart';
import 'package:sammati/core/eip712.dart';
import 'package:sammati/core/live_events.dart';
import 'package:sammati/core/notice.dart';
import 'package:sammati/core/proof.dart';
import 'package:sammati/core/rights.dart';

const fiduciaryAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const creditCheckId = '0x707a80a4813eb36bdfb3f3aebdeea292384852e7f680fd128ea1009ac1192b29';
const marketingId = '0x200aac73b1ffccefb5cbde2ae0c42cc316ec9e58f7178cc4692fffee77e36cb3';
const kycId = '0x3333333333333333333333333333333333333333333333333333333333333333';
const verifyingContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/// A notice as Core would serve it: Hindi and Kannada text included, so the
/// hash covers non-ASCII characters, with a correct noticeHash.
Map<String, dynamic> buildNoticeJson({String nonce = '0', String? sector}) {
  Map<String, dynamic> purpose(
    String id,
    String code,
    String en,
    String hi,
    String kn,
    List<String> categories,
    int retentionDays, {
    bool shares = false,
    bool required = false,
  }) =>
      {
        'id': id,
        'code': code,
        'title': {'en': en, 'hi': hi, 'kn': kn},
        'description': {'en': 'About $en', 'hi': 'के बारे में $hi', 'kn': '$kn ಬಗ್ಗೆ'},
        'dataCategories': categories,
        'retentionDays': retentionDays,
        'sharesThirdParty': shares,
        'required': required,
      };

  final json = <String, dynamic>{
    'requestId': 'req_test0001',
    'fiduciary': {
      'address': fiduciaryAddress,
      'name': 'QuickLoan',
      'color': '#2F5BEA',
      'sector': ?sector,
    },
    'purposes': [
      purpose(creditCheckId, 'credit_check', 'Credit check', 'क्रेडिट जाँच', 'ಕ್ರೆಡಿಟ್ ಪರಿಶೀಲನೆ', ['PAN', 'income'], 365),
      purpose(marketingId, 'marketing', 'Loan offers', 'ऋण ऑफ़र', 'ಸಾಲದ ಆಫರ್‌ಗಳು', ['phone', 'email'], 180, shares: true),
      purpose(kycId, 'kyc', 'Identity check', 'पहचान जाँच', 'ಗುರುತಿನ ಪರಿಶೀಲನೆ', ['name'], 30, required: true),
    ],
    'noticeHash': '0x',
    'noticeVersion': 1,
    'domain': {'name': 'Sammati', 'version': '1', 'chainId': 31337, 'verifyingContract': verifyingContract},
    'nonce': nonce,
  };
  json['noticeHash'] = noticeHashOf(json);
  return json;
}

/// The hash Core would compute for [json]'s text.
String noticeHashOf(Map<String, dynamic> json) => ConsentNotice.fromJson(json).computeNoticeHash();

String qrJson({String requestId = 'req_test0001', String fiduciary = fiduciaryAddress}) => jsonEncode({
      'v': 1,
      'core': 'http://core.test:4000',
      'requestId': requestId,
      'fiduciary': fiduciary,
      'name': 'QuickLoan',
    });

QrPayload testPayload() => QrPayload.tryParse(jsonDecode(qrJson()))!;

/// One consent row in the fake's ledger.
class FakeConsent {
  FakeConsent({required this.status, required this.expiresAt, required this.txHash});

  String status;
  int expiresAt;
  String txHash;
}

/// Stands in for Core, with the checks the real one makes: the nonce must match
/// exactly and then advances, and the signature must recover to the principal.
class FakeCoreApi implements CoreApi {
  FakeCoreApi({Map<String, dynamic>? notice}) : _notice = notice ?? buildNoticeJson();

  Map<String, dynamic> _notice;
  Object? noticeError;
  Object? consentsError;
  Object? activityError;

  /// Newest first, as Core sends them.
  List<ActivityItem> activity = [];
  int activityFetches = 0;

  /// Zero-based index of the grant call that fails, or -1 for none.
  int failGrantAt = -1;
  // Proofs, cascade and rights (W-07, W-08, W-10): tests that need them set these; the rest never touch them.
  ConsentProof? consentProof;
  AccessProof? accessProof;
  List<CascadeAckRow> cascadeAcks = [];
  List<RightsRequestRow> rights = [];
  final List<({String fiduciary, String type, String note})> submittedRights = [];

  @override
  Future<ConsentProof> getConsentProof(String txHash) async =>
      consentProof ?? (throw const CoreException(CoreFailure.notFound));

  @override
  Future<AccessProof> getAccessProof(String entryId) async =>
      accessProof ?? (throw const CoreException(CoreFailure.notFound));

  @override
  Future<List<CascadeAckRow>> getCascadeAcks(String principal, String purposeId) async => cascadeAcks;

  @override
  Future<List<RightsRequestRow>> getRights(String principal) async => rights;

  @override
  Future<void> submitRightsRequest(String principal, String fiduciary, String type, String note) async {
    submittedRights.add((fiduciary: fiduciary, type: type, note: note));
  }
  CoreException grantError = const CoreException(CoreFailure.server);
  CoreException? withdrawError;

  /// When set, a withdrawal waits for it, so a test can look at the screen mid-flight.
  Completer<void>? withdrawGate;

  final List<Map<String, Object>> grants = [];
  final List<String> signatures = [];
  final List<Map<String, Object>> withdrawals = [];
  final List<String> withdrawSignatures = [];
  final Map<String, FakeConsent> ledger = {};
  int noticeFetches = 0;
  int consentsFetches = 0;

  set notice(Map<String, dynamic> value) => _notice = value;

  BigInt get _baseNonce => BigInt.parse(_notice['nonce'] as String);
  String get currentNonce => (_baseNonce + BigInt.from(grants.length + withdrawals.length)).toString();

  /// Puts a consent on the ledger without a signed grant, e.g. one made earlier or on another phone.
  /// It consumes no nonce, as if made under another key's history.
  void seed(String purposeId, {String status = 'Active', required int expiresAt}) {
    ledger[purposeId] = FakeConsent(
      status: status,
      expiresAt: expiresAt,
      txHash: '0x${(0xa0 + ledger.length).toRadixString(16).padLeft(64, '0')}',
    );
  }

  @override
  Future<ConsentNotice> getNotice(String requestId, {required String principal}) async {
    noticeFetches++;
    if (noticeError != null) throw noticeError!;
    return ConsentNotice.fromJson({..._notice, 'nonce': currentNonce});
  }

  @override
  Future<TxResult> grant(Map<String, Object> request, String signature) async {
    if (grants.length == failGrantAt) throw grantError;
    grants.add(request);
    signatures.add(signature);
    final tx = _tx();
    ledger[request['purposeId']! as String] =
        FakeConsent(status: 'Active', expiresAt: request['expiresAt']! as int, txHash: tx);
    return TxResult(txHash: tx, status: 'confirmed');
  }

  @override
  Future<TxResult> withdraw(Map<String, Object> request, String signature) async {
    await withdrawGate?.future;
    if (withdrawError != null) throw withdrawError!;
    if (request['nonce'] != currentNonce) {
      throw CoreException(CoreFailure.rejected, code: 'BAD_NONCE', message: 'Expected nonce $currentNonce');
    }
    final domain = Eip712Domain(chainId: 31337, verifyingContract: verifyingContract);
    final message = WithdrawConsent(
      principal: request['principal']! as String,
      fiduciary: request['fiduciary']! as String,
      purposeId: request['purposeId']! as String,
      nonce: request['nonce']! as String,
      deadline: request['deadline']! as int,
    );
    final signer = recoverSigner(eip712Digest(withdrawTypedDataJson(domain, message)), signature);
    if (signer.toLowerCase() != message.principal.toLowerCase()) {
      throw const CoreException(CoreFailure.rejected, code: 'BAD_SIGNATURE');
    }
    final row = ledger[message.purposeId];
    if (row == null || row.status != 'Active') {
      throw const CoreException(CoreFailure.rejected, code: 'NOT_ACTIVE');
    }
    withdrawals.add(request);
    withdrawSignatures.add(signature);
    row
      ..status = 'Withdrawn'
      ..txHash = _tx();
    return TxResult(txHash: row.txHash, status: 'confirmed');
  }

  @override
  Future<ConsentsSnapshot> getConsents(String principal) async {
    consentsFetches++;
    if (consentsError != null) throw consentsError!;
    final fiduciary = _notice['fiduciary'] as Map<String, dynamic>;
    final purposes = (_notice['purposes'] as List).cast<Map<String, dynamic>>();
    return ConsentsSnapshot.fromJson({
      'principal': principal,
      'nonce': currentNonce,
      'domain': _notice['domain'],
      'fiduciaries': [
        {
          'fiduciary': {...fiduciary, 'sector': 'Fintech lending'},
          'consents': [
            for (final p in purposes)
              if (ledger[p['id']] case final row?)
                {
                  'purposeId': p['id'],
                  'code': p['code'],
                  'title': p['title'],
                  'status': row.status,
                  'grantedAt': 1,
                  'expiresAt': row.expiresAt,
                  'updatedAt': 1,
                  'noticeHash': _notice['noticeHash'],
                  'lastTx': row.txHash,
                  'required': p['required'],
                },
          ],
        },
      ],
    });
  }

  int _txCount = 0;
  @override
  Future<List<ActivityItem>> getActivity(String principal, {int limit = 100}) async {
    activityFetches++;
    if (activityError != null) throw activityError!;
    return activity.take(limit).toList();
  }

  String _tx() => '0x${(++_txCount).toRadixString(16).padLeft(64, '0')}';
}

/// A scripted WebSocket: tests push events and connection changes by hand.
class FakeLiveEvents implements LiveEvents {
  final _updates = StreamController<ConsentUpdated>.broadcast();
  final _access = StreamController<ActivityItem>.broadcast();
  final _connection = StreamController<bool>.broadcast();
  final _cascade = StreamController<CascadeAck>.broadcast();
  bool disposed = false;

  @override
  Stream<ConsentUpdated> get consentUpdates => _updates.stream;

  @override
  Stream<ActivityItem> get accessEvents => _access.stream;

  @override
  Stream<bool> get connection => _connection.stream;

  @override
  Stream<CascadeAck> get cascadeUpdates => _cascade.stream;

  void emitAccess(ActivityItem item) => _access.add(item);
  void emit(ConsentUpdated event) => _updates.add(event);
  void connected(bool value) => _connection.add(value);

  @override
  void dispose() => disposed = true;
}

/// The address that signed [digestHex].
String recoverSigner(String digestHex, String signature) => SignatureUtil.ecRecover(
      signature: signature,
      message: Uint8List.fromList(hex.decode(digestHex.substring(2))),
      isPersonalSign: false,
    );

/// An activity row. [at] is Unix seconds; the fixed test clock is 1760000000.
ActivityItem activityItem(
  String id,
  Decision decision,
  int at, {
  String code = 'credit_check',
  String fiduciary = fiduciaryAddress,
  String name = 'QuickLoan',
  String? reason,
  DateTime? arrivedAt,
}) =>
    ActivityItem(
      id: id,
      fiduciary: fiduciary,
      fiduciaryName: name,
      purposeCode: code,
      decision: decision,
      reason: reason ?? (decision == Decision.allowed ? 'OK' : 'CONSENT_WITHDRAWN'),
      at: at,
      arrivedAt: arrivedAt,
    );
