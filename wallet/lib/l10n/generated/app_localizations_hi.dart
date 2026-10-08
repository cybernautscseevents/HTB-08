// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hindi (`hi`).
class AppLocalizationsHi extends AppLocalizations {
  AppLocalizationsHi([String locale = 'hi']) : super(locale);

  @override
  String get appName => 'Sammati';

  @override
  String get give_consent => 'सहमति दें';

  @override
  String get withdraw => 'वापस लें';

  @override
  String withdrawn_blocked(String company) {
    return 'वापस ली गई। $company रोका गया।';
  }

  @override
  String get allowed => 'अनुमति दी गई';

  @override
  String get blocked => 'रोका गया';

  @override
  String get scan_to_connect => 'कनेक्ट करने के लिए स्कैन करें';

  @override
  String get withdraw_easy =>
      'आप बाद में किसी भी उद्देश्य की सहमति उतनी ही आसानी से वापस ले सकते हैं।';

  @override
  String get recorded => 'लेजर पर दर्ज';

  @override
  String get nav_consents => 'सहमतियाँ';

  @override
  String get nav_activity => 'गतिविधि';

  @override
  String get nav_scan => 'स्कैन';

  @override
  String get nav_rights => 'अधिकार';

  @override
  String get nav_me => 'मैं';

  @override
  String get consents_empty =>
      'अभी कोई कंपनी नहीं। अपनी पहली कंपनी जोड़ने के लिए QR कोड स्कैन करें।';

  @override
  String get activity_empty =>
      'अभी कोई गतिविधि नहीं। कंपनियों द्वारा डेटा का उपयोग यहाँ दिखेगा।';

  @override
  String get rights_access => 'देखें कि कंपनी के पास क्या है';

  @override
  String get rights_erasure => 'कंपनी से डेटा मिटाने को कहें';

  @override
  String get rights_grievance => 'शिकायत दर्ज करें';

  @override
  String get me_language => 'भाषा';

  @override
  String get me_developer => 'डेवलपर सेटिंग्स';

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
      'आपके Wi-Fi पर Sammati Core का पता, जैसे http://192.168.1.5:4000';

  @override
  String get dev_core_url_invalid =>
      'http:// या https:// से शुरू होने वाला पूरा पता दर्ज करें';

  @override
  String get dev_save => 'सहेजें';

  @override
  String get dev_saved => 'सहेजा गया';

  @override
  String get language_title => 'अपनी भाषा चुनें';

  @override
  String get onb_continue => 'आगे बढ़ें';

  @override
  String get onb_next => 'अगला';

  @override
  String get onb_1 => 'देखें किन कंपनियों के पास आपकी सहमति है';

  @override
  String get onb_2 => 'हर चीज़ को नहीं, सिर्फ़ एक उद्देश्य को हाँ कहें';

  @override
  String get onb_3 => 'एक टैप में वापस लें';

  @override
  String get wallet_create_title => 'फ़िंगरप्रिंट या PIN से सुरक्षित करें';

  @override
  String get wallet_create_body =>
      'आपकी सहमतियाँ इसी फ़ोन पर साइन होती हैं। इन्हें सिर्फ़ आप मंज़ूर कर सकते हैं।';

  @override
  String get wallet_create_button => 'वॉलेट बनाएँ';

  @override
  String get wallet_no_lock =>
      'इस फ़ोन पर स्क्रीन लॉक सेट करें, फिर दोबारा कोशिश करें।';

  @override
  String get wallet_auth_failed =>
      'पुष्टि नहीं हो सकी कि यह आप हैं। दोबारा कोशिश करें।';

  @override
  String get wallet_create_failed => 'वॉलेट नहीं बन सका। दोबारा कोशिश करें।';

  @override
  String get auth_reason_create => 'अपना वॉलेट बनाने के लिए पुष्टि करें';

  @override
  String get auth_reason_sign => 'इसे मंज़ूर करने के लिए पुष्टि करें';

  @override
  String get me_wallet_address => 'वॉलेट पता';

  @override
  String get copied => 'कॉपी किया गया';

  @override
  String get scan_hint => 'कैमरे को कंपनी के QR कोड की ओर रखें।';

  @override
  String get scan_torch => 'टॉर्च';

  @override
  String get scan_camera_denied =>
      'QR कोड स्कैन करने के लिए कैमरे की अनुमति दें।';

  @override
  String get scan_invalid_qr => 'यह Sammati का QR कोड नहीं है।';

  @override
  String get scan_paste_hint => 'यहाँ QR का पाठ पेस्ट करें';

  @override
  String get scan_paste_open => 'खोलें';

  @override
  String get error_unreachable => 'Sammati तक नहीं पहुँच सके। Wi-Fi जाँचें।';

  @override
  String get request_gone =>
      'यह अनुरोध अब मान्य नहीं है। कंपनी से नया QR कोड माँगें।';

  @override
  String get notice_mismatch =>
      'यह सूचना सत्यापित नहीं हो सकी, इसलिए कुछ भी साइन नहीं हुआ। कंपनी से नया QR कोड माँगें।';

