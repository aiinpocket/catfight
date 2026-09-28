# CatFight 金融答題推塔遊戲 — 設計規格

日期：2026-09-28

## 1. 產品概要

單線推塔遊戲（貓咪大戰風格）。畫面上半是戰場，下半持續出現四選一金融題目。
答對得分，分數是召喚單位的唯一貨幣。把對方塔打爆即獲勝。

目標平台：手機瀏覽器（直向）優先，桌面瀏覽器可玩。PWA 可加到主畫面。

### 兩種模式

| | 關卡模式 | 對戰模式 |
|---|---|---|
| 目的 | 進度 | 積分排行榜 |
| 題庫 | 每關固定分類 | 玩家選分類 |
| 對手 | 關卡腳本 AI | 隨機配對其他玩家的「每秒得分效率」轉成的 AI |
| 獎勵 | 通關給點數，點數解鎖單位 | 勝負影響積分，更新該分類效率 |

## 2. 核心迴圈

1. 戰鬥開始時前端向後端要 50 題（指定分類）。答到第 25 題時背景預抓下一批。每答完 50 題顯示本批正確率 2 秒（不打斷戰鬥）。
2. 下半螢幕顯示題目與四個選項。答對：選項亮綠 0.3 秒後換題，加 10 分（可被輔助單位加成）。答錯：正確選項亮綠、所選亮紅，停留 1.2 秒後換題，不扣分。答錯題目記錄下來，戰後結算列出。
3. 上半螢幕顯示分數與已解鎖單位按鈕，分數夠就可以點選召喚。單位從己方塔出發向對方塔前進。
4. 任一方塔血量歸零，戰鬥結束，結算。

## 3. 戰鬥規則（純 TS 模擬，與 Phaser 無關）

- 固定步長 50 ms（每秒 20 步），確定性，可在 Node 無頭執行。
- 戰場長度 1000。玩家塔在 x=0，敵方塔在 x=1000。玩家單位向右，敵方向左。
- 單位屬性：cost、hp、dps、attackRange、moveSpeed、attackType（single/area）、aura（speed/heal/scoreBonus）。
- 單位前方（射程內）有敵人或敵塔就停下攻擊，否則前進。
- 範圍攻擊打射程內所有敵人。
- 光環：加速（友軍移速 +30%）、補血（友軍每秒回 8 HP）、答題加分（每題 +5 分，多隻不疊加）。
- 塔 HP 800，塔不攻擊。攻擊為離散：每 1 秒一擊，傷害 = dps × 1。
- 加時：150 秒後雙方塔每秒流失 10 HP，保證分出勝負；同時歸零時比場上軍隊總血量、再比剩餘分數、最後以 tick 奇偶決定。
- 同種光環不疊加。

### 種子數值（由模擬校正）

| 單位 | cost | hp | dps | range | speed | 特性 |
|---|---|---|---|---|---|---|
| tank 近戰坦 | 30 | 300 | 30 | 30 | 40 | |
| archer 遠程 | 40 | 120 | 40 | 150 | 40 | |
| mage 範圍 | 80 | 150 | 25 | 100 | 40 | area |
| scholar 答題加分 | 60 | 80 | 0 | 0 | 40 | aura scoreBonus +5 |
| runner 加速光環 | 50 | 120 | 15 | 30 | 50 | aura speed +30% |
| medic 補血 | 70 | 100 | 0 | 0 | 40 | aura heal 8/s |

（2026-09-28 以無頭模擬校正後的值；模擬結果：中位數 45 題、p10 24、p90 51，左右勝率 52/48。）

### 平衡驗收

兩個「每題 4 秒、正確率 70%」的玩家用同一套簡單策略對打 1000 場，
勝負時已答題數中位數在 30 到 50 之間，p10 ≥ 20，p90 ≤ 80。

## 4. AI 對手

- 關卡模式：每關設定 `scorePerSec` 與 `strategy`（召喚順序循環）。
- 對戰模式：對手 `scorePerSec` = 被配對玩家在該分類的歷史「每秒得分」平均值；沒有對手資料時用預設值 1.75（10 分 × 70% ÷ 4 秒），顯示為「練習機器人」。
- AI 每步累積分數，依策略清單順序，分數夠就召喚。

## 5. 技術架構

```
catfight/
  packages/
    engine/    純 TS 戰鬥模擬 + 平衡模擬腳本 + 單元測試 (vitest)
    server/    Node (Fastify) + SQLite (better-sqlite3) + bcrypt + JWT
    web/       Vite + Phaser 3 + 少量 DOM UI（題目面板、登入、選單）
  data/questions/   題庫 JSON（使用者自行提供，不進 git）
  docker-compose.yml
  deploy/    VM 部署腳本
```

- `engine` 被 `web`（Phaser 用它推進並畫圖）與 `server`（驗證、AI）共用。
- Phaser 只負責繪圖與輸入，每幀呼叫 engine `step()`。

### 資料模型（SQLite）

- `users(id, username UNIQUE, display_name, password_hash, created_at)`
- `user_progress(user_id, points, unlocked_units JSON, max_stage)`
- `user_stats(user_id, category, games, wins, total_score, total_seconds)` → 效率 = total_score / total_seconds
- `match_results(id, user_id, mode, category, won, score, seconds, questions_answered, correct, created_at)`
- `questions(id, category, text, options JSON, answer_index, explanation, source)`
- `ratings(user_id, rating)` 對戰積分，ELO 簡化版：勝 +25、負 -15，最低 0。

### API

