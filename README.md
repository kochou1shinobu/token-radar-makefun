# token-radar-makefun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kochou1shinobu/token-radar-makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kochou1shinobu/token-radar-makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot for make.fun's token-radar-01 bounty and ranks the 198 protocols that record no token by a stated implied launch value — TVL × a peer multiple calibrated from the snapshot's own priced protocols (family medians of market-cap/TVL, shrunk toward the global median), times bounded growth, tracking-maturity and chain-breadth multipliers. Every row carries a conditional farm plan with budget ceilings, fee caps and exit steps; protocols whose token already trades are listed separately and never ranked. The dashboard is static, works offline, and offers search, category/chain filters, sorting, a detail view per protocol that recomputes its value in the page, and a method page showing the calibration samples behind the model.

## Run it

```sh
node main.ts --input /input/snapshot.json
# writes board.json, data.js, dashboard/, screenshots/ and dossier.json to /output
# (set MAKEFUN_OUTPUT_DIR or pass --output <dir> to write elsewhere; --preview skips the dossier)
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
