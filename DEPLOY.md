# 手動デプロイ手順

Firebase Hosting へのデプロイを手動で行う手順です。

## 1. Firebaseへのログイン (初回のみ)

開発環境(WSL/コンテナ)から認証を行うため、以下のコマンドを実行してログインします。

```bash
npx -y firebase-tools login --no-localhost
```

コマンドを実行すると認証用URLが表示されます。
1. 表示されたURLをブラウザで開きます。
2. Googleアカウントでログインし、許可します。
3. 表示された認証コードをコピーします。
4. ターミナルに認証コードを貼り付けて Enter を押します。

## 2. アプリケーションのビルド

Next.js アプリケーションをビルドし、静的ファイル(`out` ディレクトリ)を生成します。

```bash
npm run build
```

## 3. デプロイの実行

ビルドしたファイルを Firebase Hosting にアップロードします。

```bash
npx -y firebase-tools deploy --only hosting
```

完了すると `Hosting URL: https://...` と表示され、公開URLにアクセスできるようになります。
