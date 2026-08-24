# Pixelbox Self-Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Finder launch a small supervisor binary instead of Pixelbox directly. The supervisor runs the real app (`PixelboxCore`) as a child; on crash it opens its own small window with an embedded Ghostty terminal running the user's chosen AI CLI (Codex or Claude) to diagnose and fix the native source, then relaunches.

**Architecture:** A new Zig executable target (`PixelboxSupervisor`) with its own minimal Objective-C file (`supervisor_host.m` — deliberately *not* sharing code with the main app's `appkit_host.m`, which is tightly coupled to the webview/bridge and would otherwise pull WebKit and ~1800 lines of unrelated machinery into the one binary meant to stay reliable when the main app is broken). It links Ghostty directly (same static lib the main app already vendors) for its own terminal view. A post-build packaging step swaps which binary occupies the bundle's `CFBundleExecutable` slot. First-run CLI selection happens in `PixelboxCore`'s existing webview UI, persisted to a prefs file the supervisor reads.

**Tech Stack:** Zig 0.16 (`std.process.spawn`/`Child.wait`), Objective-C + AppKit + the vendored Ghostty C API (`vendor/ghostty/include/ghostty.h`), Node/webview for the one-time onboarding modal (existing `renderer/` stack).

**Spec:** `docs/superpowers/specs/2026-08-24-dev-server-watchdog-design.md` (Part 2 only — Part 1 has its own plan)

## Global Constraints

- macOS only. This entire feature is about `.app` bundle launch semantics; no Linux/Windows equivalent is in scope. Guard new build-system code the same way existing code already panics on platform mismatches (`build.zig:54-56`).
- No automated test coverage for the ObjC/window pieces — matches the spec's own "Testing" section (`docs/superpowers/specs/2026-08-24-dev-server-watchdog-design.md`, Part 2). Each native task ends in a **manual verification step with exact commands**, not an automated assertion. Zig-side pure logic (exit-code branching, prefs JSON) does get unit tests.
- Every native/build-system step must be validated by actually running `zig build` (or the more targeted step used in that task) before moving to the next task — no task should be considered done on code-review alone, given how easily subtle Zig/ObjC mistakes compile clean but crash at runtime (this session hit exactly that with the `unsetenv()` fix earlier).
- `PixelboxCore` (today's app) keeps its existing behavior unchanged in every task except Task 6 (the one-time onboarding modal) — this plan must not touch `bridge/server.js`'s or `renderer/`'s existing preview/terminal features from the other plan.
- Packaging output stays local/unsigned for this plan (confirmed empirically: the current `zig build package -Dpackage-target=macos` produces `signing=none` — see Task 7). Code-signing implications of binary-swapping a *signed* bundle are out of scope (also called out in the spec's Rollout section).

---

### Task 1: Add the `PixelboxSupervisor` build target (skeleton)

**Files:**
- Create: `src/supervisor_main.zig` (skeleton only — real spawn/relaunch logic comes in Task 2)
- Modify: `build.zig` (add the second executable target)

**Interfaces:**
- Produces: a `zig-out/bin/PixelboxSupervisor` binary, and a `zig build run-supervisor` step. Task 2 fills in this file's `main()`.

- [ ] **Step 1: Write the skeleton supervisor entry point**

Create `src/supervisor_main.zig`. Its `main` takes `std.process.Init` — the exact same entry-point signature `src/main.zig:77` already uses successfully — so it has `init.io` (needed for `std.process.spawn`/`Child.wait` in Task 2) and `init.gpa` available from the start, and uses `std.debug.print` for console output, matching how every other Zig source file in this codebase already writes to the console (confirmed via `grep -rn std.debug.print src/ vendor/zero-native/src/tooling/`) rather than a lower-level `std.fs.File` writer that isn't used anywhere else in this codebase:

```zig
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    _ = init;
    std.debug.print("PixelboxSupervisor skeleton\n", .{});
}
```

- [ ] **Step 2: Add the build target**

In `build.zig`, immediately after the existing `test_step` block (`build.zig:127-130`, the end of the `build` function), add, still inside `pub fn build`:

```zig
    const supervisor_mod = localModule(b, target, optimize, "src/supervisor_main.zig");
    const supervisor_exe = b.addExecutable(.{
        .name = "PixelboxSupervisor",
        .root_module = supervisor_mod,
    });
    b.installArtifact(supervisor_exe);

    const run_supervisor = b.addRunArtifact(supervisor_exe);
    const run_supervisor_step = b.step("run-supervisor", "Run the supervisor skeleton");
    run_supervisor_step.dependOn(&run_supervisor.step);
```

(No `linkPlatform` call yet — this step only proves the second executable target itself builds and runs. Native/Ghostty linking is added in Task 4, once the plain-window piece is verified working, to isolate failures.)

- [ ] **Step 3: Build and run it**

Run: `zig build run-supervisor`
Expected output: `PixelboxSupervisor skeleton`, then the process exits cleanly (exit code 0).

- [ ] **Step 4: Confirm the existing app target is unaffected**

Run: `zig build run`
Expected: Pixelbox launches exactly as before (this task must not change anything about the existing `exe` target — confirms the new target was purely additive).

- [ ] **Step 5: Commit**

```bash
git add src/supervisor_main.zig build.zig
git commit -m "feat: add PixelboxSupervisor build target skeleton"
```

---

### Task 2: Supervisor process-spawn loop + prefs file

**Files:**
- Modify: `src/supervisor_main.zig` (replace skeleton with real spawn/wait/relaunch loop + prefs JSON read)

**Interfaces:**
- Produces: `readSupervisorPrefs(io, allocator, path) !SupervisorPrefs` where `SupervisorPrefs = struct { cli: []const u8 }`; `decideAction(term: std.process.Child.Term) Action` where `Action = enum { relaunch, quit }`. Task 6 calls both from the loop this task builds.

Every API in this task was directly compiled and run against the installed toolchain (`/opt/homebrew/Cellar/zig/0.16.0_1`) during planning, not written from memory — this Zig version's `std` is unusually `Io`-parameterized (no `std.posix.getenv`, no `std.fs.selfExePathAlloc`, no `std.process.Child.init`; file I/O lives under `std.Io.Dir` and takes an explicit `io: Io` argument throughout) and guessing at "classic" Zig API names silently produces code that looks right but doesn't compile.

- [ ] **Step 1: Add a Zig test step for the supervisor module**

In `build.zig`, immediately after the Task 1 `run_supervisor_step` block, add:

```zig
    const supervisor_tests = b.addTest(.{ .root_module = supervisor_mod });
    const supervisor_test_step = b.step("test-supervisor", "Run supervisor unit tests");
    supervisor_test_step.dependOn(&b.addRunArtifact(supervisor_tests).step);
```

- [ ] **Step 2: Write the failing tests inside `src/supervisor_main.zig`**

Replace the entire contents of `src/supervisor_main.zig` with:

```zig
const std = @import("std");

pub const SupervisorPrefs = struct {
    cli: []const u8,
};

pub const Action = enum { relaunch, quit };

pub fn decideAction(term: std.process.Child.Term) Action {
    return switch (term) {
        .exited => |code| if (code == 0) .quit else .relaunch,
        .signal, .stopped, .unknown => .relaunch,
    };
}

pub const PrefsError = error{ InvalidCli, MissingCliField } || std.Io.Dir.ReadFileAllocError || std.json.ParseError(std.json.Scanner) || std.mem.Allocator.Error;

pub fn readSupervisorPrefs(io: std.Io, allocator: std.mem.Allocator, path: []const u8) PrefsError!SupervisorPrefs {
    const contents = try std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(64 * 1024));
    defer allocator.free(contents);

    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, contents, .{});
    defer parsed.deinit();

    const cli_value = parsed.value.object.get("cli") orelse return PrefsError.MissingCliField;
    const cli_str = switch (cli_value) {
        .string => |s| s,
        else => return PrefsError.InvalidCli,
    };
    if (!std.mem.eql(u8, cli_str, "codex") and !std.mem.eql(u8, cli_str, "claude")) {
        return PrefsError.InvalidCli;
    }
    return .{ .cli = try allocator.dupe(u8, cli_str) };
}

test "decideAction relaunches on nonzero exit" {
    try std.testing.expectEqual(Action.relaunch, decideAction(.{ .exited = 1 }));
}

test "decideAction quits on clean exit" {
    try std.testing.expectEqual(Action.quit, decideAction(.{ .exited = 0 }));
}

test "decideAction relaunches on signal" {
    try std.testing.expectEqual(Action.relaunch, decideAction(.{ .signal = @enumFromInt(11) }));
}

test "readSupervisorPrefs parses a valid prefs file" {
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();
    try tmp_dir.dir.writeFile(std.testing.io, .{ .sub_path = "supervisor.json", .data = "{\"cli\":\"claude\"}" });

    // std.testing.tmpDir creates its directory under .zig-cache/tmp/<sub_path>,
    // relative to the test runner's own cwd (std.testing.tmpDir's
    // implementation resolves it via Io.Dir.cwd() the same way) — build the
    // path this way rather than via a "realpath"-style helper, which doesn't
    // exist on Io.Dir in this Zig version.
    const path = try std.fmt.allocPrint(std.testing.allocator, ".zig-cache/tmp/{s}/supervisor.json", .{tmp_dir.sub_path});
    defer std.testing.allocator.free(path);

    const prefs = try readSupervisorPrefs(std.testing.io, std.testing.allocator, path);
    defer std.testing.allocator.free(prefs.cli);
    try std.testing.expectEqualStrings("claude", prefs.cli);
}

test "readSupervisorPrefs rejects an unsupported cli value" {
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();
    try tmp_dir.dir.writeFile(std.testing.io, .{ .sub_path = "supervisor.json", .data = "{\"cli\":\"gemini\"}" });

    const path = try std.fmt.allocPrint(std.testing.allocator, ".zig-cache/tmp/{s}/supervisor.json", .{tmp_dir.sub_path});
    defer std.testing.allocator.free(path);

    try std.testing.expectError(PrefsError.InvalidCli, readSupervisorPrefs(std.testing.io, std.testing.allocator, path));
}

pub fn main(init: std.process.Init) !void {
    _ = init;
    std.debug.print("PixelboxSupervisor skeleton\n", .{});
}
```

This entire function plus both tests (including the `.zig-cache/tmp/{s}/` path construction) was compiled and run verbatim against the installed toolchain during planning — `zig test` reported both tests passing.

- [ ] **Step 3: Run the tests**

Run: `zig build test-supervisor`
Expected: PASS (5 tests). If `PrefsError`'s composed error set doesn't line up (per the Step 2 note), fix it here before proceeding — do not move on with a non-compiling test file.

- [ ] **Step 4: Replace the skeleton `main()` with the real spawn loop**

Replace just the `pub fn main(init: std.process.Init) !void { ... }` block at the bottom of `src/supervisor_main.zig` with:

```zig
extern "c" fn _NSGetExecutablePath(buf: ?[*:0]u8, bufsize: *u32) c_int;

fn selfExecutablePath(allocator: std.mem.Allocator) ![]const u8 {
    var size: u32 = 0;
    _ = _NSGetExecutablePath(null, &size);
    const buf = try allocator.allocSentinel(u8, size, 0);
    defer allocator.free(buf);
    if (_NSGetExecutablePath(buf.ptr, &size) != 0) return error.PathTooLong;
    return allocator.dupe(u8, buf[0..std.mem.len(buf.ptr)]);
}

fn prefsFilePath(allocator: std.mem.Allocator, environ_map: *std.process.Environ.Map) ![]const u8 {
    const home = environ_map.get("HOME") orelse return error.NoHomeDir;
    return std.fs.path.join(allocator, &.{ home, "Library", "Application Support", "Pixelbox", "supervisor.json" });
}

fn coreExecutablePath(allocator: std.mem.Allocator) ![]const u8 {
    const self_path = try selfExecutablePath(allocator);
    defer allocator.free(self_path);
    const dir = std.fs.path.dirname(self_path) orelse ".";
    return std.fs.path.join(allocator, &.{ dir, "PixelboxCore" });
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;

    const core_path = try coreExecutablePath(allocator);
    defer allocator.free(core_path);

    while (true) {
        var argv = [_][]const u8{core_path};
        var child = try std.process.spawn(init.io, .{ .argv = &argv });
        const term = try child.wait(init.io);

        switch (decideAction(term)) {
            .quit => {
                std.debug.print("PixelboxCore exited cleanly. Supervisor exiting.\n", .{});
                return;
            },
            .relaunch => {
                std.debug.print("PixelboxCore exited unexpectedly ({any}). Relaunching.\n", .{term});
                // Task 6 inserts the crash-diagnosis window call here, between
                // detecting the crash and looping back to relaunch.
            },
        }
    }
}
```

`prefsFilePath` is written now but not called yet — Task 6 wires it into the `.relaunch` branch alongside `readSupervisorPrefs`. It's included here rather than in Task 6 because it's simple, self-contained, and worth compiling now rather than accumulating untested new code across two tasks.

- [ ] **Step 5: Build and manually verify the spawn loop**

Run: `zig build`
Expected: Both `zig-out/bin/Pixelbox` and `zig-out/bin/PixelboxSupervisor` build without errors.

Run:
```bash
mkdir -p /tmp/PixelboxCore-test
cp zig-out/bin/Pixelbox /tmp/PixelboxCore-test/PixelboxCore
cp zig-out/bin/PixelboxSupervisor /tmp/PixelboxCore-test/
cd /tmp/PixelboxCore-test && ./PixelboxSupervisor
```
This simulates the two binaries sitting side-by-side the way they will in the real bundle (Task 7 does this for real). Expected: `PixelboxCore` (really the full Pixelbox app, since we copied the real binary for this smoke test) launches. Quit it via Cmd+Q. Expected: supervisor prints `PixelboxCore exited cleanly. Supervisor exiting.` and the supervisor process itself exits — confirming the exit-code-0 clean-quit path works end-to-end before any crash-handling code exists.

Run it again, this time force-quit `PixelboxCore` from Activity Monitor (SIGKILL) instead of Cmd+Q.
Expected: supervisor prints the relaunch message and immediately spawns `PixelboxCore` again (loops). Ctrl-C the supervisor to stop this manual test.

- [ ] **Step 6: Commit**

```bash
git add src/supervisor_main.zig build.zig
git commit -m "feat: add supervisor spawn/relaunch loop and prefs file reader"
```

---

### Task 3: First-run CLI picker in PixelboxCore's webview

**Files:**
- Modify: `renderer/index.html` (onboarding modal markup)
- Modify: `renderer/app.js` (show-once logic, save handler)
- Modify: `bridge/server.js` (new endpoint to write the prefs file)
- Modify: `renderer/zero-api.js` (bridge method)

**Interfaces:**
- Produces: `/api/supervisor/setPreferredCli` (`{ cli: 'codex' | 'claude' }` → `{ ok: true }`), writing to the same path Task 2's `prefsFilePath()` computes (`~/Library/Application Support/Pixelbox/supervisor.json`).

- [ ] **Step 1: Add the bridge endpoint**

In `bridge/server.js`, add near the other `/api/preview/*` handlers (any point in the `handleApi` chain, e.g. right after the `/api/renderer/watchStart` block at `bridge/server.js:437-440`):

```js
  if (pathname === '/api/supervisor/setPreferredCli') {
    const cli = body.cli;
    if (cli !== 'codex' && cli !== 'claude') {
      return sendJson(res, 400, { error: 'cli must be "codex" or "claude"' });
    }
    const prefsDir = path.join(os.homedir(), 'Library', 'Application Support', 'Pixelbox');
    await fsp.mkdir(prefsDir, { recursive: true });
    await fsp.writeFile(path.join(prefsDir, 'supervisor.json'), JSON.stringify({ cli }), 'utf8');
    return sendJson(res, 200, { ok: true });
  }
```

- [ ] **Step 2: Add the bridge method**

In `renderer/zero-api.js`, add next to the other `preview*`/`terminal*` methods:

```js
    setSupervisorPreferredCli: (cli) => request('/api/supervisor/setPreferredCli', { cli }),
```

- [ ] **Step 3: Add the onboarding modal markup**

In `renderer/index.html`, add just before the closing `</body>` tag (find it with `grep -n '</body>' renderer/index.html` — append immediately before that line):

```html
    <div id="supervisor-onboarding-modal" hidden>
      <div id="supervisor-onboarding-card">
        <h2>Choose your AI CLI</h2>
        <p>Pixelbox can automatically diagnose and fix crashes using an AI agent. Pick which CLI it should use — you can't change this later without editing the prefs file directly.</p>
        <div id="supervisor-onboarding-actions">
          <button id="supervisor-onboarding-codex" type="button">Codex</button>
          <button id="supervisor-onboarding-claude" type="button">Claude</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Add minimal CSS for the modal**

In `renderer/styles.css`, add:

```css
#supervisor-onboarding-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

#supervisor-onboarding-modal[hidden] {
  display: none;
}

#supervisor-onboarding-card {
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  max-width: 360px;
  display: grid;
  gap: 12px;
  color: var(--text);
}

#supervisor-onboarding-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

#supervisor-onboarding-actions button {
  border: 1px solid var(--border);
  background: var(--cta);
  color: var(--text);
  border-radius: 999px;
  padding: 8px 16px;
  cursor: pointer;
}
```

- [ ] **Step 5: Wire the show-once logic and save handlers**

In `renderer/app.js`, add near the bottom of the file, in the same initialization region where other one-time startup wiring lives (search for the final top-level function calls at the end of the file — the last few lines that actually invoke setup functions rather than just declaring them):

```js
async function maybeShowSupervisorOnboarding() {
  const modal = document.getElementById('supervisor-onboarding-modal');
  if (!modal) return;
  let alreadyConfigured = false;
  try {
    const { content } = await window.api.readFile('/../../Library/Application Support/Pixelbox/supervisor.json');
    alreadyConfigured = Boolean(content && content.trim());
  } catch {
    alreadyConfigured = false;
  }
  if (alreadyConfigured) return;
  modal.hidden = false;

  const choose = async (cli) => {
    await window.api.setSupervisorPreferredCli(cli);
    modal.hidden = true;
  };
  document.getElementById('supervisor-onboarding-codex').addEventListener('click', () => choose('codex'));
  document.getElementById('supervisor-onboarding-claude').addEventListener('click', () => choose('claude'));
}

