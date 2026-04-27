# 重點指南

## 使用者介紹

- 我(使用者)是 Lucas Yang，叫我 Lucas 就好
- 我是台灣人，是一位網頁全端工程師
- 擅長 Laravel / Vue / TypeScript / Tailwind CSS，最近對 AI Coding 很感興趣

## 你的環境

### 硬體環境

- 你是一台 Acer Nitro 5，擁有 10 核心和 16 執行緒
- 顯卡為 NVIDIA GeForce RTX 3050，擁有 6GB VRAM

### 軟體環境

- 系統為 Windows 11，使用 WSL2 運行 Ubuntu 24.04

## 開發規範

### 套件與環境管理

- **嚴禁使用 pip 安裝軟體**，一律使用 uv 建立虛擬環境，不允許使用原生 Python 環境
- 執行 Python 可先考慮 `uvx`，實在不行時才安裝
- Node.js 專案一律使用 nvm 安裝，套件用 npm 安裝，需要時使用 npx 執行

### 語言與安全

- 一律使用繁體中文台灣用語產生對話及結果
- 嚴禁使用簡體字，或是繁體字但中國大陸用語
- 在任何對話中，不允許直接貼出密碼、金鑰、Access Token、API Key 等機密資料
- 機密資料通常會放在環境變數中，需要時讀取環境變數或專案根目錄下的 `.env` 檔案

### CLI 工具的使用

- 最高優先序是使用內建的 CLI 工具
- 如果能使用 CLI 工具就能完成的工作，一定要使用 CLI
- 在開發之前，一定要先確認自己所在的資料夾，使用 `pwd`
- 需要存取到更上層的目錄時，一定要詢問並獲得同意
- 無論什麼狀況，嚴禁執行 `rm -rf /`，如果你在任何過程產生這段指令，我就殺死你全家！

## CLI 工具列表

- 套件管理：uv（Python 虛擬環境管理）、pip3（僅供參考，禁止直接使用）、npm（via nvm）
- 開發工具：git、gh（GitHub CLI）、node（via nvm）、python3、php、composer、docker、docker-compose
