/**
 * BUDDICA Google Forms → Slack 通知システム
 *
 * フォーム: 【BUDDICA】ご契約時の接客・手続きに関するアンケート
 *
 * セットアップ:
 * 1. BigQuery APIを有効化
 * 2. フォームのトリガーに onFormSubmit を設定
 */

// ======================================
// 設定
// ======================================
const CONFIG = {
  bigquery: {
    projectId: 'buddica-internal-prod',
    datasetId: 'extreme_data_prod',
    tableId: 'sharyoeki_data',
    location: 'asia-northeast1'
  }
};

// ======================================
// 満足度判定の設定
// ======================================

// 最もネガティブな選択肢
const SEVERE_NEGATIVE = [
  '納得できなかった',        // 下取り
  'わかりづらかった',         // LINE手続き
  '遅いと感じた',            // LINE返信
  '分かりづらかった',         // 車両説明・必要書類説明
  '不明点がある',            // 納車説明
  '気になる点があった',      // 身だしなみ・言葉遣い・清掃
  '入りにくい'              // 店舗の雰囲気
];

// ややネガティブな選択肢
const MILD_NEGATIVE = [
  'もう少し検討したかった',   // 下取り
  '少しわかりづらかった',     // LINE手続き
  '少し遅いと感じた',        // LINE返信
  '希望と少し違った',        // 提案内容
  '少し分かりづらかった',     // 車両説明・必要書類説明
  '少し不明点がある',        // 納車説明
  '少し気になる'             // 身だしなみ・言葉遣い・清掃
];

const IMPRESSION_QUESTIONS = [
  'Q : 身だしなみはいかがでしたか？',
  'Q : 言葉遣いはいかがでしたか？',
  'Q : お店は入りやすい雰囲気でしたか？',
  'Q : お店の清掃は行き届いていましたか？'
];

const DIRECT_IMPRESSION_QUESTIONS = [
  'Q LINEでの各種お手続き（契約案内や書類のやり取りなど）は、分かりやすかったですか？',
  'Q LINEでの担当者からのご返信やご連絡のスピードに、ご満足いただけましたか？'
];

const DIRECT_IMPRESSION_QUESTION_SET = DIRECT_IMPRESSION_QUESTIONS.reduce(function (set, question) {
  set[question] = true;
  return set;
}, {});

const NEGATIVE_ICON = {
  severe: '🚨',
  mild: '⚠️'
};

const SUMMARY_ENTRIES = [
  { label: '下取り納得度', question: 'Q : BUDDICAの下取価格について、提示された金額にご納得いただけましたか？', includeSeverity: true },
  { label: 'ご提案内容', question: 'Q : ご提案内容は、お客様のご希望に沿っていましたか？', includeSeverity: true },
  { label: '車両/オプション説明', question: 'Q : 車両やオプションについてのご説明は、分かりやすかったですか？', includeSeverity: true },
  { label: '必要書類説明', question: 'Q : 必要書類についてのご説明は、分かりやすかったですか？', includeSeverity: true },
  { label: '納車スケジュール理解', question: 'Q : 納車までの流れやスケジュールについて、ご理解いただけましたか？', includeSeverity: true },
  { label: 'その他のご意見', question: 'その他、お気づきの点や今後BUDDICAに期待することなど、お聞かせください。', includeSeverity: false }
];

const FREE_TEXT_ALWAYS_INCLUDE_QUESTION = 'その他、お気づきの点や今後BUDDICAに期待することなど、お聞かせください。';

const DEFAULT_SLACK_MENTION = '<!channel>';
const SUPPORT_TEAM_MENTION = '<!subteam^S08HR8LT5DZ|@サポートチーム>';

// 倉敷支社のメンションは未実装。詳細は docs/slack_store_mentions.md を参照。
const STORE_SLACK_MENTION_MAP = {
  '甲府石和支社': '<!subteam^S083F63CFJ5|@甲府石和支社>',
  '高松支社': '<!subteam^S063K3RG0KS|@高松支社>',
  '神戸西支社': '<!subteam^S0762T67YTX|@神戸西支社>',
  '久留米支社': '<!subteam^S07N2BTNC58|@久留米支社>',
  '西条支社': '<!subteam^S08SUQC2ZJM|@西条支社>',
  '姫路支社': '<!subteam^S062FJ3RJRM|@姫路支社>',
  '熊本北支社': '<!subteam^S09A1JSBHUL|@熊本北支社>',
  '福岡南支社': '<!subteam^S062PFA3JUW|@福岡南支社>',
  '野田支社': '<!subteam^S0638PC85JM|@野田支社>',
  '倉敷支社': '<!subteam^S062W4A53GS|@倉敷支社>',
};

