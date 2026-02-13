---
description: browser_subagent用にCDPモードでChromeを起動する（WSL2環境）
---
# Browser Subagent用 Chrome起動

WSL2環境で browser_subagent を使用するために、CDPモードでブラウザを起動します。

## 手順
1. 既存のブラウザプロセスを終了し、CDPモードで再起動:
```bash
pkill -f chrome; google-chrome-stable --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir=~/chrome-data &
```
