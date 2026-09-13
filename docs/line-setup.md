# MIHANADA LINE 接続・運用

## 確定した構成

友だち追加時は管理画面のあいさつテキストのみ。初回Flexは送らない。
通常のチャット・写真は担当者が対応し、メニューの定型テキストにだけ自動返信する。

| リッチメニュー（2×2） | アクション | Flexの案内 |
|---|---|---|
| 左上 デジタル魚拓 | テキスト `デジタル魚拓について知りたい` | 料金・つくり方／写真送付の相談 |
| 右上 フィッシュレザー | テキスト `フィッシュレザーについて知りたい` | 商品の問い合わせ／オーダーメイド相談／詳細ページ |
| 左下 ホームページ | URL `https://www.mihanada.site/` | サイトを直接開く |
| 右下 お問い合わせ | テキスト `お問い合わせをしたい` | 魚拓／レザー商品／オーダー／その他 |

対象は MIHANADA `@963wbwmj`、Messaging APIチャネル `2011476428`。
同名の別アカウント `@304ytwqb` と取り違えないこと。

## 2026-09-11 の確認状況

- LINE管理画面に上記あいさつ文の原田さんへの送信履歴あり。
- 管理画面のリッチメニュー一覧は空。以前の画像選択は保存完了まで至っていない。
- Messaging APIは利用中。Webhook URLは空欄。長期アクセストークンは未発行（「発行」ボタン表示）。
- あいさつメッセージ・応答メッセージはいずれも有効。接続時に汎用応答の重複を確認する。
- ローカルに実トークン・シークレットを入れた `.env.local` はない。
- Chromeでログイン中のVercelは `harada3` のみで、MIHANADAプロジェクトへのアクセスを確認できない。
- 今回のコード変更はPRでレビューする。本番接続・既定メニュー切替・実機テストは未完了。

## 公開と接続の順番

1. 作業ブランチのPRを `youya44` がレビューし、Squash and mergeする。
   プレビューデプロイは作らない。ホームページのVercel設定・ドメイン・DNSは維持する。
2. `npm ci`、`npm run test:line`、`npm run line:build` を実行する。
   Cloudflareの対象アカウントでWranglerへログインし、mainのコードを `npm run line:deploy` で公開する。
   `wrangler.jsonc` の `mihanada-line` Workerのみが対象。Next.js全体の移転は不要。
   公開後、`npx wrangler secret put LINE_CHANNEL_SECRET` と
   `npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` で対象チャネルの値を登録する。
   シークレットはチャット・PR・GitHubへ貼らない。未設定時はWebhookと `/health` が503を返す。
3. 公開時に返る `https://mihanada-line.<account-subdomain>.workers.dev` の `/health` が200であることを確認する。
   このURLに `/api/line/webhook` を付けたものをLINE DevelopersのWebhook URLに設定し、検証を実行する。
   `.env.local` の `LINE_WEBHOOK_URL` にも同じ実URLを設定する（プレースホルダーは使わない）。
4. WebhookをON。あいさつメッセージとチャットはONのまま、重複する汎用自動応答はOFFにする。
5. ローカルの `.env.local`（Git管理外）に `.env.example` のLINE項目を設定し、`npm run line:check` を実行。
   対象アカウント、Flex全種類、相談文、メニューJSON、公開Webhookと有効状態を検証する。
   検証APIは友だちへメッセージを配信しない。
6. `npm run line:rich-menu` で画像登録と既定メニュー切替を行う。
   接続検証が成功するまで切り替えない。旧APIメニューID・新メニューIDを出力するため記録する。
   画像は `public/line/rich-menu.png`（2500×1686）。画像送信先は `api-data.line.me`。
7. 自分のLINEでトークを開き直し、3つのFlexと全相談ボタン・ホームページを確認する。
   写真／自由文に不要な自動返信が出ないこと、担当者から返信できることも確認する。

API作成のメニューはManager作成メニューと管理が別。APIの既定メニュー取得と実機表示で確認する。
個別ユーザーに別のメニューが紐付いている場合、そのメニューが優先される。
元に戻す場合は記録した旧APIメニューIDを再び既定に設定する。旧API既定がなければ新しいAPI既定の指定だけを解除する。
スクリプトは既存メニューを削除しない。

## コード検証

`npm run test:line` で署名検証、空イベント、各メニュー、相談ボタン、postback、有人対応との併用を検証する。
返信APIはモック化し、実際のLINEへ送信しない。`npm run line:build` でWorkersのバンドルを、`npm run build` でホームページの本番ビルドを確認する。

## 保管場所

Webhook・Flexのソースは `mihanada-lp` で管理し、実行先をCloudflare Workersへ分離する。
`workers/line.ts` が公開入口、`lib/line-webhook.ts` がWeb Crypto署名検証・応答処理、`lib/line.ts` が共通メッセージ。
旧Next.jsルートは互換入口として残すが、LINEにはWorkersのURLを登録する。
魚拓注文フォーム、LINEログイン、決済、納品連携は今回のメニュー接続とは別の実装範囲。

参考: [LINE公式のリッチメニュー設定](https://developers.line.biz/ja/docs/messaging-api/using-rich-menus/)

## 2026-09-13 Cloudflare移行の実装

- WorkerはNode.js・Next.jsランタイムを必要としない。署名は受信した生バイト列をWeb Cryptoで検証する。
- ホームページのリンク・画像URLは `https://www.mihanada.site` を維持する。
- Flexはホームページの生成り・墨色・藍色を使用。主ボタンは濃紺に統一。
- LINEのネイティブFlexはWebフォントを指定できないため、色・余白・写真・文体でトーンを揃える。
- Cloudflare公開、LINEシークレット登録、Webhook接続、既定リッチメニュー設定、実機テストは未完了。
- CloudflareのGoogleログインはアカウント利用の確認待ち。公開済みとは扱わない。

参考: [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
