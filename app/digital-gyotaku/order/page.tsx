"use client";

import { useEffect, useRef, useState } from "react";

const LINE_URL =
  process.env.NEXT_PUBLIC_LINE_URL ?? "https://lin.ee/xoSEDWK";

// 料金は仮。本番の金額はサーバ側で line_items を組み立てる（docs/gyotaku-order-flow.md）
const BASE_PRICE = 3000;
const MAX_PHOTOS = 3;

type Background = "mono" | "pale" | "wood";
type OptionKey = "square" | "tackle" | "witness";

const backgrounds: {
  value: Background;
  name: string;
  note: string;
  swatch: string;
  price: number;
}[] = [
  { value: "mono", name: "白黒", note: "墨拓と和紙の、もっともシンプルな仕上げ", swatch: "a", price: 0 },
  { value: "pale", name: "淡彩", note: "淡い色を添えた、やわらかな仕上げ", swatch: "b", price: 1000 },
  { value: "wood", name: "木目", note: "木の質感を生かした、あたたかな仕上げ", swatch: "c", price: 1000 },
];

const options: { key: OptionKey; name: string; note: string; price: number }[] = [
  { key: "square", name: "スクエア出力", note: "SNSや額装に合わせやすい正方形", price: 500 },
  { key: "tackle", name: "タックル欄", note: "ロッド・リール・ルアーを記録", price: 500 },
  { key: "witness", name: "現認者欄", note: "一緒に釣行した方の名前を添える", price: 500 },
];

const photoTips = [
  "魚の全体が写り、真上または真横から",
  "ヒレや尾まで隠れていない",
  "明るい場所で、影が少ない",
];

function yen(n: number) {
  return `¥${n.toLocaleString("ja-JP")}`;
}

