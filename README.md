# 金融貓咪大作戰 (catfight)

答題賺分數、召喚貓咪推塔的答題塔防遊戲。**題庫由你自己提供**：這個 repo 只有遊戲系統，沒有任何題目，部署後把自己的四選一題目放進 `data/questions/`，重啟就能玩。原本是為金融證照考試做的，但任何單選四選一的題庫都適用。

手機直向瀏覽器優先，桌面也能玩。展示站：https://bank.aiinpocket.com/

## 特色

- **答題驅動戰鬥**：上半是 Phaser 戰場，下半連續出四選一題。答對得分、分數召喚貓咪、推倒對方城堡。
- **題庫完全自訂**：一個分類一個 JSON 檔，啟動自動匯入；重匯會更新答案，去重不會重複出題。
- **關卡模式**：100 關，各分類依序輪流出題，難度遞增，每關一隻戰國名將喵 BOSS（19 種技能）。
- **對戰模式**：選一種題型配對其他玩家，以對手在該題型的答題效率驅動 AI，含積分與排行榜。
- **成長系統**：六種貓、三條強化軌道各 10 級，用通關點數購買。
- **自架簡單**：Docker Compose 三個容器（PostgreSQL、遊戲伺服器、Caddy），一個 `.env` 就能跑。
- 帳號只需帳號與密碼（bcrypt），不收集其他個資。

## 快速開始（Docker）

```bash
git clone https://github.com/aiinpocket/catfight.git && cd catfight
cp .env.example .env          # 填 JWT_SECRET、POSTGRES_PASSWORD
# 放至少一個題庫檔到 data/questions/（格式見下一節）
docker compose up -d --build
```

預設 Caddy 只綁 `127.0.0.1:80`，適合前面放 Cloudflare Tunnel 或其他反向代理。要直接對外服務，在 `.env` 加上：

```
CADDY_HTTP_BIND=80
CADDY_HTTPS_BIND=443
SITE_ADDRESS=quiz.example.com    # Caddy 會自動申請 HTTPS 憑證
```

更新版本：`git pull && docker compose up -d --build`。只更新題庫沒改程式：`docker compose restart app`。

資料都在本機目錄：PostgreSQL 在 `./volumes/postgres`，Caddy 憑證在 `./volumes/caddy`，題庫目錄 `./data/questions` 唯讀掛進容器。

## 加入題目

`data/questions/<分類id>.json`，一檔一分類（同一個分類 id 可以拆多檔，匯入時合併）：

```json
{
  "category": { "id": "finance_basics", "name": "金融常識", "sortOrder": 1 },
  "questions": [
    {
      "text": "題目文字",
      "options": ["選項一", "選項二", "選項三", "選項四"],
      "answerIndex": 0,
      "explanation": "解析（選填）",
      "source": "來源（選填）"
    }
  ]
}
```

- `id` 只能用小寫英數、`_`、`-`；`sortOrder` 決定關卡輪流順序（第 1 關 = 最小的分類，第 2 關 = 次小……輪完再從頭）。
- `options` 一定要四個，`answerIndex` 是正確答案在這個檔案裡的位置（0–3）。
- 遊戲中每次出題都會重新洗牌選項，所以不用刻意打亂；「以上皆是」「甲、乙、丙皆非」這類總結型選項會自動固定在最後。
- 去重鍵是（分類、題幹、選項）。改答案或出處只要改 JSON 再重啟；同題幹不同選項視為不同題。
- `*.json`、`data/pdf/`、`data/*.xlsx` 都在 `.gitignore`，題庫不會被 commit 進 repo，請自行備份。

匯入前先驗證格式（不需要 Docker，用內嵌 PGlite）：

```bash
DATABASE_URL=pglite://volumes/pglite-check npm run import-questions -w @catfight/server
```

### 從考古題 PDF 轉題庫（可選）

`tools/tabf_import.py` 可以把台灣金融研訓院（TABF）與證基會（SFI）公開的考古題 PDF 轉成上述格式，需要 `pip install pdfplumber`。PDF 放 `data/pdf/<分類>/`，依版型選 `--layout`：