const DIRECT_FOLLOWUP_MENTIONS = ['<@U0AFKHDLT2A>', '<@U0AFKHDLT2A>'];

function toDetailLines(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    var normalized = value.map(function(item) {
      return String(item || '').trim();
    }).filter(function(item) { return item; });
    if (normalized.length === 0) {
      return [];
    }
    return [normalized.join(', ')];
  }
  var text = String(value).trim();
  return text ? [text] : [];
}

function formatDetailSection(title, lines) {
  if (!title) {
    return '';
  }
  var normalized = (lines || []).map(function(line) {
    return String(line || '').trim();
  }).filter(function(line) { return line; });
  if (normalized.length === 0) {
    return '';
  }
  var indented = normalized.map(function(line) {
    return '  ' + line;
  });
  return [title].concat(indented).join('\n');
}

function addDetailSection(detailSections, title, lines) {
  var section = formatDetailSection(title, lines);
  if (section) {
    detailSections.push(section);
  }
}

function collectFreeTextComments(itemResponses) {
  const comments = [];
  itemResponses.forEach(function (itemResponse) {
    const item = itemResponse.getItem();
    const question = item.getTitle();
    if (question !== FREE_TEXT_ALWAYS_INCLUDE_QUESTION) {
      return;
    }
    const response = itemResponse.getResponse();
    const values = Array.isArray(response) ? response : [response];
    values.forEach(function (value) {
      pushNormalizedComment(comments, value);
    });
  });
  return comments;
}

function buildQaMapFromItems(items) {
  const qaMap = {};
  (items || []).forEach(function(item) {
    try {
      const formItem = item.getItem();
      const title = formItem && formItem.getTitle ? formItem.getTitle() : null;
      if (title) {
        qaMap[title] = item.getResponse();
      }
    } catch (e) {
      // ignore malformed item
    }
  });
  return qaMap;
}

function resolveResponseIdFromQaMap(qaMap) {
  if (!qaMap) {
    return '';
  }
  const explicitId = qaMap['回答ID (この欄は変更しないでください)'];
  if (explicitId !== undefined && explicitId !== null) {
    return String(explicitId).trim();
  }
  const managementNumber = qaMap['管理番号'];
  if (managementNumber !== undefined && managementNumber !== null) {
    return String(managementNumber).trim();
  }
  return '';
}

function pushNormalizedComment(list, rawValue) {
  if (!rawValue) {
    return;
  }
  var text = String(rawValue).trim();
  if (!text) {
    return;
  }
  list.push(text);
}

function normalizeAnswerValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function getSeverityIconForAnswer(value) {
  var normalized = normalizeAnswerValue(value);
  if (!normalized) {
    return '';
  }
  if (SEVERE_NEGATIVE.indexOf(normalized) !== -1) {
    return ' ' + NEGATIVE_ICON.severe;
  }
  if (MILD_NEGATIVE.indexOf(normalized) !== -1) {
    return ' ' + NEGATIVE_ICON.mild;
  }
  return '';
}

function toSimpleSentimentMarker(result) {
  if (!result) {
    return '';
  }
  if (result.emoji === '🔴') {
    return '×';
  }
  if (result.emoji === '🟡') {
    return '△';
  }
  return '◯';
}

function getFollowUpNotice(emoji) {
  if (emoji === '🔴') {
    return ' 要フォロー';
  }
  if (emoji === '🟡') {
    return ' 要確認';
  }
  return '';
}

function escapeForSlack(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_');
}

function slackSection(text) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: text
    }
  };
}

function slackDivider() {
  return { type: 'divider' };
}

function getSeverityIconForResponse(response) {
  var icon = '';
  forEachAnswerValue(response, function(value) {
    var candidate = getSeverityIconForAnswer(value);
    if (!candidate) {
      return;
    }
    if (candidate.indexOf(NEGATIVE_ICON.severe) !== -1) {
      icon = ' ' + NEGATIVE_ICON.severe;
    } else if (!icon && candidate.indexOf(NEGATIVE_ICON.mild) !== -1) {
      icon = ' ' + NEGATIVE_ICON.mild;
    }
  });
  return icon;
}

