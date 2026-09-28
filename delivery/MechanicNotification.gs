/**
 * 納車全体の印象が🔴/🟡の回答を整備部門へ追加通知する。
 * 既存通知の後に呼ぶ。未設定時は停止し、追加通知の失敗を呼び出し元へ伝播しない。
 * 判定・本文は既存処理の結果を再利用し、整備部門には @channel のみ付ける。
 */
function sendDeliveryMechanicNotification(baseSentiment, messagePayload) {
  if (!baseSentiment || (baseSentiment.emoji !== '🔴' && baseSentiment.emoji !== '🟡')) {
    return 'not_target';
  }

  try {
    const properties = PropertiesService.getScriptProperties();
    const webhookUrl = String(properties.getProperty('SLACK_MECHANIC_WEBHOOK_URL') || '').trim();
    if (!webhookUrl) {
      console.warn('[delivery_mechanic_notification] Webhook未設定のため追加通知をスキップ');
      return 'not_configured';
    }
    // 設定の取り違えで既存チャンネルへ二重投稿しない。
    const primaryWebhookUrl = String(properties.getProperty('SLACK_WEBHOOK_URL') || '').trim();
    if (webhookUrl === primaryWebhookUrl) {
      console.error('[delivery_mechanic_notification] 既存通知と同じWebhookのため追加通知をスキップ');
      return 'same_destination';
    }
    if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(webhookUrl)) {
      console.error('[delivery_mechanic_notification] Webhookの形式が不正');
      return 'invalid_webhook';
    }
    if (!messagePayload || !messagePayload.text || !Array.isArray(messagePayload.blocks)) {
      console.error('[delivery_mechanic_notification] 通知本文が不正');
      return 'invalid_message';
    }

    const blocks = messagePayload.blocks.slice();
    blocks.unshift(slackSection('<!channel>'));
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        mrkdwn: true,
        text: '<!channel>\n' + messagePayload.text,
        blocks: blocks
      }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status !== 200) {
      // 応答本文や例外には秘密URL等が含まれる可能性があるため、ログに出さない。
      console.error('[delivery_mechanic_notification] 追加通知失敗 HTTP ' + status);
      return 'http_error';
    }
    console.log('[delivery_mechanic_notification] 追加通知成功');
    return 'sent';
  } catch (error) {
    console.error('[delivery_mechanic_notification] 追加通知で例外が発生。既存通知の再送は行いません');
    return 'exception';
  }
}

/**
 * 手動の接続確認専用。整備部門へ実際に @channel 付きで1件投稿する。
 * フォーム回答・BigQuery・既存通知先は使用しない。トリガーには登録しない。
 */
function testDeliveryMechanicNotification() {
  const text = '【動作確認・テスト】整備士向け納車後アンケート通知\n'
    + '実際のお客様の回答ではありません。対応は不要です。\n'
    + '納車全体の印象が「🔴ネガティブ」「🟡ややネガティブ」の場合、このチャンネルに @channel 付きで通知します。';
  const result = sendDeliveryMechanicNotification({ emoji: '🔴' }, {
    text: text,
    blocks: [slackSection(text)]
  });
  if (result !== 'sent') throw new Error('整備部門へのテスト通知未完了: ' + result);
}