| layout | 試題檔 | 答案檔 | 典型來源 |
|---|---|---|---|
| `two-session`（預設） | `<id>-1.pdf`、`<id>-2.pdf` 兩節直式 | `<id>-3.pdf` 兩欄 | 金研院多節測驗 |
| `single2col` | `<id>-1.pdf` 橫式雙欄 | `<id>-2.pdf` 單欄 | 金研院單節測驗 |
| `sfi` | `<id>.pdf` 直式單欄，(A)–(D) 選項 | `<id>a.pdf` 五欄表 | 證基會 examweb.sfi.org.tw |

```bash
python tools/tabf_import.py --dir data/pdf/<分類> --ids <id1>,<id2> --layout sfi --count 80 \
  --category <分類id> --name <分類名稱> --sort 1 --out data/questions/<分類id>.json
```

`--count` 是每節題數（預設 60）。複選題、送分題與解析失敗的題目會列出並略過。

⚠ 考古題著作權屬原出題單位，請自行確認可否使用。本 repo 不提供也不散布任何題目。

## 玩法

- 答對 +10 分（分析師貓在場再 +5），分數拿來召喚單位；打掉對方城堡就贏。
- 答錯會亮出正確答案並停留 1.2 秒，戰後可以回顧錯題。每場載入 50 題並自動預抓下一批，每 50 題顯示一次正確率。
- **關卡模式**：100 關全部開放，玩家只挑自己要考的科目。AI 出兵速度隨關卡遞增；每關首次通關給 50+10N 點，之後每次給四分之一。
- **對戰模式**：勝 +25 / 負 −15 積分。
- 六種貓：存款貓（坦）、債券貓（遠程）、衍生品貓（範圍）、分析師貓（加分光環）、高頻貓（加速光環）、保險貓（補血光環）。

### 強化

每隻貓三條軌道各 0–10 級，第 N 級花 20+10N 點：

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

## 本機開發

需要 Node 22。npm workspaces 單一 repo。

```bash
npm install
npm test                                  # engine + server 測試
npm run build -w @catfight/web
# 不開 Docker：用內嵌 PGlite（資料存 volumes/pglite）
JWT_SECRET=dev DATABASE_URL=pglite://volumes/pglite WEB_DIR=packages/web/dist QUESTIONS_DIR=data/questions npx tsx packages/server/src/main.ts
# 或接真正的 PostgreSQL：DATABASE_URL=postgres://user:pass@localhost:5432/catfight
# 打開 http://localhost:8080
```

前端熱更新：另開 `npm run dev -w @catfight/web`（port 5173，`/api` 代理到 8080）。

煙霧測試（需伺服器已在 8080；`BASE_URL` 可指向其他環境）：

```bash
cd packages/web && npx playwright install chromium && npx playwright test
```

### 環境變數

| 變數 | 說明 |
|---|---|
| `JWT_SECRET` | 必填，簽登入 token 用 |
| `DATABASE_URL` | `postgres://…` 或 `pglite://<目錄>`（內嵌 Postgres，開發與測試用） |
| `PORT` | 伺服器埠，預設 8080 |
| `QUESTIONS_DIR` | 題庫目錄，預設 `data/questions` |
| `WEB_DIR` | 前端 build 輸出目錄，伺服器一併服務靜態檔 |
| `POSTGRES_PASSWORD`、`SITE_ADDRESS`、`CADDY_HTTP_BIND`、`CADDY_HTTPS_BIND` | 只給 docker compose 用，見 `.env.example` |

## 專案結構

```
packages/engine   純 TS 戰鬥模擬（確定性、可無頭跑）＋ AI ＋ 關卡表 ＋ BOSS ＋ 平衡測試
packages/server   Fastify 5 + PostgreSQL（測試與本機開發可用內嵌 PGlite）+ bcrypt + JWT；也服務前端靜態檔
packages/web      Vite + Phaser 3 + DOM UI，Playwright 煙霧測試
data/questions    題庫 JSON（不進 git）
tools/            tabf_import.py（考古題 PDF → 題庫，可選）、gen_art.py / gen_bosses.py（ComfyUI 產圖，可選）
deploy/           Caddyfile 與 GCP VM 一鍵部署腳本
docs/superpowers/specs  設計文件
```

