import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/activity.dart';
import '../../core/activity_controller.dart';
import '../../core/consent_providers.dart';
import '../../core/consents_controller.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';
import '../consent/proof_sheet.dart';
import '../consent/receipt_data.dart';
import '../shell/empty_state.dart';
import '../shell/offline_banner.dart';
import 'activity_text.dart';

/// How long after arriving a row still counts as "new" and plays its entrance.
const _freshWindow = Duration(seconds: 3);

/// W6 activity: every data access by a company, newest first, live over the socket.
class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(activityProvider);

    return Scaffold(
      appBar: AppBar(title: Text(t.nav_activity)),
      body: Column(
        children: [
          if (state.offline && state.loaded) OfflineBanner(message: t.offline_activity_banner),
          if (state.loaded) const _Filters(),
          Expanded(child: _Feed(state: state)),
        ],
      ),
    );
  }
}

class _Feed extends ConsumerWidget {
  const _Feed({required this.state});

  final ActivityState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);

    if (!state.loaded) {
      if (state.loading) return const Center(child: CircularProgressIndicator());
      return EmptyState(
        icon: Icons.wifi_off,
        message: t.error_unreachable,
        action: FilledButton(onPressed: ref.read(activityProvider.notifier).refresh, child: Text(t.retry)),
      );
    }

    final filter = ref.watch(activityFilterProvider);
    final items = state.items.where(filter.matches).toList();
    if (items.isEmpty) return EmptyState(icon: Icons.bolt_outlined, message: t.activity_empty);

    final snapshot = ref.watch(consentsProvider).snapshot;
    final language = Localizations.localeOf(context).languageCode;
    final now = ref.watch(clockTickProvider).value ?? ref.watch(clockProvider)();

    return RefreshIndicator(
      onRefresh: ref.read(activityProvider.notifier).refresh,
      child: ListView.builder(
        // Room under the last row for the docked scan button.
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 112),
        itemCount: items.length,
        // Without this the list matches rows to widgets by position, so when a row is inserted
        // at the top every older row would be handed a new State and play its entrance again.
        findChildIndexCallback: (key) {
          if (key is! ValueKey<String>) return null;
          final index = items.indexWhere((i) => i.id == key.value);
          return index < 0 ? null : index;
        },
        itemBuilder: (context, i) {
          final item = items[i];
          final company = snapshot?.company(item.fiduciary);
          final arrived = item.arrivedAt;
          return Padding(
            // The id key keeps a row's state (and its finished animation) as new rows push it down.
            key: ValueKey(item.id),
            padding: const EdgeInsets.only(bottom: 8),
            child: _ActivityRow(
              item: item,
              title: purposeTitle(snapshot, item, language),
              dot: parseCompanyColor(company?.fiduciary.color ?? '', SammatiColors.mute),
              time: relativeTime(t, item.at, now),
              fresh: arrived != null && now.difference(arrived).abs() < _freshWindow,
            ),
          );
        },
      ),
    );
  }
}

class _Filters extends ConsumerWidget {
  const _Filters();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final filter = ref.watch(activityFilterProvider);
    final controller = ref.read(activityFilterProvider.notifier);

    // Companies the feed knows about: the ones with consents, plus any that appear in rows.
    final companies = <String, String>{};
    for (final c in ref.watch(consentsProvider).snapshot?.companies ?? const []) {
      companies[c.fiduciary.address.toLowerCase()] = c.fiduciary.name;
    }
    for (final item in ref.watch(activityProvider).items) {
      companies.putIfAbsent(item.fiduciary.toLowerCase(), () => item.fiduciaryName);
    }

