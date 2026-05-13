# Karaoke design docs

Each numbered folder under `docs/issues/` captures one product or
architectural decision: the problem we hit, the alternatives we
considered, what we shipped, and what's left open. Style mirrors
MentraOS-2's `cloud/issues/NNN-name/spike.md` pattern.

We write these so the *reasoning* survives. Code shows what; these
docs show why.

## Index

| #   | Topic                                                  | Status |
| --- | ------------------------------------------------------ | ------ |
| 001 | Pixel-accurate text wrapping via display-utils         | landed |
| 002 | Version mismatch handling (Killer Queen, Hey Jude)     | landed |
| 003 | Detection speed + silence-aware ACR backoff            | landed |
| 004 | Fresh-detection window (45s tight cadence after confirm) | landed |
| 005 | Persistent history + favorites                         | landed |
| 006 | End-of-song HUD clear + alert mode                     | landed |

## When to add one

Add an issue when the change is **not obvious from the code alone** —
specifically:

- The behavior involves tradeoffs (latency vs API cost, freshness vs
  user-quiet, etc.).
- We rejected a more "obvious" alternative for a non-obvious reason.
- Future-us will wonder why a magic number is what it is.

Skip an issue for pure refactors, cosmetic fixes, dependency bumps.
