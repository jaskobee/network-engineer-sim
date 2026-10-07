# Network Engineer Simulator — NetSim and Cloud Engineer

Two browser-based learning products. Nothing to install, and nothing connects to real devices or real cloud accounts.

| Product | What you learn | Where |
|---|---|---|
| **NetSim** | On-prem networking: buy gear, cable it, configure it through real Cisco IOS, Linux and Windows commands, get paid when the network works. CCNA / Network+ level. | `apps/netsim` · `/network-engineer-sim/` |
| **Cloud Engineer** (Preview, working title) | Azure infrastructure: management groups, subscriptions, resource groups, networking, VMs, storage. You build it in a portal-style builder that validates like Azure does, through missions in customers' tenants. | `apps/cloud` · `/network-engineer-sim/cloud/` |

Accuracy is the product. Each product has a hard spec it must follow: `docs/netsim/NETWORKING_ACCURACY.md` and `docs/cloud/AZURE_ACCURACY.md`.

## Run it
```bash
npm install
npm run dev          # NetSim          → http://localhost:5173/network-engineer-sim/
npm run dev:cloud    # Cloud Engineer  → http://localhost:5180/network-engineer-sim/cloud/
npm test             # every app and package (Vitest)
npm run build        # NetSim → dist/, Cloud Engineer → dist/cloud/ (GitHub Pages)
```

## Repo layout
```
apps/netsim/       NetSim (React + its headless networking engine)
apps/cloud/        Cloud Engineer (React + its headless Azure model in src/azure)
packages/kernel/   @sim/kernel — IPv4 math, save format (shared, domain-free)
packages/ui/       @sim/ui — design system, sign-in, product switcher (shared)
tests/             repo-wide boundary tests: the products never import each other
docs/              netsim/ · cloud/ · platform/ (architecture: docs/platform/PLATFORM_ARCHITECTURE.md)
```

Stack: Vite 5, React 18, plain CSS, Vitest 4. JavaScript only. Working on the code with Claude Code: start with `CLAUDE.md`.
