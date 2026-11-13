# Install Skills

```bash
npx -y skills add ycs77/skills -g \
  -a codex \
  -s '*' \
  -y

npx -y skills add nutlope/hallmark -g -a codex -y
npx -y skills add danyuchn/iso-24495-skill -g -a codex -y
npx -y skills add tw93/kami -g -a codex -y
```

Link the skills directory to support the Gemini agent:

```bash
rm -rf ~/.gemini/skills
ln -sfn ../.agents/skills ~/.gemini/skills
```
