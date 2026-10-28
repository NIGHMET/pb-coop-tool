# 1.3.0 validation — 2026-10-28

Runtime: Windows, Node.js 22.23.3, Playwright 1.64.1, Chromium 156. The release is a bounded recovery tool; its version number is not a claim of universal network stability.

## Changes checked

- Missing peer links can be repaired while the peer is still a room member.
- When both peers are updated, per-offer opaque references reject old answers and old resets, including the ICE-gathering window of a replacement link. Untagged older peers remain compatible but cannot provide the same protection.
- Signal POST responses no longer overwrite the room GET polling measurement.
- The default panel leaves the bottom-right Ready/Start actions accessible at 1280×720. Saved drag positions are preserved.

## Results

- **25 offline checks passed**, including privacy, cleanup, retry limits, missing links and obsolete signalling.
- **6 local Chromium checks passed**, including real DataChannel messages after repair and obsolete-answer rejection, plus the panel/Ready interaction.
- **8 native-protocol scenarios passed on the latest reviewed `mvr5gbc0` build**: native baseline, each side alone, simultaneous failure, a deleted link, delayed old answers/resets, and an old answer arriving before the current answer. These run the public game's actual transport classes in memory with local delayed HTTP signalling; they do not use the official game server.
- **Actual Tampermonkey 5.5.1 installation passed** in an isolated Chromium profile: drag the final 1.3.0 file into the Dashboard, confirm Install, load the official game without Playwright script injection, and observe `discovery=attached`. User/friend browser profiles were not changed.
- **Official-server gameplay passed** with two owned guest accounts in isolated browser contexts: create/join, both native channels open, enter the game, move using keyboard input, observe a newer remote snapshot with changed remote coordinates, finish through the game's native abandon method, return to the server's lobby, and start a distinct second party with movement/snapshot verification again. This test uses Playwright `addInitScript`; manager injection is checked separately above.
- **Official-server fault recovery passed** in the same final run before gameplay: answering-side failure (10.7 s), simultaneous failures (5.6 s), and a deleted answering-side link (4.7 s). Faults are synthetic native link failures/deletion, not physical router outages. These timings are individual observations, not reliability estimates.
- Latest official static contract matched all eight checks for `main-BOn5p88k-mvr5gbc0.js`, SHA-256 `2bc412f4f393454540abb08a66a77f28827f7fb6ca784b3dadfd58a065f00401`.

## Failures retained in the assessment

Earlier tests reproduced obsolete-answer interference; a deterministic test failed before the reference guard and passed afterward. Review also found the gathering-window case, which now has a regression test.

Real-site attempts also encountered native Retry screens, a navigation timeout, aborted join/poll requests, and one 45-second simultaneous-recovery timeout with a failed room poll. Their network/server cause was not established. A no-tool/tool boot comparison subsequently loaded both normally. These failures are not erased by later passing runs and prevent any claim of guaranteed reconnection or a measured real-world success rate.

Test-runner issues (checking input before the native asset preloader completed, and attempting the summary's return-room callback before finishing the run) were corrected; they were not treated as production-script defects. The gameplay acceptance requires actual remote coordinate change and a new party, not merely non-null objects.

## Limits and reproduction

All official two-player checks used **one Windows host and one network**. Separate devices/NATs, TURN-only failure/credential expiry, long sessions, mobile background suspension, Firefox/WebKit, and the affected user's own two-network case remain unverified. No measured drop-frequency or latency improvement is claimed. Further game updates may require adapter changes.

`npm run check` and `npm run test:browser` are local/CI checks. `npm run test:protocol` downloads reviewed public classes into memory and runs a local signalling server; unrecognised minified layouts deliberately fail for review. No game bundle is redistributed. The final sanitised reports are [official acceptance](acceptance-1.3.0.json) and [native protocol](protocol-1.3.0.json); the latter records the asset and hash actually exercised.

`npm run test:official` is opt-in and requires two **owned test-account** storage-state files at `artifacts/acceptance/test-a-private-state.json` and `test-b-private-state.json`. It uses only those accounts and leaves its test rooms on normal exit. `--gameplay-only` skips synthetic faults. States/screenshots/raw reports stay in ignored `artifacts/`; do not use personal browser profiles or publish these files.

Before claiming cross-network reliability, compare enabled/disabled behavior using two devices on separate networks, record route and actual gameplay continuation, and test experimental switches individually.

---

# Historical records

The sections below describe earlier versions and their validation limits at that time.

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
