# Validation record — 2026-10-27

Version: `1.3.0-beta.1`. Local runtime: Windows, Node.js 22.23.3, Playwright 1.64.1, Chromium 156.

## What was checked

- **15 offline behavior checks passed.** Offer ownership and peer-reset semantics; reopening a rebuilt link; native registered pagehide listeners; ICE configuration propagation; IPv6 filtering and listener removal; complete SDP filtering; disposal and reinjection; room changes; retry limits including coexistence with native retry timers; healthy connections; privacy-filtered diagnostic export.
- **3 native Chromium checks passed.** Discover an exported module App and fully dispose the UI/wrappers; exchange data over native WebRTC connections; recover the answering side with only one page running the tool and the other page offering no automatic retries. The last test exchanged real data after reconnection and checked that no room-leave action occurred.
- **Public upstream contract check passed.** Current asset: `main-D9lomsK5-mvpt1dlr.js`, game `0.8.59`, build `mvpt1dlr`; SHA-256 `002313b36a61c38bb4768b202ef00984bcf5a0138b758572d5b013a6cf82e8e6`. All eight current static interface checks matched. This is a source-shape check, not proof of end-to-end behavior.
- **Live landing-page smoke:** a fresh headless browser captured the actual App (`discovery=attached`) on the official site, with no page errors in that attempt. No login or co-op room join was performed. An earlier fresh-context attempt timed out after 60 seconds; its cause was not established. This is not a reliability measurement.

The offline suite initially failed nine of ten added regression checks against the previous script. The answering-side native-browser recovery test initially stalled at `connecting`; after implementing the game's peer-reset signal it opened and transmitted data. The old 23-assertion harness has been replaced because its mocks incorrectly bypassed real retry/event behavior.

## What these results do not establish

The browser room is a locally authored interoperability fixture using native RTCPeerConnection and a local BroadcastChannel signalling bus. It is not the real game's server or game-state synchronisation.

Real two-player PokéBonk sessions across separate Internet networks/NATs, TURN failures/credential expiry, repeated matches/lobby transitions, long sessions, simultaneous failures, mobile background freezing, Firefox/WebKit, and specific userscript-manager injection combinations remain unverified. There are no measured improvements in real-world drop frequency, latency, win rate, or recovery success rate.

## Before promoting beyond beta

Use two devices and separate networks. Record browser/manager/game versions, one-end versus two-end installation, the selected route, time to recovery, whether game state continues correctly, and whether the match actually remains playable. Compare default settings with the script disabled. Test experimental options separately; do not enable them all and infer a cause from a single successful run.

`npm run check:upstream` and the optional `npm run test:live` are network-dependent checks. CI runs only the offline and local-browser suites. Follow the actual GitHub Actions result when deciding whether the published commit passes remotely.


## 1.3.0-beta.2 update

The user's beta.1 exports showed successful script attachment and HTTP responses, but one report had an empty peer list and the other had a connecting peer. They were captured more than two minutes apart and omitted member counts and native handshake states, so these reports do **not** establish a single network root cause.

Code review confirmed a separate recovery gap: beta.1 enumerated only existing mesh links, so a missing link could not be recovered even if the room still listed that peer. Beta.2 enumerates current room members, adds missing-link recovery with a 20-second initial-offer grace period for automatic attempts, and reports native handshake state without exposing addresses or SDP.

Validation: **20 offline checks and 4 native Chromium checks passed locally**, including a deleted answering-side link that was rebuilt and exchanged real data. Four new offline checks failed against beta.1 before implementation. A separate beta.1 simultaneous-two-end probe reopened both local native connections in three consecutive rounds; this does not prove real Internet recovery. The original cross-network/mobile limitations above still apply. The affected user's connection has not yet been retested with beta.2.
