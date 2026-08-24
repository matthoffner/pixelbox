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
                const cmd = "echo 'smoke test: task 5 terminal'; exec /bin/zsh -il";
                _ = zero_native_supervisor_run_crash_terminal(cmd.ptr, cmd.len, ".".ptr, 1);
                // Task 6 inserts the crash-diagnosis window call here, between
                // detecting the crash and looping back to relaunch.
            },
        }
    }
}
