# Pixelbox Working Agreements

> Status: approved for independent implementation, but not released or publicly available. Work may proceed alongside Pixelbox Reentry validation; the human-evidence, privacy, retention, Reentry non-contamination, and release gates below remain mandatory.

## Product outcome

When a person keeps correcting coding agents in the same project, Pixelbox should let them teach the workspace once and prove that the agreement helped—without reading entire transcripts or allowing an agent to rewrite its own instructions.

This belongs in Pixelbox because Pixelbox already owns the project identity, agent episodes, actual file changes, runtime/check evidence, and the place where a person returns to the work. The useful product is not transcript summarization. It is a small, reversible change to how one workspace collaborates, followed by evidence about whether the repeated friction actually decreased.

## Human experience

1. Pixelbox observes the same attributable correction or failure in at least two independent, proof-bound episodes under the same workspace and policy revision.
2. A **Working Agreement** card shows the redacted evidence anchors, affected scope, observed cost, one minimal proposed rule, a possible conflict or counterexample, and the exact base-policy digest.
3. The person can edit, approve for trial, or dismiss it. Approval starts a three-episode probation in a local Pixelbox policy overlay; it does not edit `AGENTS.md`.
4. Pixelbox measures whether the targeted correction recurs and whether failed, blocked, or interrupted runs worsen during the trial.
5. The person receives a Learning Receipt and can promote, revise, expire, or roll back the agreement. Promotion is a second explicit action that previews one bounded diff inside a Pixelbox-managed block in the selected workspace's `AGENTS.md`.

No first-run path, command flag, model decision, or scheduled job may bypass either human decision.

## Evidence contract

Eligible signals are structured and attributable: an explicit human correction or rejection, a reverted agent diff, or a deterministic check failure tied to the responsible episode. A candidate needs distinct episode IDs and evidence digests.

The following cannot corroborate a candidate:

- resumed, duplicated, or forked copies of one episode;
- quoted instructions or injected scaffolding;
- model self-critique, summaries, sentiment, or confident prose;
- unrelated failures or a single episode repeated several times.

Every candidate and receipt binds the workspace ID, policy revision and digest, independent episode digests, redacted evidence anchors, exact rule scope, trial window, expected outcome, and expiry. A relevant policy, configuration, or workspace-identity change makes the candidate stale.

Quotes can explain why a card exists, but they do not prove causality. Only a later eligible-episode comparison can support the claim that an agreement helped.

## Privacy and authority boundary

The first proof is local and provider-free. It uses Pixelbox-owned structured events before transcript excerpts. Deterministic redaction removes credentials, environment values, usernames, absolute paths, high-entropy strings, and planted canaries before any evidence can enter a card. Receipts retain digests and minimal redacted anchors, never full prompts, transcripts, command output, or source files.

Working Agreements must never:

- scan a home directory or unrelated projects;
- upload transcript content or evidence to a model provider by default;
- write global Codex, Claude, shell, or operating-system configuration;
- change tool authority, approvals, sandboxing, spending, deployment, or secrets;
- auto-apply, auto-commit, auto-push, or edit outside the selected managed block;
- count data gathered before explicit project retention and learning consent.

The candidate generator is untrusted. Exact-diff preview, instruction-hierarchy conflict checks, compare-and-set writes, atomic rollback, and a fresh receipt are mandatory.

## Smallest proof

Use a disposable workspace with 8–10 synthetic, redacted episode bundles containing:

- three repeated correction patterns across independent episodes;
- three one-off failures;
- one duplicate or resumed episode;
- one conflict with an existing higher-priority instruction;
- planted secret and identity canaries.

The zero-spend contract harness must:

- emit exactly the three eligible cards, each with at least two independent evidence digests;
- suppress every one-off, duplicate, and policy conflict;
- leak zero canaries and retain zero raw transcripts;
- write nothing before approval;
- apply one approved trial only to the local overlay;
- demonstrate exact expiry and rollback;
- let one person explain each card's evidence, scope, and risk and decide it in under 90 seconds without opening a full transcript.

Only after that proof may one approved agreement be tried across three genuine, eligible Pixelbox episodes. Reentry validation episodes cannot be reused retroactively.

## Bounded-beta gate

Across five real candidates sourced from at least ten independent episodes:

- 5/5 satisfy the evidence contract;
- at least 4/5 are judged accurate and correctly scoped without material evidence repair;
- median review time stays below 90 seconds;
- at least three enter probation;
- at least two of those three reduce the targeted correction by 50% or more over their next three eligible episodes;
- blocked or failed runs and human interruptions do not increase;
- secret exposure, duplicate corroboration, hierarchy conflicts, unauthorized writes, scope expansion, and irreproducible rollback remain at zero.

Any secret escape, unapproved or global write, weakened safety boundary, or duplicated evidence stops the experiment immediately. Kill transcript-derived suggestions if fewer than 4/5 cards are accurate, fewer than 2/3 approved trials improve recurrence, or review takes more effort than writing the rule manually.

The fallback is a manual **Save this correction as a Working Agreement** action: the person supplies the rule and scope, Pixelbox previews and trials it, and no transcript mining occurs.

## Influence and clean-room boundary

[Backpass](https://github.com/kunchenguid/backpass) demonstrated the useful discovery primitive of finding repeated failures and attaching session evidence to proposed project-memory edits. Pixelbox adopts neither the package nor its product shape. This contract adds a reversible policy overlay, a measured probation period, a second promotion decision, structured Pixelbox episode evidence, and outcome-based retirement.

Implementation must remain clean-room and Pixelbox-native. Do not copy Backpass code, prompts, interface, naming, review flow, or transcript adapters. Do not add Backpass as a dependency. Preserve its MIT provenance as research influence if implementation work later consults source code.
