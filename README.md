# HIBI-tool

個人向けの生活管理・ゲーム連携 Web アプリです。仕様は [`spec.txt`](./spec.txt) を基準とします。

## 現在の状態

Todo 画面、Todo の端末内保存、分類・期限フィルター、並び替え、完了・削除、チェックリスト、複数リンクを実装しています。Todoは既存Todoを親として設定でき、一覧に親子関係を表示します。親Todoの編集画面から子Todo作成画面を重ねて開け、親の未保存入力を保持します。新規親Todoの場合は、親の保存と同時に子Todoも保存します。子Todoはすべて表示・順次表示・カスタム表示を親ごとに選べ、順次表示の順序とカスタム表示の順序・タイミング（1〜100の表示グループ）を設定できます。カレンダー予定・締切にも複数のTodoを紐付けられ、親Todoを選ぶと子Todoも含まれます。ゲーム画面では所持ポイントを表示し、Todo完了時に仕様書どおり通常ポイント（メイン5、ルーティン2、その他3）を一度だけ付与します。累積ログインボーナスもJST午前4時区切りで受取・保存します。月表示カレンダーでは予定・締切の登録、編集、削除、完了チェックができ、チェック時に5ptを一度だけ付与します。JSONバックアップの書き出し・全置換復元と、変更前スナップショットの最新10回分保存にも対応しています。戦闘、ポイント消費、ルート進行、敵撃破・マス報酬、ルーティン周期、カレンダーの実通知、Google Calendar/Maps連携は未実装です。仕様書にある未確定事項は、確定仕様として扱わず機能実装前に整理します。

## 起動方法

外部依存パッケージはありません。開発時はリポジトリのルートで静的 HTTP サーバーを起動してください。

```sh
python3 -m http.server 8000
```

その後、ブラウザーで `http://localhost:8000` を開きます。Cloudflare Pages ではリポジトリのルートを静的サイトとして配信する構成を想定しています。

デプロイ用ファイルは次のコマンドで `dist/` に作成します。仕様書やテストは配信物に含めません。

```sh
npm run build
```

Cloudflare Pages の Git 連携では、Framework preset を `None`、Build command を `npm run build`、Build output directory を `dist` に設定します。Root directory はリポジトリルートのままにします。

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
      todoRepository.js    Todo・カレンダー・ゲーム状態の localStorage 保存と読み込み
      todoController.js    Todo・カレンダー画面の操作と状態管理
    calendar/
      calendarService.js   予定・締切データと月表示のロジック
    game/
      gameService.js       Todo・カレンダー報酬と累積ログインボーナス
    data/
      backupService.js     JSONバックアップの検証・入出力形式
  ui/
    renderTodoPage.js      Todo 画面の DOM 描画
    renderCalendarPage.js  月間カレンダー・予定登録・詳細の DOM 描画
    renderGamePage.js      ポイント・ルート概要の描画
    renderDataPage.js      JSON・自動バックアップ管理画面
  assets/
    assetManifest.js       今後必要になる画像素材の仮ファイル名と仕様
tests/
  todo.test.js             Todo のロジック・保存処理のテスト
  calendar.test.js         カレンダーの日付・イベント処理のテスト
  game.test.js             ポイント・ログインボーナスのテスト
  backup.test.js           JSON入出力・自動バックアップのテスト
```

Todo、カレンダー、ゲーム状態はこのブラウザーの `localStorage` にまとめて保存します。従来の Todo 保存データ（`daily-tool.todos.v1`）があれば、初回読込時に新形式へコピーし、旧データも削除せず残します。読み込み・保存に失敗した場合はエラーを表示し、読み込めない既存データを上書きしないようにしています。期限を過ぎたTodoは一覧から隠し、期限から7日を超えたデータは次回読み込み時に削除します。

Todo完了とポイント付与は同じ保存操作にまとめ、同じ完了イベントからポイントが重複付与されないようイベントIDを保存します。完了を取り消しても付与済みポイントは減りません。

カレンダーの予定・締切、関連Todo、完了報酬も同じアプリ状態に保存されます。親Todoに紐付いた予定・締切には、その子Todoも自動的に含まれます。締切の通知タイミングは設定値として保存しますが、ブラウザー通知自体はまだ実装していません。

データ管理画面では JSON の外部書き出し・全置換復元と、自動バックアップからの復元を行えます。データ変更前の状態を同じ端末に最大10回分保持します。保存はバックアップを含む単一のlocalStorage書き込みで行い、失敗時は一度再試行してからエラーを表示します。

### 画像素材について

ゲーム用の6点（平原背景、通常スライム、ボススライム、剣、剣の強化素材、ジュエル）を `public/assets/game/` 以下で確認し、実ファイル名・寸法を [`src/assets/assetManifest.js`](./src/assets/assetManifest.js) に反映しています。平原背景、剣、ジュエルはゲーム画面で使用しています。通常・ボススライムと強化素材は、戦闘・武器強化画面が未実装のためまだ表示していません。

### テスト

```sh
npm test
```

今後は画面（`ui`）、機能ごとの処理（`features` / `domain`）、データ管理、外部サービス連携を分離して追加します。サーバー側処理や外部サービスは必要性と無料運用条件を確認した後に導入します。
