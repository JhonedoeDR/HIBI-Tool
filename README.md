# HIBI-tool

個人向けの生活管理・ゲーム連携 Web アプリです。仕様は [`spec.txt`](./spec.txt) を基準とします。

## 現在の状態

初期のプロジェクト骨格のみを実装しています。各機能カードは構成の案内であり、Todo 管理やデータ保存などの機能はまだ実装していません。仕様書にある未確定事項は、確定仕様として扱わず、機能実装前に整理します。

## 起動方法

外部依存パッケージはありません。ES モジュールを使用するため、リポジトリのルートで静的 HTTP サーバーを起動してください。

```sh
python3 -m http.server 8000
```

その後、ブラウザーで `http://localhost:8000` を開きます。Cloudflare Pages ではリポジトリのルートを静的サイトとして配信する構成を想定しています。

## 構成

```text
index.html                 HTML エントリーポイント
styles.css                 共通スタイル
src/
  main.js                  アプリ起動エントリーポイント
  app/
    bootstrap.js           UI と機能一覧の組み立て
  features/
    featureCatalog.js      機能一覧の表示用定義
  ui/
    renderDashboard.js     ダッシュボードの DOM 描画
```

今後は、画面（`ui`）、機能ごとの処理（`features` / `domain`）、データ管理（`data`）、外部サービス連携（`integrations`）を分離して追加します。サーバー側処理や外部サービスは必要性と無料運用条件を確認した後に導入します。
