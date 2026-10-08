import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;
import 'consents.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    tz.initializeTimeZones();
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await _plugin.initialize(initSettings);
    _initialized = true;
  }

  Future<void> scheduleExpiryReminders(ConsentsSnapshot snapshot) async {
    await init();
    // In a real app we'd use timezone-based scheduling (zonedSchedule).
    // For the hackathon demo, we just simulate or set a standard timeout if needed,
    // but the prompt asked for "expiry local notifications" W-11.
    // We will clear existing and re-schedule.
    await _plugin.cancelAll();

    int id = 0;
    final now = DateTime.now();
    for (final f in snapshot.companies) {
      for (final c in f.consents) {
        final expiresAt = c.expiresAt;
        if (c.stateAt(now) == ConsentState.active && expiresAt != null && expiresAt > 0) {
          final expiry = DateTime.fromMillisecondsSinceEpoch(expiresAt * 1000);
          final reminderTime = expiry.subtract(const Duration(days: 3));
          
          if (reminderTime.isAfter(now)) {
            final scheduledDate = tz.TZDateTime.from(reminderTime, tz.local);
            _plugin.zonedSchedule(
              id++,
              'Consent expiring soon',
              'Your consent for ${c.title.en} at ${f.fiduciary.name} expires in 3 days.',
              scheduledDate,
              const NotificationDetails(
                android: AndroidNotificationDetails(
                  'expiry_channel',
                  'Expiry Reminders',
                  channelDescription: 'Reminders for expiring consents',
                  importance: Importance.high,
                  priority: Priority.high,
                ),
              ),
              androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
              uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
            );
          }
        }
      }
    }
  }
}
