// The wallet's single entry point for the key (trd.md §4.2): the private key is
// created once, kept in secure storage, and is only ever read after the user
// has just passed a device-credential check. The key never leaves this class.

import 'dart:convert';
import 'dart:typed_data';

import 'package:eth_sig_util/eth_sig_util.dart';

import 'eip712.dart';
import 'wallet_key.dart';

/// Where the key bytes live (flutter_secure_storage in the app, a map in tests).
abstract interface class KeyVault {
  Future<String?> read(String name);
  Future<void> write(String name, String value);
  Future<void> deleteAll();
}

/// Proof that the person holding the phone is present (local_auth in the app).
abstract interface class UserPresence {
  /// False when the phone has no screen lock, biometric or PIN at all.
  Future<bool> isAvailable();

  /// Shows the system prompt with [reason]; true only on success.
  Future<bool> confirm(String reason);
}

enum WalletFailure { noDeviceLock, authFailed, notCreated, storageFailed }

class WalletException implements Exception {
  const WalletException(this.failure);
  final WalletFailure failure;

  @override
  String toString() => 'WalletException(${failure.name})';
}

const _keyName = 'wallet_private_key';
// The address is public, so it is kept beside the key to show on screen
// without prompting for biometrics.
const _addressName = 'wallet_address';

class WalletService {
  WalletService({required KeyVault vault, required UserPresence presence})
      : _vault = vault,
        _presence = presence;

  final KeyVault _vault;
  final UserPresence _presence;

  /// The same two seams, for the profile vault (profile_store.dart): one device check gates both secrets.
  KeyVault get vault => _vault;
  UserPresence get presence => _presence;

  /// The wallet address, or null on a fresh install. No prompt.
  Future<String?> address() => _readAddress();

  /// Creates the wallet after the user confirms with their device credential.
  /// Fails closed: a phone with no screen lock cannot hold a wallet.
  /// If a wallet already exists it is returned untouched, so a repeated call
  /// can never replace (and so destroy) the user's identity.
  Future<String> create({required String reason}) async {
    final existing = await _readAddress();
    if (existing != null) return existing;

    if (!await _presence.isAvailable()) throw const WalletException(WalletFailure.noDeviceLock);
    if (!await _presence.confirm(reason)) throw const WalletException(WalletFailure.authFailed);

    try {
      final key = WalletKey.generate();
      // Key first: if the address write fails the wallet is simply not created yet.
      await _vault.write(_keyName, key.privateKeyHex);
      await _vault.write(_addressName, key.address);
      return key.address;
    } catch (_) {
      throw const WalletException(WalletFailure.storageFailed);
    }
  }

  /// Signs EIP-712 V4 typed data (built with grantTypedDataJson or
  /// withdrawTypedDataJson) and returns 0x r||s||v. Every call prompts: the
  /// user approves each signature, and nothing is cached between calls.
  Future<String> sign(String typedDataJson, {required String reason}) async =>
      (await signAll([typedDataJson], reason: reason)).single;

  /// Signs several messages behind ONE prompt, for a single user action that
  /// needs several signatures (one grant per purpose). The key is read only
  /// after the prompt succeeds and is not kept afterwards.
  Future<List<String>> signAll(List<String> typedDataJsons, {required String reason}) async {
    if (await _readAddress() == null) throw const WalletException(WalletFailure.notCreated);
    if (!await _presence.confirm(reason)) throw const WalletException(WalletFailure.authFailed);

    final privateKey = await _readKey();
    return [for (final json in typedDataJsons) signTypedDataV4(privateKey, json)];
  }

  /// Signs a text message as EIP-191 `personal_sign` (the Processor verifies submissions this way, trd.md §4.4.8) and
  /// returns 0x r||s||v. Prompts like every signature; nothing is cached. Not an EIP-712 type: none of those change.
  Future<String> signMessage(String message, {required String reason}) async {
    if (await _readAddress() == null) throw const WalletException(WalletFailure.notCreated);
    if (!await _presence.confirm(reason)) throw const WalletException(WalletFailure.authFailed);
    final privateKey = await _readKey();
    return EthSigUtil.signPersonalMessage(privateKey: privateKey, message: Uint8List.fromList(utf8.encode(message)));
  }

  Future<String?> _readAddress() async {
    try {
      return await _vault.read(_addressName);
    } catch (_) {
      throw const WalletException(WalletFailure.storageFailed);
    }
  }

  Future<String> _readKey() async {
    try {
      final key = await _vault.read(_keyName);
      if (key != null) return key;
    } catch (_) {
      // Fall through to the same failure: callers cannot act on the difference.
    }
    throw const WalletException(WalletFailure.storageFailed);
  }
}
