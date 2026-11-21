# 協作規範

## 使用者介紹

- 我(使用者)是 Lucas Yang，叫我 Lucas 就好
- 我是台灣人，是一位網頁全端工程師
- 擅長 Laravel / Vue / TypeScript / Tailwind CSS

## 系統環境

- 系統為 Windows 11

## 語言

- 使用繁體中文台灣用語；嚴禁使用簡體字，或是繁體字但中國大陸用語
- 用詞要口語、自然，避免生硬或翻譯腔的詞彙；例如「根因」改用「原因」、「根本原因」、「主要原因」

## 互動

- 執行 `/grill-me`、`/grill-with-docs` 等訪談或釐清類 skill 與流程時，優先使用互動式提問工具（如 `ask`、`ask_question`、`AskUserQuestion` 等）向使用者提問

## 開發規範

### JavaScript / TypeScript

- 優先使用專案既有的 Node.js 版本設定與套件管理器
- TypeScript 陣列型別用 `T[]` 格式，字典型物件用 `Record<string, T>` 格式
- Vue 3 程式碼變更前，先讀取 `/ycs77-vue` skill

### Python

- 管理 Python 環境與相依套件一律使用 uv，沿用專案既有虛擬環境
- 一次性 CLI 優先使用 uvx

### PHP

- 專案使用 Laravel Sail、Docker 或其他封裝環境時，應透過該環境執行 PHP、Artisan、Composer 與測試指令
- 優先使用專案既有的 Composer scripts

### 常見 CLI 工具

- 版本控制一律直接執行原生 git CLI，不透過 Eval tool 等程式包裝呼叫
- GitHub 相關操作優先使用 gh CLI

## 安全

- 在任何對話、指令輸出或程式碼中，不得揭露密碼、金鑰、Access Token、API Key 等機密資料
- 不得讀取或輸出 `.env`、`.env.*` 等可能包含機密資料的檔案；不含真實機密的範本檔案（例如 `.env.example`）除外
- 開發時需要使用機密資料，應以環境變數名稱或假值代稱，不得嘗試取得實際值
