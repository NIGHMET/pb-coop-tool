# Changelog

## 1.3.0-beta.1

- Discover the actual exported game App instead of assuming a global room context.
- Preserve native offer ownership and rebuild failed/closed links using the existing peer-reset signal when answering (it does not leave the room).
- Preserve recovery history, limit repeated attempts, and fix statistics after reopening a rebuilt link.
- Replace and restore the registered pagehide listener.
- Refresh ICE credentials through the game's backend and apply them to future links.
- Filter IPv6 addresses in full SDP when explicitly enabled; keep the option off by default.
- Restore instance hooks, native constructors, observers, style, and the public API on disposal.
- Export diagnostics without room codes, names, addresses, SDP, or credentials.
- Replace overstated packet-loss/network advice with accurately labelled sampling and experimental options.
- Add deterministic regression tests, native Chromium tests, upstream contract checks, and CI.

This is an experimental release. Local tests do not establish reliability on real Internet/NAT/mobile networks.
