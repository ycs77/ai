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
  -s write-social-post \
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

### Setup Claude Code Status Line

First, you must install `jq`. **Run Git Bash as Administrator** for this step:

```bash
curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-windows-amd64.exe -o jq.exe
mv jq.exe '/c/Program Files/Git/usr/bin/jq.exe'
```

Next, download the status line script and make it executable:

```bash
curl -fsSL https://raw.githubusercontent.com/ycs77/ai/main/.claude/statusline.sh -o ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh
```

Then, add the following Claude Code configuration to display the status line:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline.sh"
  }
}
```
