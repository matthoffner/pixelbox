const std = @import("std");
const build_options = @import("build_options");
const zero_native = @import("zero-native");

pub const StdoutTraceSink = struct {
    pub fn sink(self: *StdoutTraceSink) zero_native.trace.Sink {
        return .{ .context = self, .write_fn = write };
    }

    fn write(context: *anyopaque, record: zero_native.trace.Record) zero_native.trace.WriteError!void {
        _ = context;
        if (!shouldTrace(record)) return;
        var buffer: [1024]u8 = undefined;
        var writer = std.Io.Writer.fixed(&buffer);
        zero_native.trace.formatText(record, &writer) catch return error.OutOfSpace;
        std.debug.print("{s}\n", .{writer.buffered()});
    }
};

pub const RunOptions = struct {
    app_name: []const u8,
    window_title: []const u8 = "",
    bundle_id: []const u8,
    icon_path: []const u8 = "assets/pixelbox.icns",
    bridge: ?zero_native.BridgeDispatcher = null,
    builtin_bridge: zero_native.BridgePolicy = .{},
    security: zero_native.SecurityPolicy = .{},

    fn appInfo(self: RunOptions) zero_native.AppInfo {
        return .{
            .app_name = self.app_name,
            .window_title = self.window_title,
            .bundle_id = self.bundle_id,
            .icon_path = self.icon_path,
        };
    }
};

pub fn runWithOptions(app: zero_native.App, options: RunOptions, init: std.process.Init) !void {
    if (comptime std.mem.eql(u8, build_options.platform, "macos")) {
        try runMacos(app, options, init);
    } else if (comptime std.mem.eql(u8, build_options.platform, "linux")) {
        try runLinux(app, options, init);
    } else if (comptime std.mem.eql(u8, build_options.platform, "windows")) {
        try runWindows(app, options, init);
    } else {
        try runNull(app, options, init);
    }
}

fn runNull(app: zero_native.App, options: RunOptions, init: std.process.Init) !void {
    var app_info = options.appInfo();
    var null_platform = zero_native.NullPlatform.initWithOptions(.{}, webEngine(), app_info);
    var trace_sink = StdoutTraceSink{};
    var runtime = zero_native.Runtime.init(.{
        .platform = null_platform.platform(),
        .trace_sink = trace_sink.sink(),
        .bridge = options.bridge,
        .builtin_bridge = options.builtin_bridge,
        .security = options.security,
        .automation = if (build_options.automation) zero_native.automation.Server.init(init.io, ".zig-cache/zero-native-automation", app_info.resolvedWindowTitle()) else null,
    });
    try runtime.run(app);
}

fn runMacos(app: zero_native.App, options: RunOptions, init: std.process.Init) !void {
    var app_info = options.appInfo();
    var mac_platform = try zero_native.platform.macos.MacPlatform.initWithOptions(zero_native.geometry.SizeF.init(1400, 900), webEngine(), app_info);
    defer mac_platform.deinit();
    var trace_sink = StdoutTraceSink{};
    var runtime = zero_native.Runtime.init(.{
        .platform = mac_platform.platform(),
        .trace_sink = trace_sink.sink(),
        .bridge = options.bridge,
        .builtin_bridge = options.builtin_bridge,
        .security = options.security,
        .automation = if (build_options.automation) zero_native.automation.Server.init(init.io, ".zig-cache/zero-native-automation", app_info.resolvedWindowTitle()) else null,
    });
    try runtime.run(app);
}

fn runLinux(app: zero_native.App, options: RunOptions, init: std.process.Init) !void {
    var app_info = options.appInfo();
    var linux_platform = try zero_native.platform.linux.LinuxPlatform.initWithOptions(zero_native.geometry.SizeF.init(1400, 900), webEngine(), app_info);
    defer linux_platform.deinit();
    var trace_sink = StdoutTraceSink{};
    var runtime = zero_native.Runtime.init(.{
        .platform = linux_platform.platform(),
        .trace_sink = trace_sink.sink(),
        .bridge = options.bridge,
        .builtin_bridge = options.builtin_bridge,
        .security = options.security,
        .automation = if (build_options.automation) zero_native.automation.Server.init(init.io, ".zig-cache/zero-native-automation", app_info.resolvedWindowTitle()) else null,
    });
    try runtime.run(app);
}

fn runWindows(app: zero_native.App, options: RunOptions, init: std.process.Init) !void {
    var app_info = options.appInfo();
    var windows_platform = try zero_native.platform.windows.WindowsPlatform.initWithOptions(zero_native.geometry.SizeF.init(1400, 900), webEngine(), app_info);
    defer windows_platform.deinit();
    var trace_sink = StdoutTraceSink{};
    var runtime = zero_native.Runtime.init(.{
        .platform = windows_platform.platform(),
        .trace_sink = trace_sink.sink(),
        .bridge = options.bridge,
        .builtin_bridge = options.builtin_bridge,
        .security = options.security,
        .automation = if (build_options.automation) zero_native.automation.Server.init(init.io, ".zig-cache/zero-native-automation", app_info.resolvedWindowTitle()) else null,
    });
    try runtime.run(app);
}

fn shouldTrace(record: zero_native.trace.Record) bool {
    if (comptime std.mem.eql(u8, build_options.trace, "off")) return false;
    if (comptime std.mem.eql(u8, build_options.trace, "all")) return true;
    if (comptime std.mem.eql(u8, build_options.trace, "events")) return true;
    return std.mem.indexOf(u8, record.name, build_options.trace) != null;
}

fn webEngine() zero_native.WebEngine {
    if (comptime std.mem.eql(u8, build_options.web_engine, "chromium")) return .chromium;
    return .system;
}
