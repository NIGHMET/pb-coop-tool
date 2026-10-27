# PokéBonk Co-op Connection Doctor

**Experimental diagnostics and bounded recovery · 1.3.0-beta.1**

[中文](README.md) · [Install userscript](https://raw.githubusercontent.com/NIGHMET/pb-coop-tool/main/pb-coop-fix.user.js) · [Other games](docs/ADAPTERS.md) · [Validation](docs/VALIDATION.md)

**Already have Tampermonkey? [Download the installation file](https://github.com/NIGHMET/pb-coop-tool/releases/download/v1.3.0-beta.1/pb-coop-tool-install.user.js), drag it onto Tampermonkey Dashboard → Installed Userscripts, then confirm Install. No copying code. Keep the `.user.js` extension.**

A community userscript for [PokéBonk](https://pokebonk.com) browser co-op. It shows connection state, performs bounded recovery of failed connections, and exports privacy-filtered diagnostics. **PokéBonk is the only current adapter. Recovery across real Internet/NAT/mobile networks is not yet validated.** The in-game panel currently uses Chinese.

## Install

Use a userscript manager capable of running in the page context, such as Tampermonkey or Violentmonkey. Open the install link, or paste the full `pb-coop-fix.user.js` into a new script. Refresh the game and join co-op. Keep the default settings for the first trial. Injection compatibility across managers/browsers is not fully tested.

The adapter reuses the game's already loaded same-origin module, its exported `App` class and `frameGap()` method to discover the running instance. If the panel keeps waiting for a room, do not assume recovery is active: injection isolation, CSP or an upstream change may prevent attachment.

## Behavior

- Automatic recovery is enabled: rebuild existing failed/closed links, preserve the game's larger-slot-offers rule, wait at least 15 seconds between extra script attempts, and stop after five extra automatic attempts per peer. Native game retries are counted separately. Stable operation for 15 seconds resets the limit.
- Manual recovery retries failed/closed links without touching healthy connections. An answering peer sends one protocol `bye` to reset that peer link and prompt the larger-slot peer to offer again; this does not leave the room. This cannot resume an ended room or an ended run.
- TURN refresh calls the game's own backend and updates ICE configuration for future links. Healthy links are not interrupted.
- IPv6 filtering, increased relay send frequency and skipping the `pagehide` leave callback are **experimental and off by default**. These may reduce connectivity, increase congestion, or delay normal room departure. They cannot prevent OS/browser background suspension.
- The game already accelerates polling with `hurryPoll()`; existing fast retries remain intact.
- The receive-stall ratio is a sampled idle indicator, **not packet loss**. A relay route is not inherently broken. Send backlog is a local sending metric.

`__pbCoopFix.diagnostics()` returns a shareable report without room codes, player names, IP addresses, SDP or credentials. Raw `stats`/`events` are local debugging objects and should not be posted publicly. `repairNow()`, `refreshIce()`, `save()` and `dispose()` are also available. Disposal restores this instance's hooks and removes the panel while preserving saved preferences. Remove the userscript and reload to stop future injection.

## Development

Node.js 22+:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run check:upstream
```

Runtime is a single dependency-free userscript. Playwright is a development-only dependency. `node harness.mjs` is a compatibility entry point for offline tests. Browser tests use a local authored fixture and native WebRTC. Upstream checks only inspect public source and do not execute or redistribute it. See [validation boundaries](docs/VALIDATION.md).

## Reuse

The observation, reversible hooks, retry budget and reporting approach can inform other browser WebRTC DataChannel games. Recovery requires a separate game-specific signalling/lifecycle adapter. WebSocket and native-client games require different integrations. There is no generic repair mode or adapter SDK yet; see [adapter notes](docs/ADAPTERS.md).

Unofficial and unaffiliated with the game. No game bundles, assets, accounts or server credentials are distributed. [MIT license](LICENSE) covers this tool only. Contributions and careful reports are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
