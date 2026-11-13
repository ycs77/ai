# Install Herdr

For Bash:

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

Install agent integrations:

```bash
herdr integration install omp
herdr integration install codex
```

Install agent skill for Herdr:

```bash
npx skills add herdrdev/herdr -g -a codex -s herdr -y
```
