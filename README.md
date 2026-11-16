# HIBI-tool

個人向けの生活管理・ゲーム連携 Web アプリです。仕様は [`spec.txt`](./spec.txt) を基準とします。

## 現在の状態

Todo 画面、Todo の端末内保存、分類・期限フィルター、並び替え、完了・削除、チェックリスト、複数リンクを実装しています。ルーティン周期、Todo の親子関係、通知、カレンダー、ゲーム連携、バックアップなどは未実装です。仕様書にある未確定事項は、確定仕様として扱わず、機能実装前に整理します。

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
package.json               Node.js 標準テストの設定（外部依存なし）
src/
  main.js                  アプリ起動エントリーポイント
  app/
    bootstrap.js           画面の起動
  features/
    todo/
      todoService.js       Todo の生成・絞り込み・状態更新
      todoRepository.js    Todo の localStorage 保存と読み込み
      todoController.js    Todo 画面の操作と状態管理
  ui/
    renderTodoPage.js      Todo 画面の DOM 描画
  assets/
    assetManifest.js       今後必要になる画像素材の仮ファイル名と仕様
tests/
  todo.test.js             Todo のロジック・保存処理のテスト
```

Todo データはこのブラウザーの `localStorage` に保存されます。読み込み・保存に失敗した場合はエラーを表示し、読み込めない既存データを上書きしないようにしています。期限を過ぎたTodoは一覧から隠し、期限から7日を超えたデータは次回読み込み時に削除します。

### 画像素材について

画像はまだ作成・配置していません。必要な仮ファイル名、用途、サイズ、形式、点数は [`src/assets/assetManifest.js`](./src/assets/assetManifest.js) に記載しています。UI の簡単な記号はコードで表示し、ゲーム用の画像素材のみ外部での制作を想定しています。

### テスト

```sh
npm test
```

今後は画面（`ui`）、機能ごとの処理（`features` / `domain`）、データ管理、外部サービス連携を分離して追加します。サーバー側処理や外部サービスは必要性と無料運用条件を確認した後に導入します。
