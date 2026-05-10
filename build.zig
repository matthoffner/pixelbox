const std = @import("std");

const PlatformOption = enum {
    auto,
    @"null",
    macos,
    linux,
    windows,
};

const TraceOption = enum {
    off,
    events,
    runtime,
    all,
};

const WebEngineOption = enum {
    system,
    chromium,
};

const PackageTarget = enum {
    macos,
    windows,
    linux,
};

const default_zero_native_path = "vendor/zero-native";
const default_ghostty_path = "vendor/ghostty";
const default_ghostty_zig = "zig";
const app_exe_name = "Pixelbox";

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const platform_option = b.option(PlatformOption, "platform", "Desktop backend: auto, null, macos, linux, windows") orelse .auto;
    const trace_option = b.option(TraceOption, "trace", "Trace output: off, events, runtime, all") orelse .events;
    const debug_overlay = b.option(bool, "debug-overlay", "Enable debug overlay output") orelse false;
    const automation_enabled = b.option(bool, "automation", "Enable zero-native automation artifacts") orelse false;
    const js_bridge_enabled = b.option(bool, "js-bridge", "Enable optional JavaScript bridge stubs") orelse false;
    const web_engine_override = b.option(WebEngineOption, "web-engine", "Override app.zon web engine: system, chromium");
    const cef_dir_override = b.option([]const u8, "cef-dir", "Override CEF root directory for Chromium builds");
    const cef_auto_install_override = b.option(bool, "cef-auto-install", "Override app.zon CEF auto-install setting");
    const package_target = b.option(PackageTarget, "package-target", "Package target: macos, windows, linux") orelse .macos;
    const zero_native_path = b.option([]const u8, "zero-native-path", "Path to the zero-native framework checkout") orelse default_zero_native_path;
    const ghostty_path = b.option([]const u8, "ghostty-path", "Path to the vendored Ghostty checkout") orelse default_ghostty_path;
    const ghostty_zig_path = b.option([]const u8, "ghostty-zig", "Path to the Zig 0.15 binary used to build Ghostty") orelse default_ghostty_zig;
    const optimize_name = @tagName(optimize);
    const selected_platform: PlatformOption = switch (platform_option) {
        .auto => if (target.result.os.tag == .macos) .macos else if (target.result.os.tag == .linux) .linux else if (target.result.os.tag == .windows) .windows else .@"null",
        else => platform_option,
    };
    if (selected_platform == .macos and target.result.os.tag != .macos) @panic("-Dplatform=macos requires a macOS target");
    if (selected_platform == .linux and target.result.os.tag != .linux) @panic("-Dplatform=linux requires a Linux target");
    if (selected_platform == .windows and target.result.os.tag != .windows) @panic("-Dplatform=windows requires a Windows target");

    const app_web_engine = appWebEngineConfig();
    const web_engine = web_engine_override orelse app_web_engine.web_engine;
    const cef_dir = cef_dir_override orelse defaultCefDir(selected_platform, app_web_engine.cef_dir);
    const cef_auto_install = cef_auto_install_override orelse app_web_engine.cef_auto_install;
    if (web_engine == .chromium and selected_platform == .@"null") {
        @panic("-Dweb-engine=chromium requires -Dplatform=macos, linux, or windows");
    }

    const zero_native_mod = zeroNativeModule(b, target, optimize, zero_native_path);
    const options = b.addOptions();
    options.addOption([]const u8, "platform", switch (selected_platform) {
        .auto => unreachable,
        .@"null" => "null",
        .macos => "macos",
        .linux => "linux",
        .windows => "windows",
    });
    options.addOption([]const u8, "trace", @tagName(trace_option));
    options.addOption([]const u8, "web_engine", @tagName(web_engine));
    options.addOption(bool, "debug_overlay", debug_overlay);
    options.addOption(bool, "automation", automation_enabled);
    options.addOption(bool, "js_bridge", js_bridge_enabled);
    const options_mod = options.createModule();

    const runner_mod = localModule(b, target, optimize, "src/runner.zig");
    runner_mod.addImport("zero-native", zero_native_mod);
    runner_mod.addImport("build_options", options_mod);

    const app_mod = localModule(b, target, optimize, "src/main.zig");
    app_mod.addImport("zero-native", zero_native_mod);
    app_mod.addImport("runner", runner_mod);

    const exe = b.addExecutable(.{
        .name = app_exe_name,
        .root_module = app_mod,
    });
    linkPlatform(b, target, app_mod, exe, selected_platform, web_engine, zero_native_path, cef_dir, cef_auto_install, ghostty_path, ghostty_zig_path);
    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run.step);

    const package = b.addSystemCommand(&.{
        "zero-native",
        "package",
        "--target",
        @tagName(package_target),
        "--manifest",
        "app.zon",
        "--optimize",
        optimize_name,
        "--output",
        b.fmt("zig-out/package/Pixelbox-0.3.0-{s}-{s}{s}", .{ @tagName(package_target), optimize_name, packageSuffix(package_target) }),
        "--binary",
    });
    package.addFileArg(exe.getEmittedBin());
    package.addArgs(&.{ "--web-engine", @tagName(web_engine), "--cef-dir", cef_dir });
    if (cef_auto_install) package.addArg("--cef-auto-install");
    package.step.dependOn(&exe.step);
    const package_step = b.step("package", "Create a local package artifact");
    package_step.dependOn(&package.step);

    const dev = b.addSystemCommand(&.{ "zero-native", "dev", "--manifest", "app.zon", "--binary" });
    dev.addFileArg(exe.getEmittedBin());
    dev.step.dependOn(&exe.step);
    const dev_step = b.step("dev", "Run a managed zero-native dev session");
    dev_step.dependOn(&dev.step);

    const tests = b.addTest(.{ .root_module = app_mod });
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&b.addRunArtifact(tests).step);
}

