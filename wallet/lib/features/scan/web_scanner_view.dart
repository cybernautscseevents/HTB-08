import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../theme/tokens.dart';
import 'camera_scanner_view.dart';

/// The scanner for the browser build (`flutter run -d chrome`, for demos and development).
///
/// A webcam pointed at another screen is a fragile way to read a QR code, so this adds a text box under
/// the camera: paste the JSON the company console shows next to its QR code (the QR payload) and it is
/// handled exactly as if the camera had read it. Phones never see this; main.dart only uses it on web.
class WebScannerView extends StatefulWidget {
  const WebScannerView({super.key, required this.onCode});

  final ValueChanged<String> onCode;

  @override
  State<WebScannerView> createState() => _WebScannerViewState();
}

class _WebScannerViewState extends State<WebScannerView> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isNotEmpty) widget.onCode(text);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Stack(
      fit: StackFit.expand,
      children: [
        CameraScannerView(onCode: widget.onCode),
        Align(
          alignment: Alignment.bottomCenter,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.only(left: 16, right: 16, bottom: 130, top: 16),
              child: Material(
                color: SammatiColors.surface,
                borderRadius: BorderRadius.circular(SammatiRadius.row),
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _controller,
                          decoration: InputDecoration(hintText: t.scan_paste_hint, border: InputBorder.none),
                          onSubmitted: (_) => _submit(),
                        ),
                      ),
                      FilledButton(onPressed: _submit, child: Text(t.scan_paste_open)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}