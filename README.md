# HIBI-tool

個人向けの生活管理・ゲーム連携 Web アプリです。仕様は [`spec.txt`](./spec.txt) を基準とします。

## 現在の状態

Todo 画面、Todo の端末内保存、分類・期限フィルター、並び替え、完了・削除、チェックリスト、複数リンクを実装しています。Todoは既存Todoを親として設定でき、一覧に親子関係を表示します。親Todoの編集画面から子Todo作成画面を重ねて開け、親の未保存入力を保持します。新規親Todoの場合は、親の保存と同時に子Todoも保存します。子Todoはすべて表示・順次表示・カスタム表示を親ごとに選べ、順次表示の順序とカスタム表示の順序・タイミング（1〜100の表示グループ）を設定できます。ルーティンTodoは毎日・毎週・毎月・毎年・任意間隔と、毎月／毎年の第○曜日を指定できます。完了時は次回周期に進み、期限を過ぎた未完了周期は次の予定日にスキップします。カレンダー予定・締切にも複数のTodoを紐付けられ、親Todoを選ぶと子Todoも含まれます。Todoの開始日・期限、予定の準備開始・出発・開始、締切の指定オフセットから通知予定時刻を算出し、Todo一覧とカレンダー詳細に表示します（過去分と完了済み項目は除外）。通知サーバー連携用に、予定をISO日時と安定IDを含む全件スナップショットへ変換する処理、Cloudflare D1の保存スキーマ・リポジトリ、期限到来通知をFCMへ送るCron Workerを追加しました。WorkerにはOAuth認証、リース付きキュー処理、指数バックオフ再試行、無効トークンの処理を実装しています。Pages Functions APIは未実装で、WorkerのCloudflare/FCM設定・デプロイも未実施のため、実際のプッシュ通知はまだ配信されません。累積ログインボーナスもJST午前4時区切りで受取・保存します。戦闘ロジックの基礎として、1回の攻撃で武器攻撃力を合算し、攻撃専用ポイントを優先消費する処理を実装しています。月表示カレンダーでは予定・締切の登録、編集、削除、完了チェックができ、チェック時に5ptを一度だけ付与します。JSONバックアップの書き出し・全置換復元と、変更前スナップショットの最新10回分保存にも対応しています。iOS通知の準備としてWeb App Manifestと通知クリックを扱うService Workerを追加しました。戦闘画面、敵・進行度の数値、武器特性、敵撃破・マス報酬、Google Calendar/Maps連携は未実装です。仕様書にある未確定事項は、確定仕様として扱わず機能実装前に整理します。

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
manifest.webmanifest       ホーム画面追加用のWeb App Manifest
service-worker.js          Push通知の表示・クリック処理
styles.css                 共通スタイル
package.json               Node.js 標準テストの設定（外部依存なし）
public/
  assets/
    app-icon.svg           既存ブランド文字を使ったPWAアイコン
src/
  main.js                  アプリ起動エントリーポイント
  app/
    bootstrap.js           画面の起動
  features/
    todo/
      todoService.js       Todo の生成・絞り込み・状態更新
      routineService.js    ルーティン周期の検証・次回日計算
      todoRepository.js    Todo・カレンダー・ゲーム状態の localStorage 保存と読み込み
      todoController.js    Todo・カレンダー画面の操作と状態管理
    notifications/
      notificationService.js 通知予定時刻の算出
      notificationSyncService.js サーバー同期用スナップショット生成
      d1NotificationRepository.js D1へのスナップショット保存
      notificationDispatcher.js D1通知キューのリース・送信結果管理
      fcmClient.js          OAuth・FCM HTTP v1送信
      pushClient.js          通知Service Workerの登録
    calendar/
      calendarService.js   予定・締切データと月表示のロジック
    game/
      gameService.js       Todo・カレンダー報酬と累積ログインボーナス
      combatService.js     1回攻撃のダメージ・ポイント消費計算
    data/
      backupService.js     JSONバックアップの検証・入出力形式
  ui/
    renderTodoPage.js      Todo 画面の DOM 描画
    renderCalendarPage.js  月間カレンダー・予定登録・詳細の DOM 描画
    renderGamePage.js      ポイント・ルート概要の描画
    renderDataPage.js      JSON・自動バックアップ管理画面
  assets/
    assetManifest.js       今後必要になる画像素材の仮ファイル名と仕様
