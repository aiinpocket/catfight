# 金融貓咪大作戰 (catfight)

答金融題賺分數、召喚貓咪推塔的單線塔防遊戲。手機直向瀏覽器優先，桌面也能玩。

正式站：**https://bank.aiinpocket.com/**

## 玩法

- 螢幕上半是 Phaser 戰場，下半持續出現四選一金融題。答對 +10 分（分析師貓在場再 +5），分數拿來召喚單位；打掉對方城堡就贏。
- 答錯會亮出正確答案並停留 1.2 秒，戰後可以回顧錯題。每場載入 50 題，答到一半自動預抓下一批，每 50 題顯示一次正確率。
- **關卡模式**：100 關全部開放，玩家只挑自己要考的科目打。分類依題庫 `sortOrder` 輪流出現（A、B、A、B…），AI 出兵速度隨關卡遞增。每關有一隻戰國名將喵 BOSS，各有專屬技能（雜賀喵定點貫穿狙擊、真田喵同目標疊傷、豐臣喵召喚……）。每關首次通關給 50+10N 點、之後每次通關給四分之一，點數用來解鎖與強化貓咪。
- **對戰模式**：選一種題型配對其他玩家，用對手在該題型的「每秒得分效率」驅動 AI 出兵。勝 +25 / 負 −15 積分，有排行榜。
- 六種貓：存款貓（坦）、債券貓（遠程）、衍生品貓（範圍）、分析師貓（加分光環）、高頻貓（加速光環）、保險貓（補血光環）。

### 強化系統

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

## 專案結構

```
packages/engine   純 TS 戰鬥模擬（確定性、可無頭跑）＋ AI ＋ 關卡表 ＋ BOSS ＋ 平衡測試
packages/server   Fastify 5 + PostgreSQL（pg；測試與本機開發可用內嵌 PGlite）+ bcrypt + JWT；也服務前端靜態檔
packages/web      Vite + Phaser 3 + DOM UI，Playwright 煙霧測試
data/questions    題庫 JSON（每檔一個分類；*.json 不進 git，格式見該目錄 README）
tools/            tabf_import.py（考古題 PDF → 題庫 JSON，可選）、gen_art.py / gen_bosses.py（ComfyUI 產圖）
deploy/           Caddyfile 與 GCP VM 部署腳本
docs/superpowers/specs  設計文件
```

npm workspaces 單一 repo，Node 22。

## 本機開發

```bash
npm install
npm test                                  # engine + server 測試
npm run build -w @catfight/web
# 不想開 Docker：用內嵌 PGlite（資料存 volumes/pglite）
JWT_SECRET=dev DATABASE_URL=pglite://volumes/pglite WEB_DIR=packages/web/dist QUESTIONS_DIR=data/questions npx tsx packages/server/src/main.ts
# 或接真正的 PostgreSQL：DATABASE_URL=postgres://user:pass@localhost:5432/catfight
# 打開 http://localhost:8080
```

前端熱更新：另開 `npm run dev -w @catfight/web`（port 5173，/api 代理到 8080）。

煙霧測試（需伺服器已在 8080；`BASE_URL` 可指向其他環境）：

```bash
cd packages/web && npx playwright install chromium && npx playwright test
```

## 題庫

**這個 repo 只含遊戲系統，不含任何題目**：題庫從空開始，部署後自行加題。`data/questions/<分類id>.json` 一檔一分類（格式見 [data/questions/README.md](data/questions/README.md)；`*.json`、`data/pdf/`、`data/*.xlsx` 都被 `.gitignore` 排除，不會被 commit 進來），伺服器每次啟動自動匯入：

- 去重鍵是（分類、題幹、選項），同題幹不同選項視為不同題；重匯同一題會更新答案與出處，修正題庫只要改 JSON 再重啟。
- 每場從分類中隨機抽題，**選項順序每次送出都重新洗牌**；「以上皆是／甲、乙、丙皆非」這類總結型選項固定留在最後。
- 關卡由分類依 `sortOrder` 輪流產生，AI 出兵速度隨關卡數遞增。
- 同一個分類 id 可以拆成多個檔案（例如不同來源各一檔），匯入時會合併。

事先驗證格式與試匯入（不需要 Docker，用內嵌 PGlite）：

```bash
DATABASE_URL=pglite://volumes/pglite-check npm run import-questions -w @catfight/server
```

### 從考古題 PDF 產生題庫（可選）

`tools/tabf_import.py` 能把台灣金融研訓院（TABF）與證基會（SFI）公開的考古題 PDF 轉成上述 JSON（需要 `pip install pdfplumber`）。PDF 放在 `data/pdf/<分類>/`，依版型選 `--layout`：

