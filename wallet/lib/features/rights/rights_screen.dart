import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/consent_providers.dart';
import '../../core/consents_controller.dart';
import '../../core/rights_controller.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';
import '../shell/empty_state.dart';
import 'rights_form_sheet.dart';

class RightsScreen extends ConsumerWidget {
  const RightsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(rightsProvider);

    final entries = [
      (Icons.visibility_outlined, t.rights_access, 'access'),
      (Icons.edit_outlined, 'Correction', 'correction'),
      (Icons.delete_outline, t.rights_erasure, 'erasure'),
      (Icons.report_gmailerrorred_outlined, t.rights_grievance, 'grievance'),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(t.nav_rights)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(rightsProvider.notifier).refresh(),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final (icon, label, type) in entries) ...[
              Material(
                color: SammatiColors.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(SammatiRadius.row),
                  side: const BorderSide(color: SammatiColors.line),
                ),
                child: ListTile(
                  minTileHeight: 56,
                  leading: Icon(icon, color: SammatiColors.ink),
                  title: Text(label, style: Theme.of(context).textTheme.titleMedium),
                  trailing: const Icon(Icons.chevron_right, color: SammatiColors.mute),
                  onTap: () => showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    shape: const RoundedRectangleBorder(
                      borderRadius: BorderRadius.vertical(top: Radius.circular(SammatiRadius.pass)),
                    ),
                    builder: (_) => RightsFormSheet(type: type, label: label),
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
            const SizedBox(height: 8),
            Material(
              color: SammatiColors.marigold,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(SammatiRadius.row),
                side: const BorderSide(color: SammatiColors.line),
              ),
              child: ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.download_outlined, color: SammatiColors.ink),
                title: Text('Download my data summary', style: Theme.of(context).textTheme.titleMedium?.copyWith(color: SammatiColors.ink)),
                trailing: const Icon(Icons.chevron_right, color: SammatiColors.ink),
                onTap: () {
                  final consents = ref.read(consentsProvider).snapshot?.companies ?? [];
                  final summary = {
                    'exportedAt': DateTime.now().toIso8601String(),
                    'companies': consents.map((f) => {
                      'name': f.fiduciary.name,
                      'address': f.fiduciary.address,
                      'consents': f.consents.map((c) => {
                        'purpose': c.code,
                        'status': c.status.name,
                        'expiresAt': c.expiresAt != null ? DateTime.fromMillisecondsSinceEpoch(c.expiresAt! * 1000).toIso8601String() : null,
                      }).toList(),
                    }).toList(),
                  };
                  showDialog(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Data Summary (JSON)'),
                      content: SingleChildScrollView(
                        child: Text(const JsonEncoder.withIndent('  ').convert(summary)),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Close'),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 24),
            Text('Recent requests', style: Theme.of(context).textTheme.titleMedium), // To be localized if needed
            const SizedBox(height: 16),
            if (state.isLoading && state.requests.isEmpty)
              const Center(child: CircularProgressIndicator())
            else if (state.error && state.requests.isEmpty)
              EmptyState(icon: Icons.cloud_off, message: t.error_generic)
            else if (state.requests.isEmpty)
              EmptyState(icon: Icons.inbox, message: 'No requests yet.')
            else
              for (final req in state.requests) ...[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(req.fiduciaryName, style: Theme.of(context).textTheme.titleMedium),
                  subtitle: Text(
                    '${req.type.toUpperCase()} · ${req.status.toUpperCase()}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SammatiColors.mute),
                  ),
                ),
                const Divider(height: 1),
              ],
          ],
        ),
      ),
    );
  }
}

