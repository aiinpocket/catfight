# 題庫目錄

把題目檔放在這裡：`<分類id>.json`（例如 `finance_basics.json`），伺服器啟動時自動匯入。
已存在的「分類＋題目文字」會略過，所以可以反覆加題再重啟容器（`docker compose restart app`）。
`*.json` 不進 git，題庫檔請自行備份。

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

- `sortOrder` 決定關卡輪流的順序：第 1 關 = sortOrder 最小的分類，第 2 關 = 次小……輪完一圈再從頭，AI 強度遞增。
- 選項在遊戲中每次送出都會重新洗牌，`answerIndex` 指的是這個檔案裡的位置。
- 匯入前驗證格式：`DATABASE_URL=… npm run import-questions -w @catfight/server -- data/questions`。
