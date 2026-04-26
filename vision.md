# Pixelbox Vision

## North Star
Pixelbox makes software creation feel immediate, conversational, and shippable.

A single environment where you can go from idea to running product without context-switching across ten tools. The builder can ask, edit, run, preview, debug, and iterate in one loop.

## The Core Bet
Most friction in software development is not writing code, it is orchestration:
- finding the right file
- wiring commands
- running and checking dev servers
- fixing broken feedback loops
- keeping context across changes

Pixelbox should remove orchestration drag so the human stays focused on product decisions.

## What Pixelbox Is Building

### 1) A real build loop, not a demo loop
Pixelbox should optimize for real software work:
- create and edit actual project files
- run project-native commands (`npm run dev`, tests, builds)
- surface deterministic local preview URLs
- keep state and context across sessions
- support debugging, not just generation

Success means users can ship from Pixelbox, not export out to another environment to finish.

### 2) Agent + workspace coherence
The assistant and filesystem should act as one system:
- every suggestion maps to concrete file changes
- every change can be run and verified immediately
- every run has observable output (logs, status, URL)
- every decision can be captured in project memory/docs

No fake progress. No “looks good” without execution.

### 3) Product-first development velocity
Pixelbox should help builders answer:
- What are we building right now?
- What changed?
- Does it run?
- Is it better for users?

The system should bias toward completed vertical slices over endless partial scaffolding.

## pxcode as the proving ground
pxcode in this local directory is the live reference implementation of the Pixelbox philosophy:
- local-first development
- agent-driven coding with real file operations
- integrated run/preview/debug cycle
- docs and memory co-located with code

If a workflow does not hold up in pxcode, it is not ready to be a Pixelbox promise.

## Product Principles

1. Build software, not theater  
   Prioritize correctness, execution, and shipped behavior over polished but empty updates.

2. Shorten time-to-proof  
   Every step should move quickly toward a running result that can be inspected.

3. Keep the loop tight  
   Edit, run, observe, fix, repeat. Minimize waiting and ambiguity.

4. Preserve developer intent  
   The system should amplify decisions, not overwrite style or architecture without reason.

5. Be explicit about reality  
   Distinguish clearly between planned, changed, and verified.

## What Pixelbox Could Achieve

### Near term
- Become the fastest way to move from rough product idea to a working local prototype.
- Make “agent coding” trustworthy by requiring execution-backed updates.
- Reduce setup burden with predictable project conventions and preview behavior.

### Mid term
- Enable small teams to maintain high output with fewer coordination costs.
- Turn product context (vision, memory, docs, code) into a single operational system.
- Make iterative refactoring and debugging as easy as greenfield creation.

### Long term
- Redefine software development as continuous product conversation grounded in executable reality.
- Let one builder operate with the leverage of a full-stack team while maintaining code ownership.
- Make building software feel as fluid as thinking, without sacrificing rigor.

## Non-Goals
- Not a “one click app generator” that produces unmaintainable code.
- Not a chat interface that avoids running real commands.
- Not a landing-page illusion machine.

## How We Measure Direction
Pixelbox is on track when:
- users spend more time deciding product behavior and less time on tooling friction
- generated or edited code is run and verified in the same loop
- session outputs are concrete (changed files, commands run, URLs, logs)
- projects started in Pixelbox are actually shipped from Pixelbox

## Working Standard for This Repo
For pxcode, every meaningful update should answer:
1. What product behavior improved?
2. What files changed?
3. What commands were run?
4. What is the exact local URL or output proving it works?

That is the bar for real progress.