- `POST /api/auth/register` {username, displayName, password} → token
- `POST /api/auth/login` → token
- `GET /api/me` 進度、統計、積分
- `GET /api/questions?category=&limit=50&exclude=` 隨機題目
- `GET /api/stages` 關卡列表與解鎖狀態
- `POST /api/match/opponent?category=` 配對，回傳對手 display_name 與 scorePerSec
- `POST /api/match/result` 回報結果，更新統計、積分、進度
- `GET /api/leaderboard` 前 100
- `POST /api/unlock` {unitId} 用點數解鎖

安全：密碼 bcrypt(12)，JWT 7 天，帳號 3–20 字英數，密碼 ≥ 8 字。不收集其他個資。

### 題庫

- 分類：`bank_law`（銀行法規）、`trust`（信託）、`wealth`（理財規劃）、`finance_basics`（金融常識）、`news`（財金時事）。
- JSON 格式：`{category, text, options[4], answerIndex, explanation?, source?}`。
- 由 `scripts/import-questions.ts` 匯入 SQLite。
- MVP 內建一批種子題（來源：公開考古題整理）。著作權：正式營運前需改寫。

### 美術

ComfyUI（z_image_turbo）生成單位精靈（透明背景、側面、卡通風），塔、背景。
每單位一張靜態圖，行走用 Phaser tween 上下晃動。

### 部署

- Docker：`server` image（含 web 靜態檔，由 Fastify 服務）。
- `docker-compose.yml`：server 容器 + Caddy（自動 HTTPS，先用 IP 走 HTTP）。
- Volume：`./volumes/data` 掛 SQLite。
- VM：`stress`（pressure-507503, asia-east1-b, 34.80.44.47）。部署腳本用 `gcloud compute scp` + `ssh docker compose up -d --build`。

## 6. 測試

- engine：vitest 單元測試（移動、攻擊、光環、勝負判定、確定性）、平衡模擬測試。
- server：vitest + 內存 SQLite 的 API 測試（註冊登入、題目、配對、結果回報、排行）。
- web：Playwright 煙霧測試（登入 → 開一關 → 答一題 → 召喚一隻）。


## 7. 2026-09-28 變更：PostgreSQL、動態關卡、空題庫

- 資料庫改為 **PostgreSQL**（`pg`）；測試與本機開發用內嵌 PGlite（`DATABASE_URL=pglite://dir`）。SQLite 移除。
- 題庫從空開始，`data/questions/*.json` 不進 git；檔案格式改為 `{ category: {id, name, sortOrder}, questions: [...] }`，啟動時自動匯入（分類＋題目文字去重）。
- **關卡動態化**：`buildStages(categories)`，第 n 關分類 = categories[(n−1) mod 分類數]，每分類 5 輪；AI `scorePerSec = min(3.5, 0.5 + 0.18·(n−1))`、warmup 遞減、策略每 2 關升級。模擬：第 1 關弱玩家 95% 勝，第 15 關平均玩家 29% 勝。
- 題目每次隨機抽取，且**選項順序由後端每次洗牌**後回傳（answerIndex 同步調整）。
- 對戰模式分類清單來自 `/api/categories`（只列有題目的分類）。

## 8. 強化系統（2026-09-28）

- `user_progress.upgrades` JSONB：`{ unitId: { hp, atk, special } }`，各 0–10 級。`POST /api/upgrade {unitId, track}`，需先解鎖該貓，費用 20+10×新等級 點。
- 生命／攻擊每級 +10%。特技：存款貓近戰命中附帶自身最大血量 1%×N；債券貓射程 +2N；衍生品貓攻擊 +N；分析師貓死亡後加分延續 0.2N 秒；高頻貓在場時對手攻速 −2%N（對手 cooldown 回復變慢）；保險貓每秒補血 +0.5N。
- 引擎：`createBattle({left: upgrades})`，實體在召喚時固定 hp/dps/range；AI 方不帶強化。

## 9. 100 關與名將喵 BOSS（2026-09-28）

- `STAGE_COUNT = 100`；AI 收入 `0.5 + 2.5·t^1.8`（t = (n−1)/99），warmup 8 s → 0，策略每 12.5 關升級。
- 每關 BOSS = `BOSS_LIST[n-1]`（100 位戰國名將），屬性型態（近戰／遠程／坦／快速／砲兵）× 技能種類（19 種）；血量 `260 + 2600t² + 700t`、攻擊 `12 + 70t`，再乘型態係數與 `BOSS_TUNE`（0.6 / 0.7）。
- AI 於 `atMs = 60000 − 35000t` 免費派出 BOSS；第 80 關起死後 75 秒復活。
- 引擎新增：`spawnFree`、`unitDef`（含 boss）、每擊結算（護甲／閃避／吸血／處決）、`special` 事件。
- 平衡：使用者決定暫不細調，後續會開放更多強化。目前模擬（玩家帶 n/10 級強化）：第 55 關約 60%、第 85 關約 50%、第 100 關 0%。
- 題庫：以 `tools/tabf_import.py` 從金研院家族信託規劃顧問師三次測驗匯入 351 題（複選 9 題略過）。

## 10. 難度上調（2026-09-28，使用者反映第一關太簡單）

- `STAGE_TUNE`：base 0.5 → 0.9、gain 2.5 → 3.5、pow 1.8 → 1.6、BOSS 第 60 關起 60 秒復活；warmup 3 秒 → 0；BOSS 登場 20 秒 → 12 秒。
- `BOSS_TUNE`：血 0.8、攻 0.9；豐臣召喚間隔 18 秒 → 7 秒。
- 模擬（玩家帶 n/10 級強化）：第 1 關平均玩家 94%／弱玩家 22%，第 30 關 31%，第 40 關 71%，第 50 關起需要更多強化。