fn localModule(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode, path: []const u8) *std.Build.Module {
    return b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
    });
}

fn zeroNativePath(b: *std.Build, zero_native_path: []const u8, sub_path: []const u8) std.Build.LazyPath {
    return .{ .cwd_relative = b.pathJoin(&.{ zero_native_path, sub_path }) };
}

fn zeroNativeModule(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode, zero_native_path: []const u8) *std.Build.Module {
    const geometry_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/geometry/root.zig");
    const assets_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/assets/root.zig");
    const app_dirs_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/app_dirs/root.zig");
    const trace_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/trace/root.zig");
    const app_manifest_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/app_manifest/root.zig");
    const diagnostics_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/diagnostics/root.zig");
    const platform_info_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/platform_info/root.zig");
    const json_mod = externalModule(b, target, optimize, zero_native_path, "src/primitives/json/root.zig");
    const debug_mod = externalModule(b, target, optimize, zero_native_path, "src/debug/root.zig");
    debug_mod.addImport("app_dirs", app_dirs_mod);
    debug_mod.addImport("trace", trace_mod);

    const zero_native_mod = externalModule(b, target, optimize, zero_native_path, "src/root.zig");
    zero_native_mod.addImport("geometry", geometry_mod);
    zero_native_mod.addImport("assets", assets_mod);
    zero_native_mod.addImport("app_dirs", app_dirs_mod);
    zero_native_mod.addImport("trace", trace_mod);
    zero_native_mod.addImport("app_manifest", app_manifest_mod);
    zero_native_mod.addImport("diagnostics", diagnostics_mod);
    zero_native_mod.addImport("platform_info", platform_info_mod);
    zero_native_mod.addImport("json", json_mod);
    return zero_native_mod;
}

fn externalModule(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode, zero_native_path: []const u8, path: []const u8) *std.Build.Module {
    return b.createModule(.{
        .root_source_file = zeroNativePath(b, zero_native_path, path),
        .target = target,
        .optimize = optimize,
    });
}

