# BUDDICA アンケート Slack 通知

成約後・納車後の Google フォーム回答を受け取り、BigQuery で顧客情報を照合して Slack に通知する、2つの独立した Google Apps Script プロジェクトです。

2026年9月24日に稼働中の Apps Script エディタからコードとマニフェストを取得し、設定画面・概要・トリガー画面を確認して保存しました。コードの改変・GASへの反映・フォーム送信・Slack送信は行っていません。

## 保存場所

| 種類 | コード・設定 | 元のプロジェクト |
|---|---|---|
| 成約後アンケート | [contract/](contract/) | [成約後アンケート_Slack通知](https://script.google.com/home/projects/1dOZFlsOwMwUcVP1fx3HTolYtnH8y09Hp6hrRKlGslAIrwEHpFAnN14Hk/edit) |
| 納車後アンケート | [delivery/](delivery/) | [納車後アンケート_Slack通知](https://script.google.com/home/projects/1q9dvabjNnbDGzabiP9FmcU8TkI6kWic_EDK1isQbx_cW426gXcZ_7LX_/edit) |

各フォルダには以下を保存しています。

- `コード.gs`：GASエディタのコード全文。取得時の内容をそのまま保存。
- `appsscript.json`：実際のマニフェスト。
- `settings.json`：プロジェクト・フォーム・トリガー・BigQuery・権限の確認済み設定。GASへアップロードするファイルではありません。
- `script-properties.example.json`：設定するプロパティ名のひな形。秘密値は含みません。
- `.clasp.json`：既存GASへの紐づけ情報。各フォルダを独立したプロジェクトとして扱います。
- `.claspignore`：コードとマニフェストだけを同期対象にする指定。

## 資料

- [GAS 設定・復元手順](docs/gas-settings.md)
- [成約後アンケート 判定ロジック](docs/contract-judgment.md)
- [納車後アンケート 判定ロジック](docs/delivery-judgment.md)
- [取得時のソース照合情報（SHA-256）](docs/source-snapshot.json)

## 秘密値とバックアップ範囲

このリポジトリは保存時点で公開設定です。Slack Webhook URL、認証情報、フォーム回答、BigQueryの顧客データは保存していません。`SLACK_WEBHOOK_URL` は両GASで設定済みであることのみ記録しています。

コードの保存だけでは、フォーム本体、回答、スクリプトプロパティ、インストール型トリガー、GCPの権限設定は復元されません。再構築時は設定資料に沿って別途設定してください。GitHubへのコミットはGASへの自動反映ではありません。

## 保存時のGitHub状況

指定された `m-tsurue/customer_survey` は存在しましたが、取り込み前の `git ls-remote` は空で、ブランチ・コミットがない状態でした。この保存が当該リポジトリへの初回取り込みです。他のリポジトリに過去の複製があるかは調査していません。