function formatAnswerValue(response) {
  if (Array.isArray(response)) {
    var joined = response.map(function(value) {
      return String(value).trim();
    }).filter(function(value) { return value; }).join(', ');
    return joined || '(未回答)';
  }
  var normalized = normalizeAnswerValue(response);
  return normalized || '(未回答)';
}

function forEachAnswerValue(response, callback) {
  if (Array.isArray(response)) {
    response.forEach(callback);
  } else {
    callback(response);
  }
}

function tallySentimentValue(value, counts) {
  var normalized = normalizeAnswerValue(value);
  if (!normalized) {
    return;
  }
  if (SEVERE_NEGATIVE.indexOf(normalized) !== -1) {
    counts.severe++;
    return;
  }
  if (MILD_NEGATIVE.indexOf(normalized) !== -1) {
    counts.mild++;
  }
}

function countSentimentForQuestions(qaMap, questions) {
  var counts = { severe: 0, mild: 0, answered: 0 };
  questions.forEach(function(question) {
    var response = qaMap[question];
    if (!response) {
      return;
    }
    counts.answered++;
    forEachAnswerValue(response, function(answer) {
      tallySentimentValue(answer, counts);
    });
  });
  return counts;
}

function countSentimentWithFilter(qaMap, predicate) {
  var counts = { severe: 0, mild: 0, answered: 0 };
  Object.keys(qaMap).forEach(function(question) {
    if (predicate && !predicate(question)) {
      return;
    }
    var response = qaMap[question];
    if (!response) {
      return;
    }
    counts.answered++;
    forEachAnswerValue(response, function(answer) {
      tallySentimentValue(answer, counts);
    });
  });
  return counts;
}

function buildSentimentResultFromCounts(counts, options) {
  options = options || {};
  if (counts.severe > 0 || counts.mild >= 2) {
    return { emoji: '🔴', label: 'ネガティブ', severeCount: counts.severe, mildCount: counts.mild };
  }
  if (counts.mild === 1) {
    return { emoji: '🟡', label: 'ややネガティブ', severeCount: counts.severe, mildCount: counts.mild };
  }
  if (options.nullWhenNoAnswer && counts.answered === 0) {
    return null;
  }
  return { emoji: '🟢', label: '問題なし', severeCount: counts.severe, mildCount: counts.mild };
}

function buildSummaryLines(qaMap) {
  return SUMMARY_ENTRIES.map(function(entry) {
    var response = qaMap[entry.question];
    if (response === undefined || response === null || response === '') {
      return '';
    }
    var formatted = formatAnswerValue(response);
    if (!formatted || formatted === '(未回答)') {
      return '';
    }
    var icon = entry.includeSeverity ? getSeverityIconForResponse(response) : '';
    return '- ' + entry.label + '：' + formatted + icon;
  }).filter(function(line) { return line; });
}

function collectBasicInfoLines(responseId, customerInfoOverride) {
  var lines = [];
  var customerInfo = customerInfoOverride || (responseId ? getCustomerInfoFromBigQuery(responseId) : null);

  lines.push('回答ID: ' + (responseId ? responseId : '不明'));

  if (!customerInfo) {
    lines.push('顧客名: 不明（Bigqueryを確認してください）');
    lines.push('営業担当者: 不明');
    lines.push('販売店: 不明');
    return lines;
  }

  lines.push('顧客名: ' + (customerInfo.customerName ? customerInfo.customerName : '不明'));
  lines.push('営業担当者: ' + (customerInfo.staffName ? customerInfo.staffName : '不明'));
  lines.push('販売店: ' + (customerInfo.storeName ? customerInfo.storeName : '不明'));

  if (customerInfo.orderDate) {
    var formattedDate = formatOrderDateValue(customerInfo.orderDate);
    if (formattedDate) {
      lines.push('契約日: ' + formattedDate);
    }
  }

  if (customerInfo.vehicleName) {
    var vehicleLine = '車両: ' + customerInfo.vehicleName;
    if (customerInfo.gradeName) {
      vehicleLine += ' (' + customerInfo.gradeName + ')';
    }
    lines.push(vehicleLine);
  }

  return lines;
}

function formatOrderDateValue(value) {
  var raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^\d{8}$/.test(raw)) {
    return raw.substring(0, 4) + '/' + raw.substring(4, 6) + '/' + raw.substring(6, 8);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, '/');
  }
  return raw;
}