API 一覽：`/api/auth/register`、`/api/auth/login`、`/api/me`、`/api/categories`、`/api/questions`、`/api/stages`、`/api/units`、`/api/unlock`、`/api/upgrade`、`/api/match/opponent`、`/api/match/result`、`/api/battle/heartbeat`、`/api/leaderboard`、`/api/health`。

## 客製化

**BOSS 與難度**：`packages/engine/src/bosses.ts` 是 100 隻名將喵的名稱、外觀提示、技能與屬性，數值隨關卡自動縮放。關卡順序依史實退場年份（`died`）由早到晚，新增 BOSS 請維持排序，美術檔 `packages/web/public/assets/boss/boss_<關卡>.png` 跟著關卡編號。難度標準在 `packages/engine/src/schedule.ts`：第 1–10 關以「每題約 7.5 秒、正確率 40%」的讀題玩家為基準，之後每 5 關基準正確率 +5%，到第 46 關達 80% 後維持。AI 的收入等於基準玩家在該正確率下的得分速度，AI 小喵（含 BOSS 召喚／分裂）的血量攻擊從 0.7 倍隨標準升到 1 倍；每關雙方起始都有 50 分，落敗也拿一半點數。BOSS 的每關倍率由 `npm run calibrate -w @catfight/engine` 用模擬二分搜尋（基準玩家約七成勝率）寫進 `bossCalibration.ts`，改過單位／BOSS／曲線後要重跑。全域旋鈕：`stages.ts` 的 `STAGE_TUNE` 與 `bosses.ts` 的 `BOSS_TUNE`。

**平衡**：數值集中在 `packages/engine/src/units.ts`、`battle.ts`（`BALANCE`）、`stages.ts`、`bosses.ts`。改完跑：

```bash
npm run calibrate -w @catfight/engine   # 逐關校準 BOSS 倍率（約 3 分鐘），寫入 src/bossCalibration.ts
npm run balance -w @catfight/engine     # 無頭模擬報表（對戰與各關卡勝率）
npm test -w @catfight/engine            # 含平衡驗收測試
```

驗收條件：兩個「每題 4 秒、正確率 70%」的玩家對打，中位數 30–50 題分勝負；基準玩家（每題 7.5 秒、該關基準正確率）在抽查關卡的勝率 ≥55%。

**美術**：單位、城堡、背景與 BOSS 圖已包含在 repo；想換風格可用本機 ComfyUI（Z-Image Turbo）重生：

```bash
python tools/gen_art.py                  # 全部；--only tank,archer 只重生部分；需要 ComfyUI 在 127.0.0.1:8188
python tools/gen_bosses.py <bosses.json> # 100 隻 BOSS，先用 engine 把 BOSS_LIST 匯出成 JSON
```

## 部署到雲端 VM（可選）

`deploy/deploy.sh` 把 git HEAD 打包連同本機 `data/questions/*.json` 一起 scp 到 GCP VM，第一次自動裝 Docker、產生 `.env`，之後每次先 build 再換容器。換容器前會查 `/api/health` 的 `activeBattles`，有人正在對戰就每 15 秒重試、最多等 `WAIT_MAX`（預設 600 秒），`FORCE=1` 跳過等待。

```bash
PROJECT=<gcp-project> ZONE=<zone> VM=<vm-name> bash deploy/deploy.sh
```

前端在對戰中每 30 秒送心跳、題目預抓、結算失敗自動重試，所以換版時的幾秒重啟不會中斷進行中的對局。展示站的 VM 前面是 Cloudflare Tunnel（`cloudflared` → `localhost:80`），所以 compose 預設只綁 localhost；其他雲或自有主機把腳本裡的 `gcloud compute ssh/scp` 換掉即可。

## 貢獻

`main` 受分支保護，所有變更請開 Pull Request，送 PR 前請確認 `npm test` 全綠。

## 授權

程式碼採 MIT 授權（見 [LICENSE](LICENSE)）。遊戲美術另計；題庫不在此 repo 內，由部署者自行提供並負責其授權。
