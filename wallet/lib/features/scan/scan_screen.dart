import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app/router.dart';
import '../../core/consent_providers.dart';
import '../../core/core_api.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';

/// W2 scan: full-screen camera; a valid Sammati QR slides to the consent notice.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  // The camera reports the same code many times a second.
  static const _invalidCooldown = Duration(seconds: 3);

  bool _handled = false;
  String? _lastInvalid;
  DateTime? _lastInvalidAt;

  static QrPayload? _parse(String raw) {
    try {
      return QrPayload.tryParse(jsonDecode(raw));
    } on FormatException {
      return null;
    }
  }

  void _onCode(String raw) {
    if (_handled) return;

    final payload = _parse(raw);
    if (payload == null) {
      _reportInvalid(raw);
      return;
    }

    _handled = true;
    HapticFeedback.mediumImpact();
    context.pushReplacement(Routes.consentNotice, extra: payload);
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;

    final controller = MobileScannerController();
    final barcodeCapture = await controller.analyzeImage(file.path);
    
    if (barcodeCapture != null && barcodeCapture.barcodes.isNotEmpty) {
      final code = barcodeCapture.barcodes.first.rawValue;
      if (code != null) {
        _onCode(code);
      } else {
        _reportInvalid("");
      }
    } else {
      _reportInvalid("");
    }
    controller.dispose();
  }

  void _reportInvalid(String raw) {
    final now = DateTime.now();
    final repeat = raw == _lastInvalid && now.difference(_lastInvalidAt!) < _invalidCooldown;
    if (repeat) return;
    _lastInvalid = raw;
    _lastInvalidAt = now;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(AppLocalizations.of(context).scan_invalid_qr)));
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: SammatiColors.ink,
      body: Stack(
        fit: StackFit.expand,
        children: [
          ref.watch(scannerViewBuilderProvider)(context, _onCode),
          // The frame is decorative; it must not swallow touches meant for the torch button.
          IgnorePointer(
            child: Center(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  border: Border.all(color: SammatiColors.marigold, width: 4),
                  borderRadius: BorderRadius.circular(SammatiRadius.pass),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topLeft,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: IconButton.filled(
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    backgroundColor: SammatiColors.ink,
                    foregroundColor: SammatiColors.surface,
                  ),
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () => context.pop(),
                ),
              ),
            ),
          ),
          Positioned(
            left: 24,
            right: 24,
            bottom: 56,
            child: SafeArea(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: SammatiColors.ink.withValues(alpha: 0.85),
                  borderRadius: BorderRadius.circular(SammatiRadius.row),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${t.scan_to_connect}\n${t.scan_hint}',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: SammatiColors.surface),
                      ),
                    ),
                    if (!kIsWeb)
                      IconButton(
                        icon: const Icon(Icons.photo_library),
                        color: SammatiColors.surface,
                        onPressed: _pickImage,
                        tooltip: 'Upload QR from Gallery',
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
