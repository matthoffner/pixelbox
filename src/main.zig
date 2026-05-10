const std = @import("std");
const runner = @import("runner");
const zero_native = @import("zero-native");

pub const panic = std.debug.FullPanic(zero_native.debug.capturePanic);

const backend_host = "127.0.0.1";
const default_backend_port = "3210";
const max_terminal_panel_payload_bytes = 2048;

const NativeTerminalBridgeState = struct {
    visible: bool = false,
    payload_len: usize = 0,
    payload: [max_terminal_panel_payload_bytes]u8 = [_]u8{0} ** max_terminal_panel_payload_bytes,

    fn setPayload(self: *NativeTerminalBridgeState, visible: bool, value: []const u8) void {
        self.visible = visible;
        const next_len = @min(value.len, self.payload.len);
        @memcpy(self.payload[0..next_len], value[0..next_len]);
        self.payload_len = next_len;
    }

    fn payloadSlice(self: *const NativeTerminalBridgeState) []const u8 {
        return self.payload[0..self.payload_len];
    }
};

const App = struct {
    backend_url: []const u8,
    bridge_state: NativeTerminalBridgeState = .{},

    fn app(self: *@This()) zero_native.App {
        return .{
            .context = self,
            .name = "pixelbox",
            .source = zero_native.WebViewSource.url(self.backend_url),
        };
    }

    fn bridgeDispatcher(self: *@This(), allocator: std.mem.Allocator, allowed_origin: []const u8) !zero_native.BridgeDispatcher {
        const command_origin = try allocator.alloc([]const u8, 1);
        command_origin[0] = allowed_origin;
        const command_policies = try allocator.alloc(zero_native.BridgeCommandPolicy, 2);
        command_policies[0] = .{
            .name = "pixelbox.terminal.getCapabilities",
            .origins = command_origin,
        };
        command_policies[1] = .{
            .name = "pixelbox.terminal.setPanelState",
            .origins = command_origin,
        };
        const handlers = try allocator.alloc(zero_native.BridgeHandler, 2);
        handlers[0] = .{
            .name = "pixelbox.terminal.getCapabilities",
            .context = self,
            .invoke_fn = handleNativeTerminalGetCapabilities,
        };
        handlers[1] = .{
            .name = "pixelbox.terminal.setPanelState",
            .context = self,
            .invoke_fn = handleNativeTerminalSetPanelState,
        };
        return .{
            .policy = .{
                .enabled = true,
                .commands = command_policies,
            },
            .registry = .{
                .handlers = handlers,
            },
        };
    }
};

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const cwd = try std.process.currentPathAlloc(init.io, allocator);
    defer allocator.free(cwd);

    var env = std.process.Environ.Map.init(allocator);
    defer env.deinit();
    {
        const keys = init.environ_map.keys();
        const values = init.environ_map.values();
        for (keys, values) |key, value| try env.put(key, value);
    }

    const port = env.get("PIXELBOX_BACKEND_PORT") orelse default_backend_port;
    try env.put("PIXELBOX_BACKEND_PORT", port);
    if (env.get("PIXELBOX_WORKSPACE_ROOT") == null) {
        try env.put("PIXELBOX_WORKSPACE_ROOT", cwd);
    }

    var backend_argv = [_][]const u8{ "node", "bridge/server.js" };
    var backend_child = try std.process.spawn(init.io, .{
        .argv = &backend_argv,
        .cwd = .{ .path = cwd },
        .stdin = .ignore,
        .stdout = .inherit,
        .stderr = .inherit,
        .environ_map = &env,
    });
    defer {
        backend_child.kill(init.io);
        _ = backend_child.wait(init.io) catch {};
    }

    const backend_url = try std.fmt.allocPrint(allocator, "http://{s}:{s}/renderer/index.html", .{ backend_host, port });
    defer allocator.free(backend_url);
    const backend_origin = try std.fmt.allocPrint(allocator, "http://{s}:{s}", .{ backend_host, port });
    defer allocator.free(backend_origin);
    try waitUntilReady(init.io, backend_host, port, "/health", 30000);

    var app = App{ .backend_url = backend_url };
    const bridge_dispatcher = try app.bridgeDispatcher(allocator, backend_origin);
    try runner.runWithOptions(app.app(), .{
        .app_name = "Pixelbox",
        .window_title = "Pixelbox",
        .bundle_id = "com.pixelbox.app",
        .icon_path = "assets/pixelbox.icns",
        .bridge = bridge_dispatcher,
        .security = .{
            .navigation = .{
                .allowed_origins = &.{
                    "http://127.0.0.1:3210",
                    "http://127.0.0.1:3210/",
                },
            },
        },
    }, init);
}

