// Cascade section state for W-08 (pass_detail_screen.dart).
//
// One Riverpod family provider per (principal, purposeId) pair. On first read it
// fetches the full list from Core and then patches it live from cascade.updated frames.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'consent_providers.dart';
import 'consents_controller.dart';
import 'core_api.dart';
import 'live_events.dart';
import 'preferences.dart';
import 'proof.dart';
import 'wallet_providers.dart';

/// The loading + data state for one purpose's cascade acks.
class CascadeState {
  const CascadeState({
    this.acks = const [],
    this.loading = false,
    this.failed = false,
  });

  final List<CascadeAckRow> acks;
  final bool loading;
  final bool failed;

  CascadeState copyWith({List<CascadeAckRow>? acks, bool? loading, bool? failed}) =>
      CascadeState(
        acks: acks ?? this.acks,
        loading: loading ?? this.loading,
        failed: failed ?? this.failed,
      );
}

/// Args for the family: the principal and purpose pair for which we fetch acks.
class _CascadeKey {
  const _CascadeKey(this.principal, this.purposeId);

  final String principal;
  final String purposeId;

  @override
  bool operator ==(Object other) =>
      other is _CascadeKey && other.principal == principal && other.purposeId == purposeId;

  @override
  int get hashCode => Object.hash(principal, purposeId);
}

class CascadeController extends Notifier<CascadeState> {
  /// Riverpod 3 passes a family argument through the constructor (it was `arg` in Riverpod 2).
  CascadeController(this._key);

  final _CascadeKey _key;

  @override
  CascadeState build() {
    final live = ref.watch(liveEventsProvider);
    if (live != null) {
      final sub = live.cascadeUpdates.listen(_onLive);
      ref.onDispose(() => unawaited(sub.cancel()));
    }

    // Kick off the first fetch after build() returns.
    Future.microtask(refresh);
    return const CascadeState(loading: true);
  }

  Future<void> refresh() async {
    final principal = _key.principal;
    final purposeId = _key.purposeId;
    state = state.copyWith(loading: state.acks.isEmpty);
    try {
      final acks = await ref
          .read(coreApiFactoryProvider)(ref.read(coreUrlProvider))
          .getCascadeAcks(principal, purposeId);
      state = CascadeState(acks: acks);
    } on CoreException {
      state = state.copyWith(loading: false, failed: true);
    }
  }

  void _onLive(CascadeAck event) {
    // Guard: only handle events for this purpose.
    if (event.purposeId.toLowerCase() != _key.purposeId.toLowerCase()) return;
    if (event.principal.toLowerCase() != _key.principal.toLowerCase()) return;

    // Build a CascadeAckRow from the live event, then upsert it.
    final live = CascadeAckRow(
      processor: event.processor,
      notifiedAt: event.notifiedAt,
      ackedAt: event.ackedAt,
      txHash: event.txHash,
    );

    final existing = state.acks.indexWhere(
      (r) => r.processor.toLowerCase() == event.processor.toLowerCase(),
    );
    final updated = [...state.acks];
    if (existing >= 0) {
      updated[existing] = live;
    } else {
      updated.add(live);
    }
    state = state.copyWith(acks: updated, loading: false, failed: false);
  }
}

/// Key: (_CascadeKey). The screen reads it with cascadeProvider((_CascadeKey(principal, purposeId))).
final cascadeProvider =
    NotifierProvider.autoDispose.family<CascadeController, CascadeState, _CascadeKey>(
  CascadeController.new,
);

/// Returns the provider for a specific (principal, purposeId) pair.
NotifierProvider<CascadeController, CascadeState> cascadeFor(
        String principal, String purposeId) =>
    cascadeProvider(_CascadeKey(principal, purposeId));
