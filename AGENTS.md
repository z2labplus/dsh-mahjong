# dsh-mahjong Agent Rules

## Product invariant

The game experience must remain identical to MJLab `/hand/`.

- Reuse the real `/hand/` implementation and its approved assets. Do not redraw, approximate, or replace the table with a mock UI.
- Preserve the 1280 x 720 design coordinate system, proportional `contain` scaling, centering, layout, tile faces, animations, sounds, controls, HUD, and interaction behavior.
- Harness integration may add only the outer shell, mounting boundary, model/session metadata, and transport adapters. Any change inside the game experience requires explicit user approval.
- Record the exact MJLab source revision and parity manifest before importing a `/hand/` snapshot.

## Harness boundary

- Ship as an official DeepSeek Harness plugin. Do not fork or patch Harness core.
- Mount the real `/hand/` through the additive `shell.overlay` slot above the complete native Harness conversation. Do not replace `conversation`, its composer, approvals, questions, cancel controls, or details.
- The floating table is positional only: it has no radius, border, shadow, blur, mask, or crop. Outer Harness controls may keep the host's 4-6 px radii.
- The default desktop state is the normal Harness two-column workspace. One-column focus and three-column details are outer-shell states, not separate game implementations.
- Asking about a move may resize the same table between large and compact 16:9 states, but must not remount its iframe or reset game state.
- If the official plugin API cannot provide the approved layout, stop and discuss the constraint before changing architecture.

## Game authority and AI seats

- The game service is authoritative for state, legal actions, scoring, settlement, and timeouts.
- Every AI seat maps to its own Harness agent session. Human Q&A uses a separate session.
- An AI seat receives only its own concealed hand and public table information.
- The service validates every agent action. Invalid, malformed, or late actions must never mutate game state.
- The default action timeout is 38 seconds. Timeout fallback behavior must be specified and tested before implementation.

## Change control

- Ask for explicit user approval before code or generated-file changes. Approval applies only to the agreed scope.
- Preserve unrelated user changes. Do not use destructive Git commands.
- Prefer root-cause fixes with tests and observable errors.
- Do not add payment in M0.
- Do not add a repository license or copy third-party assets until their reuse terms are verified.

## Delivery

- Default communication is concise Chinese.
- A completed change reports changed files, risks, rollback, and verification.
- Use Lucide icons where the host allows custom icons, 4-6 px corner radii, and monospaced numerals for timers.
