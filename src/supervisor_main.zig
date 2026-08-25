const std = @import("std");

extern fn zero_native_supervisor_run_crash_terminal(command: [*]const u8, command_len: c_ulong, working_directory: [*]const u8, working_directory_len: c_ulong) c_int;

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

pub fn cliBinary(cli: []const u8) []const u8 {
    return if (std.mem.eql(u8, cli, "codex")) "codex" else "claude";
}

pub fn cliBypassFlag(cli: []const u8) []const u8 {
    return if (std.mem.eql(u8, cli, "codex"))
        "--dangerously-bypass-approvals-and-sandbox"
    else
        "--dangerously-skip-permissions";
}

pub fn cliDisplayName(cli: []const u8) []const u8 {
    return if (std.mem.eql(u8, cli, "codex")) "Codex CLI" else "Claude CLI";
}

/// Wraps `value` in single quotes, escaping any embedded single quote as the
/// POSIX `'\''` sequence, so the result survives as exactly one shell word.
pub fn shellSingleQuote(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const escaped = try std.mem.replaceOwned(u8, allocator, value, "'", "'\\''");
    defer allocator.free(escaped);
    return std.fmt.allocPrint(allocator, "'{s}'", .{escaped});
}

/// Assembles the crash-diagnosis command. The prompt is always emitted as one
/// properly escaped shell word: an apostrophe in the prompt text used to
/// terminate the outer quoting and split the prompt into two positional args,
/// which hard-fails Codex's single-positional clap parser and silently
/// truncates Claude's prompt mid-sentence.
///
/// `bypass_permissions` is false when no source tree was found — a
/// permission-bypassed agent rooted at `/` has nothing legitimate to edit.
pub fn buildCrashCommand(
    allocator: std.mem.Allocator,
    cli: []const u8,
    prompt: []const u8,
    bypass_permissions: bool,
) ![]u8 {
    const quoted = try shellSingleQuote(allocator, prompt);
    defer allocator.free(quoted);
    if (bypass_permissions) {
        return std.fmt.allocPrint(allocator, "{s} {s} {s}", .{ cliBinary(cli), cliBypassFlag(cli), quoted });
    }
    return std.fmt.allocPrint(allocator, "{s} {s}", .{ cliBinary(cli), quoted });
}

/// Mirrors `getStartupTerminalCommand` in bridge/server.js: when the CLI isn't
/// on PATH the crash terminal prints a human-readable line instead of a bare
/// "command not found".
pub fn guardCrashCommand(allocator: std.mem.Allocator, cli: []const u8, command: []const u8) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "if command -v {s} >/dev/null 2>&1; then {s}; else echo \"{s} not found in PATH — close this window to relaunch Pixelbox.\"; fi",
        .{ cliBinary(cli), command, cliDisplayName(cli) },
    );
}

/// Bounds the upward walk in `findSourceRoot`. Deep enough for any realistic
/// checkout, shallow enough that a pathological path can't spin.
const max_source_root_walk_depth: usize = 64;

/// Walks upward from `start_path` looking for a `build.zig`, returning the
/// owned path of the first directory that has one, or null if the walk reaches
/// the filesystem root (or the depth bound) without finding one.
///
/// A Finder-launched .app inherits a cwd of `/`, so the caller probes the
/// executable's own directory ancestry as a second starting point.
pub fn findSourceRoot(io: std.Io, allocator: std.mem.Allocator, start_path: []const u8) !?[]u8 {
    var current: []const u8 = start_path;
    var depth: usize = 0;
    while (depth < max_source_root_walk_depth) : (depth += 1) {
        const candidate = try std.fs.path.join(allocator, &.{ current, "build.zig" });
        defer allocator.free(candidate);
        const found = if (std.Io.Dir.cwd().access(io, candidate, .{})) true else |_| false;
        if (found) return try allocator.dupe(u8, current);

        const parent = std.fs.path.dirname(current) orelse return null;
        if (parent.len == current.len) return null;
        current = parent;
    }
    return null;
}

pub const fix_and_rebuild_brief = "Diagnose the Zig/Objective-C source in this repository and fix it, then run zig build to confirm it compiles, then exit.";
pub const diagnose_only_brief = "Diagnose the likely cause from the crash info and report your findings; do not attempt to modify any source.";

pub fn buildCrashPrompt(
    allocator: std.mem.Allocator,
    term_description: []const u8,
    has_source_root: bool,
) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "PixelboxCore just crashed ({s}). {s}",
        .{ term_description, if (has_source_root) fix_and_rebuild_brief else diagnose_only_brief },
    );
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

test "buildCrashCommand quotes the prompt as a single shell word" {
    const command = try buildCrashCommand(std.testing.allocator, "codex", "PixelboxCore just crashed (signal 11). Fix it.", true);
    defer std.testing.allocator.free(command);
    try std.testing.expectEqualStrings(
        "codex --dangerously-bypass-approvals-and-sandbox 'PixelboxCore just crashed (signal 11). Fix it.'",
        command,
    );
}

