# gitdash

Local per-machine dashboard showing every git repo's status vs GitHub, with per-repo push / pull / merge / fetch / stash buttons. No bulk operations.

## Status: scaffold

- [x] Project scaffold (Next.js 15, Tailwind, TypeScript strict)
- [ ] Discovery + exclude rules
- [ ] SQLite persistence
- [ ] `gh api` remote comparison with ETag cache
- [ ] SSE live updates + chokidar watchers
- [ ] Per-repo action endpoints
- [ ] CSRF + Host validation
- [ ] `bin/gitdash` launcher

## Running (dev)

```bash
npm install
npm run dev
```

Opens on `http://127.0.0.1:7420`.

## Config

Future location: `~/.config/gitdash/config.json`. Shipped defaults exclude `node_modules`, `.cache`, `.nvm`, `.mcp`, `.codex`, `.nemoclaw`, `.openclaw`, `snap`.
