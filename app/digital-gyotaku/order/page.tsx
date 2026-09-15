"use client";

import { useEffect, useRef, useState } from "react";

const LINE_URL =
  process.env.NEXT_PUBLIC_LINE_URL ?? "https://lin.ee/xoSEDWK";
const LIFF_ID =
  process.env.NEXT_PUBLIC_LIFF_ID ?? "2011607510-4wOg38uG";
const LIFF_URL = `https://liff.line.me/${LIFF_ID}`;
const ORDER_API_URL =
  process.env.NEXT_PUBLIC_GYOTAKU_ORDER_API_URL ??
  "https://mihanada-line.dzor-xiii.workers.dev/api/gyotaku/orders";

// 料金は仮。本番の金額はサーバ側で line_items を組み立てる（docs/gyotaku-order-flow.md）
const BASE_PRICE = 3000;
const MAX_PHOTOS = 3;

type Background = "mono" | "pale" | "wood";
type OptionKey = "square" | "tackle" | "witness";
type Photo = { file: File; url: string };

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

// 必須項目。Phase 2 以降はサーバ側でも同じ条件で検証する
const requiredFields: { key: string; label: string }[] = [
  { key: "species", label: "魚種" },
  { key: "length", label: "全長" },
  { key: "date", label: "釣行日" },
  { key: "place", label: "釣れた場所" },
  { key: "angler", label: "釣り人の名前" },
];

function yen(n: number) {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function isPositiveNumber(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n > 0;
}

function validate(values: Record<string, string>, photoCount: number) {
  const errors: string[] = [];
  if (photoCount === 0) errors.push("写真を1枚以上選んでください");
  for (const f of requiredFields) {
    if (!values[f.key]?.trim()) errors.push(`${f.label}を入力してください`);
  }
  if (values.length?.trim() && !isPositiveNumber(values.length)) {
    errors.push("全長は数字で入力してください");
  }
  if (values.weight?.trim() && !isPositiveNumber(values.weight)) {
    errors.push("重さは数字で入力してください");
  }
  return errors;
}

// 選んだ写真の File とプレビュー用 object URL をまとめて持ち、URL の寿命を管理する
function usePhotoPreviews(max: number) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);

  function commit(next: Photo[]) {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    photosRef.current = next;
    setPhotos(next);
  }

  useEffect(
    () => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );

  return {
    photos,
    replace: (files: File[]) =>
      commit(files.slice(0, max).map((file) => ({ file, url: URL.createObjectURL(file) }))),
    release: () => commit([]),
  };
}

