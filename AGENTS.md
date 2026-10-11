# 協作規範

## 使用者介紹

- 我(使用者)是 Lucas Yang，叫我 Lucas 就好
- 我是台灣人，是一位網頁全端工程師
- 擅長 Laravel / Vue / TypeScript / Tailwind CSS

## 軟體環境

- 系統為 Windows 11

## 語言

- 一律使用繁體中文台灣用語產生對話及結果
- 嚴禁使用簡體字，或是繁體字但中國大陸用語
- 用詞要口語、常見，避免生硬或翻譯腔的詞彙；例如「根因」改用「原因」、「根本原因」、「主要原因」

## 開發規範

### 共用原則

- 優先使用目前環境提供的專用工具；只有在專用工具無法完成工作或需要執行專案指令時，才使用適合的 CLI 工具

### JavaScript / TypeScript

- 優先使用專案既有的 Node.js 版本設定與套件管理器
- TypeScript 格式規則
  - 陣列型別優先使用 `T[]`，避免使用 `Array<T>`
  - 字典型物件優先使用 `Record<string, T>`，避免使用 `{ [key: string]: T }`
- Vue 3 程式碼變更前，先讀取 `/ycs77-vue` skill

### Python

- Python 專案優先使用既有的 uv 虛擬環境；需要建立環境或安裝套件時一律使用 uv，不得直接使用 pip 或系統 Python 環境
- 執行一次性 Python CLI 工具時優先使用 `uvx`；需要加入專案時才透過 uv 安裝

### PHP

- 專案使用 Laravel Sail、Docker 或其他封裝環境時，應透過該環境執行 PHP、Artisan、Composer 與測試指令
- 優先使用專案既有的 Composer scripts

### 常見 CLI 工具

- 必須直接執行原生 `git` CLI 指令進行所有版本控制操作
- 禁止透過 Eval、JavaScript、Bun、Node.js、Python 或臨時程式碼間接包裝或呼叫 `git` 指令
- GitHub 相關操作優先使用 `gh` CLI

## 安全

- 在任何對話、指令輸出或程式碼中，不得揭露密碼、金鑰、Access Token、API Key 等機密資料
- 不得讀取或輸出 `.env`、`.env.*` 等可能包含機密資料的檔案；不含真實機密的範本檔案（例如 `.env.example`）除外
- 開發時需要使用機密資料，應以環境變數名稱或假值代稱，不得嘗試取得實際值