test "buildCrashCommand escapes an apostrophe in the prompt" {
    const command = try buildCrashCommand(std.testing.allocator, "claude", "run 'zig build' now", true);
    defer std.testing.allocator.free(command);
    try std.testing.expectEqualStrings(
        "claude --dangerously-skip-permissions 'run '\\''zig build'\\'' now'",
        command,
    );
}

test "buildCrashCommand omits the bypass flag when there is no source root" {
    const command = try buildCrashCommand(std.testing.allocator, "codex", "report only", false);
    defer std.testing.allocator.free(command);
    try std.testing.expectEqualStrings("codex 'report only'", command);
}

test "guardCrashCommand falls back to a message when the CLI is missing" {
    const guarded = try guardCrashCommand(std.testing.allocator, "codex", "codex 'hi'");
    defer std.testing.allocator.free(guarded);
    try std.testing.expectEqualStrings(
        "if command -v codex >/dev/null 2>&1; then codex 'hi'; else echo \"Codex CLI not found in PATH — close this window to relaunch Pixelbox.\"; fi",
        guarded,
    );
}

test "findSourceRoot walks upward to the nearest build.zig" {
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();
    try tmp_dir.dir.writeFile(std.testing.io, .{ .sub_path = "build.zig", .data = "" });
    try tmp_dir.dir.createDirPath(std.testing.io, "a/b");

    const root = try std.fmt.allocPrint(std.testing.allocator, ".zig-cache/tmp/{s}", .{tmp_dir.sub_path});
    defer std.testing.allocator.free(root);
    const start = try std.fmt.allocPrint(std.testing.allocator, "{s}/a/b", .{root});
    defer std.testing.allocator.free(start);

    const found = (try findSourceRoot(std.testing.io, std.testing.allocator, start)) orelse
        return error.TestExpectedSourceRoot;
    defer std.testing.allocator.free(found);
    try std.testing.expectEqualStrings(root, found);
}

test "findSourceRoot returns null when the walk reaches the filesystem root" {
    try std.testing.expectEqual(
        @as(?[]u8, null),
        try findSourceRoot(std.testing.io, std.testing.allocator, "/"),
    );
}

test "buildCrashPrompt switches to a report-only brief without a source root" {
    const fix = try buildCrashPrompt(std.testing.allocator, "signal 11", true);
    defer std.testing.allocator.free(fix);
    try std.testing.expect(std.mem.indexOf(u8, fix, "run zig build") != null);
    // The prompt must never carry quotes that the shell would have to survive.
    try std.testing.expect(std.mem.indexOfScalar(u8, fix, '\'') == null);

    const report = try buildCrashPrompt(std.testing.allocator, "signal 11", false);
    defer std.testing.allocator.free(report);
    try std.testing.expect(std.mem.indexOf(u8, report, "do not attempt to modify any source") != null);
}

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
                    const term_description = switch (term) {
                        .exited => |code| try std.fmt.allocPrint(allocator, "exit code {d}", .{code}),
                        .signal => |sig| try std.fmt.allocPrint(allocator, "signal {d}", .{@intFromEnum(sig)}),
                        else => try allocator.dupe(u8, "an unknown termination"),
                    };
                    defer allocator.free(term_description);

                    const cwd = try std.process.currentPathAlloc(init.io, allocator);
                    defer allocator.free(cwd);

                    // A Finder-launched .app inherits a cwd of "/", so probe the
                    // executable's own ancestry too before giving up.
                    var source_root = findSourceRoot(init.io, allocator, cwd) catch null;
                    if (source_root == null) {
                        const core_dir = std.fs.path.dirname(core_path) orelse ".";
                        source_root = findSourceRoot(init.io, allocator, core_dir) catch null;
                    }
                    defer if (source_root) |root| allocator.free(root);

                    const prompt = try buildCrashPrompt(allocator, term_description, source_root != null);
                    defer allocator.free(prompt);

                    // Without a source tree there is nothing to fix, so the agent
                    // runs plain — no permission bypass rooted at "/".
                    const raw_command = try buildCrashCommand(allocator, p.cli, prompt, source_root != null);
                    defer allocator.free(raw_command);

                    const command = try guardCrashCommand(allocator, p.cli, raw_command);
                    defer allocator.free(command);

                    const working_directory = source_root orelse cwd;
                    _ = zero_native_supervisor_run_crash_terminal(
                        command.ptr,
                        command.len,
                        working_directory.ptr,
                        working_directory.len,
                    );
                } else {
                    std.debug.print("No AI CLI preference found (or it's invalid) — relaunching without diagnosis.\n", .{});
                }
            },
        }
    }
}
