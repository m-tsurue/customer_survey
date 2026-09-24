# GAS 設定・復元手順

確認日：2026年9月24日（日本時間）。Apps Script の実画面と取得したソースを根拠とします。

## プロジェクト

| 設定 | 成約後 | 納車後 |
|---|---|---|
| プロジェクト名 | 成約後アンケート_Slack通知 | 納車後アンケート_Slack通知 |
| 形式 | Googleフォームに紐づくGAS | Googleフォームに紐づくGAS |
| オーナー表示 | Customer Center | Customer Center |
| 作成日 | 2025/09/29 | 2025/10/26 |
| タイムゾーン | Asia/Tokyo | Asia/Tokyo |
| ランタイム | V8 | V8 |
| 例外ログ | STACKDRIVER（有効） | STACKDRIVER（有効） |
| GCPプロジェクト設定 | デフォルト | デフォルト |
| 高度なサービス | BigQuery / v2 / bigquery | BigQuery / v2 / bigquery |
| ライブラリ | エディタに登録なし | エディタに登録なし |
| マニフェストの表示 | オフ | オン |
| 概要に表示されたデプロイ | Head | Head |
| スクリプトプロパティ | SLACK_WEBHOOK_URL：設定済み | SLACK_WEBHOOK_URL：設定済み |

成約後のマニフェスト表示は取得のため一時的にオンにし、取得後オフへ戻しました。コード・トリガー・秘密値は変更していません。

プロジェクトID・フォームID・URLは [contract/settings.json](../contract/settings.json)、[delivery/settings.json](../delivery/settings.json) に収録しています。納車後の実フォーム名は「【BUDDICA】ご納車後アンケート」で、コード内のフォールバック名「【BUDDICA】納車後ご満足度アンケート」とは異なります。通常のフォーム送信では実フォーム名が通知に使用されます。

## 登録済みトリガー

| 設定 | 成約後 | 納車後 |
|---|---|---|
| 確認アカウントで表示された件数 | 1件 | 1件 |
| オーナー表示 | 自分 | 自分 |
| 実行関数 | onFormSubmit | onFormSubmit |
| 導入 | Head | Head |
| イベントのソース | フォームから | フォームから |
| イベントの種類 | フォーム送信時 | フォーム送信時 |
| エラー通知 | 今すぐ通知を受け取る | 毎日通知を受け取る |
| 確認時の前回実行 | 2026/09/24 21:02:02 | 2026/09/24 20:23:30 |
| 確認時の表示エラー率 | 0% | 0% |

件数は今回の確認アカウントから見えた範囲です。他のユーザーが所有するトリガーは未確認です。表示エラー率はUIの観測値であり、コードが例外やHTTPエラーをログに記録して終了する場合もあるため、Slack到達率を示すものではありません。

## OAuthスコープ

成約後はマニフェストに `oauthScopes` の記載がなく、概要画面に以下の2件が表示されていました。

- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/bigquery`

納車後はマニフェストに以下の5件を明示し、概要画面にも同じ5件が表示されていました。

- `https://www.googleapis.com/auth/forms.currentonly`
- `https://www.googleapis.com/auth/forms`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/bigquery`
- `https://www.googleapis.com/auth/script.scriptapp`

取得したマニフェストをそのまま保存しており、両者の権限を揃える変更はしていません。

## BigQuery連携（両方共通）

| 設定 | 値 |
|---|---|
| データプロジェクト | buddica-internal-prod |
| データセット | extreme_data_prod |
| テーブル | sharyoeki_data |
| ロケーション | asia-northeast1 |
| 照合キー | management_number |
| SQL | Standard SQL、パラメータ付き検索、LIMIT 1 |
| 取得列 | management_number, sales_representative, sales_destination, sales_location_name, vehicle_name, grade, order_date |

フォームの「回答ID (この欄は変更しないでください)」を管理番号として照合します。成約後のみ、上記の値が `undefined` / `null` の場合に「管理番号」を代替参照します。候補値は前後空白除去、数字のみ、先頭ゼロ除去の順で照合します。

