// Device-backed implementations of the wallet's two seams.

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

import 'wallet_service.dart';

class SecureStorageVault implements KeyVault {
  SecureStorageVault([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String name) => _storage.read(key: name);

  @override
  Future<void> write(String name, String value) => _storage.write(key: name, value: value);
}

class LocalAuthPresence implements UserPresence {
  LocalAuthPresence([LocalAuthentication? auth]) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  // local_auth has no web implementation (it throws MissingPluginException), and a browser has no device PIN
  // or fingerprint to ask for. The Chrome build is for demos and development only: there the check passes
  // without a prompt, and the key sits in the browser's storage rather than the phone's secure hardware.
  @override
  Future<bool> isAvailable() async => kIsWeb || await _auth.isDeviceSupported();

  // biometricOnly stays false so the phone PIN/pattern is accepted (ui.md: "fingerprint or PIN").
  @override
  Future<bool> confirm(String reason) async {
    if (kIsWeb) return true;
    try {
      return await _auth.authenticate(localizedReason: reason);
    } on LocalAuthException {
      // Cancelled, locked out, or no credential: all mean "not confirmed".
      return false;
    }
  }
}
