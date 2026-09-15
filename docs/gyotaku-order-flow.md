# デジタル魚拓 注文フロー

## 前提
- 制作は社内の生成ツール（`gyotaku` リポ）で行う。お客さんには触らせない
- お客さんは LINE 起点でフォーム回答と決済だけ行う
- やりとり・納品はすべて公式LINEのトークで完結する

## フロー
1. 公式LINE のリッチメニュー →「注文する」
2. LIFF でフォームを開く（`/digital-gyotaku/order`）
3. 写真・魚の情報・仕上げを入力 →「決済へ進む」
4. Stripe Checkout で決済
5. Stripe Webhook（`checkout.session.completed`）で注文を確定、LINE に「お支払いを確認しました」を push
6. 社内で制作（gyotaku ツール）
7. 完成データを LINE で push 納品

## LINE ユーザーの特定
- フォームは LIFF アプリとして登録し、`https://liff.line.me/{liffId}` 経由で開かせる。通常のブラウザリンクで開くと userId は取れない
- `liff.getProfile()` で `userId`（`U` 始まりの固定ID）と `displayName` を取得し、注文レコードに保存する
- userId はチャネルごとに異なる。**Messaging API のチャネルと同じプロバイダー配下**に LIFF を作ること。そうしないと Webhook で受ける userId と一致しない
- 納品時の push は既存の `lib/line-webhook` / Cloudflare Workers の基盤に乗せる

## Stripe との受け渡し
- Checkout Session 作成時に `client_reference_id = order.id`、`metadata = { line_user_id, order_id }` を渡す
- Webhook 側は metadata だけで「誰の注文か」を引ける。完了通知の push もここから
- 料金: 基本 ¥3,000（仮）、背景 淡彩/木目 +¥1,000、スクエア/タックル欄/現認者欄 各 +¥500。line_items はサーバ側で組み立てる（クライアントの金額は信用しない）

## データ（Supabase 案）
`gyotaku_orders`
- id, created_at
- line_user_id, line_display_name
- species, length_cm, weight_kg, caught_on, place, angler, note
- background (mono | pale | wood), options (jsonb: square / tackle / witness)
- tackle_rod_reel, tackle_lure, witness_name, message
- photo_paths (text[] — Supabase Storage)
- stripe_session_id, stripe_payment_intent, amount_jpy
- status (draft | paid | producing | delivered | refunded)

## 写真品質の扱い（要判断）
決済が先に通る設計なので、写真が使えない場合は返金対応になる。選択肢:
- A. アップロード直後に Claude API で判定（全身が写っているか / 真横か / ヒレが開いているか）し、その場で撮り直しを促す。決済ボタンは判定 OK 後に有効化
- B. 決済をフォーム内で行わず、社内で写真確認後に Stripe Payment Link を LINE で送る 2 段構え
現状の UI は A 寄り。どちらにするかで「決済へ進む」の位置が変わる。

## フェーズ
- Phase 1（この PR）: フォーム UI
- Phase 2: LIFF 組み込み、Supabase 保存、写真アップロード
- Phase 3: Stripe Checkout + Webhook、決済完了 push
- Phase 4: 写真品質チェック、納品 push、注文一覧（社内向け）