export default function GyotakuOrderPage() {
  // TODO(Phase 2): LIFF 組み込み
  // liff.init({ liffId }) → liff.getProfile() で userId / displayName を取得し、ここで state に持つ。
  // 注文レコードの line_user_id / line_display_name と Stripe の metadata に渡す。
  // const { userId, displayName } = useLiffProfile();

  const [photos, setPhotos] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [background, setBackground] = useState<Background>("mono");
  const [selected, setSelected] = useState<Record<OptionKey, boolean>>({
    square: false,
    tackle: false,
    witness: false,
  });
  const [done, setDone] = useState(false);

  // プレビュー用の object URL を差し替え時・離脱時に解放する
  const photosRef = useRef<string[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach(URL.revokeObjectURL), []);

  const total =
    BASE_PRICE +
    (backgrounds.find((b) => b.value === background)?.price ?? 0) +
    options.reduce((sum, o) => sum + (selected[o.key] ? o.price : 0), 0);

  function bind(key: string) {
    return {
      value: values[key] ?? "",
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setValues((v) => ({ ...v, [key]: e.target.value })),
    };
  }

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setDragOver(false);
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS);
    if (files.length === 0) return;
    photos.forEach(URL.revokeObjectURL);
    setPhotos(files.map((f) => URL.createObjectURL(f)));
  }

  function toCheckout() {
    // UI のみ。Phase 3 でここを Stripe Checkout へのリダイレクトに置き換え、
    // 下の完了画面は決済後の戻り先として表示する
    setDone(true);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="gy-order">
      <div className="shell">
        {!done && (
          <header className="top">
            <span className="word">MIHANADA</span>
            <span className="stepnum">Gyotaku</span>
          </header>
        )}

        {!done ? (
          <section className="pane">
            <h1 className="s-head">
              その一匹のこと、
              <br />
              教えてください。
            </h1>
            <p className="lead">
              写真と釣行の記録をもとに、和紙の質感を生かしたデジタル魚拓をつくります。送っていただいたあとは、こちらで仕立ててお届けします。
            </p>

            <div className="block">
              <p className="eyebrow">Photo</p>
              <h2 className="s-head">写真</h2>
              <div className="form">
                <label className={`drop${dragOver ? " is-over" : ""}`}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onFiles}
                    onDragEnter={() => setDragOver(true)}
                    onDragLeave={() => setDragOver(false)}
                  />
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5M12 4v11m0-11L8 8m4-4 4 4" />
                  </svg>
                  <p className="t">写真を選ぶ</p>
                  <p className="s">JPG / PNG / HEIC　最大3枚</p>
                </label>
                <div className="thumbs">
                  {Array.from({ length: MAX_PHOTOS }, (_, i) => (
                    <div key={i} className={`ph${i === 0 ? " is-main" : ""}`}>
                      {photos[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- blob: のローカルプレビュー
                        <img src={photos[i]} alt="" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </div>
                  ))}
                </div>
                <ul className="tips">
                  {photoTips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="block">
              <p className="eyebrow">The fish</p>
              <h2 className="s-head">魚のこと</h2>
              <div className="form">
                <div className="field">
                  <label htmlFor="gy-species">
                    Species<span className="jp">魚種</span><span className="req">*</span>
                  </label>
                  <input id="gy-species" className="input" placeholder="例：マハタ" {...bind("species")} />
                </div>
                <div className="field row">
                  <div className="field">
                    <label htmlFor="gy-length">
                      Length<span className="jp">全長</span><span className="req">*</span>
                    </label>
                    <div className="unit">
                      <input id="gy-length" className="input" inputMode="decimal" placeholder="45" {...bind("length")} />
                      <span>cm</span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="gy-weight">
                      Weight<span className="jp">重さ</span>
                    </label>
                    <div className="unit">
                      <input id="gy-weight" className="input" inputMode="decimal" placeholder="任意" {...bind("weight")} />
                      <span>kg</span>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gy-date">
                    Date<span className="jp">釣行日</span><span className="req">*</span>
                  </label>
                  <input id="gy-date" className="input" type="date" {...bind("date")} />
                </div>
                <div className="field">
                  <label htmlFor="gy-place">
                    Place<span className="jp">釣れた場所</span><span className="req">*</span>
                  </label>
                  <input id="gy-place" className="input" placeholder="例：壱岐 郷ノ浦沖" {...bind("place")} />
                  <p className="hint">作品に載る表記そのままで。伏せたい場合は「壱岐沖」など大まかに</p>
                </div>
                <div className="field">
                  <label htmlFor="gy-angler">
                    Angler<span className="jp">釣り人の名前</span><span className="req">*</span>
                  </label>
                  <input id="gy-angler" className="input" placeholder="例：吉田 祐也" {...bind("angler")} />
                </div>
                <div className="field">
                  <label htmlFor="gy-note">
                    Angler&apos;s note<span className="jp">思い出のひとこと</span>
                  </label>
                  <textarea id="gy-note" className="textarea" placeholder="例：凪の朝、単独釣行。" {...bind("note")} />
                  <p className="hint">20文字前後がきれいに収まります</p>
                </div>
              </div>
            </div>

            <div className="block">
              <p className="eyebrow">Finish</p>
              <h2 className="s-head">仕上げ</h2>
              <div className="form">
                <div className="field">
                  <span className="lbl">
                    Background<span className="jp">背景</span>
                  </span>
                  <div className="choices">
                    {backgrounds.map((b) => (
                      <label key={b.value} className="choice">
                        <input
                          type="radio"
                          name="bg"
                          value={b.value}
                          checked={background === b.value}
                          onChange={() => setBackground(b.value)}
                        />
                        <span className={`sw ${b.swatch}`} />
                        <span className="n">
                          {b.name}
                          <span className="d">{b.note}</span>
                        </span>
                        <span className="p">{b.price ? `+ ${yen(b.price)}` : "基本"}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="lbl">
                    Options<span className="jp">追加する項目</span>
                  </span>
                  <div className="choices">
                    {options.map((o) => (
                      <OptionChoice
                        key={o.key}
                        option={o}
                        checked={selected[o.key]}
                        onChange={(checked) => setSelected((s) => ({ ...s, [o.key]: checked }))}
                        sub={
                          o.key === "tackle" ? (
                            <>
                              <div className="field">
                                <label htmlFor="gy-tackle">Rod / Reel</label>
                                <input id="gy-tackle" className="input" placeholder="例：ワールドシャウラ 1652R-3 / ステラ 4000" {...bind("tackle")} />
                              </div>
                              <div className="field">
                                <label htmlFor="gy-lure">Lure / Bait</label>
                                <input id="gy-lure" className="input" placeholder="例：ジグ 60g" {...bind("lure")} />
                              </div>
                            </>
                          ) : o.key === "witness" ? (
                            <div className="field">
                              <label htmlFor="gy-witness">
                                Witness<span className="jp">現認者</span>
                              </label>
                              <input id="gy-witness" className="input" placeholder="例：山田 太郎" {...bind("witness")} />
                            </div>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gy-msg">
                    Message<span className="jp">その他ご要望</span>
                  </label>
                  <textarea id="gy-msg" className="textarea" placeholder="魚の向き、伏せたい情報、納期のご希望など" {...bind("msg")} />
                </div>
              </div>
            </div>

            <div className="total">
              <span className="k">お支払い</span>
              <span className="v">
                {yen(total)}
                <small>税込</small>
              </span>
            </div>
            <p className="hint">
              背景・オプションの選択で金額が変わります。写真に不足があれば、決済前にLINEでご連絡します。
            </p>
            <div className="actions">
              <button type="button" className="btn" onClick={toCheckout}>
                決済へ進む
              </button>
              <p className="hint">このあと決済画面（Stripe）に移ります。完成データは公式LINEに届きます</p>
            </div>
          </section>
        ) : (
          <section className="pane deep on-deep">
            <svg className="wave" width="64" height="20" viewBox="0 0 64 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
              <path d="M2 10c6-8 12-8 18 0s12 8 18 0 12-8 18 0" />
            </svg>
            <p className="eyebrow is-center">Payment complete</p>
            <h2 className="s-head">お支払いを確認しました。</h2>
            <p className="lead">
              ここからは、こちらの仕事です。
              <br />
              できあがったら公式LINEにお届けします。
            </p>
            <div className="next">
              <div className="li">
                <span className="no">01</span>
                <div>
                  <div className="t">お申し込み・お支払い</div>
                  <div className="s">完了</div>
                </div>
              </div>
              <div className="li now">
                <span className="no">02</span>
                <div>
                  <div className="t">仕立て</div>
                  <div className="s">和紙の質感に、その日の記録をのせていきます。目安は7〜10日</div>
                </div>
              </div>
              <div className="li">
                <span className="no">03</span>
                <div>
                  <div className="t">LINEでお届け</div>
                  <div className="s">完成データをトークに送ります。気になる点はそこから調整できます</div>
                </div>
              </div>
            </div>
            <div className="actions">
              <a className="btn is-ghost" href={LINE_URL}>
                LINEにもどる
              </a>
            </div>
            {/* TODO(Phase 3): Webhook で確定した注文番号を表示する。現在はモックの固定値 */}
            <p className="foot">注文番号　GY-260915-014</p>
          </section>
        )}
      </div>
    </div>
  );
}

function OptionChoice({
  option,
  checked,
  onChange,
  sub,
}: {
  option: { key: OptionKey; name: string; note: string; price: number };
  checked: boolean;
  onChange: (checked: boolean) => void;
  // チェック時に開く追加入力欄（タックル欄・現認者欄のみ）
  sub?: React.ReactNode;
}) {
  return (
    <>
      <label className="choice opt">
        <input
          type="checkbox"
          name="opt"
          value={option.key}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="n">
          {option.name}
          <span className="d">{option.note}</span>
        </span>
        <span className="p">+ {yen(option.price)}</span>
        <span className="tick" />
      </label>
      {sub && <div className={`sub${checked ? " is-on" : ""}`}>{sub}</div>}
    </>
  );
}
