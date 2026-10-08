import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'consent_providers.dart';
import 'core_api.dart';
import 'preferences.dart';
import 'rights.dart';
import 'wallet_providers.dart';

class RightsState {
  const RightsState({this.requests = const [], this.isLoading = true, this.error = false});

  final List<RightsRequestRow> requests;
  final bool isLoading;
  final bool error;

  RightsState copyWith({List<RightsRequestRow>? requests, bool? isLoading, bool? error}) {
    return RightsState(
      requests: requests ?? this.requests,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

class RightsController extends Notifier<RightsState> {
  @override
  RightsState build() {
    // Watched here, in build, so the list loads once the wallet address resolves (Riverpod only allows
    // watch during build; the methods below read).
    final principal = ref.watch(walletAddressProvider).value;
    if (principal != null) _fetch(principal);
    return const RightsState();
  }

  Future<void> _fetch(String principal) async {
    try {
      final rows = await ref.read(coreApiFactoryProvider)(ref.read(coreUrlProvider)).getRights(principal);
      state = state.copyWith(requests: rows, isLoading: false, error: false);
    } catch (_) {
      state = state.copyWith(isLoading: false, error: true);
    }
  }

  Future<void> refresh() async {
    final principal = ref.read(walletAddressProvider).value;
    if (principal != null) await _fetch(principal);
  }

  Future<void> submit(String fiduciary, String type, String note) async {
    final principal = ref.read(walletAddressProvider).value;
    if (principal == null) return;

    await ref.read(coreApiFactoryProvider)(ref.read(coreUrlProvider)).submitRightsRequest(principal, fiduciary, type, note);
    await _fetch(principal);
  }
}

final rightsProvider = NotifierProvider.autoDispose<RightsController, RightsState>(RightsController.new);