# 金融貓咪大作戰 (catfight)

答題賺分數、召喚貓咪推塔的單線塔防遊戲。手機直向瀏覽器優先，桌面可玩，可加到主畫面（PWA）。

- 上半：Phaser 戰場。下半：持續出現的四選一金融題。答對 +10 分（分析師貓在場 +5），分數用來召喚單位。
- **關卡模式**：關卡依題庫分類輪流出現（A、B、C、A、B、C…），同分類再出現時對手更強；首次通關給點數解鎖新貓咪。
- **對戰模式**：選題型配對其他玩家，對手的「每秒得分效率」轉成 AI 出兵速度；勝 +25 / 負 −15 積分，有排行榜。

## 專案結構

```
packages/engine   純 TS 戰鬥模擬（確定性、可無頭跑）＋ AI ＋ 關卡表 ＋ 平衡測試
packages/server   Fastify + PostgreSQL(pg；測試與本機開發可用內嵌 PGlite) + bcrypt + JWT；也服務前端靜態檔
packages/web      Vite + Phaser 3 + DOM UI
data/questions    題庫 JSON（每檔一個分類，*.json 不進 git，格式見該目錄 README）
tools/gen_art.py  用本機 ComfyUI（Z-Image Turbo）產生單位／塔／背景素材
deploy/           Caddyfile 與 GCP VM 部署腳本
```

## 本機開發

```bash
npm install
npm test                      # engine + server 測試
npm run balance -w @catfight/engine   # 平衡模擬報表
npm run build -w @catfight/web
# 不想開 Docker：用內嵌 PGlite（資料存 volumes/pglite）
JWT_SECRET=dev DATABASE_URL=pglite://volumes/pglite WEB_DIR=packages/web/dist QUESTIONS_DIR=data/questions npx tsx packages/server/src/main.ts
# 或接真正的 PostgreSQL：DATABASE_URL=postgres://user:pass@localhost:5432/catfight
# 打開 http://localhost:8080
```

前端熱更新：另開 `npm run dev -w @catfight/web`（port 5173，/api 代理到 8080）。

煙霧測試（需伺服器已在 8080）：

```bash
cd packages/web && npx playwright install chromium && npx playwright test
```

## 題庫

題庫從空開始。`data/questions/<分類id>.json` 一檔一分類（格式見 [data/questions/README.md](data/questions/README.md)），
伺服器每次啟動自動匯入（以分類＋題目文字去重），加題只要放檔案、`docker compose restart app`。
手動驗證與匯入：`DATABASE_URL=… npm run import-questions -w @catfight/server -- data/questions`。

- **關卡**由分類依 `sortOrder` 輪流產生：第 1 關分類 A、第 2 關分類 B、…、輪完一圈回到 A，AI 出兵速度隨關卡數遞增（每個分類 5 輪）。
- 每場都從分類中隨機抽題，**選項順序每次送出都重新洗牌**。

⚠ 放考古題前請注意著作權，正式營運建議改寫或取得授權。

## 強化系統

每隻貓三條軌道，各 0–10 級，用關卡點數購買（第 N 級 20+10N 點）：

| 軌道 | 效果 |
|---|---|
| 生命 | 最大血量 +10%×N |
| 攻擊 | 傷害 +10%×N |
| 存款貓特技 | 近戰命中額外造成自身最大血量 1%×N |
| 債券貓特技 | 射程 +2×N |
| 衍生品貓特技 | 攻擊 +N |
| 分析師貓特技 | 死亡後加分效果延續 0.2×N 秒 |
| 高頻貓特技 | 在場時對手攻速 −2%×N |
| 保險貓特技 | 每秒補血 +0.5×N |

數值在 `packages/engine/src/upgrades.ts`；AI 對手不吃強化。

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
cp .env.example .env    # 填 JWT_SECRET、POSTGRES_PASSWORD；SITE_ADDRESS 有網域就填網域，Caddy 會自動申請 HTTPS
docker compose up -d --build
```

- PostgreSQL 資料在 `./volumes/postgres`（本地 volume），Caddy 憑證在 `./volumes/caddy`，題庫目錄 `./data/questions` 唯讀掛進容器。
- 更新：`git pull && docker compose up -d --build`。

GCP VM（pressure-507503 / asia-east1-b / stress）一鍵部署：

```bash
bash deploy/deploy.sh
```

會把 git HEAD 打包 scp 到 `/opt/catfight`，第一次自動裝 Docker 並產生 `.env`，然後 `docker compose up -d --build`。