function buildAdditionalDetailSections(qaMap) {
  var detailSections = [];

  addDetailSection(detailSections, 'きっかけ', toDetailLines(qaMap['Q : BUDDICAを知ってくださったきっかけは、何でしたか？']));

  var purchaseReason = qaMap['Q : 今回、新しくお車をご購入されたのは、どのような理由からでしたか？'];
  if (purchaseReason) {
    var purchaseLines = toDetailLines(purchaseReason);
    if (purchaseReason === '初めて車を購入した') {
      var purpose = qaMap['Q : お車の購入の主な目的を教えてください'];
      if (purpose) {
        purchaseLines.push('購入目的: ' + purpose);
      }
    } else if (purchaseReason === '今乗っている車からの乗り換え') {
      var replaceReason = qaMap['Q : お乗り換えをされた理由を教えてください'];
      if (replaceReason) {
        purchaseLines.push('乗り換え理由: ' + replaceReason);
      }
    }
    addDetailSection(detailSections, '購入理由', purchaseLines);
  }

  addDetailSection(detailSections, '決め手', toDetailLines(qaMap['Q : 今回のお車を選ばれたのは、どんな点が決め手になりましたか？ ※複数回答可']));

  var tradeIn = qaMap['Q : 今回、下取り車両はありましたか？'];
  if (tradeIn) {
    var tradeLines = toDetailLines(tradeIn);
    if (tradeIn === 'BUDDICAで下取り') {
      var satisfaction = qaMap['Q : BUDDICAの下取価格について、提示された金額にご納得いただけましたか？'];
      if (satisfaction) {
        tradeLines.push('納得度: ' + satisfaction + getSeverityIconForAnswer(satisfaction));
      }
    }
    addDetailSection(detailSections, '下取り', tradeLines);
  }

  var directUse = qaMap['Q 今回、車のオンライン通販サービス「BUDDICA DIRECT」を利用されましたか？'];
  if (directUse) {
    var directLines = toDetailLines('利用: ' + directUse);
    if (directUse === 'はい') {
      var lineClarity = qaMap['Q LINEでの各種お手続き（契約案内や書類のやり取りなど）は、分かりやすかったですか？'];
      var lineSpeed = qaMap['Q LINEでの担当者からのご返信やご連絡のスピードに、ご満足いただけましたか？'];
      var visit = qaMap['Q 今回のご検討期間中に、BUDDICAの店舗にはご来店いただきましたか？'];

      if (lineClarity) {
        directLines.push('LINE手続きの分かりやすさ: ' + lineClarity + getSeverityIconForAnswer(lineClarity));
      }

      if (lineSpeed) {
        directLines.push('LINE返信スピード: ' + lineSpeed + getSeverityIconForAnswer(lineSpeed));
      }

      if (visit) {
        directLines.push('店舗来店: ' + visit);
      }
    }

    addDetailSection(detailSections, 'BUDDICA DIRECT', directLines);
  }

  var evaluationSections = buildEvaluationSections(qaMap);
  evaluationSections.forEach(function(section) {
    if (section) {
      detailSections.push(section);
    }
  });

  addDetailSection(detailSections, 'その他のご意見', toDetailLines(qaMap['その他、お気づきの点や今後BUDDICAに期待することなど、お聞かせください。']));

  return detailSections.filter(function(section) { return section; });
}

// ============================================================
// ネガティブ判定ロジック改良版
// ============================================================

// 満足度判定関数（選択式回答用）
function evaluateImpression(qaMap) {
  var counts = countSentimentForQuestions(qaMap, IMPRESSION_QUESTIONS);
  return buildSentimentResultFromCounts(counts, { nullWhenNoAnswer: true });
}

function evaluateDirectImpression(qaMap) {
  var counts = countSentimentForQuestions(qaMap, DIRECT_IMPRESSION_QUESTIONS);
  return buildSentimentResultFromCounts(counts, { nullWhenNoAnswer: true });
}

function checkSatisfactionLevel(qaMap) {
  var counts = countSentimentWithFilter(qaMap, function(question) {
    return !DIRECT_IMPRESSION_QUESTION_SET[question];
  });
  return buildSentimentResultFromCounts(counts);
}