Apps Scriptに紐づく「GCP デフォルト」と、データ参照先の `buddica-internal-prod` は別の設定です。GCPコンソール上のAPI有効化・IAM・課金状態は今回未確認です。

## Slack通知

- 両GASとも、スクリプトプロパティ `SLACK_WEBHOOK_URL` を使います。URLはGitに保存せず、GAS設定または社内の秘密情報管理先で管理してください。
- 通知先はWebhook側で指定しています。2026年9月24日にSlack設定とGASの秘密URLを照合し、成約後は `notify_契約後アンケート`、納車後は `notify_納車後7日アンケート` と確認しました。管理画面・登録者・復旧時の確認事項は [Incoming Webhook 設定・引き継ぎ](slack-incoming-webhooks.md) に記録しています。
- 支社メンションは `STORE_SLACK_MENTION_MAP` に10支社分を登録。販売店が不明・未登録の場合は `<!channel>` です。
- 成約後：接客に対する印象が🔴/🟡、または自由記入があればサポートチームを追加。DIRECTが×/△の場合はDIRECT担当者を追加します。DIRECTだけがネガティブの場合はサポートチーム追加条件には入りません。
- 納車後：納車全体が🔴/🟡、DIRECTが×/△、自由記入ありのいずれかでサポートチームを追加。DIRECTが×/△ならDIRECT担当者も追加します。
- 取得時点の `DIRECT_FOLLOWUP_MENTIONS` は納車後が `<@U0AFKHDLT2A>` の1件、成約後は同じIDが2件並んでいます。最終メンション作成時に重複除去されるため1件になります。保存に際してコードは修正していません。
- 成約後の「倉敷支社は未実装」「docs/slack_store_mentions.md を参照」というコメントは取得元のままです。実際のマップには倉敷支社が登録されています。参照先資料は今回取得したGASファイルには含まれていません。
- 納車後の `checkWebhookProperty()` はWebhook値をログ出力する既存関数です。保存作業では実行していません。

## 復元・引き継ぎ

1. 対象フォームとGASへのアクセス権、および継続運用する実行アカウントを確認します。新規構築する場合はフォームに紐づくGASを作成します。
2. 種類を取り違えず、対象フォルダの `コード.gs` と `appsscript.json` を反映します。2つのコードを1つのGASへ混在させないでください。
3. 高度なサービス `BigQuery v2`、タイムゾーン、V8、例外ログ、対象マニフェストのスコープを確認します。
4. 実行アカウントが参照先BigQueryでクエリを実行・参照できること、必要なAPI設定が有効であることを管理者と確認します。
5. `SLACK_WEBHOOK_URL` を対象GASのスクリプトプロパティに設定します。ひな形JSONは自動適用されません。
6. 実行アカウントで `onFormSubmit` / `Head` / 「フォームから」/「フォーム送信時」のインストール型トリガーを登録し、上表のエラー通知設定を指定します。既存トリガーがある場合は重複を作らないでください。
7. フォーム設問名・選択肢がコードと一致することを確認します。文字列による照合のため、設問名や選択肢の変更時にはコードも確認します。
8. 運用担当者が指定したテスト回答・通知先で送信、BigQuery照合、Slack到達とメンションを確認します。エディタからイベント引数なしで `onFormSubmit` を実行してもフォーム送信テストの代わりにはなりません。

`.clasp.json` は元の本番GASに紐づきます。新しいGASへ復元する場合はIDを差し替えます。`settings.json`、プロパティひな形、ドキュメントはGASソースとして同期しません。このリポジトリには自動デプロイの設定はありません。

## 今回の検証範囲

コードとマニフェストの取得内容とのバイト一致・SHA-256照合、JavaScript構文、JSON形式、既知の秘密値パターンがコミット対象にないことを確認。フォーム送信、BigQuery実行、Slack送信の実地テストは今回行っていません。
