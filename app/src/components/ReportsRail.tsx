/**
 * Shared bits of the reports workspace: the icon and the Hindi name for each report type. The
 * left rail that used to live here is gone — report types are now a picture-led gallery and a
 * row of type chips on the report pages themselves.
 */

export const REPORT_ICON: Record<string, string> = {
  atr: 'clipboard', learning_impact: 'target', exceptions: 'alert', review_pack: 'briefcase',
  block_performance: 'map', intervention_effectiveness: 'flask', data_quality: 'database', executive_summary: 'file',
};

/** Hindi names for the report types, beside the English ones in REPORT_TYPES. */
export const REPORT_HI: Record<string, { label: string; blurb: string }> = {
  atr: { label: 'कृत कार्यवाही रिपोर्ट', blurb: 'हर प्रकरण: स्वीकृत कार्य, ज़िम्मेदार, प्रगति, सबूत, सत्यापन और परिणाम।' },
  learning_impact: { label: 'अधिगम प्रभाव रिपोर्ट', blurb: 'पूर्व-निर्धारित परिणाम जाँच: आधार, अनुवर्ती, तुलना, प्रभाव और उसकी अनिश्चितता।' },
  exceptions: { label: 'अपवाद रिपोर्ट', blurb: 'जो पटरी से हटा है: आगे भेजे गए, विलंबित काम, लौटाए सबूत, फिर खुले प्रकरण।' },
  review_pack: { label: 'ज़िला समीक्षा संकलन', blurb: 'मासिक समीक्षा बैठक के लिए: स्थिति, हॉटस्पॉट, आवश्यक निर्णय, जोखिम।' },
  block_performance: { label: 'खंड प्रदर्शन रिपोर्ट', blurb: 'खंड या संकुल के अनुसार अधिगम रुझान और प्रकरण भार।' },
  intervention_effectiveness: { label: 'हस्तक्षेप प्रभावशीलता रिपोर्ट', blurb: 'हर प्रयुक्त हस्तक्षेप: कितनी बार जाँचा गया और जाँच में क्या दिखा।' },
  data_quality: { label: 'डेटा गुणवत्ता रिपोर्ट', blurb: 'जिन गिरावटों का आकलन नहीं हो सका, आयात अस्वीकृतियाँ, अपर्याप्त नमूने।' },
  executive_summary: { label: 'कार्यकारी सारांश', blurb: 'एक पृष्ठ: मुख्य आँकड़े, शीर्ष प्राथमिकताएँ, परिणाम मिश्रण, सावधानियाँ।' },
};