// ======================================
// メイン処理：フォーム送信時
// ======================================
function onFormSubmit(e) {
  try {
    const formTitle = e.source.getTitle();
    const items = e.response.getItemResponses();

    console.log(`[${new Date().toISOString()}] フォーム回答受信: ${formTitle}`);
    console.log(`回答数: ${items.length}`);

    const qaMap = buildQaMapFromItems(items);
    const responseId = resolveResponseIdFromQaMap(qaMap);
    const customerInfo = responseId ? getCustomerInfoFromBigQuery(responseId) : null;
    const freeTextComments = collectFreeTextComments(items);
    const satisfactionResult = checkSatisfactionLevel(qaMap);
    const directUseAnswer = qaMap['Q 今回、車のオンライン通販サービス「BUDDICA DIRECT」を利用されましたか？'];
    const directImpressionResult = directUseAnswer === 'はい' ? evaluateDirectImpression(qaMap) : null;
    const directSummary = directUseAnswer === 'はい'
      ? (directImpressionResult || { emoji: '◯', label: '問題なし' })
      : null;
    const directMarker = directSummary ? toSimpleSentimentMarker(directSummary) : null;
    const directFollowupMentions = (directMarker && directMarker !== '◯') ? DIRECT_FOLLOWUP_MENTIONS.slice() : [];
    const message = createSlackMessage(formTitle, items, {
      qaMap: qaMap,
      responseId: responseId,
      customerInfo: customerInfo,
      freeTextComments: freeTextComments,
      satisfactionResult: satisfactionResult,
      directUseAnswer: directUseAnswer,
      directImpressionResult: directImpressionResult
    });
    const notifySupport = shouldNotifySupportTeam(satisfactionResult, freeTextComments);
    const mention = buildMentionText(customerInfo, notifySupport, directFollowupMentions);
    sendToSlack(message, mention);

    console.log(`[${new Date().toISOString()}] 処理完了`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] フォーム送信エラー:`, error.toString());
  }
}

// ======================================
// Slackメッセージ作成（自由記入欄コメント付き）
// ======================================
function createSlackMessage(formTitle, items, options) {
  options = options || {};
  const qaMap = options.qaMap || buildQaMapFromItems(items);
  const responseId = options.responseId !== undefined ? options.responseId : resolveResponseIdFromQaMap(qaMap);
  const customerInfo = options.customerInfo;

  const satisfactionResult = Object.prototype.hasOwnProperty.call(options, 'satisfactionResult')
    ? options.satisfactionResult
    : checkSatisfactionLevel(qaMap);
  const freeTextComments = options.freeTextComments || collectFreeTextComments(items);
  const latestFreeTextComment = freeTextComments.length > 0 ? freeTextComments[freeTextComments.length - 1] : null;
  const impressionResult = evaluateImpression(qaMap);
  const directUseAnswer = Object.prototype.hasOwnProperty.call(options, 'directUseAnswer')
    ? options.directUseAnswer
    : qaMap['Q 今回、車のオンライン通販サービス「BUDDICA DIRECT」を利用されましたか？'];
  const directImpressionResult = Object.prototype.hasOwnProperty.call(options, 'directImpressionResult')
    ? options.directImpressionResult
    : (directUseAnswer === 'はい' ? evaluateDirectImpression(qaMap) : null);
  const directSummary = directUseAnswer === 'はい'
    ? (directImpressionResult || { emoji: '◯', label: '問題なし' })
    : null;

  const blocks = [];
  const fallbackLines = [];

  const headerLine = '■■■■■■■■■■■■■■■■■■■■■';
  const headerText = `「${formTitle}」に回答がありました。`;
  blocks.push(slackSection(headerLine));
  blocks.push(slackSection(headerText));
  fallbackLines.push(headerLine);
  fallbackLines.push(headerText);

  blocks.push(slackDivider());
  fallbackLines.push('++++++++++++++++++++++++++++++++');

  const summaryItems = [];
  if (satisfactionResult) {
    summaryItems.push('接客に対する印象: ' + satisfactionResult.emoji + satisfactionResult.label + getFollowUpNotice(satisfactionResult.emoji));
  } else {
    summaryItems.push('接客に対する印象: 未回答');
  }

  if (latestFreeTextComment) {
    summaryItems.push('自由記入欄: ⚠️コメントあり、必ず確認');
  } else {
    summaryItems.push('自由記入欄: コメントなし');
  }

  if (impressionResult) {
    summaryItems.push('担当者・店舗の印象：' + toSimpleSentimentMarker(impressionResult) + ' ' + impressionResult.label);
  } else {
    summaryItems.push('担当者・店舗の印象：未回答');
  }

  if (directUseAnswer === 'はい') {
    summaryItems.push('ダイレクト印象：' + toSimpleSentimentMarker(directSummary) + ' ' + directSummary.label);
  } else if (directUseAnswer === 'いいえ') {
    summaryItems.push('ダイレクト印象：未利用');
  } else if (!directUseAnswer) {
    summaryItems.push('ダイレクト印象：未回答');
  }

  const summaryBlockText = ['*簡易判定*'].concat(summaryItems.map(function(item) {
    return '• ' + escapeForSlack(item);
  })).join('\n');
  blocks.push(slackSection(summaryBlockText));
  fallbackLines.push('**簡易判定**');
  Array.prototype.push.apply(fallbackLines, summaryItems.map(function(item) {
    return '- ' + item;
  }));

  blocks.push(slackDivider());
  fallbackLines.push('++++++++++++++++++++++++++++++++');
  fallbackLines.push('**基本情報**');

  const basicInfoLines = collectBasicInfoLines(responseId, customerInfo);
  const basicBlockText = ['*基本情報*'].concat(basicInfoLines.map(function(line) {
    return '• ' + escapeForSlack(line);
  })).join('\n');
  blocks.push(slackSection(basicBlockText));
  Array.prototype.push.apply(fallbackLines, basicInfoLines.map(function(line) {
    return '- ' + line;
  }));

  const detailSections = buildAdditionalDetailSections(qaMap);
  if (detailSections.length > 0) {
    blocks.push(slackDivider());
    fallbackLines.push('++++++++++++++++++++++++++++++++');
  }

  detailSections.forEach(function(section) {
    var parts = section.split('\n');
    if (!parts.length) {
      return;
    }
    var title = String(parts[0] || '').trim();
    if (!title) {
      return;
    }
    var normalizedTitle = title === 'その他のご意見' ? 'その他' : title;
    var bodyLines = parts.slice(1).map(function(rawLine) {
      return String(rawLine || '').trim().replace(/^[-•]\s*/, '').replace(/^\-\s*/, '').replace(/^\s+/, '');
    }).filter(function(line) { return line; });

    if (normalizedTitle === 'その他' && latestFreeTextComment) {
      var commentLines = latestFreeTextComment.split(/\r?\n/).map(function(line) {
        return String(line || '').trim();
      }).filter(function(line) { return line; });
      if (commentLines.length > 0) {
        bodyLines = commentLines;
      }
    }

    if (bodyLines.length === 0) {
      return;
    }

    if (normalizedTitle === 'その他') {
      var quoteText = ['*' + escapeForSlack(normalizedTitle) + '*'].concat(bodyLines.map(function(line) {
        return '> ' + escapeForSlack(line);
      })).join('\n');
      blocks.push(slackSection(quoteText));
      fallbackLines.push('**' + normalizedTitle + '**');
      bodyLines.forEach(function(line) {
        fallbackLines.push('> ' + line);
      });
    } else {
      var listText = ['*' + escapeForSlack(normalizedTitle) + '*'].concat(bodyLines.map(function(line) {
        return '• ' + escapeForSlack(line);
      })).join('\n');
      blocks.push(slackSection(listText));
      fallbackLines.push('**' + normalizedTitle + '**');
      bodyLines.forEach(function(line) {
        fallbackLines.push('- ' + line);
      });
    }
  });

  var fallbackText = fallbackLines.join('\n');
  return {
    text: fallbackText,
    blocks: blocks
  };
}

function buildEvaluationSections(qaMap) {
  var sections = [];

  var advisorLines = [];
  var appearance = qaMap['Q : 身だしなみはいかがでしたか？'];
  var language = qaMap['Q : 言葉遣いはいかがでしたか？'];
  var proposal = qaMap['Q : ご提案内容は、お客様のご希望に沿っていましたか？'];
  var vehicleExp = qaMap['Q : 車両やオプションについてのご説明は、分かりやすかったですか？'];
  var docExp = qaMap['Q : 必要書類についてのご説明は、分かりやすかったですか？'];
  var deliveryExp = qaMap['Q : 納車までの流れやスケジュールについて、ご理解いただけましたか？'];

  if (appearance) advisorLines.push('- 身だしなみ: ' + appearance + getSeverityIconForAnswer(appearance));
  if (language) advisorLines.push('- 言葉遣い: ' + language + getSeverityIconForAnswer(language));
  if (proposal) advisorLines.push('- ご提案内容: ' + proposal + getSeverityIconForAnswer(proposal));
  if (vehicleExp) advisorLines.push('- 車両/オプション説明: ' + vehicleExp + getSeverityIconForAnswer(vehicleExp));
  if (docExp) advisorLines.push('- 必要書類説明: ' + docExp + getSeverityIconForAnswer(docExp));
  if (deliveryExp) advisorLines.push('- 納車スケジュール理解: ' + deliveryExp + getSeverityIconForAnswer(deliveryExp));

  if (advisorLines.length > 0) {
    sections.push(formatDetailSection('担当カーライフアドバイザーの応対', advisorLines));
  }

  var storeLines = [];
  var atmosphere = qaMap['Q : お店は入りやすい雰囲気でしたか？'];
  var cleanliness = qaMap['Q : お店の清掃は行き届いていましたか？'];

  if (atmosphere) storeLines.push('- 入りやすさ: ' + atmosphere + getSeverityIconForAnswer(atmosphere));
  if (cleanliness) storeLines.push('- 清掃状況: ' + cleanliness + getSeverityIconForAnswer(cleanliness));

  if (storeLines.length > 0) {
    sections.push(formatDetailSection('店舗の雰囲気', storeLines));
  }

  return sections;
}

// ======================================
// BigQueryから顧客情報を取得
// ======================================
function buildManagementNumberCandidates(value) {
  var trimmed = String(value || '').trim();
  if (!trimmed) {
    return [];
  }

  var digitsOnly = trimmed.replace(/[^0-9]/g, '');
  var normalized = digitsOnly.replace(/^0+/, '');
  var seen = {};
  var candidates = [];

  [trimmed, digitsOnly, normalized].forEach(function(candidate) {
    if (!candidate) {
      return;
    }
    if (seen[candidate]) {
      return;
    }
    seen[candidate] = true;
    candidates.push(candidate);
  });

  return candidates;
}

function getCustomerInfoFromBigQuery(managementNumber) {
  if (!managementNumber) {
    return null;
  }

  const candidates = buildManagementNumberCandidates(managementNumber);
  if (candidates.length === 0) {
    return null;
  }

  const tablePath = [CONFIG.bigquery.projectId, CONFIG.bigquery.datasetId, CONFIG.bigquery.tableId]
    .map(function(part) { return String(part || '').trim(); })
    .join('.');

  Logger.log('[BQ] tablePath=%s', tablePath);
  Logger.log('[BQ] managementNumber candidates=%s', JSON.stringify(candidates));

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var query = [
      'SELECT',
      '  management_number,',
      '  sales_representative,',
      '  sales_destination,',
      '  sales_location_name,',
      '  vehicle_name,',
      '  grade,',
      '  order_date',
      'FROM `' + tablePath + '`',
      'WHERE CAST(management_number AS STRING) = @managementNumber',
      'LIMIT 1'
    ].join('\n');

    var job = {
      configuration: {
        query: {
          query: query,
          useLegacySql: false,
          location: CONFIG.bigquery.location,
          parameterMode: 'NAMED',
          queryParameters: [
            {
              name: 'managementNumber',
              parameterType: { type: 'STRING' },
              parameterValue: { value: candidate }
            }
          ]
        }
      }
    };

    Logger.log('[BQ] Executing query via job insert (candidate=%s)', candidate);

    try {
      var queryJob = BigQuery.Jobs.insert(job, CONFIG.bigquery.projectId);
      var jobId = queryJob.jobReference.jobId;

      var queryResults = null;
      var attempts = 0;
      var maxAttempts = 5;

      while (attempts < maxAttempts) {
        attempts++;
        queryResults = BigQuery.Jobs.getQueryResults(
          CONFIG.bigquery.projectId,
          jobId,
          { location: CONFIG.bigquery.location, timeoutMs: 10000 }
        );

        if (queryResults.jobComplete) {
          break;
        }

        Utilities.sleep(Math.min(500 * Math.pow(2, attempts - 1), 5000));
      }

      if (queryResults && queryResults.jobComplete && queryResults.rows && queryResults.rows.length > 0) {
        const row = queryResults.rows[0];
        const fields = {};
        (queryResults.schema.fields || []).forEach(function(field, index) {
          var cell = row.f[index] || {};
          fields[field.name] = cell.v || null;
        });

        return {
          staffName: fields.sales_representative,
          customerName: fields.sales_destination,
          storeName: fields.sales_location_name,
          vehicleName: fields.vehicle_name,
          gradeName: fields.grade,
          orderDate: fields.order_date
        };
      }
    } catch (error) {
      console.error('BigQueryエラー (candidate=' + candidate + '):', error.toString());
      if (error && error.details) {
        console.error('BigQueryエラー詳細:', JSON.stringify(error.details));
      }
    }
  }

  Logger.log('[BQ] No record for managementNumber candidates=%s', JSON.stringify(candidates));
  return null;
}

// ======================================
// テストユーティリティ（BigQuery照会確認用）
// ======================================
function resolveStoreMention(storeName) {
  if (!storeName) {
    return DEFAULT_SLACK_MENTION;
  }
  var mention = STORE_SLACK_MENTION_MAP[storeName];
  if (mention) {
    return mention;
  }

  var normalized = String(storeName).replace(/\s+/g, '');
  var fallback = DEFAULT_SLACK_MENTION;
  Object.keys(STORE_SLACK_MENTION_MAP).forEach(function(key) {
    if (fallback !== DEFAULT_SLACK_MENTION) {
      return;
    }
    var normalizedKey = String(key).replace(/\s+/g, '');
    if (normalized.indexOf(normalizedKey) !== -1) {
      fallback = STORE_SLACK_MENTION_MAP[key];
    }
  });

  return fallback;
}

function resolveSlackMention(customerInfo) {
  if (!customerInfo) {
    return DEFAULT_SLACK_MENTION;
  }
  return resolveStoreMention(customerInfo.storeName);
}

function shouldNotifySupportTeam(satisfactionResult, freeTextComments) {
  var hasComment = (freeTextComments || []).some(function(comment) {
    return String(comment || '').trim();
  });
  var hasNegative = false;
  if (satisfactionResult && satisfactionResult.emoji) {
    hasNegative = satisfactionResult.emoji === '🔴' || satisfactionResult.emoji === '🟡';
  }
  return hasComment || hasNegative;
}

function buildMentionText(customerInfo, includeSupport, extraMentions) {
  var mentions = [];
  var primary = resolveSlackMention(customerInfo);
  if (primary) {
    mentions.push(primary);
  }
  if (includeSupport) {
    mentions.push(SUPPORT_TEAM_MENTION);
  }
  (extraMentions || []).forEach(function(mention) {
    var trimmed = String(mention || '').trim();
    if (trimmed) {
      mentions.push(trimmed);
    }
  });

  var seen = {};
  var uniqueMentions = mentions.filter(function(mention) {
    var trimmed = String(mention || '').trim();
    if (!trimmed) {
      return false;
    }
    if (seen[trimmed]) {
      return false;
    }
    seen[trimmed] = true;
    return true;
  });

  if (uniqueMentions.length === 0) {
    return DEFAULT_SLACK_MENTION;
  }
  return uniqueMentions.join(' ');
}

// ======================================
// Slack送信
// ======================================
function sendToSlack(messagePayload, mention) {
  try {
    const webhookUrl = getSlackWebhookUrl();
    if (!webhookUrl) {
      console.error('Webhook URL未設定');
      return;
    }

    const mentionText = mention || DEFAULT_SLACK_MENTION;
    const mentionHeader = mentionText ? '■■■■■■■■■■■■■■■■■■■■■\n' + mentionText : '';
    var payload = {
      mrkdwn: true
    };

    if (messagePayload && messagePayload.blocks) {
      var blocks = messagePayload.blocks.slice();
      if (mentionText) {
        blocks.unshift(slackSection(mentionText));
        blocks.unshift(slackSection('■■■■■■■■■■■■■■■■■■■■■'));
      }
      payload.blocks = blocks;
      payload.text = mentionHeader ? mentionHeader + (messagePayload.text ? '\n' + messagePayload.text : '') : (messagePayload.text || '');
    } else {
      var messageText = messagePayload !== undefined && messagePayload !== null
        ? String(messagePayload)
        : '';
      payload.text = mentionHeader ? mentionHeader + (messageText ? '\n' + messageText : '') : messageText;
    }

    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error('Slack送信エラー:', response.getContentText());
    } else {
      console.log('Slack送信成功');
    }
  } catch (error) {
    console.error('Slack送信例外:', error.toString());
  }
}

// ======================================
// Webhook URL管理
// ======================================
function getSlackWebhookUrl() {
  const scriptProperties = PropertiesService.getScriptProperties();
  return scriptProperties.getProperty('SLACK_WEBHOOK_URL');
}