# AI Installation Guide

### Install AI Tools

```sh
npm install -g @github/copilot @google/gemini-cli @openai/codex @upstash/context7-mcp
```

### Install Skills

```sh
npx skills add ycs77/skills -g \
  -a claude-code \
  -a github-copilot \
  -s commit-message \
  -s github-release-notes \
  -s write \
  -y
```

### Install Claude Code

For Bash (Linux/macOS):

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

For PowerShell (Windows):

```sh
irm https://claude.ai/install.ps1 | iex
```

Next, set the `CLAUDE_CODE_GIT_BASH_PATH` environment variable to the location of your Git Bash executable, which is usually `C:\Program Files\git\bin\bash.exe`.
