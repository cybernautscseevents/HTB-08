import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/consents_controller.dart';
import '../../core/rights_controller.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';

class RightsFormSheet extends ConsumerStatefulWidget {
  const RightsFormSheet({super.key, required this.type, required this.label});

  final String type;
  final String label;

  @override
  ConsumerState<RightsFormSheet> createState() => _RightsFormSheetState();
}

class _RightsFormSheetState extends ConsumerState<RightsFormSheet> {
  String? _selectedFiduciary;
  final _noteController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedFiduciary == null) return;
    setState(() => _submitting = true);
    
    try {
      await ref.read(rightsProvider.notifier).submit(
        _selectedFiduciary!, 
        widget.type, 
        _noteController.text,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).error_generic)),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final companies = ref.watch(consentsProvider).snapshot?.companies ?? [];

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.label, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 24),
          DropdownButtonFormField<String>(
            decoration: InputDecoration(
              labelText: 'Company',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SammatiRadius.row)),
            ),
            value: _selectedFiduciary,
            items: [
              for (final comp in companies)
                DropdownMenuItem(
                  value: comp.fiduciary.address,
                  child: Text(comp.fiduciary.name),
                ),
            ],
            onChanged: (val) => setState(() => _selectedFiduciary = val),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _noteController,
            decoration: InputDecoration(
              labelText: 'Note (optional)',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SammatiRadius.row)),
            ),
            maxLines: 3,
          ),
          const SizedBox(height: 24),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            onPressed: (_submitting || _selectedFiduciary == null) ? null : _submit,
            child: _submitting ? const CircularProgressIndicator() : const Text('Submit'),
          ),
        ],
      ),
    );
  }
}