    return SizedBox(
      height: 56,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: [
          _FilterChip(label: t.filter_all, selected: filter.isAll, onTap: controller.showAll),
          _FilterChip(
            label: t.allowed,
            selected: filter.decision == Decision.allowed,
            onTap: () => controller.showDecision(Decision.allowed),
          ),
          _FilterChip(
            label: t.blocked,
            selected: filter.decision == Decision.blocked,
            onTap: () => controller.showDecision(Decision.blocked),
          ),
          for (final entry in companies.entries)
            _FilterChip(
              label: entry.value,
              selected: filter.company?.toLowerCase() == entry.key,
              onTap: () => controller.toggleCompany(entry.key),
            ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Semantics(
        button: true,
        selected: selected,
        child: ChoiceChip(
          label: Text(label),
          selected: selected,
          onSelected: (_) => onTap(),
          showCheckmark: selected,
          checkmarkColor: SammatiColors.surface,
          selectedColor: SammatiColors.ink,
          backgroundColor: SammatiColors.surface,
          side: const BorderSide(color: SammatiColors.line),
          shape: const StadiumBorder(),
          labelStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: selected ? SammatiColors.surface : SammatiColors.ink,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}

/// One feed row. A row that just arrived grows in from the top and washes green (allowed)
/// or red (blocked) for about a second; with reduced motion it simply appears (ui.md §1.3, §7).
class _ActivityRow extends StatefulWidget {
  const _ActivityRow({
    required this.item,
    required this.title,
    required this.dot,
    required this.time,
    required this.fresh,
  });

  final ActivityItem item;
  final String title;
  final Color dot;
  final String time;
  final bool fresh;

  @override
  State<_ActivityRow> createState() => _ActivityRowState();
}

class _ActivityRowState extends State<_ActivityRow> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );
  bool _decided = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // MediaQuery is not readable in initState, so the choice is made once, here.
    if (_decided) return;
    _decided = true;
    if (widget.fresh && !MediaQuery.disableAnimationsOf(context)) {
      _controller.forward();
    } else {
      _controller.value = 1;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final style = Theme.of(context).textTheme;
    final item = widget.item;
    final blocked = item.decision == Decision.blocked;
    final wash = blocked ? SammatiColors.block : SammatiColors.allow;
    final why = blocked ? reasonText(t, item.reason) : null;
    final decisionLabel = blocked ? t.blocked : t.allowed;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final growth = CurvedAnimation(parent: _controller, curve: const Interval(0, 0.25, curve: Curves.easeOut));
        final tint = Color.lerp(wash.withValues(alpha: 0.25), SammatiColors.surface, Curves.easeIn.transform(_controller.value));
        return SizeTransition(
          sizeFactor: growth,
          axisAlignment: -1,
          child: Container(
            decoration: BoxDecoration(
              color: tint,
              borderRadius: BorderRadius.circular(SammatiRadius.row),
              border: Border.all(color: SammatiColors.line),
            ),
            // A coloured edge cannot be part of the border: Flutter rejects rounded corners on
            // borders whose sides differ in colour. The blocked stripe is drawn over it instead.
            child: ClipRRect(
              borderRadius: BorderRadius.circular(SammatiRadius.row),
              child: Stack(
                children: [
                  child!,
                  if (blocked)
                    const Positioned(left: 0, top: 0, bottom: 0, width: 4, child: ColoredBox(color: SammatiColors.block)),
                ],
              ),
            ),
          ),
        );
      },
      child: InkWell(
        onTap: () => showAccessProofSheet(context, item.id),
        borderRadius: BorderRadius.circular(SammatiRadius.row),
        child: MergeSemantics(
          child: Semantics(
            label: t.activity_row_label(widget.title, item.fiduciaryName, decisionLabel, widget.time),
          child: ExcludeSemantics(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(width: 12, height: 12, decoration: BoxDecoration(color: widget.dot, shape: BoxShape.circle)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${widget.title} · ${item.fiduciaryName}', style: style.titleMedium),
                        if (why != null) Text(why, style: style.bodyMedium?.copyWith(color: SammatiColors.mute)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      DecisionChip(decision: item.decision),
                      const SizedBox(height: 4),
                      Text(widget.time, style: style.bodyMedium?.copyWith(color: SammatiColors.mute)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      ),
    );
  }
}