  @override
  String get grant_failed => 'इसे दर्ज नहीं कर सके। दोबारा कोशिश करें।';

  @override
  String get retry => 'दोबारा कोशिश करें';

  @override
  String asking_for_purposes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count उद्देश्यों के लिए पूछ रहे हैं',
    );
    return '$_temp0';
  }

  @override
  String give_consent_count(int count) {
    return 'सहमति दें ($count)';
  }

  @override
  String get needed_for_service => 'सेवा के लिए ज़रूरी';

  @override
  String get shares_third_party => 'तीसरे पक्ष के साथ साझा';

  @override
  String retention_days(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days दिन रखा जाएगा',
    );
    return '$_temp0';
  }

  @override
  String retention_months(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: '$months महीने रखा जाएगा',
    );
    return '$_temp0';
  }

  @override
  String get expiry_label => 'सहमति की अवधि';

  @override
  String get expiry_30d => '30 दिन';

  @override
  String get expiry_6m => '6 महीने';

  @override
  String get expiry_1y => '1 साल';

  @override
  String purpose_switch_label(String purpose, String company) {
    return '$purpose, $company';
  }

  @override
  String receipt_expires(String date) {
    return '$date तक मान्य';
  }

  @override
  String get receipt_tx => 'लेजर लेन-देन';

  @override
  String get receipt_view_proof => 'प्रमाण देखें';

  @override
  String get done => 'हो गया';

  @override
  String get error_generic => 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें।';

  @override
  String consents_summary(int companies, int active) {
    String _temp0 = intl.Intl.pluralLogic(
      companies,
      locale: localeName,
      other: '$companies कंपनियाँ · $active सक्रिय',
    );
    return '$_temp0';
  }

  @override
  String get status_active => 'सक्रिय';

  @override
  String get status_expired => 'समाप्त';

  @override
  String get status_withdrawn => 'वापस ली गई';

  @override
  String expired_ago(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days दिन पहले समाप्त, फिर से सहमति दें',
    );
    return '$_temp0';
  }

  @override
  String expires_in_days(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days दिन में समाप्त',
    );
    return '$_temp0';
  }

  @override
  String expires_in_months(int months) {
    String _temp0 = intl.Intl.pluralLogic(
      months,
      locale: localeName,
      other: '$months महीने में समाप्त',
    );
    return '$_temp0';
  }

  @override
  String get offline_banner =>
      'कनेक्शन नहीं है। पिछली ज्ञात सहमतियाँ दिख रही हैं।';

  @override
  String withdraw_confirm(String company, String purpose) {
    return '$company को $purpose के लिए आपका डेटा इस्तेमाल करने से रोकें? उन्हें तुरंत रोक दिया जाएगा।';
  }

  @override
  String get keep => 'रखें';

  @override
  String get auth_reason_withdraw => 'सहमति वापस लेने के लिए पुष्टि करें';

  @override
  String get filter_all => 'सभी';

  @override
  String get reason_consent_withdrawn => 'सहमति वापस ली गई';

  @override
  String get reason_consent_expired => 'सहमति समाप्त';

  @override
  String get reason_no_consent => 'सहमति नहीं दी गई';

  @override
  String get reason_ledger_unavailable =>
      'सहमति जाँच नहीं हो सकी, इसलिए रोका गया';

  @override
  String get reason_no_principal => 'यह पता नहीं चला कि डेटा किसका था';

  @override
  String get time_now => 'अभी अभी';

  @override
  String time_seconds(int n) {
    return '$n सेकंड पहले';
  }

  @override
  String time_minutes(int n) {
    return '$n मिनट पहले';
  }

  @override
  String time_hours(int n) {
    return '$n घंटे पहले';
  }

  @override
  String time_days(int n) {
    return '$n दिन पहले';
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
      'कनेक्शन नहीं है। पिछली ज्ञात गतिविधि दिख रही है।';

  @override
  String get proof_headline =>
      'यह एक्सेस रिकॉर्ड किया गया और लेजर पर लॉक किया गया।';

  @override
  String get proof_record_hash => 'रिकॉर्ड हैश';

  @override
  String get proof_batch_anchor => 'बैच एंकर';

  @override
  String get proof_merkle_verified => 'सत्यापित ✓';

  @override
  String get proof_merkle_failed => 'सत्यापन विफल';

  @override
  String get proof_merkle_checking => 'जाँच हो रही है…';

  @override
  String get proof_open_explorer => 'ब्लॉक एक्सप्लोरर में खोलें';

  @override
  String get proof_consent_signer => 'हस्ताक्षरकर्ता (आप)';

  @override
  String get proof_ledger_head => 'लेजर हेड';

  @override
  String get proof_consent_tx => 'लेन-देन';

  @override
  String get proof_loading => 'प्रमाण लोड हो रहा है…';

  @override
  String get proof_failed => 'प्रमाण लोड नहीं हो सका। दोबारा कोशिश करें।';

  @override
  String get cascade_title => 'इन्हें भी बताया गया';

  @override
  String get cascade_waiting => 'प्रतीक्षा में…';

  @override
  String cascade_acked(int n) {
    return '$n सेकंड पहले';
  }
}
