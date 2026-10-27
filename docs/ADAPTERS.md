# Reuse in other games

Current support: **PokéBonk only, experimental**. There is no generic auto-repair mode or adapter SDK in this version.

Useful reusable techniques include observing native peer-connection creation, reporting connection state and send buffers, bounded retries, reversible hooks, and privacy-filtered diagnostic exports. Native WebRTC statistics can describe the selected route and transport health. They do not expose a game's authoritative room membership, reconnect policy, or application snapshot loss automatically.

| Game transport | Reuse potential | Required work |
| --- | --- | --- |
| Browser WebRTC DataChannel | High for diagnostics | A game-specific bridge for rooms, offer ownership, SDP signalling, and lifecycle |
| Browser WebSocket | UI/reporting concepts only | A separate transport observer and reconnect policy |
| Native UDP/TCP or server-only sessions | No direct userscript support | A separate native or server integration |

## Existing developer bridge

`window.__pbCoopFix.attachRoom(room)` is an advanced bridge for an **existing PokéBonk-compatible room object**. It is not a cross-game standard. It requires:

- `alive`, `code`, `me`, `inRun`, `others`, and `retryLink` with PokéBonk semantics.
- `mesh.links` / `mesh.tries` Maps, `mesh.members`, `mesh.me`, `mesh.ice`, `mesh.link(id, offerer)`, `mesh.state(id)`, and `mesh.relayed(id)`.
- Links with `state`, `pc`, `offerer`, `rtt`, `idle`, `lag`, `backlog`, and `close()`.
- If supplied: `schedule(ms)`, the registered `onHide` listener, `mesh.ev.signal(id, kind, sdp)`, and `backend.coopIce(acc)`.

The adapter assumes **larger slot initiates**. Do not bind an unrelated game's object merely because its property names happen to match. Never apply the relay or SDP patches to another game without understanding its protocol.

## Suggested future split

After at least one second game has been studied and tested, extract a read-only WebRTC diagnostic core and keep each game's recovery/lifecycle bridge separate. A future adapter should explicitly declare transport, attach/detach, diagnostics, peer identity, reconnect ownership, and optional recovery capability. Unsupported games should stay in read-only mode. This is a direction for future work, not functionality claimed by this release.
