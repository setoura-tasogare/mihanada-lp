# デジタル魚拓 注文フロー

## 前提
- 制作は社内の生成ツール（`gyotaku` リポ）で行う。お客さんには触らせない
- お客さんは LINE 起点でフォーム回答と決済だけ行う
- やりとり・納品はすべて公式LINEのトークで完結する

## フロー
1. 公式LINE のリッチメニュー →「注文する」
2. LIFF でフォームを開く（`/digital-gyotaku/order`）
3. 写真・魚の情報・仕上げを入力 →「決済へ進む」（クライアントとサーバの両方で必須項目を検証）
4. Cloudflare WorkerでLINE IDトークンを検証し、注文と写真をCloudflare KVへ保存する
5. Workerが表示内容を再計算し、注文を `awaiting_payment` にしてStripe Checkoutへ移動する
6. Stripe Webhookで入金を確認したら注文を `paid` に確定し、同じLINEユーザーへ注文番号と入金確認をpushする
8. 社内で制作（gyotaku ツール）
9. 完成データを LINE で push 納品

## LINE ユーザーの特定
- フォームは LIFF アプリとして登録し、LIFF URL（`https://liff.line.me/{liffId}`）で開かせる
  - LINE アプリ内で開けば自動でログイン済みになり、`liff.getProfile()` が使える
  - 外部ブラウザで LIFF URL を開いた場合も、`liff.login()` でログインすればプロフィールは取れる
  - `/digital-gyotaku/order` を LIFF を通さず直接開いた場合は LIFF の初期化もログインもされないので、userId は取れない。直接アクセス時は LIFF URL へ誘導する
- 画面では `liff.getIDToken()` を取得してWorkerへ送る。WorkerはLINEの `POST /oauth2/v2.1/verify` で検証し、返された `sub`（`U` 始まりの固定ID）と `name` を注文に保存する
- userId は**プロバイダー単位**で決まる。同じユーザーでも、同一プロバイダー配下のチャネル同士なら userId は一致し、プロバイダーが違うと一致しない。**LIFF と Messaging API チャネルは同じプロバイダー配下に置く**こと。そうしないと Webhook で受ける userId と注文の userId が一致しない
- 納品時の push は既存の `lib/line-webhook` / Cloudflare Workers の基盤に乗せる

## Stripe との受け渡し
- Checkout Session 作成時に `client_reference_id = order.id`、`metadata = { line_user_id, order_id }` を渡す
- Webhook 側は metadata だけで「誰の注文か」を引ける。完了通知の push もここから
- 料金: 基本 ¥3,000、背景 淡彩/木目 +¥1,000、スクエア/タックル欄/現認者欄 各 +¥500。line_items はサーバ側で組み立てる（クライアントの金額は信用しない）
- 決済手段はまずカード（Apple Pay / Google Pay 含む）に限定する。コンビニ払いなど入金が後になる手段を足す場合は、下の非同期イベントの処理を必ず入れる

## 決済・返金の状態遷移
`status`: `draft` → `awaiting_payment` → `paid` → `producing` → `delivered`、返金時は `refunded`

| イベント | 条件 | 更新 |
| --- | --- | --- |
| `checkout.session.completed` | `payment_status = 'paid'` | `awaiting_payment → paid`、入金確認の push |
| `checkout.session.completed` | `payment_status = 'unpaid'`（遅延決済） | 状態は変えない（入金待ちのまま） |
| `checkout.session.async_payment_succeeded` | — | `awaiting_payment → paid`、入金確認の push |
| `checkout.session.async_payment_failed` | — | `awaiting_payment → draft`、支払い失敗の案内を push |
| `checkout.session.expired` | — | `awaiting_payment → draft` |
| `charge.refunded` | 全額返金 | `paid / producing / delivered → refunded`、`refunded_amount_jpy` を更新 |
| `charge.refunded` | 部分返金 | 状態は変えず `refunded_amount_jpy` だけ更新 |
| `refund.failed` | — | 状態は変えず、社内に通知して手動対応 |