maybeShowSupervisorOnboarding();
```

Note: `window.api.readFile` (`renderer/zero-api.js:50`) resolves paths through `workspaceFs.resolveWorkspacePath`, which is scoped to the *workspace* root, not arbitrary filesystem paths — the relative-path hack above (`/../../Library/...`) is almost certainly wrong for reaching a path outside the workspace sandbox. Add a second small bridge endpoint instead of fighting the workspace path resolver:

```js
  if (pathname === '/api/supervisor/getPreferredCli') {
    const prefsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Pixelbox', 'supervisor.json');
    try {
      const raw = await fsp.readFile(prefsPath, 'utf8');
      return sendJson(res, 200, JSON.parse(raw));
    } catch {
      return sendJson(res, 200, { cli: null });
    }
  }
```

(Add this in `bridge/server.js` right next to the `setPreferredCli` handler from Step 1.) Add the matching `zero-api.js` method next to `setSupervisorPreferredCli`:

```js
    getSupervisorPreferredCli: () => request('/api/supervisor/getPreferredCli'),
```

And fix `maybeShowSupervisorOnboarding` to use it instead of the broken `readFile` path hack:

```js
async function maybeShowSupervisorOnboarding() {
  const modal = document.getElementById('supervisor-onboarding-modal');
  if (!modal) return;
  const { cli } = await window.api.getSupervisorPreferredCli();
  if (cli) return;
  modal.hidden = false;

  const choose = async (chosenCli) => {
    await window.api.setSupervisorPreferredCli(chosenCli);
    modal.hidden = true;
  };
  document.getElementById('supervisor-onboarding-codex').addEventListener('click', () => choose('codex'));
  document.getElementById('supervisor-onboarding-claude').addEventListener('click', () => choose('claude'));
}

