# 📚 マンガ本棚 — セットアップ手順（完全ブラウザのみ・インストール不要）

---

## 全体の流れ

1. StackBlitzでプロジェクトを開きGitHubに保存
2. Firebaseでデータベースを作成
3. AnthropicでAPIキーを取得
4. Vercelでデプロイ → URLが発行される
5. iPhoneのホーム画面に追加

所要時間：約20〜30分

---

## STEP 1：StackBlitzでGitHubにアップロード

StackBlitzはブラウザ上で動く開発環境です。Node.jsのインストール不要でコードをGitHubに保存できます。

1. https://stackblitz.com を開いて「Sign in with GitHub」でログイン
2. 右上「+New Project」→「Vite + React」を選択
3. 左のファイルツリーが表示されたら、デフォルトのファイルを全部削除する：
   - ファイルを右クリック →「Delete」
4. ダウンロードした `manga-shelf.zip` を右クリック →「すべて展開」
5. 展開した `manga-shelf` フォルダの**中身を全部選択**して、StackBlitzの左ファイルツリーに**ドラッグ＆ドロップ**
   - `src/`・`api/`・`index.html`・`package.json` などが並んでいればOK
6. 左上メニュー「Connect Repository」をクリック
7. 「Create new repository」→ 名前 `manga-shelf` → 「Create」
8. これでGitHubに自動的にコードが保存される

---

## STEP 2：Firebaseでデータベースを作成（無料）

1. https://console.firebase.google.com を開く（Googleアカウントでログイン）
2. 「プロジェクトを作成」→ 名前：`manga-shelf` →「続行」×2
3. 左メニュー「構築」→「Firestore Database」→「データベースを作成」
   - ロケーション：`asia-northeast1`（東京）
   - 「本番環境モード」で作成
4. 作成後、上の「**ルール**」タブをクリック
5. 表示されているテキストを**全部消して**、以下を貼り付けて「公開」：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shared/{document} {
      allow read, write: if true;
    }
  }
}
```

6. 左メニューの⚙️「プロジェクトの設定」→「全般」タブ
7. ページ下部「マイアプリ」→「</>」（ウェブ）アイコンをクリック
8. ニックネーム（例：`manga-web`）を入力 →「アプリを登録」
9. 表示される `firebaseConfig` の値を**メモ帳にコピー**しておく：

```
apiKey: "AIzaSy..."
authDomain: "manga-shelf-xxx.firebaseapp.com"
projectId: "manga-shelf-xxx"
storageBucket: "manga-shelf-xxx.appspot.com"
messagingSenderId: "123456789"
appId: "1:123...:web:abc..."
```

---

## STEP 3：Anthropic APIキーを取得

1. https://console.anthropic.com を開く（アカウントがなければ無料で作成）
2. 左メニュー「API Keys」→「Create Key」
3. 名前（例：`manga-shelf`）を入力 → 作成
4. 表示された `sk-ant-...` のキーをメモ帳に保存
   - ⚠️ このキーはこの画面を閉じると二度と表示されないので必ず保存

---

## STEP 4：Vercelでデプロイ

1. https://vercel.com を開いて「Continue with GitHub」でログイン
2. 「Add New…」→「Project」
3. `manga-shelf` リポジトリの「Import」をクリック
4. 「Environment Variables」の欄に以下を**1つずつ**追加：
   - 「Name」欄にキー名、「Value」欄に値を入れて「Add」を押す

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...`（STEP3でコピーしたもの） |
| `VITE_FIREBASE_API_KEY` | firebaseConfigの `apiKey` の値 |
| `VITE_FIREBASE_AUTH_DOMAIN` | firebaseConfigの `authDomain` の値 |
| `VITE_FIREBASE_PROJECT_ID` | firebaseConfigの `projectId` の値 |
| `VITE_FIREBASE_STORAGE_BUCKET` | firebaseConfigの `storageBucket` の値 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | firebaseConfigの `messagingSenderId` の値 |
| `VITE_FIREBASE_APP_ID` | firebaseConfigの `appId` の値 |

5. 「**Deploy**」をクリック
6. 2〜3分後に `https://manga-shelf-xxx.vercel.app` のURLが発行される 🎉

---

## STEP 5：iPhoneのホーム画面に追加

1. iPhoneの **Safari** でVercelのURLを開く（ChromeやFirefoxでは追加できないので注意）
2. 画面下の「共有」ボタン（□から↑が出てるアイコン）をタップ
3. 「ホーム画面に追加」→「追加」
4. ホーム画面にアイコンが追加されてアプリのように使える

---

## 注意事項

- **URLの共有**：発行されたVercelのURLを家族に送るだけで全員が同じデータを共有できます
- **Firebaseのルール**：URLを知っている人なら誰でもデータを見られる設定です。不特定多数には公開しないよう注意してください
- **APIの費用**：漫画の検索・最新巻チェックにAnthropicのAPIを使います。1回あたり数円程度ですが、https://console.anthropic.com で使用量を確認できます
