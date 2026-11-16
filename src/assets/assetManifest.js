export const gameAssets = {
  areaBackground: "./public/assets/game/areas/area-01-background.png",
  normalSlime: "./public/assets/game/enemies/enemy-normal-01.png",
  bossSlime: "./public/assets/game/enemies/enemy-boss-01.png",
  sword: "./public/assets/game/weapons/weapon-01.png",
  jewel: "./public/assets/game/items/item-jewel.png",
  swordUpgradeMaterial: "./public/assets/game/items/item-upgrade-material.png",
};

export const assetManifest = [
  {
    file: gameAssets.areaBackground,
    purpose: "平原エリアの背景",
    width: 1920,
    height: 1080,
    format: "PNG",
    quantity: "1点",
  },
  {
    file: gameAssets.normalSlime,
    purpose: "ノーマルスライムの立ち絵。透過背景",
    width: 512,
    height: 512,
    format: "透過PNG",
    quantity: "1点",
  },
  {
    file: gameAssets.bossSlime,
    purpose: "ボススライムの立ち絵。透過背景",
    width: 1024,
    height: 1024,
    format: "透過PNG",
    quantity: "1点",
  },
  {
    file: gameAssets.sword,
    purpose: "剣の武器アイコン。透過背景",
    width: 512,
    height: 512,
    format: "透過PNG",
    quantity: "1点",
  },
  {
    file: gameAssets.jewel,
    purpose: "ジュエルのアイコン。透過背景",
    width: 256,
    height: 256,
    format: "透過PNG",
    quantity: "1点",
  },
  {
    file: gameAssets.swordUpgradeMaterial,
    purpose: "剣の強化素材アイコン。透過背景",
    width: 512,
    height: 512,
    format: "透過PNG",
    quantity: "1点",
  },
];