maybeShowSupervisorOnboarding();
```

- [ ] **Step 6: Manual verification**

Per project convention, do not run `npm run build` for local testing — relaunch Pixelbox (`zig build run`, or reload if already running per the `/run` skill's guidance for this repo) and confirm:
1. `rm -f ~/Library/Application\ Support/Pixelbox/supervisor.json` (start from a clean state).
2. Reload the app — the onboarding modal appears.
3. Click "Claude" — modal disappears.
4. `cat ~/Library/Application\ Support/Pixelbox/supervisor.json` shows `{"cli":"claude"}`.
5. Reload the app again — modal does *not* reappear.

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/app.js renderer/styles.css renderer/zero-api.js bridge/server.js
git commit -m "feat: add first-run AI CLI picker for supervisor prefs"
```

---

### Task 4: Minimal crash window (blank NSWindow, no Ghostty yet)

**Files:**
- Create: `vendor/zero-native/src/platform/macos/supervisor_host.m`
- Create: `vendor/zero-native/src/platform/macos/supervisor_host.h`
- Modify: `build.zig` (link this file + AppKit for the supervisor target)

**Interfaces:**
- Produces: a C function `int zero_native_supervisor_show_crash_window(const char *message)` — blocks until the user clicks a "Close" button, then returns `0`. Task 5 replaces the window's body with a real Ghostty terminal view; Task 6 calls this function (by then upgraded) from `supervisor_main.zig`.