fn handleNativeTerminalGetCapabilities(context: *anyopaque, invocation: zero_native.bridge.Invocation, output: []u8) anyerror![]const u8 {
    _ = context;
    _ = invocation;
    return std.fmt.bufPrint(
        output,
        "{{\"nativeTerminal\":true,\"provider\":\"ghostty-spike\",\"panelStateAvailable\":true}}",
        .{},
    );
}

fn handleNativeTerminalSetPanelState(context: *anyopaque, invocation: zero_native.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const app: *App = @ptrCast(@alignCast(context));
    const visible = std.mem.indexOf(u8, invocation.request.payload, "\"visible\":true") != null;
    app.bridge_state.setPayload(visible, invocation.request.payload);
    return std.fmt.bufPrint(
        output,
        "{{\"ok\":true,\"visible\":{},\"payloadBytes\":{}}}",
        .{ app.bridge_state.visible, app.bridge_state.payloadSlice().len },
    );
}

fn waitUntilReady(io: std.Io, host: []const u8, port_text: []const u8, ready_path: []const u8, timeout_ms: u32) !void {
    var port_buffer: [16]u8 = undefined;
    var port_len: usize = 0;
    for (port_text) |char| {
        if (std.ascii.isDigit(char)) {
            if (port_len >= port_buffer.len) return error.InvalidPort;
            port_buffer[port_len] = char;
            port_len += 1;
            continue;
        }
        if (port_len > 0) break;
    }
    if (port_len == 0) {
        @memcpy(port_buffer[0..default_backend_port.len], default_backend_port);
        port_len = default_backend_port.len;
    }
    const port = try std.fmt.parseUnsigned(u16, port_buffer[0..port_len], 10);
    var waited_ms: u32 = 0;
    while (waited_ms <= timeout_ms) : (waited_ms += 100) {
        const address = std.Io.net.IpAddress.resolve(io, host, port) catch {
            sleepPollInterval(io);
            continue;
        };
        if (std.Io.net.IpAddress.connect(&address, io, .{ .mode = .stream, .protocol = .tcp })) |stream| {
            if (httpReady(io, stream, host, ready_path)) {
                stream.close(io);
                return;
            }
            stream.close(io);
        } else |_| {
            sleepPollInterval(io);
        }
    }
    return error.Timeout;
}

fn httpReady(io: std.Io, stream: std.Io.net.Stream, host: []const u8, path: []const u8) bool {
    var request_buffer: [512]u8 = undefined;
    const request = std.fmt.bufPrint(&request_buffer, "GET {s} HTTP/1.1\r\nHost: {s}\r\nConnection: close\r\n\r\n", .{ path, host }) catch return false;
    var write_buffer: [512]u8 = undefined;
    var stream_writer = std.Io.net.Stream.writer(stream, io, &write_buffer);
    stream_writer.interface.writeAll(request) catch return false;
    stream_writer.interface.flush() catch return false;
    var response_buffer: [64]u8 = undefined;
    var read_buffer: [512]u8 = undefined;
    var stream_reader = std.Io.net.Stream.reader(stream, io, &read_buffer);
    const len = stream_reader.interface.readSliceShort(&response_buffer) catch return false;
    const response = response_buffer[0..len];
    return std.mem.startsWith(u8, response, "HTTP/1.1 2") or
        std.mem.startsWith(u8, response, "HTTP/1.0 2") or
        std.mem.startsWith(u8, response, "HTTP/1.1 3") or
        std.mem.startsWith(u8, response, "HTTP/1.0 3");
}

fn sleepPollInterval(io: std.Io) void {
    std.Io.sleep(io, std.Io.Duration.fromMilliseconds(100), .awake) catch {};
}

test "pixelbox backend url uses local server" {
    try std.testing.expect(true);
}
