# Web公開（デプロイ）手順書

このアプリケーションをGitHubにアップロードし、Vercelを使ってWeb上に公開するための手順です。

## 1. 前提条件の確認 (Gitのインストール)

ターミナルで以下のコマンドを実行し、Gitがインストールされているか確認してください。

```bash
git --version
```

もしエラーが出る場合（例: `git : 用語 'git' は...`）、[Git公式サイト](https://git-scm.com/downloads)からWindows版をダウンロードしてインストールしてください。

## 2. GitHubリポジトリの作成

1.  [GitHub](https://github.com)にログインします。
2.  右上の「+」アイコンから「New repository」を選択します。
3.  **Repository name** に名前（例: `network-training-app`）を入力します。
4.  **Public**（誰でも閲覧可能）または **Private**（自分のみ）を選択します。
5.  「Create repository」ボタンをクリックします。

## 3. ローカルプロジェクトのGit初期化

VSCodeのターミナル（またはコマンドプロンプト）で、プロジェクトのルートディレクトリ（`network-training-app`）にて以下のコマンドを順に実行します。

```bash
# Gitの初期化
git init

# すべてのファイルをステージング
git add .

# 初期コミット
git commit -m "Initial commit"
```

## 4. GitHubへのプッシュ

GitHubでリポジトリを作成した後に表示されるコマンドを実行します。`<username>` と `<repo>` は自分のものに置き換えてください。

```bash
# ローカルリポジトリとGitHubリポジトリを紐付け
git remote add origin https://github.com/<username>/<repo>.git

# メインブランチ名を 'main' に変更（推奨）
git branch -M main

# GitHubへプッシュ
git push -u origin main
```

## 5. Vercelへのデプロイ (推奨)

Next.jsアプリケーションは、Vercelを使うと最も簡単にデプロイできます。

1.  [Vercel](https://vercel.com)にアクセスし、GitHubアカウントでログインします。
2.  ダッシュボードの「Add New...」から「Project」を選択します。
3.  先ほど作成したGitHubリポジトリ（`network-training-app`）の横にある「Import」をクリックします。
4.  設定画面が表示されますが、デフォルトのままで「Deploy」をクリックします。
5.  数分待つとビルドが完了し、公開URLが発行されます。

## 6. 公開アプリケーションの更新方法

コードを修正した後は、以下のコマンドを実行することでGitHubに変更をプッシュでき、Vercel側でも自動的に再デプロイ（更新）が行われます。

```bash
# 変更ファイルをステージング
git add .

# 変更内容をコミット（メッセージは適宜変更してください）
git commit -m "Update application"

# GitHubへプッシュ（Vercelへの自動デプロイがトリガーされます）
git push
```

## 7. 公開URLの変更 (カスタムドメインの設定)

公開URLを `https://baudroie-network-training-app.vercel.app/` に設定する手順です。

1.  Vercelのダッシュボードで、対象のプロジェクト (`network-training-app`) を開きます。
2.  上部のタブから **Settings** をクリックします。
3.  左側メニューの **Domains** を選択します。
4.  **Domains** 設定画面で、現在のドメインの横にある **Edit** ボタンをクリックします（または Add します）。
5.  ドメイン名を **`baudroie-network-training-app.vercel.app`** に変更し、保存します。

※ 名前が他ですでに使われている場合はエラーになりますが、その場合は少し違う名前を試してください。