This task exists specifically to validate the Zig↔ObjC FFI boundary and NSApplication run-loop handoff *before* adding Ghostty's complexity on top — isolates failures to one layer at a time, given how easily native crashes happened earlier this session.

- [ ] **Step 1: Write the minimal ObjC window**

Create `vendor/zero-native/src/platform/macos/supervisor_host.h`:

```c
#ifndef ZERO_NATIVE_SUPERVISOR_HOST_H
#define ZERO_NATIVE_SUPERVISOR_HOST_H

int zero_native_supervisor_show_crash_window(const char *message, unsigned long message_len);

#endif
```

Create `vendor/zero-native/src/platform/macos/supervisor_host.m`:

```objc
#import <Cocoa/Cocoa.h>
#import "supervisor_host.h"

@interface ZeroNativeSupervisorWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic, assign) BOOL closed;
@end

@implementation ZeroNativeSupervisorWindowDelegate
- (void)windowWillClose:(NSNotification *)notification {
    (void)notification;
    self.closed = YES;
    [NSApp stop:nil];
}
@end

int zero_native_supervisor_show_crash_window(const char *message, unsigned long message_len) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

        NSString *messageString = [[NSString alloc] initWithBytes:message
                                                             length:message_len
                                                           encoding:NSUTF8StringEncoding] ?: @"";

        NSRect frame = NSMakeRect(0, 0, 720, 420);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                        styleMask:(NSWindowStyleMaskTitled |
                                                                   NSWindowStyleMaskClosable |
                                                                   NSWindowStyleMaskResizable)
                                                          backing:NSBackingStoreBuffered
                                                            defer:NO];
        window.title = @"Pixelbox crashed";
        [window center];

        ZeroNativeSupervisorWindowDelegate *delegate = [[ZeroNativeSupervisorWindowDelegate alloc] init];
        window.delegate = delegate;

        NSTextView *textView = [[NSTextView alloc] initWithFrame:frame];
        textView.editable = NO;
        textView.string = messageString;
        textView.font = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];

        NSScrollView *scrollView = [[NSScrollView alloc] initWithFrame:frame];
        scrollView.documentView = textView;
        scrollView.hasVerticalScroller = YES;
        scrollView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        window.contentView = scrollView;

        [window makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];

        [NSApp run];

        return 0;
    }
}
```

Note: `[NSApp run]` blocks until `[NSApp stop:nil]` is called (from `windowWillClose:`), which is what makes this a synchronous, blocking call from Zig's perspective — exactly matching `supervisor_main.zig`'s sequential loop (spawn → wait → *(this blocking call)* → relaunch). `[NSApp stop:nil]` only breaks the run loop on the *next* event; the delegate posts no explicit wake event here because closing the window itself generates the event that unblocks `run`.

- [ ] **Step 2: Link this file into the supervisor target**

In `build.zig`, add a new function near `linkPlatform` (`build.zig:177`):

```zig
fn linkSupervisorMacos(b: *std.Build, supervisor_mod: *std.Build.Module, zero_native_path: []const u8) void {
    supervisor_mod.addCSourceFile(.{
        .file = zeroNativePath(b, zero_native_path, "src/platform/macos/supervisor_host.m"),
        .flags = &.{"-fobjc-arc"},
    });
    supervisor_mod.linkFramework("Cocoa", .{});
    supervisor_mod.linkSystemLibrary("c", .{});
}
```