fn linkPlatform(b: *std.Build, target: std.Build.ResolvedTarget, app_mod: *std.Build.Module, exe: *std.Build.Step.Compile, platform: PlatformOption, web_engine: WebEngineOption, zero_native_path: []const u8, cef_dir: []const u8, cef_auto_install: bool, ghostty_path: []const u8, ghostty_zig_path: []const u8) void {
    _ = target;
    if (platform == .macos) {
        const ghostty_build = addGhosttyBuild(b, ghostty_path, ghostty_zig_path);
        exe.step.dependOn(&ghostty_build.step);
        const ghostty_include = b.pathJoin(&.{ ghostty_path, "zig-out", "include" });
        const ghostty_lib = b.pathJoin(&.{ ghostty_path, "zig-out", "lib", "ghostty-internal.a" });
        switch (web_engine) {
            .system => {
                const ghostty_include_flag = b.fmt("-I{s}", .{ghostty_include});
                app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/macos/appkit_host.m"), .flags = &.{ "-fobjc-arc", "-ObjC", ghostty_include_flag } });
                app_mod.linkFramework("WebKit", .{});
            },
            .chromium => {
                const cef_check = addCefCheck(b, cef_dir);
                if (cef_auto_install) {
                    const cef_auto = b.addSystemCommand(&.{ "zero-native", "cef", "install", "--dir", cef_dir });
                    cef_check.step.dependOn(&cef_auto.step);
                }
                exe.step.dependOn(&cef_check.step);
                const include_arg = b.fmt("-I{s}", .{cef_dir});
                const define_arg = b.fmt("-DZERO_NATIVE_CEF_DIR=\"{s}\"", .{cef_dir});
                app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/macos/cef_host.mm"), .flags = &.{ "-fobjc-arc", "-ObjC++", "-std=c++17", "-stdlib=libc++", include_arg, define_arg } });
                app_mod.addObjectFile(b.path(b.fmt("{s}/libcef_dll_wrapper/libcef_dll_wrapper.a", .{cef_dir})));
                app_mod.addFrameworkPath(b.path(b.fmt("{s}/Release", .{cef_dir})));
                app_mod.linkFramework("Chromium Embedded Framework", .{});
                app_mod.addRPath(.{ .cwd_relative = "@executable_path/Frameworks" });
            },
        }
        app_mod.linkFramework("AppKit", .{});
        app_mod.linkFramework("Metal", .{});
        app_mod.linkFramework("CoreGraphics", .{});
        app_mod.linkFramework("CoreText", .{});
        app_mod.linkFramework("CoreVideo", .{});
        app_mod.linkFramework("QuartzCore", .{});
        app_mod.linkFramework("IOSurface", .{});
        app_mod.linkFramework("Carbon", .{});
        app_mod.linkFramework("Foundation", .{});
        app_mod.linkFramework("UniformTypeIdentifiers", .{});
        app_mod.addObjectFile(.{ .cwd_relative = ghostty_lib });
        app_mod.linkSystemLibrary("c", .{});
        app_mod.linkSystemLibrary("c++", .{});
    } else if (platform == .linux) {
        switch (web_engine) {
            .system => {
                app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/linux/gtk_host.c"), .flags = &.{} });
                app_mod.linkSystemLibrary("gtk4", .{});
                app_mod.linkSystemLibrary("webkitgtk-6.0", .{});
            },
            .chromium => {
                const cef_check = addCefCheck(b, cef_dir);
                if (cef_auto_install) {
                    const cef_auto = b.addSystemCommand(&.{ "zero-native", "cef", "install", "--dir", cef_dir });
                    cef_check.step.dependOn(&cef_auto.step);
                }
                exe.step.dependOn(&cef_check.step);
                const include_arg = b.fmt("-I{s}", .{cef_dir});
                const define_arg = b.fmt("-DZERO_NATIVE_CEF_DIR=\"{s}\"", .{cef_dir});
                app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/linux/cef_host.cpp"), .flags = &.{ "-std=c++17", include_arg, define_arg } });
                app_mod.addObjectFile(b.path(b.fmt("{s}/libcef_dll_wrapper/libcef_dll_wrapper.a", .{cef_dir})));
                app_mod.addLibraryPath(b.path(b.fmt("{s}/Release", .{cef_dir})));
                app_mod.linkSystemLibrary("cef", .{});
                app_mod.addRPath(.{ .cwd_relative = "$ORIGIN" });
            },
        }
        app_mod.linkSystemLibrary("c", .{});
        if (web_engine == .chromium) app_mod.linkSystemLibrary("stdc++", .{});
    } else if (platform == .windows) {
        switch (web_engine) {
            .system => app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/windows/webview2_host.cpp"), .flags = &.{ "-std=c++17" } }),
            .chromium => {
                const cef_check = addCefCheck(b, cef_dir);
                if (cef_auto_install) {
                    const cef_auto = b.addSystemCommand(&.{ "zero-native", "cef", "install", "--dir", cef_dir });
                    cef_check.step.dependOn(&cef_auto.step);
                }
                exe.step.dependOn(&cef_check.step);
                const include_arg = b.fmt("-I{s}", .{cef_dir});
                const define_arg = b.fmt("-DZERO_NATIVE_CEF_DIR=\"{s}\"", .{cef_dir});
                app_mod.addCSourceFile(.{ .file = zeroNativePath(b, zero_native_path, "src/platform/windows/cef_host.cpp"), .flags = &.{ "-std=c++17", include_arg, define_arg } });
                app_mod.addObjectFile(b.path(b.fmt("{s}/libcef_dll_wrapper/libcef_dll_wrapper.lib", .{cef_dir})));
                app_mod.addLibraryPath(b.path(b.fmt("{s}/Release", .{cef_dir})));
            },
        }
        app_mod.linkSystemLibrary("user32", .{});
        app_mod.linkSystemLibrary("ole32", .{});
        app_mod.linkSystemLibrary("advapi32", .{});
        app_mod.linkSystemLibrary("shell32", .{});
        app_mod.linkSystemLibrary("shlwapi", .{});
        app_mod.linkSystemLibrary("runtimeobject", .{});
        app_mod.linkSystemLibrary("windowsapp", .{});
        if (web_engine == .chromium) app_mod.linkSystemLibrary("libcef", .{});
    }
}