```bash
# two-session（預設）：<id>-1.pdf、<id>-2.pdf 兩節試題 + <id>-3.pdf 答案（金研院直式）
python tools/tabf_import.py --dir data/pdf/<分類> --ids <id1>,<id2> \
  --category <分類id> --name <分類名稱> --sort 1 --out data/questions/<分類id>.json

# single2col：<id>-1.pdf 單節橫式雙欄試題 + <id>-2.pdf 答案（金研院橫式）；每屆 80 題的科目加 --count 80
python tools/tabf_import.py --dir data/pdf/<分類> --ids <id1>,<id2> --layout single2col --count 80 \
  --category <分類id> --name <分類名稱> --sort 2 --out data/questions/<分類id>.json

# sfi：<id>.pdf 直式單欄 (A)-(D) 選項 + <id>a.pdf 答案表（證基會 examweb.sfi.org.tw）
python tools/tabf_import.py --dir data/pdf/<分類> --ids <id1>,<id2> --layout sfi --count 80 \
  --category <分類id> --name <分類名稱> --sort 3 --out data/questions/<分類id>_sfi.json
```

複選題、送分題與解析失敗的題目會列出並略過。`bash deploy/deploy.sh` 會把本機 `data/questions/*.json` 一併上傳到 VM；只更新題庫沒改程式時，記得在 VM 上 `docker compose restart app` 才會重新匯入。

⚠ 考古題著作權屬原出題單位，請自行確認可否使用；本 repo 不提供也不散布任何題目。

## BOSS 與難度

`packages/engine/src/bosses.ts`：100 隻名將喵的名稱、外觀提示、技能與屬性型態，數值隨關卡自動縮放。**關卡順序依史實退場年份**（每筆的 `died`）由早到晚：第 1 關太田道灌（1486 年歿），織田信長在第 31 關，德川家康第 86 關，最後一關是活到 1658 年的真田信之；新增 BOSS 時請維持排序，美術檔 `assets/boss/boss_<關卡>.png` 跟著關卡編號。19 種技能：狙擊貫穿、同目標疊傷、衝鋒首擊、護甲、回血、召喚、減攻速光環、擊退、閃避、狂暴、殘血強化、吸血、破城、偷分、處決、死後分裂、治療友軍、範圍攻擊、復活一次。

BOSS 由 AI 在 `stageAi(n).boss.atMs` 免費派出（第 1 關 20 秒，後期提早到 12 秒），第 60 關起死後 60 秒復活。整體難度只改兩處：`stages.ts` 的 `STAGE_TUNE`（AI 收入曲線、暖機、復活關卡）與 `bosses.ts` 的 `BOSS_TUNE`（BOSS 血量／攻擊倍率）。

## 平衡調整

所有數值集中在 `packages/engine/src/units.ts`、`battle.ts`（`BALANCE`）、`stages.ts`、`bosses.ts`。改完跑：

```bash
npm run balance -w @catfight/engine     # 無頭模擬報表（對戰與各關卡勝率）
npm test -w @catfight/engine            # 含平衡驗收測試
```

驗收條件：兩個「每題 4 秒、正確率 70%」的玩家對打，中位數 30–50 題分勝負；第 1 關對平均玩家勝率 >75%。

## 美術

單位、城堡與背景由本機 ComfyUI（Z-Image Turbo）產生，輸出到 `packages/web/public/assets/`：

```bash
python tools/gen_art.py                  # 全部；--only tank,archer 只重生部分；需要 ComfyUI 在 127.0.0.1:8188
python tools/gen_bosses.py <bosses.json> # 100 隻 BOSS，先用 engine 把 BOSS_LIST 匯出成 JSON
```

## 部署（Docker）

```bash
cp .env.example .env    # 填 JWT_SECRET、POSTGRES_PASSWORD；SITE_ADDRESS 有網域就填網域，Caddy 會自動申請 HTTPS
docker compose up -d --build
```

- PostgreSQL 資料在 `./volumes/postgres`，Caddy 憑證在 `./volumes/caddy`，題庫目錄 `./data/questions` 唯讀掛進容器。
- 更新：`git pull && docker compose up -d --build`。

正式站跑在 GCP VM 上，流量走 Cloudflare Tunnel（VM 上的 `cloudflared` systemd 服務 → `localhost:80` Caddy），防火牆不開 80/443，SSH 只接受金鑰。一鍵部署：

```bash
bash deploy/deploy.sh
```

會把 git HEAD 打包 scp 到 VM 的 `/opt/catfight`，第一次自動裝 Docker 並產生 `.env`，先 `docker compose build`，再查 `/api/health` 的 `activeBattles`：有人正在對戰就每 15 秒重試、最多等 `WAIT_MAX`（預設 600 秒）才換容器，超時中止；`FORCE=1` 跳過等待。前端在對戰中每 30 秒送一次心跳，結算送出失敗會自動重試，題目也是預抓的，所以換版時的幾秒重啟不會中斷進行中的考試。

## 貢獻

`main` 受分支保護，所有變更請開 Pull Request。組織外的貢獻者請 fork 後發 PR。送 PR 前請確認 `npm test` 全綠。

## 授權

程式碼採 MIT 授權（見 [LICENSE](LICENSE)）。遊戲美術與題庫不在此授權範圍內。
