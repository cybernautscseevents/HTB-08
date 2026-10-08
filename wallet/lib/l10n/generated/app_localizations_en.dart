// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Sammati';

  @override
  String get give_consent => 'Give consent';

  @override
  String get withdraw => 'Withdraw';

  @override
  String withdrawn_blocked(String company) {
    return 'Withdrawn. $company is blocked.';
  }

  @override
  String get allowed => 'Allowed';

  @override
  String get blocked => 'Blocked';

  @override
  String get scan_to_connect => 'Scan to connect';

  @override
  String get withdraw_easy =>
      'You can withdraw any purpose later, as easily as you gave it.';

  @override
  String get recorded => 'Recorded on the ledger';

  @override
  String get nav_consents => 'Consents';

  @override
  String get nav_activity => 'Activity';

  @override
  String get nav_scan => 'Scan';

  @override
  String get nav_rights => 'Rights';

  @override
  String get nav_me => 'Me';

  @override
  String get consents_empty =>
      'No companies yet. Scan a QR code to connect your first one.';

  @override
  String get activity_empty =>
      'No activity yet. Data access by companies will appear here.';

  @override
  String get rights_access => 'See what a company holds';

  @override
  String get rights_erasure => 'Ask a company to erase data';

  @override
  String get rights_grievance => 'Raise a complaint';

  @override
  String get me_language => 'Language';

  @override
  String get me_developer => 'Developer settings';

  @override
  String get language_english => 'English';

  @override
  String get language_hindi => 'हिन्दी';

  @override
  String get language_kannada => 'ಕನ್ನಡ';

  @override
  String get dev_core_url => 'Core URL';

  @override
  String get dev_core_url_hint =>
      'Address of the Sammati Core on your Wi-Fi, for example http://192.168.1.5:4000';

  @override
  String get dev_core_url_invalid =>
      'Enter a full address starting with http:// or https://';

  @override
  String get dev_save => 'Save';

  @override
  String get dev_saved => 'Saved';

  @override
  String get language_title => 'Choose your language';

  @override
  String get onb_continue => 'Continue';

  @override
  String get onb_next => 'Next';

  @override
  String get onb_1 => 'See every company that has your consent';

  @override
  String get onb_2 => 'Say yes to a purpose, not to everything';

  @override
  String get onb_3 => 'Withdraw in one tap';

  @override
  String get wallet_create_title => 'Secure with fingerprint or PIN';

  @override
  String get wallet_create_body =>
      'Your consents are signed on this phone. Only you can approve them.';

  @override
  String get wallet_create_button => 'Create wallet';

  @override
  String get wallet_no_lock =>
      'Set a screen lock on this phone, then try again.';

  @override
  String get wallet_auth_failed => 'Could not confirm it is you. Try again.';

  @override
  String get wallet_create_failed => 'Could not create the wallet. Try again.';

  @override
  String get auth_reason_create => 'Confirm to create your wallet';

  @override
  String get auth_reason_sign => 'Confirm to approve this';

  @override
  String get me_wallet_address => 'Wallet address';

  @override
  String get copied => 'Copied';

  @override
  String get scan_hint => 'Point the camera at the company\'s QR code.';

  @override
  String get scan_torch => 'Torch';

  @override
  String get scan_camera_denied => 'Allow camera access to scan QR codes.';

  @override
  String get scan_invalid_qr => 'This is not a Sammati QR code.';

  @override
  String get scan_paste_hint => 'Paste the QR text here';

  @override
  String get scan_paste_open => 'Open';

  @override
  String get error_unreachable => 'Could not reach Sammati. Check Wi-Fi.';

  @override
  String get request_gone =>
      'This request is no longer valid. Ask the company for a new QR code.';

  @override
  String get notice_mismatch =>
      'This notice could not be verified, so nothing was signed. Ask the company for a new QR code.';

  @override
  String get grant_failed => 'Could not record this. Try again.';

  @override
  String get retry => 'Try again';

  @override
  String asking_for_purposes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Asking for $count purposes',
      one: 'Asking for 1 purpose',
    );
    return '$_temp0';
  }

  @override
  String give_consent_count(int count) {
    return 'Give consent ($count)';
  }

  @override
  String get needed_for_service => 'Needed for the service';

  @override
  String get shares_third_party => 'Shared with third parties';

  @override
  String retention_days(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'kept for $days days',
      one: 'kept for 1 day',
    );
    return '$_temp0';
  }

  @override
  String retention_months(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: 'kept for $months months',
      one: 'kept for 1 month',
    );
    return '$_temp0';
  }

  @override
  String get expiry_label => 'Consent lasts';

  @override
  String get expiry_30d => '30 days';

  @override
  String get expiry_6m => '6 months';

  @override
  String get expiry_1y => '1 year';

  @override
  String purpose_switch_label(String purpose, String company) {
    return '$purpose, $company';
  }

  @override
  String receipt_expires(String date) {
    return 'Valid until $date';
  }

  @override
  String get receipt_tx => 'Ledger transaction';

  @override
  String get receipt_view_proof => 'View proof';

  @override
  String get done => 'Done';

  @override
  String get error_generic => 'Something went wrong. Try again.';

  @override
  String consents_summary(int companies, int active) {
    String _temp0 = intl.Intl.pluralLogic(
      companies,
      locale: localeName,
      other: '$companies companies · $active active',
      one: '1 company · $active active',
    );
    return '$_temp0';
  }

  @override
  String get status_active => 'Active';

  @override
  String get status_expired => 'Expired';

  @override
  String get status_withdrawn => 'Withdrawn';

  @override
  String expired_ago(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Expired $days days ago, give consent again',
      one: 'Expired 1 day ago, give consent again',
      zero: 'Expired today, give consent again',
    );
    return '$_temp0';
  }

  @override
  String expires_in_days(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Expires in $days days',
      one: 'Expires in 1 day',
    );
    return '$_temp0';
  }

  @override
  String expires_in_months(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: 'Expires in $months months',
      one: 'Expires in 1 month',
    );
    return '$_temp0';
  }

  @override
  String get offline_banner => 'No connection. Showing last known consents.';

  @override
  String withdraw_confirm(String company, String purpose) {
    return 'Stop $company using your data for $purpose? They will be blocked right away.';
  }

  @override
  String get keep => 'Keep';

  @override
  String get auth_reason_withdraw => 'Confirm to withdraw consent';

  @override
  String get filter_all => 'All';

  @override
  String get reason_consent_withdrawn => 'Consent withdrawn';

  @override
  String get reason_consent_expired => 'Consent expired';

  @override
  String get reason_no_consent => 'No consent given';

  @override
  String get reason_ledger_unavailable => 'Could not check consent, so blocked';

  @override
  String get reason_no_principal => 'Could not tell whose data this was';

  @override
  String get time_now => 'Just now';

  @override
  String time_seconds(int n) {
    return '$n s ago';
  }

  @override
  String time_minutes(int n) {
    return '$n min ago';
  }

  @override
  String time_hours(int n) {
    return '$n h ago';
  }

  @override
  String time_days(int n) {
    return '$n d ago';
  }

  @override
  String activity_row_label(
    String purpose,
    String company,
    String decision,
    String time,
  ) {
    return '$purpose, $company, $decision, $time';
  }

  @override
  String get offline_activity_banner =>
      'No connection. Showing last known activity.';

  @override
  String get proof_headline =>
      'This access was recorded and locked on the ledger.';

  @override
  String get proof_record_hash => 'Record hash';

  @override
  String get proof_batch_anchor => 'Batch anchor';

  @override
  String get proof_merkle_verified => 'Verified ✓';

  @override
  String get proof_merkle_failed => 'Verification failed';

  @override
  String get proof_merkle_checking => 'Checking…';

  @override
  String get proof_open_explorer => 'Open in block explorer';

  @override
  String get proof_consent_signer => 'Signer (you)';

  @override
  String get proof_ledger_head => 'Ledger head';

  @override
  String get proof_consent_tx => 'Transaction';

  @override
  String get proof_loading => 'Loading proof…';

  @override
  String get proof_failed => 'Could not load proof. Try again.';

  @override
  String get cascade_title => 'Also told';

  @override
  String get cascade_waiting => 'Waiting…';

  @override
  String cascade_acked(int n) {
    return '$n s ago';
  }
}
