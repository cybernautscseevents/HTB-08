import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/consent_providers.dart';
import '../../core/consents.dart';
import '../../core/consents_controller.dart';
import '../../core/core_api.dart';
import '../../core/format.dart';
import '../../core/cascade_controller.dart';
import '../../core/preferences.dart';
import '../../core/wallet_providers.dart';
import '../../core/wallet_service.dart';
import '../../core/withdraw_flow.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';
import '../../core/vault_purposes.dart';
import '../alerts/renew.dart';
import '../consent/receipt_data.dart';
import '../shell/empty_state.dart';
import '../vault/vault_send_section.dart';
import 'consent_text.dart';

/// W5 pass detail: the company's purposes, each with a switch that withdraws.
/// Withdrawing is two taps: flip the switch, then confirm in the sheet.
class PassDetailScreen extends ConsumerStatefulWidget {
  const PassDetailScreen({super.key, required this.fiduciary});

  final String fiduciary;

  @override
  ConsumerState<PassDetailScreen> createState() => _PassDetailScreenState();
}

class _PassDetailScreenState extends ConsumerState<PassDetailScreen> {
  // Purposes with a withdrawal in flight, so a second tap cannot sign twice.
  final _busy = <String>{};

  Future<void> _withdraw(CompanyConsents company, ConsentView consent) async {
    final t = AppLocalizations.of(context);
    final language = Localizations.localeOf(context).languageCode;
    final messenger = ScaffoldMessenger.of(context);
    final purposeTitle = consent.title.forLanguage(language);

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(SammatiRadius.pass)),
      ),
      builder: (_) => _WithdrawSheet(company: company.fiduciary.name, purpose: purposeTitle),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy.add(consent.purposeId));
    try {
      final result = await ref.read(withdrawFlowProvider).withdraw(
            coreUrl: ref.read(coreUrlProvider),
            fiduciary: company.fiduciary.address,
            purposeId: consent.purposeId,
            reason: t.auth_reason_withdraw,
          );
      ref.read(consentsProvider.notifier).markWithdrawn(company.fiduciary.address, result.purposeId, result.txHash);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(t.withdrawn_blocked(company.fiduciary.name))));
    } on WalletException {
      _toast(messenger, t.wallet_auth_failed);
    } on NothingToWithdrawException {
      // Already withdrawn elsewhere: show the truth instead of an error.
      await ref.read(consentsProvider.notifier).refresh();
    } on CoreException catch (e) {
      _toast(messenger, e.failure == CoreFailure.unreachable ? t.error_unreachable : t.grant_failed);
    } finally {
      if (mounted) setState(() => _busy.remove(consent.purposeId));
    }
  }

  void _toast(ScaffoldMessengerState messenger, String message) => messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final company = ref.watch(consentsProvider).snapshot?.company(widget.fiduciary);
    final now = ref.watch(clockProvider)();

    if (company == null) {
      return Scaffold(
        appBar: AppBar(),
        body: EmptyState(icon: Icons.verified_user_outlined, message: t.consents_empty),
      );
    }

    final accent = parseCompanyColor(company.fiduciary.color, SammatiColors.ink);
    final style = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(backgroundColor: accent, title: Text(company.fiduciary.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (company.fiduciary.sector != null) ...[
            Text(company.fiduciary.sector!, style: style.bodyLarge),
            const SizedBox(height: 16),
          ],
          for (final consent in company.consents) ...[
            _PurposeRow(
              company: company.fiduciary.name,
              fiduciary: company.fiduciary.address,
              consent: consent,
              now: now,
              busy: _busy.contains(consent.purposeId),
              onWithdraw: () => _withdraw(company, consent),
            ),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

/// A purpose row. When it becomes withdrawn, a grey "cut" sweeps across it in 250 ms
/// (ui.md §1.3); with reduced motion the change is instant. It animates on a live change
/// too, so a withdrawal made elsewhere shows the same way.
class _PurposeRow extends ConsumerWidget {
  const _PurposeRow({
    required this.company,
    required this.fiduciary,
    required this.consent,
    required this.now,
    required this.busy,
    required this.onWithdraw,
  });

  static const cutDuration = Duration(milliseconds: 250);

  final String company;
  final String fiduciary;
  final ConsentView consent;
  final DateTime now;
  final bool busy;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final style = Theme.of(context).textTheme;
    final language = Localizations.localeOf(context).languageCode;
    final state = consent.stateAt(now);
    final title = consent.title.forLanguage(language);
    final cut = state == ConsentState.withdrawn;
    final duration = MediaQuery.disableAnimationsOf(context) ? Duration.zero : cutDuration;
    final line = expiryLine(t, consent, now);

    return ClipRRect(
      borderRadius: BorderRadius.circular(SammatiRadius.row),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: SammatiColors.surface,
          borderRadius: BorderRadius.circular(SammatiRadius.row),
          border: Border.all(color: SammatiColors.line),
        ),
        child: Stack(
          children: [
            Positioned.fill(
              child: TweenAnimationBuilder<double>(
                tween: Tween(end: cut ? 1 : 0),
                duration: duration,
                curve: Curves.easeOut,
                builder: (_, value, _) => FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: value,
                  child: const ColoredBox(color: SammatiColors.paper),
                ),
              ),
            ),
            // One column, so the pieces stack instead of drawing over each other (a Stack would put them all at the top).
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AnimatedOpacity(
                  opacity: cut ? 0.6 : 1,
                  duration: duration,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(title, style: style.titleLarge),
                              const SizedBox(height: 8),
                              StatusChip(state: state),
                              if (line != null) ...[
                                const SizedBox(height: 8),
                                Text(line, style: style.bodyMedium?.copyWith(color: SammatiColors.mute)),
                              ],
                              // "Give consent again" (ui.md W13): the same Renew as the Alerts tab, from the expired consent itself.
                              if (state == ConsentState.expired)
                                TextButton(
                                  style: TextButton.styleFrom(minimumSize: const Size(48, 48), padding: EdgeInsets.zero),
                                  onPressed: () => startRenewal(context, ref, fiduciary: fiduciary, company: company, purposeCode: consent.code),
                                  child: Text(t.alert_renew),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (busy)
                          const SizedBox(width: 48, height: 48, child: Center(child: CircularProgressIndicator(strokeWidth: 3)))
                        else
                          MergeSemantics(
                            child: Semantics(
                              label: t.purpose_switch_label(title, company),
                              // Only an active consent can be switched off; giving consent again goes through a new scan.
                              child: state == ConsentState.active
                                  ? OutlinedButton(
                                      onPressed: onWithdraw,
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: SammatiColors.block,
                                        side: const BorderSide(color: SammatiColors.block),
                                      ),
                                      child: Text(t.withdraw),
                                    )
                                  : const SizedBox.shrink(),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (vaultPurposes.contains(consent.code))
                  VaultSendSection(
                    fiduciary: fiduciary,
                    company: company,
                    purposeCode: consent.code,
                    consentActive: state == ConsentState.active,
                    categories: consent.dataCategories,
                    noticeHash: consent.noticeHash,
                  ),
                // After a withdrawal this is the "who else was told" list (W-08); empty, it takes no room.
                _CascadeList(purposeId: consent.purposeId, now: now),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CascadeList extends ConsumerWidget {
  const _CascadeList({required this.purposeId, required this.now});

  final String purposeId;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final style = Theme.of(context).textTheme;
    final principal = ref.watch(walletAddressProvider).value;
    if (principal == null) return const SizedBox.shrink();

    final cascadeState = ref.watch(cascadeFor(principal, purposeId));
    if (cascadeState.acks.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 24, color: SammatiColors.line),
          Text(t.cascade_title, style: style.titleMedium),
          const SizedBox(height: 8),
          for (final ack in cascadeState.acks)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Expanded(child: Text(ack.processorName ?? shortHex(ack.processor), style: style.bodyMedium)),
                  if (ack.ackedAt != null)
                    Text(
                      t.cascade_acked(now.difference(DateTime.fromMillisecondsSinceEpoch(ack.ackedAt! * 1000)).inSeconds.clamp(0, 999999)),
                      style: style.bodyMedium?.copyWith(color: SammatiColors.allow),
                    )
                  else
                    Text(t.cascade_waiting, style: style.bodyMedium?.copyWith(color: SammatiColors.mute)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _WithdrawSheet extends StatelessWidget {
  const _WithdrawSheet({required this.company, required this.purpose});

  final String company;
  final String purpose;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(t.withdraw_confirm(company, purpose), style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: SammatiColors.block, minimumSize: const Size.fromHeight(56)),
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(t.withdraw),
            ),
            const SizedBox(height: 8),
            TextButton(
              style: TextButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(t.keep),
            ),
          ],
        ),
      ),
    );
  }
}
