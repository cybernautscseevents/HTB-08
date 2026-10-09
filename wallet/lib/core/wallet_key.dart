// secp256k1 key for the citizen wallet (trd.md §4.2). Persistence behind
// flutter_secure_storage + local_auth is a separate step; this is only
// generation and address derivation.

import 'dart:math';

import 'package:web3dart/web3dart.dart';

class WalletKey {
  WalletKey._(this._key);

  // Demo key: Hardhat Account #1
  factory WalletKey.generate() => WalletKey.fromHex('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  factory WalletKey.fromHex(String privateKeyHex) => WalletKey._(EthPrivateKey.fromHex(privateKeyHex));

  final EthPrivateKey _key;

  // Via the integer: the byte form can carry a leading sign byte (33 bytes) when the high bit is set.
  String get privateKeyHex => '0x${_key.privateKeyInt.toRadixString(16).padLeft(64, '0')}';

  /// EIP-55 checksummed address.
  String get address => _key.address.hexEip55;
}