migrations/
  0001_notification_tables.sql Cloudflare D1の通知テーブル
workers/
  notification-dispatcher.js 期限到来通知を送るCron Worker
  wrangler.toml                Worker・D1・Cron設定
tests/
  todo.test.js             Todo のロジック・保存処理のテスト
  routine.test.js          ルーティン周期・次回日のテスト
  notification.test.js     通知予定時刻の計算テスト
  notificationRepository.test.js D1スナップショット保存のテスト
  notificationDispatcher.test.js キュー配信・再試行テスト
  fcmClient.test.js        FCM認証・送信テスト
  pwa.test.js              PWA設定・Push Service Workerのテスト
  calendar.test.js         カレンダーの日付・イベント処理のテスト
  game.test.js             ポイント・ログインボーナスのテスト
  combat.test.js           1回攻撃の戦闘ロジックのテスト
  backup.test.js           JSON入出力・自動バックアップのテスト
```

Todo、カレンダー、ゲーム状態はこのブラウザーの `localStorage` にまとめて保存します。従来の Todo 保存データ（`daily-tool.todos.v1`）があれば、初回読込時に新形式へコピーし、旧データも削除せず残します。読み込み・保存に失敗した場合はエラーを表示し、読み込めない既存データを上書きしないようにしています。期限を過ぎたTodoは一覧から隠し、期限から7日を超えたデータは次回読み込み時に削除します。

Todo完了とポイント付与は同じ保存操作にまとめ、同じ完了イベントからポイントが重複付与されないようイベントIDを保存します。完了を取り消しても付与済みポイントは減りません。

ルーティン周期はTodoと一緒に保存します。完了時に同じ周期ルールの次回日へ進み、チェックリストをリセットします。未完了の周期を過ぎていた場合は、アプリ起動時または日付変更時に今日以降の次の予定日へ進め、過去分をまとめてスキップします。毎月31日など該当日がない月と、年次の2月29日は月末日に実行します。指定した第5曜日がない月・年はその周期を飛ばします。

カレンダーの予定・締切、関連Todo、完了報酬も同じアプリ状態に保存されます。親Todoに紐付いた予定・締切には、その子Todoも自動的に含まれます。通知予定時刻は端末のローカル時刻で計算・表示します。通知の端末登録・同期フローはまだ未接続のため、現在はアプリから通知を受け取れません。

通知の配信Workerは `workers/wrangler.toml` を使って別途デプロイする構成です。稼働にはCloudflare D1の作成・ID設定、Cron Workerのデプロイ、およびFCMサービスアカウントJSONをWorker Secretとして登録する操作が必要です。安全な認証付き同期APIはまだないため、これらの設定を行ってもアプリから通知先端末を登録することはできません。APIの認証・端末登録を実装して配信を試す段階で、外部サービス側の操作手順をまとめて案内します。サービスアカウントの秘密鍵をソースやチャットへ貼り付けないでください。

通知キューは期限到来時に配信し、失敗時は最大5回まで指数バックオフで再試行します。FCMが受理した後、Workerが送信済み状態を保存する前に停止した場合は再送される可能性があるため、通知は厳密な一度限りではなく少なくとも一度の配信です。同じ通知IDをService Workerの表示タグにも使い、表示中の重複は置き換えます。

データ管理画面では JSON の外部書き出し・全置換復元と、自動バックアップからの復元を行えます。データ変更前の状態を同じ端末に最大10回分保持します。保存はバックアップを含む単一のlocalStorage書き込みで行い、失敗時は一度再試行してからエラーを表示します。

### 画像素材について

ゲーム用の6点（平原背景、通常スライム、ボススライム、剣、剣の強化素材、ジュエル）を `public/assets/game/` 以下で確認し、実ファイル名・寸法を [`src/assets/assetManifest.js`](./src/assets/assetManifest.js) に反映しています。平原背景、剣、ジュエルはゲーム画面で使用しています。通常・ボススライムと強化素材は、戦闘・武器強化画面が未実装のためまだ表示していません。

PWAアイコンは既存のDaily-toolブランド文字をSVGで表現しており、新しいイラスト素材は追加していません。

### テスト

```sh
npm test
```

今後は画面（`ui`）、機能ごとの処理（`features` / `domain`）、データ管理、外部サービス連携を分離して追加します。サーバー側処理や外部サービスは必要性と無料運用条件を確認した後に導入します。
