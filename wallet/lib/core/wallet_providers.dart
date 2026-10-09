import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'preferences.dart';
import 'wallet_platform.dart';
import 'wallet_service.dart';

final walletServiceProvider = Provider<WalletService>(
  (ref) => WalletService(vault: SecureStorageVault(), presence: LocalAuthPresence()),
);

// Short enough to read as a logo, long enough not to flash on a fast phone.
const splashDuration = Duration(milliseconds: 600);

/// The wallet address: loading on launch, null when no wallet exists yet.
/// The router redirects on this, so creating the wallet moves the user on by itself.
class WalletAddressNotifier extends AsyncNotifier<String?> {
  @override
  Future<String?> build() async {
    final service = ref.read(walletServiceProvider);
    final (address, _) = await (service.address(), Future<void>.delayed(splashDuration)).wait;
    return address;
  }

  Future<void> create({required String reason}) async {
    final address = await ref.read(walletServiceProvider).create(reason: reason);
    state = AsyncData(address);
  }

  Future<void> clearApp() async {
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.clear();
    await ref.read(walletServiceProvider).vault.deleteAll();
    state = const AsyncData(null);
  }
}

final walletAddressProvider = AsyncNotifierProvider<WalletAddressNotifier, String?>(WalletAddressNotifier.new);
