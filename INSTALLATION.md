# AI Installation Guide

### Install AI Tools

```bash
npm install -g @github/copilot@latest @openai/codex@latest
```

### Install Skills

```bash
npx -y skills add ycs77/skills -g \
  -a claude-code \
  -a codex \
  -a github-copilot \
  -s '*' \
  -y

ln -sfn ../.agents/skills ~/.gemini/skills
```

### Install Claude Code

For Bash (Linux/macOS):

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

For PowerShell (Windows):

```powershell
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