- 状態の更新は必ず「今の状態」を条件に付けて行う（例: `update ... set status = 'paid' where id = $1 and status = 'awaiting_payment'`）。条件に合わなければ何もしない
- 返金は社内から Stripe ダッシュボードで実行する想定。フォームからの返金操作は作らない

## Webhook の冪等性
Stripe は同じイベントを複数回送ることがある（再送・順不同）。どのイベントを何回受けても、注文確定と LINE 通知が一度だけになるようにする。
- **イベントの処理済み記録**: `stripe_events(event_id primary key, type, received_at)` に `event.id` を insert してから処理する。重複キーで失敗したら処理済みとして 200 を返す
- **Session の一意制約**: `gyotaku_orders.stripe_session_id` に UNIQUE 制約を付ける
- **条件付き更新**: 上の状態遷移のとおり、今の状態を条件にした update にする。更新件数が 0 件なら後続処理（push など）をしない
- **LINE push の再送**: 注文ごとに固定の `X-Line-Retry-Key` を付け、LINE側の重複抑止（24時間）を利用する。送信が受理された後にD1の `confirmation_sent_at` を記録する。通信失敗時はStripeへ502を返して再試行する。24時間を超える障害では通知履歴の照合が必要。
- 署名検証（`Stripe-Signature`）に失敗したリクエストは処理しない

## 現在の保存先（Cloudflare KV）

- Namespace: `MIHANADA_GYOTAKU_ORDERS`
- 注文: `orders/{orderId}/meta.json`
- 写真: `orders/{orderId}/photos/{number}-{filename}`
- 注文JSONに `lineUserId`、`lineDisplayName`、入力内容、金額、写真キーを保存する。決済状態とLINE通知状態はD1を正とする。
- 画像は1枚10MB以下、最大3枚。KVは現在の小規模受付用で、決済・管理画面の実装時にD1またはSupabaseへ索引を移す

## 現在の注文索引（Cloudflare D1）

- Database: `mihanada-gyotaku`
- `gyotaku_orders`: LINEユーザー、金額、Stripe Session、決済状態、LINE通知状態
- `stripe_events`: StripeイベントIDを主キーとして再送を記録
- 注文内容と写真はKV、検索・決済状態はD1に保存する
- StripeシークレットはWorker Secretにのみ保存し、Gitやブラウザには公開しない

## 将来のデータ（Supabase 案）
`gyotaku_orders`
- id, created_at
- line_user_id, line_display_name
- species, length_cm, weight_kg, caught_on, place, angler, note
- background (mono | pale | wood), options (jsonb: square / tackle / witness)
- tackle_rod_reel, tackle_lure, witness_name, message
- photo_paths (text[] — Supabase Storage)
- stripe_session_id (UNIQUE), stripe_payment_intent, amount_jpy, refunded_amount_jpy
- status (draft | awaiting_payment | paid | producing | delivered | refunded)

`stripe_events`
- event_id (PK), type, received_at

`line_push_outbox`
- id, order_id, kind (payment_confirmed | payment_failed | delivered など), created_at, sent_at
- UNIQUE (order_id, kind)

## 写真品質の扱い（要判断）
決済が先に通る設計なので、写真が使えない場合は返金対応になる。選択肢:
- A. アップロード直後に Claude API で判定（全身が写っているか / 真横か / ヒレが開いているか）し、その場で撮り直しを促す。決済ボタンは判定 OK 後に有効化
- B. 決済をフォーム内で行わず、社内で写真確認後に Stripe Payment Link を LINE で送る 2 段構え
現状の UI は A 寄り。どちらにするかで「決済へ進む」の位置が変わる。

## フェーズ
- Phase 1（この PR）: フォーム UI（クライアント側の必須項目チェックを含む）
- Phase 2: LIFF 組み込み、Cloudflare KV保存、写真アップロード、サーバ側の入力検証（完了）
- Phase 3: Stripe Checkout + Webhook（状態遷移・冪等性）、決済完了 push（実装済み）
- Phase 4: 写真品質チェック、納品 push、注文一覧（社内向け）
