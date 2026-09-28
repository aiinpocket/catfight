# 金融貓咪大作戰 (catfight)

答金融題賺分數、召喚貓咪推塔的單線塔防遊戲。手機直向瀏覽器優先，桌面也能玩。

正式站：**https://bank.aiinpocket.com/**

## 玩法

- 螢幕上半是 Phaser 戰場，下半持續出現四選一金融題。答對 +10 分（分析師貓在場再 +5），分數拿來召喚單位；打掉對方城堡就贏。
- 答錯會亮出正確答案並停留 1.2 秒，戰後可以回顧錯題。每場載入 50 題，答到一半自動預抓下一批，每 50 題顯示一次正確率。
- **關卡模式**：100 關。分類依題庫 `sortOrder` 輪流出現（A、B、A、B…），AI 出兵速度隨關卡遞增。每關有一隻戰國名將喵 BOSS，各有專屬技能（雜賀喵定點貫穿狙擊、真田喵同目標疊傷、豐臣喵召喚……）。首次通關給點數，用來解鎖與強化貓咪。
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
tools/            tabf_import.py（金研院考古題 PDF → 題庫）、gen_art.py / gen_bosses.py（ComfyUI 產圖）
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

題庫從空開始，repo 內不含任何題目。`data/questions/<分類id>.json` 一檔一分類（格式見 [data/questions/README.md](data/questions/README.md)），伺服器每次啟動自動匯入：

- 去重鍵是（分類、題幹、選項），同題幹不同選項視為不同題；重匯同一題會更新答案與出處，修正題庫只要改 JSON 再重啟。
- 每場從分類中隨機抽題，**選項順序每次送出都重新洗牌**。
- 關卡由分類依 `sortOrder` 輪流產生，AI 出兵速度隨關卡數遞增。

手動匯入：`DATABASE_URL=… npm run import-questions -w @catfight/server -- data/questions`。

### 匯入金研院考古題

```bash
# 兩節試題 + 答案卷（<id>-1.pdf、<id>-2.pdf 試題，<id>-3.pdf 答案），例如家族信託規劃顧問
python tools/tabf_import.py --dir data/pdf/family_trust --ids 663415,644264,617843 \
  --category family_trust --name 家族信託規劃顧問 --sort 1 --out data/questions/family_trust.json

# 單節橫式雙欄試題 + 答案卷（<id>-1.pdf 試題，<id>-2.pdf 答案），例如金融科技力
python tools/tabf_import.py --dir data/pdf/fintech --ids 663416,644266,617844 --layout single2col \
  --category fintech --name 金融科技力 --sort 2 --out data/questions/fintech.json
```

複選題與解析失敗的題目會列出並略過。`bash deploy/deploy.sh` 會把 `data/questions/*.json` 一併上傳到 VM。

⚠ 考古題著作權屬原出題單位，正式營運前請確認授權。

## BOSS 與難度

`packages/engine/src/bosses.ts`：100 隻名將喵的名稱、外觀提示、技能與屬性型態，數值隨關卡自動縮放。19 種技能：狙擊貫穿、同目標疊傷、衝鋒首擊、護甲、回血、召喚、減攻速光環、擊退、閃避、狂暴、殘血強化、吸血、破城、偷分、處決、死後分裂、治療友軍、範圍攻擊、復活一次。

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

會把 git HEAD 打包 scp 到 VM 的 `/opt/catfight`，第一次自動裝 Docker 並產生 `.env`，然後 `docker compose up -d --build`。

## 貢獻

`main` 受分支保護，所有變更請開 Pull Request。組織外的貢獻者請 fork 後發 PR。送 PR 前請確認 `npm test` 全綠。

## 授權

程式碼採 MIT 授權（見 [LICENSE](LICENSE)）。遊戲美術與題庫不在此授權範圍內。
