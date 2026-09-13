export const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "MIHANADA 基本メニュー",
  chatBarText: "MIHANADA メニュー",
  areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: "message", text: "デジタル魚拓について知りたい" } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: "message", text: "フィッシュレザーについて知りたい" } },
    { bounds: { x: 0, y: 843, width: 1250, height: 843 }, action: { type: "uri", uri: "https://www.mihanada.site/" } },
    { bounds: { x: 1250, y: 843, width: 1250, height: 843 }, action: { type: "message", text: "お問い合わせをしたい" } },
  ],
};
