/**
 * BUDDICA Google Forms → Slack 通知システム
 *
 * フォーム: 【BUDDICA】納車後ご満足度アンケート
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

const FORM_TITLE = '【BUDDICA】納車後ご満足度アンケート';
const SLACK_DEBUG_CHANNEL = '#debug_notify';

const QUESTIONS = {
  RESPONSE_ID: '回答ID (この欄は変更しないでください)',
  VEHICLE_STATE: '納車されたお車の状態に、ご満足いただけましたか？',
  VEHICLE_STATE_DETAIL: 'お車の状態について、具体的にどのような点にご不満がございましたか？',
  DELIVERY_DAY: '納車当日の対応（ご説明、書類のお渡し、お車の受け渡し時間など）は、スムーズでしたか？',
  DELIVERY_DAY_DETAIL: '納車対応当日の対応について、具体的にどのような点にご不満がございましたか？',
  FLOW: 'ご契約から納車までの全体の流れについて、ご満足いただけましたか？',
  FLOW_DETAIL: 'ご契約から納車までの流れについて、具体的にどのような点にご不満がございましたか？',
  DIRECT_USE: '今回、車のオンライン通販サービス「BUDDICA DIRECT」を利用されましたか？',
  DIRECT_GAP: 'オンラインでご覧になった写真や動画と、実際のお車の印象にギャップはありましたか？',
  DIRECT_NEXT: '次回も、今回のようにオンライン（非対面）サービスを利用して車を購入したいと思いますか？',
  NPS: '今後、BUDDICAを大切なご友人やご家族、知人に紹介してもよいと思われますか？',
  OTHER: 'その他、お気づきの点や今後BUDDICAに期待することなど、お聞かせください。'
};

const BASE_SATISFACTION_QUESTIONS = [
  QUESTIONS.VEHICLE_STATE,
  QUESTIONS.DELIVERY_DAY,
  QUESTIONS.FLOW
];

const DIRECT_EXPERIENCE_QUESTIONS = [
  QUESTIONS.DIRECT_GAP,
  QUESTIONS.DIRECT_NEXT
];

const FREE_TEXT_QUESTIONS = [
  QUESTIONS.VEHICLE_STATE_DETAIL,
  QUESTIONS.DELIVERY_DAY_DETAIL,
  QUESTIONS.FLOW_DETAIL,
  QUESTIONS.OTHER
];

// ======================================
// 満足度判定
// ======================================
const SEVERE_NEGATIVE = [
  '不満がある',
  '期待より悪かった',
  '大きく期待を下回った',
  '全くしたくない',
  '全くそう思わない'
];

const MILD_NEGATIVE = [
  'やや期待と異なっていた',
  'あまりしたくない',
  'あまりそう思わない'
];

const NEGATIVE_ICON = {
  severe: '🚨',
  mild: '⚠️'
};

const DEFAULT_SLACK_MENTION = '<!channel>';
const SUPPORT_TEAM_MENTION = '<!subteam^S08HR8LT5DZ|@サポートチーム>';

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

const DIRECT_FOLLOWUP_MENTIONS = ['<@U0AFKHDLT2A>'];

// ======================================
// メイン処理
// ======================================
function onFormSubmit(e) {
  try {
    const formTitle = e && e.source ? e.source.getTitle() : FORM_TITLE;
    const items = e && e.response ? e.response.getItemResponses() : [];
    const qaMap = buildQaMapFromItems(items);
    const responseId = resolveResponseIdFromQaMap(qaMap);
    const customerInfo = responseId ? getCustomerInfoFromBigQuery(responseId) : null;
    const hasFreeText = hasFreeTextFeedback(qaMap);
    const baseSentiment = evaluateBaseSatisfaction(qaMap);
    const directUseAnswer = normalizeAnswerValue(qaMap[QUESTIONS.DIRECT_USE]);
    const directResult = evaluateDirectExperience(qaMap);
    const directMarker = directResult ? directResult.marker : null;
    const extraMentions = (directMarker && directMarker !== '◯') ? DIRECT_FOLLOWUP_MENTIONS.slice() : [];
    const supportNeeded = shouldNotifySupportTeam(baseSentiment, hasFreeText, directMarker);

    const message = createSlackMessage(formTitle || FORM_TITLE, qaMap, {
      responseId: responseId,
      customerInfo: customerInfo,
      hasFreeText: hasFreeText,
      baseSentiment: baseSentiment,
      directUseAnswer: directUseAnswer,
      directResult: directResult
    });

    const mention = buildMentionText(customerInfo, supportNeeded, extraMentions);
    sendToSlack(message, mention);
  } catch (error) {
    console.error('[delivery_form_notification] エラー:', error);
  }
}

// ======================================
// Slack メッセージ生成
// ======================================
function createSlackMessage(formTitle, qaMap, options) {
  options = options || {};
  const responseId = options.responseId || '';
  const customerInfo = options.customerInfo || null;
  const hasFreeText = options.hasFreeText;
  const baseSentiment = options.baseSentiment;
  const directUseAnswer = options.directUseAnswer;
  const directResult = options.directResult;

  const blocks = [];
  const fallbackLines = [];
  const headerLine = '■■■■■■■■■■■■■■■■■■■■■';

  blocks.push(slackSection(headerLine));
  blocks.push(slackSection(`「${formTitle || FORM_TITLE}」に回答がありました。`));
  fallbackLines.push(headerLine);
  fallbackLines.push(`「${formTitle || FORM_TITLE}」に回答がありました。`);

  blocks.push(slackDivider());
  fallbackLines.push('++++++++++++++++++++++++++++++++');

  const summaryItems = buildSummaryItems({
    baseSentiment: baseSentiment,
    hasFreeText: hasFreeText,
    directUseAnswer: directUseAnswer,
    directResult: directResult,
    npsScore: qaMap[QUESTIONS.NPS]
  });
  blocks.push(slackSection(['*簡易判定*'].concat(summaryItems.slackLines).join('\n')));
  fallbackLines.push('**簡易判定**');
  Array.prototype.push.apply(fallbackLines, summaryItems.fallbackLines);

  blocks.push(slackDivider());
  fallbackLines.push('++++++++++++++++++++++++++++++++');

  const basicInfoLines = buildBasicInfoLines(responseId, customerInfo);
  blocks.push(slackSection(['*基本情報*'].concat(basicInfoLines.slackLines).join('\n')));
  fallbackLines.push('**基本情報**');
  Array.prototype.push.apply(fallbackLines, basicInfoLines.fallbackLines);

  const detailSections = buildDetailSections(qaMap);
  if (detailSections.length > 0) {
    blocks.push(slackDivider());
    fallbackLines.push('++++++++++++++++++++++++++++++++');
  }
  detailSections.forEach(function(section) {
    blocks.push(slackSection(section.slackText));
    Array.prototype.push.apply(fallbackLines, section.fallbackLines);
  });

  return {
    text: fallbackLines.join('\n'),
    blocks: blocks
  };
}

function buildSummaryItems(params) {
  const lines = [];
  const fallback = [];

  if (params.baseSentiment) {
    lines.push('• ' + escapeForSlack('納車全体の印象: ' + params.baseSentiment.emoji + ' ' + params.baseSentiment.label + getFollowUpNotice(params.baseSentiment.emoji)));
    fallback.push('- 納車全体の印象: ' + params.baseSentiment.emoji + ' ' + params.baseSentiment.label + getFollowUpNotice(params.baseSentiment.emoji));
  } else {
    lines.push('• ' + escapeForSlack('納車全体の印象: 未回答'));
    fallback.push('- 納車全体の印象: 未回答');
  }

  const freeTextLine = params.hasFreeText ? '自由記入欄: ⚠️コメントあり、必ず確認' : '自由記入欄: コメントなし';
  lines.push('• ' + escapeForSlack(freeTextLine));
  fallback.push('- ' + freeTextLine);

  const directUseLine = params.directUseAnswer ? `DIRECT 利用: ${params.directUseAnswer}` : 'DIRECT 利用: 未回答';
  lines.push('• ' + escapeForSlack(directUseLine));
  fallback.push('- ' + directUseLine);

  let directExperienceLine = 'DIRECT 体験: 未回答';
  if (params.directUseAnswer === 'いいえ') {
    directExperienceLine = 'DIRECT 体験: 未利用';
  } else if (params.directResult) {
    directExperienceLine = `DIRECT 体験: ${params.directResult.marker} ${params.directResult.label}`;
  }
  lines.push('• ' + escapeForSlack(directExperienceLine));
  fallback.push('- ' + directExperienceLine);

  const npsLine = formatNpsSummary(params.npsScore);
  lines.push('• ' + escapeForSlack('紹介意向: ' + npsLine));
  fallback.push('- 紹介意向: ' + npsLine);

  return { slackLines: lines, fallbackLines: fallback };
}

function buildBasicInfoLines(responseId, customerInfo) {
  const slackLines = [];
  const fallbackLines = [];
  const info = customerInfo || {};

  const idLine = '回答ID: ' + (responseId || '不明');
  slackLines.push('• ' + escapeForSlack(idLine));
  fallbackLines.push('- ' + idLine);

  const nameLine = '顧客名: ' + (info.customerName || '不明（BigQueryを確認してください）');
  slackLines.push('• ' + escapeForSlack(nameLine));
  fallbackLines.push('- ' + nameLine);

  const staffLine = '営業担当者: ' + (info.staffName || '不明');
  slackLines.push('• ' + escapeForSlack(staffLine));
  fallbackLines.push('- ' + staffLine);

  const storeLine = '販売店: ' + (info.storeName || '不明');
  slackLines.push('• ' + escapeForSlack(storeLine));
  fallbackLines.push('- ' + storeLine);

  if (info.orderDate) {
    const orderLine = '契約日: ' + formatOrderDateValue(info.orderDate);
    slackLines.push('• ' + escapeForSlack(orderLine));
    fallbackLines.push('- ' + orderLine);
  }

  if (info.vehicleName) {
    let vehicleLine = '車両: ' + info.vehicleName;
    if (info.gradeName) {
      vehicleLine += ' (' + info.gradeName + ')';
    }
    slackLines.push('• ' + escapeForSlack(vehicleLine));
    fallbackLines.push('- ' + vehicleLine);
  }

  return { slackLines: slackLines, fallbackLines: fallbackLines };
}

function buildDetailSections(qaMap) {
  const sections = [];

  addSectionIfPresent(sections, 'お車の状態', [buildSatisfactionLine(qaMap[QUESTIONS.VEHICLE_STATE])], qaMap[QUESTIONS.VEHICLE_STATE_DETAIL]);
  addSectionIfPresent(sections, '納車当日の対応', [buildSatisfactionLine(qaMap[QUESTIONS.DELIVERY_DAY])], qaMap[QUESTIONS.DELIVERY_DAY_DETAIL]);
  addSectionIfPresent(sections, '契約〜納車の流れ', [buildSatisfactionLine(qaMap[QUESTIONS.FLOW])], qaMap[QUESTIONS.FLOW_DETAIL]);

  const directLines = [];
  if (qaMap[QUESTIONS.DIRECT_USE]) {
    directLines.push('利用: ' + qaMap[QUESTIONS.DIRECT_USE]);
  }
  if (qaMap[QUESTIONS.DIRECT_GAP]) {
    directLines.push('写真・動画とのギャップ: ' + formatAnswerValue(qaMap[QUESTIONS.DIRECT_GAP]) + getSeverityIconForResponse(qaMap[QUESTIONS.DIRECT_GAP]));
  }
  if (qaMap[QUESTIONS.DIRECT_NEXT]) {
    directLines.push('次回もオンラインで購入?: ' + formatAnswerValue(qaMap[QUESTIONS.DIRECT_NEXT]) + getSeverityIconForResponse(qaMap[QUESTIONS.DIRECT_NEXT]));
  }
  addSectionIfPresent(sections, 'BUDDICA DIRECT', directLines, null);

  if (qaMap[QUESTIONS.NPS]) {
    addSectionIfPresent(sections, '紹介意向 (NPS)', ['スコア: ' + formatNpsSummary(qaMap[QUESTIONS.NPS])], null);
  }

  addSectionIfPresent(sections, 'その他', null, qaMap[QUESTIONS.OTHER]);

  return sections;
}

function addSectionIfPresent(container, title, bulletLines, commentValue) {
  const normalizedBullets = (bulletLines || []).filter(function(line) {
    return line && String(line).trim();
  }).map(function(line) {
    return String(line).trim();
  });

  const commentLines = extractCommentLines(commentValue);

  if (normalizedBullets.length === 0 && commentLines.length === 0) {
    return;
  }

  const lines = ['*' + escapeForSlack(title) + '*'];
  const fallback = ['**' + title + '**'];

  normalizedBullets.forEach(function(line) {
    lines.push('• ' + escapeForSlack(line));
    fallback.push('- ' + line);
  });

  commentLines.forEach(function(line) {
    lines.push('> ' + escapeForSlack(line));
    fallback.push('> ' + line);
  });

  container.push({
    slackText: lines.join('\n'),
    fallbackLines: fallback
  });
}

function buildSatisfactionLine(answer) {
  if (!answer) {
    return '';
  }
  return '満足度: ' + formatAnswerValue(answer) + getSeverityIconForResponse(answer);
}

function extractCommentLines(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(/\r?\n/)
    .map(function(line) { return line.trim(); })
    .filter(function(line) { return line; });
}

function formatNpsSummary(value) {
    const normalized = normalizeAnswerValue(value);
    if (!normalized) {
      return '未回答';
    }

    const SCORE_MAP = {
      '強くそう思う': '強くそう思う (5/5)',
      'ある程度そう思う': 'ある程度そう思う (4/5)',
      'どちらともいえない': 'どちらともいえない (3/5)',
      'あまりそう思わない': 'あまりそう思わない (2/5)',
      '全くそう思わない': '全くそう思わない (1/5)'
    };

    return SCORE_MAP[normalized] || normalized;
  }

// ======================================
// 判定・メンション
// ======================================
function evaluateBaseSatisfaction(qaMap) {
  const counts = countSentimentForQuestions(qaMap, BASE_SATISFACTION_QUESTIONS);
  return buildSentimentResultFromCounts(counts, { nullWhenNoAnswer: true });
}

function evaluateDirectExperience(qaMap) {
  if (normalizeAnswerValue(qaMap[QUESTIONS.DIRECT_USE]) !== 'はい') {
    return null;
  }
  const counts = countSentimentForQuestions(qaMap, DIRECT_EXPERIENCE_QUESTIONS);
  const result = buildSentimentResultFromCounts(counts, { nullWhenNoAnswer: true });
  if (!result) {
    return { emoji: '🟢', label: '問題なし', marker: '◯' };
  }
  return {
    emoji: result.emoji,
    label: result.label,
    marker: toSimpleSentimentMarker(result)
  };
}

function hasFreeTextFeedback(qaMap) {
  return FREE_TEXT_QUESTIONS.some(function(question) {
    return !!normalizeAnswerValue(qaMap[question]);
  });
}

function shouldNotifySupportTeam(baseSentiment, hasFreeText, directMarker) {
  const baseNegative = baseSentiment && (baseSentiment.emoji === '🔴' || baseSentiment.emoji === '🟡');
  const directNegative = directMarker && directMarker !== '◯';
  return baseNegative || directNegative || hasFreeText;
}

function buildMentionText(customerInfo, includeSupport, extraMentions) {
  const mentions = [];
  const primary = resolveSlackMention(customerInfo);
  if (primary) {
    mentions.push(primary);
  }
  if (includeSupport) {
    mentions.push(SUPPORT_TEAM_MENTION);
  }
  (extraMentions || []).forEach(function(mention) {
    const trimmed = String(mention || '').trim();
    if (trimmed) {
      mentions.push(trimmed);
    }
  });

  const seen = {};
  const unique = mentions.filter(function(mention) {
    const trimmed = String(mention || '').trim();
    if (!trimmed) {
      return false;
    }
    if (seen[trimmed]) {
      return false;
    }
    seen[trimmed] = true;
    return true;
  });

  if (unique.length === 0) {
    return DEFAULT_SLACK_MENTION;
  }
  return unique.join(' ');
}

function resolveSlackMention(customerInfo) {
  if (!customerInfo || !customerInfo.storeName) {
    return DEFAULT_SLACK_MENTION;
  }
  const mention = STORE_SLACK_MENTION_MAP[customerInfo.storeName];
  if (mention) {
    return mention;
  }

  const normalized = customerInfo.storeName.replace(/\s+/g, '');
  let fallback = DEFAULT_SLACK_MENTION;
  Object.keys(STORE_SLACK_MENTION_MAP).forEach(function(key) {
    if (fallback !== DEFAULT_SLACK_MENTION) {
      return;
    }
    const normalizedKey = key.replace(/\s+/g, '');
    if (normalized.indexOf(normalizedKey) !== -1) {
      fallback = STORE_SLACK_MENTION_MAP[key];
    }
  });
  return fallback;
}

// ======================================
// 共通ユーティリティ
// ======================================
function buildQaMapFromItems(items) {
  const qaMap = {};
  (items || []).forEach(function(item) {
    try {
      const title = item.getItem().getTitle();
      qaMap[title] = item.getResponse();
    } catch (error) {
      // ignore malformed item
    }
  });
  return qaMap;
}

function resolveResponseIdFromQaMap(qaMap) {
  const raw = qaMap[QUESTIONS.RESPONSE_ID];
  return raw ? String(raw).trim() : '';
}

function normalizeAnswerValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.length ? String(value[0]).trim() : '';
  }
  return String(value).trim();
}

function formatAnswerValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(function(entry) { return String(entry).trim(); })
      .filter(function(entry) { return entry; })
      .join(', ') || '(未回答)';
  }
  const normalized = normalizeAnswerValue(value);
  return normalized || '(未回答)';
}

function getSeverityIconForAnswer(value) {
  const normalized = normalizeAnswerValue(value);
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

function getSeverityIconForResponse(response) {
  if (!response) {
    return '';
  }
  if (Array.isArray(response)) {
    for (var i = 0; i < response.length; i++) {
      const icon = getSeverityIconForAnswer(response[i]);
      if (icon) {
        return icon;
      }
    }
    return '';
  }
  return getSeverityIconForAnswer(response);
}

function countSentimentForQuestions(qaMap, questions) {
  const counts = { severe: 0, mild: 0, answered: 0 };
  questions.forEach(function(question) {
    const response = qaMap[question];
    if (!response) {
      return;
    }
    counts.answered++;
    const values = Array.isArray(response) ? response : [response];
    values.forEach(function(answer) {
      tallySentimentValue(answer, counts);
    });
  });
  return counts;
}

function tallySentimentValue(value, counts) {
  const normalized = normalizeAnswerValue(value);
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

function toSimpleSentimentMarker(result) {
  if (!result) {
    return '◯';
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

// ======================================
// BigQuery 連携
// ======================================
function buildManagementNumberCandidates(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return [];
  }
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  const normalized = digitsOnly.replace(/^0+/, '');
  const seen = {};
  const candidates = [];

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

  for (var i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const query = [
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

    const job = {
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

    try {
      const queryJob = BigQuery.Jobs.insert(job, CONFIG.bigquery.projectId);
      const jobId = queryJob.jobReference.jobId;

      var queryResults = null;
      var attempts = 0;
      const maxAttempts = 5;

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
          const cell = row.f[index] || {};
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
      console.error('[BigQuery] エラー:', error);
    }
  }

  return null;
}

function formatOrderDateValue(value) {
  const raw = String(value || '').trim();
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

// ======================================
// Slack送信
// ======================================
function sendToSlack(messagePayload, mention) {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) {
    console.error('Webhook URL未設定');
    return;
  }

  const mentionText = mention || DEFAULT_SLACK_MENTION;
  const headerLine = '■■■■■■■■■■■■■■■■■■■■■';
  const payload = {
    mrkdwn: true
  };

  if (messagePayload && messagePayload.blocks) {
    const blocks = messagePayload.blocks.slice();
    blocks.unshift(slackSection(mentionText));
    blocks.unshift(slackSection(headerLine));
    payload.blocks = blocks;
    payload.text = headerLine + '\n' + mentionText + '\n' + (messagePayload.text || '');
  } else {
    const messageText = messagePayload ? String(messagePayload) : '';
    payload.text = headerLine + '\n' + mentionText + (messageText ? '\n' + messageText : '');
  }

  try {
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      console.error('Slack送信エラー:', response.getContentText());
    }
  } catch (error) {
    console.error('Slack送信例外:', error);
  }
}

function getSlackWebhookUrl() {
  const scriptProperties = PropertiesService.getScriptProperties();
  return scriptProperties.getProperty('SLACK_WEBHOOK_URL');
}

function checkWebhookProperty() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(props.getProperty('SLACK_WEBHOOK_URL'));
}

