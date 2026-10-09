import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/format.dart';
import '../../core/preferences.dart';
import '../../core/requests_controller.dart';
import '../../core/wallet_providers.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';
import 'language_options.dart';

/// W9 me. Security and about arrive with their features.
class MeScreen extends ConsumerWidget {
  const MeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final address = ref.watch(walletAddressProvider).value;

    return Scaffold(
      appBar: AppBar(title: Text(t.nav_me)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(t.me_language, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          LanguageOptions(
            current: ref.watch(localeProvider).languageCode,
            onSelected: ref.read(localeProvider.notifier).setLanguage,
          ),
          const SizedBox(height: 24),
          _Group(
            children: [
              if (address != null)
                ListTile(
                  minTileHeight: 56,
                  leading: const Icon(Icons.account_balance_wallet_outlined),
                  title: Text(t.me_wallet_address),
                  subtitle: Text(shortHex(address)),
                  trailing: const Icon(Icons.copy, size: 20),
                  onTap: () async {
                    final messenger = ScaffoldMessenger.of(context);
                    await Clipboard.setData(ClipboardData(text: address));
                    messenger.showSnackBar(SnackBar(content: Text(t.copied)));
                  },
                ),
              ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.alternate_email),
                title: Text(t.id_title),
                subtitle: Text(ref.watch(identityProvider).value ?? t.id_none),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.sammatiId),
              ),
              ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.badge_outlined),
                title: Text(t.profile_title),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.profile),
              ),
              ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.info_outline),
                title: Text(t.me_about),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.about),
              ),
              ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.code),
                title: Text(t.me_developer),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.devSettings),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _Group(
            children: [
              ListTile(
                minTileHeight: 56,
                leading: const Icon(Icons.logout, color: SammatiColors.block),
                title: Text('Sign out', style: TextStyle(color: SammatiColors.block, fontWeight: FontWeight.bold)),
                onTap: () async {
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(
                      title: const Text('Sign out?'),
                      content: const Text('This will erase your wallet and sign you out.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
                        TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out', style: TextStyle(color: SammatiColors.block))),
                      ],
                    ),
                  );
                  if (confirm == true) {
                    await ref.read(walletAddressProvider.notifier).clearApp();
                  }
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SammatiColors.surface,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(SammatiRadius.row),
        side: const BorderSide(color: SammatiColors.line),
      ),
      child: Column(children: children),
    );
  }
}