export default function GyotakuOrderPage() {
  const { photos, replace: replacePhotos, release: releasePhotos } =
    usePhotoPreviews(MAX_PHOTOS);
  const [dragOver, setDragOver] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [background, setBackground] = useState<Background>("mono");
  const [selected, setSelected] = useState<Record<OptionKey, boolean>>({
    square: false,
    tackle: false,
    witness: false,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lineStatus, setLineStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [lineName, setLineName] = useState("");
  const [idToken, setIdToken] = useState("");
  const [orderId, setOrderId] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function connectLine() {
      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const token = liff.getIDToken();
        if (!token) throw new Error("LINE ID token is unavailable");
        const decoded = liff.getDecodedIDToken();
        if (!active) return;
        setIdToken(token);
        setLineName(typeof decoded?.name === "string" ? decoded.name : "LINEユーザー");
        setLineStatus("connected");
      } catch {
        if (active) setLineStatus("error");
      }
    }
    void connectLine();
    return () => {
      active = false;
    };
  }, []);

  // 送信のたびに errors は新しい配列になるので、エラーがあれば毎回一覧へフォーカスを移す
  useEffect(() => {
    if (errors.length > 0) errorRef.current?.focus();
  }, [errors]);

  const total =
    BASE_PRICE +
    (backgrounds.find((b) => b.value === background)?.price ?? 0) +
    options.reduce((sum, o) => sum + (selected[o.key] ? o.price : 0), 0);

  function bind(key: string) {
    return {
      name: key,
      value: values[key] ?? "",
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setValues((v) => ({ ...v, [key]: e.target.value })),
    };
  }

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setDragOver(false);
    const files = Array.from(e.target.files ?? []);
    // ピッカーをキャンセルした場合は、選択済みの写真を残す
    if (files.length === 0) return;
    replacePhotos(files);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validate(values, photos.length);
    if (lineStatus !== "connected" || !idToken) {
      found.push("LINEとの連携を確認できません。LINEから開き直してください");
    }
    setErrors(found);
    if (found.length > 0) return;

    setSubmitting(true);
    try {
      const form = new FormData(e.currentTarget);
      form.set("idToken", idToken);
      form.set("background", background);
      form.delete("photos");
      photos.forEach((photo) => form.append("photos", photo.file));
      form.delete("options");
      for (const [key, checked] of Object.entries(selected)) {
        if (checked) form.append("options", key);
      }

      const response = await fetch(ORDER_API_URL, { method: "POST", body: form });
      const result = (await response.json()) as {
        orderId?: string;
        displayName?: string;
        error?: string;
      };
      if (!response.ok || !result.orderId) {
        throw new Error(result.error ?? "注文を送信できませんでした");
      }
      setOrderId(result.orderId);
      if (result.displayName) setLineName(result.displayName);
      releasePhotos();
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "注文を送信できませんでした",
      ]);
    } finally {
      setSubmitting(false);
    }
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
          <form className="pane" onSubmit={onSubmit} noValidate>
            {/* required は支援技術向けに残し、エラーはブラウザの吹き出しではなく下の一覧にまとめて出す */}
            <h1 className="s-head">
              その一匹のこと、
              <br />
              教えてください。
            </h1>
            <p className="lead">
              写真と釣行の記録をもとに、和紙の質感を生かしたデジタル魚拓をつくります。送っていただいたあとは、こちらで仕立ててお届けします。
            </p>
            <div className={`line-status is-${lineStatus}`} role="status">
              {lineStatus === "connected" ? (
                <span><strong>{lineName}</strong>さんのLINEと連携済みです</span>
              ) : lineStatus === "connecting" ? (
                <span>LINEと連携しています…</span>
              ) : (
                <span>LINEと連携できませんでした。<a href={LIFF_URL}>LINEから開き直す</a></span>
              )}
            </div>

            <div className="block">
              <p className="eyebrow">Photo</p>
              <h2 className="s-head">
                写真<span className="req" aria-hidden="true">*</span>
              </h2>
              <div className="form">
                <label className={`drop${dragOver ? " is-over" : ""}`}>
                  <input
                    type="file"
                    name="photos"
                    accept="image/*"
                    multiple
                    aria-label="写真を選ぶ（必須・最大3枚）"
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
                        <img src={photos[i].url} alt={`選んだ写真 ${i + 1}`} />
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
                  <input id="gy-species" className="input" placeholder="例：マハタ" required {...bind("species")} />
                </div>
                <div className="field row">
                  <div className="field">
                    <label htmlFor="gy-length">
                      Length<span className="jp">全長</span><span className="req">*</span>
                    </label>
                    <div className="unit">
                      <input id="gy-length" className="input" inputMode="decimal" placeholder="45" required {...bind("length")} />
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
                  <input id="gy-date" className="input" type="date" required {...bind("date")} />
                </div>
                <div className="field">
                  <label htmlFor="gy-place">
                    Place<span className="jp">釣れた場所</span><span className="req">*</span>
                  </label>
                  <input id="gy-place" className="input" placeholder="例：壱岐 郷ノ浦沖" required {...bind("place")} />
                  <p className="hint">作品に載る表記そのままで。伏せたい場合は「壱岐沖」など大まかに</p>
                </div>
                <div className="field">
                  <label htmlFor="gy-angler">
                    Angler<span className="jp">釣り人の名前</span><span className="req">*</span>
                  </label>
                  <input id="gy-angler" className="input" placeholder="例：吉田 祐也" required {...bind("angler")} />
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
                <fieldset className="field">
                  <legend className="lbl">
                    Background<span className="jp">背景</span>
                  </legend>
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
                </fieldset>
                <fieldset className="field">
                  <legend className="lbl">
                    Options<span className="jp">追加する項目</span>
                  </legend>
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
                </fieldset>
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
            {errors.length > 0 && (
              <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
                <p>入力内容を確認してください</p>
                <ul>
                  {errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="actions">
              <button type="submit" className="btn" disabled={submitting || lineStatus === "connecting"}>
                {submitting ? "送信しています…" : "この内容で申し込む"}
              </button>
              <p className="hint">受付後、注文番号を公式LINEへお送りします。内容を確認してご連絡します</p>
            </div>
          </form>
        ) : (
          <section className="pane deep on-deep">
            <svg className="wave" width="64" height="20" viewBox="0 0 64 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
              <path d="M2 10c6-8 12-8 18 0s12 8 18 0 12-8 18 0" />
            </svg>
            <p className="eyebrow is-center">Order received</p>
            <h2 className="s-head">お申し込みを受け付けました。</h2>
            <p className="lead">
              {lineName}さん、ありがとうございます。
              <br />
              内容を確認して、公式LINEでご連絡します。
            </p>
            <div className="next">
              <div className="li">
                <span className="no">01</span>
                <div>
                  <div className="t">お申し込み</div>
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
            <p className="foot">注文番号　{orderId}</p>
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