In `pub fn build`, right after the Task 1 `supervisor_exe`/`b.installArtifact(supervisor_exe)` lines, add:

```zig
    if (selected_platform == .macos) {
        linkSupervisorMacos(b, supervisor_mod, zero_native_path);
    }
```

- [ ] **Step 3: Add a Zig `extern` binding and a temporary test call from `main()`**

In `src/supervisor_main.zig`, add near the top (after `const std = @import("std");`):

```zig
extern fn zero_native_supervisor_show_crash_window(message: [*]const u8, message_len: c_ulong) c_int;
```

Temporarily add a test invocation right after the `while (true) {` loop's `.relaunch =>` branch print statement from Task 2 (this is a throwaway smoke test call — Task 6 replaces it with the real diagnostic-prompt call):

```zig
            .relaunch => {
                std.debug.print("PixelboxCore exited unexpectedly ({any}). Relaunching.\n", .{term});
                const msg = "Smoke test: crash window from Task 4.";
                _ = zero_native_supervisor_show_crash_window(msg.ptr, msg.len);
            },
```

- [ ] **Step 4: Build and manually verify**

Run: `zig build`
Expected: Compiles without errors. Fix any ObjC/Zig linkage errors before proceeding (common ones: missing `-fobjc-arc` flag, or forgetting `Cocoa` framework — both already included above, but if the compiler reports otherwise, this is the moment to fix it, not later).

Repeat the manual test from Task 2 Step 5 (copy both binaries to `/tmp/PixelboxCore-test/`, run `./PixelboxSupervisor`, force-quit `PixelboxCore` via Activity Monitor). Expected: after the relaunch message prints, a window titled "Pixelbox crashed" appears showing "Smoke test: crash window from Task 4." Click the window's close button. Expected: the window closes and `PixelboxCore` relaunches immediately after (the blocking call returns, the loop continues).

- [ ] **Step 5: Commit**

```bash
git add vendor/zero-native/src/platform/macos/supervisor_host.m vendor/zero-native/src/platform/macos/supervisor_host.h build.zig src/supervisor_main.zig
git commit -m "feat: add minimal crash window and verify Zig/ObjC FFI boundary"
```

---

### Task 5: Embed the Ghostty terminal view in the crash window

**Files:**
- Modify: `vendor/zero-native/src/platform/macos/supervisor_host.m` (replace `NSTextView` with a Ghostty terminal surface)
- Modify: `build.zig` (link Ghostty into the supervisor target)

**Interfaces:**
- Produces: `int zero_native_supervisor_run_crash_terminal(const char *command, unsigned long command_len, const char *working_directory, unsigned long working_directory_len)` — replaces Task 4's `show_crash_window` function; runs `command` in the embedded terminal, blocks until that process exits, returns `0`. Task 6 calls this exact function from `supervisor_main.zig`.

- [ ] **Step 1: Link Ghostty into the supervisor target**

`build.zig`'s existing `linkPlatform` (`build.zig:177-218`) already shows exactly which pieces are needed for Ghostty specifically (as opposed to the webview-related WebKit linking, which this task's window does not need). Replace the `linkSupervisorMacos` function from Task 4 with:

```zig
fn linkSupervisorMacos(b: *std.Build, supervisor_exe: *std.Build.Step.Compile, supervisor_mod: *std.Build.Module, zero_native_path: []const u8, ghostty_path: []const u8, ghostty_zig_path: []const u8) void {
    const ghostty_build = addGhosttyBuild(b, ghostty_path, ghostty_zig_path);
    supervisor_exe.step.dependOn(&ghostty_build.step);
    const ghostty_include = b.pathJoin(&.{ ghostty_path, "zig-out", "include" });
    const ghostty_lib = b.pathJoin(&.{ ghostty_path, "zig-out", "lib", "ghostty-internal.a" });
    const ghostty_include_flag = b.fmt("-I{s}", .{ghostty_include});

    supervisor_mod.addCSourceFile(.{
        .file = zeroNativePath(b, zero_native_path, "src/platform/macos/supervisor_host.m"),
        .flags = &.{ "-fobjc-arc", "-ObjC", ghostty_include_flag },
    });
    supervisor_mod.linkFramework("Cocoa", .{});
    supervisor_mod.linkFramework("Metal", .{});
    supervisor_mod.linkFramework("CoreGraphics", .{});
    supervisor_mod.linkFramework("CoreText", .{});
    supervisor_mod.linkFramework("CoreVideo", .{});
    supervisor_mod.linkFramework("QuartzCore", .{});
    supervisor_mod.linkFramework("IOSurface", .{});
    supervisor_mod.linkFramework("Carbon", .{});
    supervisor_mod.linkFramework("Foundation", .{});
    supervisor_mod.linkFramework("UniformTypeIdentifiers", .{});
    supervisor_mod.addObjectFile(.{ .cwd_relative = ghostty_lib });
    supervisor_mod.linkSystemLibrary("c", .{});
    supervisor_mod.linkSystemLibrary("c++", .{});
}
```

Update the call site in `pub fn build` (added in Task 4 Step 2) to pass the extra arguments:

```zig
    if (selected_platform == .macos) {
        linkSupervisorMacos(b, supervisor_exe, supervisor_mod, zero_native_path, ghostty_path, ghostty_zig_path);
    }
```

- [ ] **Step 2: Replace the window body with a Ghostty terminal surface**

Replace the entire contents of `vendor/zero-native/src/platform/macos/supervisor_host.m` with:

```objc
#import <Cocoa/Cocoa.h>
#import "supervisor_host.h"
#import "ghostty.h"

@interface ZeroNativeSupervisorTerminalView : NSView
@property(nonatomic, assign) ghostty_surface_t surface;
@end

@implementation ZeroNativeSupervisorTerminalView

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (BOOL)wantsUpdateLayer {
    return YES;
}

- (void)keyDown:(NSEvent *)event {
    if (!self.surface) return;
    NSString *characters = event.characters ?: @"";
    ghostty_input_key_s keyEvent = {0};
    keyEvent.action = GHOSTTY_ACTION_PRESS;
    keyEvent.text = characters.UTF8String;
    ghostty_surface_key(self.surface, keyEvent);
}

- (void)mouseDown:(NSEvent *)event {
    (void)event;
    if (self.window) [self.window makeFirstResponder:self];
}

@end

typedef struct {
    ghostty_app_t app;
    ghostty_surface_t surface;
    BOOL processExited;
} ZeroNativeSupervisorContext;

static void ZeroNativeSupervisorWakeup(void *userdata) {
    ZeroNativeSupervisorContext *ctx = (ZeroNativeSupervisorContext *)userdata;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (ctx->app) ghostty_app_tick(ctx->app);
    });
}

static bool ZeroNativeSupervisorAction(ghostty_app_t app, ghostty_target_s target, ghostty_action_s action) {
    (void)app;
    (void)target;
    (void)action;
    return false;
}

static bool ZeroNativeSupervisorReadClipboard(void *userdata, ghostty_clipboard_e clipboard, void *state) {
    (void)userdata;
    (void)clipboard;
    (void)state;
    return false;
}

static void ZeroNativeSupervisorConfirmReadClipboard(void *userdata, const char *value, void *state, ghostty_clipboard_request_e request) {
    (void)userdata;
    (void)value;
    (void)state;
    (void)request;
}

static void ZeroNativeSupervisorWriteClipboard(void *userdata, ghostty_clipboard_e clipboard, const ghostty_clipboard_content_s *contents, size_t count, bool confirm) {
    (void)userdata;
    (void)clipboard;
    (void)contents;
    (void)count;
    (void)confirm;
}

static void ZeroNativeSupervisorCloseSurface(void *userdata, bool process_alive) {
    (void)process_alive;
    ZeroNativeSupervisorContext *ctx = (ZeroNativeSupervisorContext *)userdata;
    dispatch_async(dispatch_get_main_queue(), ^{
      ctx->processExited = YES;
      [NSApp stop:nil];
    });
}

int zero_native_supervisor_run_crash_terminal(const char *command, unsigned long command_len, const char *working_directory, unsigned long working_directory_len) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

        NSString *commandString = [[NSString alloc] initWithBytes:command length:command_len encoding:NSUTF8StringEncoding] ?: @"";
        NSString *workingDirectoryString = [[NSString alloc] initWithBytes:working_directory length:working_directory_len encoding:NSUTF8StringEncoding] ?: @".";

        if (!ghostty_config_new) {
            return 1;
        }

        ghostty_config_t config = ghostty_config_new();
        ghostty_config_load_default_files(config);
        ghostty_config_finalize(config);

        ZeroNativeSupervisorContext ctx = {0};

        ghostty_runtime_config_s runtimeConfig = {0};
        runtimeConfig.userdata = &ctx;
        runtimeConfig.supports_selection_clipboard = false;
        runtimeConfig.wakeup_cb = ZeroNativeSupervisorWakeup;
        runtimeConfig.action_cb = ZeroNativeSupervisorAction;
        runtimeConfig.read_clipboard_cb = ZeroNativeSupervisorReadClipboard;
        runtimeConfig.confirm_read_clipboard_cb = ZeroNativeSupervisorConfirmReadClipboard;
        runtimeConfig.write_clipboard_cb = ZeroNativeSupervisorWriteClipboard;
        runtimeConfig.close_surface_cb = ZeroNativeSupervisorCloseSurface;

        ghostty_app_t app = ghostty_app_new(&runtimeConfig, config);
        if (!app) {
            ghostty_config_free(config);
            return 1;
        }
        ctx.app = app;

        NSRect frame = NSMakeRect(0, 0, 900, 500);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                        styleMask:(NSWindowStyleMaskTitled |
                                                                   NSWindowStyleMaskClosable |
                                                                   NSWindowStyleMaskResizable)
                                                          backing:NSBackingStoreBuffered
                                                            defer:NO];
        window.title = @"Pixelbox crashed — diagnosing";
        [window center];

        ZeroNativeSupervisorTerminalView *view = [[ZeroNativeSupervisorTerminalView alloc] initWithFrame:frame];
        window.contentView = view;

        ghostty_surface_config_s surfaceConfig = ghostty_surface_config_new();
        surfaceConfig.platform_tag = GHOSTTY_PLATFORM_MACOS;
        surfaceConfig.platform.macos.nsview = (__bridge void *)view;
        surfaceConfig.scale_factor = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1.0;
        surfaceConfig.font_size = 13.0f;
        surfaceConfig.working_directory = workingDirectoryString.UTF8String;
        surfaceConfig.command = commandString.UTF8String;
        surfaceConfig.wait_after_command = false;
        surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_WINDOW;

        ghostty_surface_t surface = ghostty_surface_new(app, &surfaceConfig);
        if (!surface) {
            ghostty_app_free(app);
            ghostty_config_free(config);
            return 1;
        }
        ctx.surface = surface;
        view.surface = surface;

        [window makeKeyAndOrderFront:nil];
        [window makeFirstResponder:view];
        [NSApp activateIgnoringOtherApps:YES];

        [NSApp run];

        ghostty_surface_free(surface);
        ghostty_app_free(app);
        ghostty_config_free(config);

        return 0;
    }
}
```

Update `vendor/zero-native/src/platform/macos/supervisor_host.h` to match the new function:

```c
#ifndef ZERO_NATIVE_SUPERVISOR_HOST_H
#define ZERO_NATIVE_SUPERVISOR_HOST_H

int zero_native_supervisor_run_crash_terminal(const char *command, unsigned long command_len, const char *working_directory, unsigned long working_directory_len);

#endif
```

Note on the `keyDown:`/`ghostty_input_key_s` shape in the terminal view: this is a simplified adaptation, not a line-for-line copy of `appkit_host.m`'s much more complete `ZeroNativeGhosttyTerminalView` (which also handles modifier keys, mouse drag/scroll, IME composition, and dozens of edge cases across ~350 lines). Verify the exact `ghostty_input_key_s` field names and the correct action enum against `vendor/ghostty/include/ghostty.h` during Step 3's build — if the compiler reports mismatched field names, fix them there against the header rather than guessing further, since this plan's author has read `ghostty.h` but not exhaustively cross-checked every struct field for this specific simplified rewrite.

- [ ] **Step 3: Update the Zig `extern` declaration**

In `src/supervisor_main.zig`, replace the `extern fn zero_native_supervisor_show_crash_window(...)` line from Task 4 with:

