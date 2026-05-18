# Environment Variables

## Editor

Set the default CLI editor to VSCode.

Windows PowerShell:

```powershell
setx VISUAL "code --wait"
setx EDITOR "code --wait"
```

Linux/macOS Bash (add to `~/.bashrc` or `~/.zshrc`):

```bash
export VISUAL="code --wait"
export EDITOR="code --wait"
```

- `VISUAL`: Preferred full-screen or graphical editor.
- `EDITOR`: Fallback default editor used by CLI tools.
- `code --wait`: Opens VSCode and waits until the editor window is closed before returning control to the CLI.