fn addGhosttyBuild(b: *std.Build, ghostty_path: []const u8, ghostty_zig_path: []const u8) *std.Build.Step.Run {
    const ghostty_cmd = b.addSystemCommand(&.{
        "/usr/bin/env",
        "DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer",
        ghostty_zig_path,
        "build",
        "-Demit-exe=false",
        "-Demit-xcframework=false",
        "-Demit-macos-app=false",
        "-Demit-docs=false",
        "-Demit-themes=false",
        "-Demit-terminfo=false",
        "-Demit-termcap=false",
    });
    ghostty_cmd.setCwd(.{ .cwd_relative = ghostty_path });
    return ghostty_cmd;
}

fn addCefCheck(b: *std.Build, cef_dir: []const u8) *std.Build.Step.Run {
    const check = b.addSystemCommand(&.{ "zero-native", "cef", "doctor", "--dir", cef_dir });
    return check;
}

fn appWebEngineConfig() struct {
    web_engine: WebEngineOption,
    cef_dir: []const u8,
    cef_auto_install: bool,
} {
    return .{
        .web_engine = .system,
        .cef_dir = "third_party/cef/macos",
        .cef_auto_install = false,
    };
}

fn defaultCefDir(platform: PlatformOption, manifest_dir: []const u8) []const u8 {
    if (manifest_dir.len > 0) return manifest_dir;
    return switch (platform) {
        .macos => "third_party/cef/macos",
        .linux => "third_party/cef/linux",
        .windows => "third_party/cef/windows",
        else => "third_party/cef/macos",
    };
}

fn packageSuffix(target: PackageTarget) []const u8 {
    return switch (target) {
        .macos => ".app",
        .linux, .windows => "",
    };
}
