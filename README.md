# 金融貓咪大作戰 (catfight)

答題賺分數、召喚貓咪推塔的單線塔防遊戲。手機直向瀏覽器優先，桌面可玩，可加到主畫面（PWA）。

- 上半：Phaser 戰場。下半：持續出現的四選一金融題。答對 +10 分（分析師貓在場 +5），分數用來召喚單位。
- **關卡模式**：8 關固定題型，首次通關給點數解鎖新貓咪。
- **對戰模式**：選題型配對其他玩家，對手的「每秒得分效率」轉成 AI 出兵速度；勝 +25 / 負 −15 積分，有排行榜。

## 專案結構

```
packages/engine   純 TS 戰鬥模擬（確定性、可無頭跑）＋ AI ＋ 關卡表 ＋ 平衡測試
packages/server   Fastify + SQLite(better-sqlite3) + bcrypt + JWT；也服務前端靜態檔
packages/web      Vite + Phaser 3 + DOM UI
data/questions    題庫 JSON（每檔一個分類）
tools/gen_art.py  用本機 ComfyUI（Z-Image Turbo）產生單位／塔／背景素材
deploy/           Caddyfile 與 GCP VM 部署腳本
```

## 本機開發

```bash
npm install
npm test                      # engine + server 測試
npm run balance -w @catfight/engine   # 平衡模擬報表
npm run build -w @catfight/web
JWT_SECRET=dev DATA_DIR=volumes/data WEB_DIR=packages/web/dist QUESTIONS_DIR=data/questions npx tsx packages/server/src/main.ts
# 打開 http://localhost:8080
```

前端熱更新：另開 `npm run dev -w @catfight/web`（port 5173，/api 代理到 8080）。

煙霧測試（需伺服器已在 8080）：

```bash
cd packages/web && npx playwright install chromium && npx playwright test
```

## 題庫

`data/questions/*.json`，格式：

```json
{ "category": "bank_law", "text": "…", "options": ["A","B","C","D"], "answerIndex": 1, "explanation": "…", "source": "…" }
```

分類：`finance_basics` 金融常識、`bank_law` 銀行法規、`trust` 信託實務、`wealth` 理財規劃、`news` 財金時事。
伺服器每次啟動會把目錄裡的題目 upsert 進 SQLite（以分類＋題目文字去重），所以加題只要放檔案、重啟容器。
手動匯入：`npm run import-questions -w @catfight/server -- <db 路徑> <目錄>`。

⚠ 目前種子題為自行撰寫的練習題。若要放金研院考古題，正式營運前請注意著作權，建議改寫或取得授權。

## 美術

```bash
python tools/gen_art.py            # 全部；--only tank,archer 只重生部分；需要 ComfyUI 在 127.0.0.1:8188
```

輸出到 `packages/web/public/assets/`。

## 平衡調整

所有數值集中在 `packages/engine/src/units.ts`、`battle.ts`（`BALANCE`）、`stages.ts`。
改完跑 `npm run balance -w @catfight/engine` 與 `npm test -w @catfight/engine`；
驗收條件是兩個「每題 4 秒、正確率 70%」的玩家對打，中位數 30–50 題分勝負。

## 部署（Docker）

```bash
cp .env.example .env    # 填 JWT_SECRET；SITE_ADDRESS 有網域就填網域，Caddy 會自動申請 HTTPS
docker compose up -d --build
```

- SQLite 在 `./volumes/data/catfight.db`（本地 volume），Caddy 憑證在 `./volumes/caddy`。
- 更新：`git pull && docker compose up -d --build`。

GCP VM（pressure-507503 / asia-east1-b / stress）一鍵部署：

```bash
bash deploy/deploy.sh
```

會把 git HEAD 打包 scp 到 `/opt/catfight`，第一次自動裝 Docker 並產生 `.env`，然後 `docker compose up -d --build`。