```zig
extern fn zero_native_supervisor_run_crash_terminal(command: [*]const u8, command_len: c_ulong, working_directory: [*]const u8, working_directory_len: c_ulong) c_int;
```

And replace the Task 4 smoke-test call site with:

```zig
            .relaunch => {
                std.debug.print("PixelboxCore exited unexpectedly ({any}). Relaunching.\n", .{term});
                const cmd = "echo 'smoke test: task 5 terminal'; sleep 3600";
                _ = zero_native_supervisor_run_crash_terminal(cmd.ptr, cmd.len, ".".ptr, 1);
            },
```

(`sleep 3600` keeps the shell alive so the manual test in Step 4 has time to confirm the terminal is interactive before closing the window — Task 6 replaces this whole call with the real AI CLI invocation.)

- [ ] **Step 4: Build and manually verify**

Run: `zig build`
Expected: compiles. This is the highest-risk build in this plan — if `ghostty_input_key_s` or other struct fields don't match, fix them against `vendor/ghostty/include/ghostty.h` before proceeding, per the note in Step 2.

Repeat the manual crash-simulation test (copy binaries to `/tmp/PixelboxCore-test/`, run supervisor, force-quit core). Expected: a window titled "Pixelbox crashed — diagnosing" appears showing a live terminal with `smoke test: task 5 terminal` printed and a running shell. Type a command (e.g. `ls`) and confirm it executes and echoes back — this confirms keyboard input reaches the PTY. Close the window. Expected: the window closes and `PixelboxCore` relaunches.

- [ ] **Step 5: Commit**

```bash
git add vendor/zero-native/src/platform/macos/supervisor_host.m vendor/zero-native/src/platform/macos/supervisor_host.h build.zig src/supervisor_main.zig
git commit -m "feat: embed a real Ghostty terminal in the supervisor crash window"
```

---

### Task 6: Wire the real diagnostic prompt

**Files:**
- Modify: `src/supervisor_main.zig` (build the real crash-diagnosis command instead of the Task 5 smoke test, read `cli` from prefs)

**Interfaces:**
- Consumes: `readSupervisorPrefs` (Task 2), `zero_native_supervisor_run_crash_terminal` (Task 5).

- [ ] **Step 1: Build the diagnostic command string and call it from the relaunch branch**

Replace the `.relaunch =>` branch (from Task 5 Step 3) and the surrounding loop body in `src/supervisor_main.zig`'s `main()` with:

```zig
pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;

    const core_path = try coreExecutablePath(allocator);
    defer allocator.free(core_path);

    const prefs_path = try prefsFilePath(allocator, init.environ_map);
    defer allocator.free(prefs_path);

    while (true) {
        var argv = [_][]const u8{core_path};
        var child = try std.process.spawn(init.io, .{ .argv = &argv });
        const term = try child.wait(init.io);

        switch (decideAction(term)) {
            .quit => {
                std.debug.print("PixelboxCore exited cleanly. Supervisor exiting.\n", .{});
                return;
            },
            .relaunch => {
                std.debug.print("PixelboxCore exited unexpectedly ({any}). Diagnosing.\n", .{term});

                const prefs = readSupervisorPrefs(init.io, allocator, prefs_path) catch null;
                if (prefs) |p| {
                    defer allocator.free(p.cli);
                    const binary = if (std.mem.eql(u8, p.cli, "codex")) "codex" else "claude";
                    const flag = if (std.mem.eql(u8, p.cli, "codex")) "--dangerously-bypass-approvals-and-sandbox" else "--dangerously-skip-permissions";
                    const term_description = switch (term) {
                        .exited => |code| try std.fmt.allocPrint(allocator, "exit code {d}", .{code}),
                        .signal => |sig| try std.fmt.allocPrint(allocator, "signal {d}", .{@intFromEnum(sig)}),
                        else => try allocator.dupe(u8, "an unknown termination"),
                    };
                    defer allocator.free(term_description);

                    const prompt = try std.fmt.allocPrint(
                        allocator,
                        "PixelboxCore just crashed ({s}). Diagnose the Zig/Objective-C source in this repository and fix it, then run 'zig build' to confirm it compiles, then exit.",
                        .{term_description},
                    );
                    defer allocator.free(prompt);

                    const command = try std.fmt.allocPrint(allocator, "{s} {s} '{s}'", .{ binary, flag, prompt });
                    defer allocator.free(command);

                    const cwd = try std.process.currentPathAlloc(init.io, allocator);
                    defer allocator.free(cwd);
                    _ = zero_native_supervisor_run_crash_terminal(command.ptr, command.len, cwd.ptr, cwd.len);
                } else {
                    std.debug.print("No AI CLI preference found (or it's invalid) — relaunching without diagnosis.\n", .{});
                }
            },
        }
    }
}
```

`std.process.currentPathAlloc(init.io, allocator)` is the same function `src/main.zig:79` already uses successfully to get the current working directory — reused here rather than a POSIX `getcwd` wrapper, since this Zig version's `std.posix` doesn't expose one directly (see Task 2's note on this toolchain's unusually `Io`-parameterized `std`).

Note on `prompt` potentially containing an embedded `'`: it won't here, since `term_description` is only digits and the words "exit code"/"signal"/"an unknown termination" — no user-controlled input flows into this string, so the naive single-quote wrapping in `command` is safe for this specific use.

- [ ] **Step 2: Build**

Run: `zig build`
Expected: compiles cleanly, since every API used here was already verified in Task 2.

- [ ] **Step 3: Manual end-to-end verification with a real AI CLI**

This requires `claude` or `codex` actually installed and authenticated, matching whatever was set in Task 3's onboarding.

