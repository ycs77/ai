# Environment Variables

## Editor

Set the default CLI editor to VSCode:

```powershell
setx VISUAL "code --wait"
setx EDITOR "code --wait"
```

- `VISUAL`: Preferred full-screen or graphical editor.
- `EDITOR`: Fallback default editor used by CLI tools.
- `code --wait`: Opens VSCode and waits until the editor window is closed before returning control to the CLI.