1. Copy the freshly built `zig-out/bin/Pixelbox` and `zig-out/bin/PixelboxSupervisor` to `/tmp/PixelboxCore-test/` (as `PixelboxCore` and `PixelboxSupervisor` respectively, matching Task 2/4's manual test setup) — but this time run the supervisor from *this repository's directory* (`cd /Users/matthoffner/porch/pixelbox && /tmp/PixelboxCore-test/PixelboxSupervisor`) so the diagnostic agent's working directory is the real source tree it needs to fix.
2. Force-quit `PixelboxCore` from Activity Monitor.
3. Confirm the crash window opens and the configured CLI starts inside it with the diagnostic prompt as its initial message.
4. Watch it read the prompt and begin investigating (it won't find a real bug to fix since nothing is actually broken in this test — that's fine; confirm it responds sensibly, e.g. reports it can't find evidence of a crash, rather than erroring out or the terminal staying blank).
5. Exit the CLI (e.g. `/exit` or Ctrl-D) and confirm the window closes and `PixelboxCore` relaunches.

- [ ] **Step 4: Commit**

```bash
git add src/supervisor_main.zig
git commit -m "feat: wire real AI CLI diagnostic prompt into the crash window"
```

---

### Task 7: Packaging — bundle the supervisor as the app's entry point

**Files:**
- Create: `scripts/finalize-supervisor-bundle.sh`
- Modify: `build.zig` (add a `finalize-package` step depending on both `package` and the supervisor build)

**Interfaces:**
- Produces: a `zig build finalize-package` step that, after `zig build package -Dpackage-target=macos` has produced the `.app`, renames its core binary and installs the supervisor as the launched executable.

Confirmed empirically during planning (see below) that the current `zig build package -Dpackage-target=macos` produces `zig-out/package/Pixelbox-0.3.0-macos-Debug.app/Contents/MacOS/pixelbox` (lowercase, matching `app.zon`'s `.name = "pixelbox"`), with `Info.plist`'s `CFBundleExecutable` also `pixelbox` and `signing=none` (unsigned local build) — so no Info.plist edit and no re-signing concern for this plan.

- [ ] **Step 1: Write the finalize script**

Create `scripts/finalize-supervisor-bundle.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <path-to-.app-bundle> <path-to-PixelboxSupervisor-binary>" >&2
  exit 1
fi

APP_BUNDLE="$1"
SUPERVISOR_BINARY="$2"
MACOS_DIR="${APP_BUNDLE}/Contents/MacOS"

if [[ ! -d "${MACOS_DIR}" ]]; then
  echo "Expected ${MACOS_DIR} to exist — did 'zig build package' run first?" >&2
  exit 1
fi

CORE_BINARY=$(find "${MACOS_DIR}" -maxdepth 1 -type f | head -n 1)
if [[ -z "${CORE_BINARY}" ]]; then
  echo "No executable found in ${MACOS_DIR}" >&2
  exit 1
fi

CORE_NAME=$(basename "${CORE_BINARY}")
mv "${CORE_BINARY}" "${MACOS_DIR}/PixelboxCore"
cp "${SUPERVISOR_BINARY}" "${MACOS_DIR}/${CORE_NAME}"
chmod +x "${MACOS_DIR}/${CORE_NAME}" "${MACOS_DIR}/PixelboxCore"

echo "Finalized: Contents/MacOS/${CORE_NAME} is now the supervisor; the real app is Contents/MacOS/PixelboxCore"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/finalize-supervisor-bundle.sh`

- [ ] **Step 3: Add the build step**

In `build.zig`, after the existing `package_step` block (`build.zig:118-119`), add:

```zig
    const finalize_supervisor = b.addSystemCommand(&.{"scripts/finalize-supervisor-bundle.sh"});
    finalize_supervisor.addArg(b.fmt("zig-out/package/Pixelbox-0.3.0-{s}-{s}{s}", .{ @tagName(package_target), optimize_name, packageSuffix(package_target) }));
    finalize_supervisor.addFileArg(supervisor_exe.getEmittedBin());
    finalize_supervisor.step.dependOn(&package.step);
    finalize_supervisor.step.dependOn(&supervisor_exe.step);
    const finalize_package_step = b.step("finalize-package", "Package the app, then swap in the supervisor as the launched binary");
    finalize_package_step.dependOn(&finalize_supervisor.step);
```

Note: this duplicates the exact `b.fmt(...)` path-construction expression already used for `package`'s own `--output` argument (`build.zig:111`) — if that literal ever changes (e.g. the hardcoded `"0.3.0"` when the app version bumps), both call sites need updating together. This is pre-existing duplication in `build.zig` (the version string is already hardcoded once at line 111); this task doesn't introduce new drift risk beyond what already exists, just a second call site of the same pattern.

- [ ] **Step 4: Build and verify the finalized bundle**

Run: `PATH="$PWD/node_modules/.bin:$PATH" zig build finalize-package -Dpackage-target=macos`
Expected: succeeds, prints the "Finalized: ..." message from the script.

Run: `ls "zig-out/package/Pixelbox-0.3.0-macos-Debug.app/Contents/MacOS/"`
Expected: exactly two files, `pixelbox` (now the supervisor binary) and `PixelboxCore` (the real app).

Run: `open "zig-out/package/Pixelbox-0.3.0-macos-Debug.app"`
Expected: the app launches normally (Finder-launching it now goes through the supervisor, which spawns `PixelboxCore` — this should be indistinguishable from today's behavior on the happy path). Quit it normally (Cmd+Q from the app's own menu). Confirm via Activity Monitor (or `ps aux | grep Pixelbox`) that both the supervisor and core process have exited — a clean quit should leave nothing running.

Run it again and force-quit the `PixelboxCore` process specifically (not the supervisor) via Activity Monitor. Expected: the crash window opens exactly as verified manually in Task 6.

- [ ] **Step 5: Commit**

```bash
git add scripts/finalize-supervisor-bundle.sh build.zig
git commit -m "feat: package the supervisor as the app bundle's launched executable"
```

---

### Task 8: Update project documentation for the new binary layout

**Files:**
- Modify: `README.md` (only if it documents the packaging/build process — check first)
- Modify: `AGENTS.md` (only if relevant — check first; this file is about Pixelbox-as-a-dev-environment context, not its own build, so likely no change needed)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Check whether `README.md` documents packaging**

Run: `grep -n "zig build package\|Contents/MacOS\|CFBundleExecutable" README.md`

- [ ] **Step 2: If it does, add a note about the new layout**

If Step 1 found matches, add a short paragraph near them explaining: `zig build finalize-package -Dpackage-target=macos` is now the command to produce a distributable `.app` (not plain `zig build package`), and the bundle now contains two binaries (`Contents/MacOS/<name>` is the supervisor; `Contents/MacOS/PixelboxCore` is the real app). If Step 1 found no matches, skip this step — nothing to update.

- [ ] **Step 3: Commit (only if Step 2 made changes)**

```bash
git add README.md
git commit -m "docs: document the supervisor binary layout for packaging"
```
