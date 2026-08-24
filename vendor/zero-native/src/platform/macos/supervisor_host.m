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

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    (void)event;
    return YES;
}

- (void)setFrameSize:(NSSize)newSize {
    [super setFrameSize:newSize];
    if (!self.surface) return;
    NSRect backing = [self convertRectToBacking:self.bounds];
    uint32_t width = (uint32_t)MAX(1, llround(backing.size.width));
    uint32_t height = (uint32_t)MAX(1, llround(backing.size.height));
    ghostty_surface_set_size(self.surface, width, height);
}

- (void)keyDown:(NSEvent *)event {
    if (!self.surface) {
        [super keyDown:event];
        return;
    }

    ghostty_input_key_s keyEvent = {0};
    keyEvent.action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
    keyEvent.keycode = (uint32_t)event.keyCode;

    NSUInteger mods = 0;
    if (event.modifierFlags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
    if (event.modifierFlags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
    if (event.modifierFlags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
    if (event.modifierFlags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
    if (event.modifierFlags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
    keyEvent.mods = (ghostty_input_mods_e)mods;
    keyEvent.consumed_mods = (ghostty_input_mods_e)(mods & ~(GHOSTTY_MODS_CTRL | GHOSTTY_MODS_SUPER));

    NSString *unshifted = [event charactersByApplyingModifiers:0];
    if (unshifted.length > 0) {
        keyEvent.unshifted_codepoint = [unshifted characterAtIndex:0];
    }

    NSString *text = event.characters;
    if (text.length == 1) {
        unichar scalar = [text characterAtIndex:0];
        if (scalar < 0x20) {
            text = [event charactersByApplyingModifiers:(event.modifierFlags & ~NSEventModifierFlagControl)] ?: @"";
        } else if (scalar >= 0xF700 && scalar <= 0xF8FF) {
            text = nil;
        }
    }
    keyEvent.text = text.length > 0 ? text.UTF8String : NULL;

    if (!ghostty_surface_key(self.surface, keyEvent)) {
        [super keyDown:event];
    }
}

- (void)mouseDown:(NSEvent *)event {
    (void)event;
    if (self.window) [self.window makeFirstResponder:self];
}

@end

// `[NSApp stop:nil]` only sets a flag that AppKit consumes after the *current*
// event finishes processing. Called from a dispatch_async block there may be no
// event in flight at all, in which case `[NSApp run]` sits waiting for the next
// one and never notices the flag. Post a dummy event so the run loop wakes up
// and re-checks. Harmless when there already is an event in flight.
static void ZeroNativeSupervisorStopApp(void) {
    [NSApp stop:nil];
    NSEvent *wakeupEvent = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                              location:NSZeroPoint
                                         modifierFlags:0
                                             timestamp:0
                                          windowNumber:0
                                               context:nil
                                               subtype:0
                                                 data1:0
                                                 data2:0];
    [NSApp postEvent:wakeupEvent atStart:YES];
}

@interface ZeroNativeSupervisorWindowDelegate : NSObject <NSWindowDelegate>
@end

@implementation ZeroNativeSupervisorWindowDelegate
- (void)windowWillClose:(NSNotification *)notification {
    (void)notification;
    ZeroNativeSupervisorStopApp();
}
@end

typedef struct {
    ghostty_app_t app;
    ghostty_surface_t surface;
    void *window;
    BOOL processExited;
} ZeroNativeSupervisorContext;

static void ZeroNativeSupervisorWakeup(void *userdata) {
    ZeroNativeSupervisorContext *ctx = (ZeroNativeSupervisorContext *)userdata;
    if (!ctx) return;
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
    if (!ctx) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      ctx->processExited = YES;
      NSWindow *window = (__bridge NSWindow *)ctx->window;
      if (window) [window close];
      // Not just for the window == NULL case: `[window close]` reaches
      // `windowWillClose:` synchronously, but we're running inside a
      // dispatch_async block with no event in flight, so the run loop still
      // needs an explicit nudge to notice the stop flag.
      ZeroNativeSupervisorStopApp();
    });
}

static NSString *ZeroNativeSupervisorShellQuote(NSString *value) {
    NSString *escaped = [value ?: @"" stringByReplacingOccurrencesOfString:@"'" withString:@"'\"'\"'"];
    return [NSString stringWithFormat:@"'%@'", escaped];
}

// Ghostty's macOS exec path turns `command` into
// `/usr/bin/login -flp <user> /bin/bash --noprofile --norc -c "exec -l <command>"`,
// so `command` has to be a single executable + args — a shell command list
// (anything with `;`, `&&`, pipes, ...) silently loses everything after the
// first command. The app's own terminal (appkit_host.m) works around this by
// writing the command into a temp script and handing Ghostty the script path;
// do the same here.
static NSString *ZeroNativeSupervisorStartupScript(NSString *command, NSString *workingDirectory) {
    NSString *scriptPath = [NSTemporaryDirectory() stringByAppendingPathComponent:@"pixelbox-supervisor-crash.sh"];
    NSString *trimmed = [command stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSString *commandLine = trimmed.length > 0
      ? [NSString stringWithFormat:@"CRASH_COMMAND=%@\neval \"$CRASH_COMMAND\"\n", ZeroNativeSupervisorShellQuote(trimmed)]
      : @"";
    NSString *script = [NSString stringWithFormat:
      @"#!/bin/zsh\n"
       "cd %@ || exit 1\n"
       "export TERM=\"${TERM:-xterm-256color}\"\n"
       "%@",
      ZeroNativeSupervisorShellQuote(workingDirectory ?: NSHomeDirectory()),
      commandLine];

    NSError *error = nil;
    if (![script writeToFile:scriptPath atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
        NSLog(@"[zero-native] supervisor failed to write crash terminal script: %@", error);
        return @"/bin/zsh";
    }
    if (![[NSFileManager defaultManager] setAttributes:@{ NSFilePosixPermissions: @0755 } ofItemAtPath:scriptPath error:&error]) {
        NSLog(@"[zero-native] supervisor failed to chmod crash terminal script: %@", error);
    }
    return scriptPath;
}

static BOOL ZeroNativeSupervisorEnsureGhosttyInitialized(void) {
    static BOOL attempted = NO;
    static BOOL initialized = NO;
    if (attempted) return initialized;
    attempted = YES;
    char arg0[] = "pixelbox-supervisor";
    char *argv[] = { arg0, NULL };
    initialized = (ghostty_init(1, &argv[0]) == 0);
    if (!initialized) {
        NSLog(@"[zero-native] supervisor ghostty_init failed");
    }
    return initialized;
}

int zero_native_supervisor_run_crash_terminal(const char *command, unsigned long command_len, const char *working_directory, unsigned long working_directory_len) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

        NSString *commandString = [[NSString alloc] initWithBytes:command length:command_len encoding:NSUTF8StringEncoding] ?: @"";
        NSString *workingDirectoryString = [[NSString alloc] initWithBytes:working_directory length:working_directory_len encoding:NSUTF8StringEncoding] ?: @".";
        // Ghostty opens the surface's working directory with an absolute-path-only
        // API (apprt.embedded.Surface.init -> std.fs.openDirAbsolute), which panics
        // on a relative path like ".". Resolve against the process cwd first.
        if (!workingDirectoryString.isAbsolutePath) {
            NSString *cwd = [[NSFileManager defaultManager] currentDirectoryPath] ?: @"/";
            workingDirectoryString = [[cwd stringByAppendingPathComponent:workingDirectoryString] stringByStandardizingPath];
        }

        if (!ZeroNativeSupervisorEnsureGhosttyInitialized()) {
            return 1;
        }

        ghostty_config_t config = ghostty_config_new();
        if (!config) {
            return 1;
        }
        ghostty_config_load_default_files(config);
        ghostty_config_finalize(config);

        // Heap-allocated, and deliberately never freed. Ghostty's runtime
        // callbacks hand this pointer to `dispatch_async` blocks that run on the
        // main queue, and a block can still be queued when `[NSApp run]` returns
        // and this frame unwinds. The supervisor calls this function once per
        // crash cycle, so a stack local would leave a queued block dereferencing
        // a dead frame that the *next* invocation has already reused. Before
        // returning we null out every pointer inside it, which turns any
        // still-in-flight block into a safe no-op; leaking one small struct per
        // crash is much cheaper than the use-after-free.
        ZeroNativeSupervisorContext *ctx = calloc(1, sizeof(ZeroNativeSupervisorContext));
        if (!ctx) {
            ghostty_config_free(config);
            return 1;
        }

        ghostty_runtime_config_s runtimeConfig = {0};
        runtimeConfig.userdata = ctx;
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
        ctx->app = app;
        ghostty_app_set_focus(app, true);

        NSRect frame = NSMakeRect(0, 0, 900, 500);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                        styleMask:(NSWindowStyleMaskTitled |
                                                                   NSWindowStyleMaskClosable |
                                                                   NSWindowStyleMaskResizable)
                                                          backing:NSBackingStoreBuffered
                                                            defer:NO];
        window.title = @"Pixelbox crashed — diagnosing";
        window.releasedWhenClosed = NO;
        [window center];
        ctx->window = (__bridge void *)window;

        ZeroNativeSupervisorWindowDelegate *windowDelegate = [[ZeroNativeSupervisorWindowDelegate alloc] init];
        window.delegate = windowDelegate;

        ZeroNativeSupervisorTerminalView *view = [[ZeroNativeSupervisorTerminalView alloc] initWithFrame:frame];
        view.wantsLayer = YES;
        view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        window.contentView = view;

        ghostty_surface_config_s surfaceConfig = ghostty_surface_config_new();
        surfaceConfig.platform_tag = GHOSTTY_PLATFORM_MACOS;
        surfaceConfig.platform.macos.nsview = (__bridge void *)view;
        // `close_surface_cb` (and the clipboard callbacks) are invoked with the
        // *surface* userdata, not the app userdata from ghostty_runtime_config_s
        // — see apprt/embedded.zig:470 and :646. Without this the callback gets
        // NULL and the terminal can never signal that it's done.
        surfaceConfig.userdata = ctx;
        surfaceConfig.scale_factor = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1.0;
        surfaceConfig.font_size = 13.0f;
        surfaceConfig.working_directory = workingDirectoryString.UTF8String;
        NSString *startupScript = ZeroNativeSupervisorStartupScript(commandString, workingDirectoryString);
        surfaceConfig.command = startupScript.UTF8String;
        surfaceConfig.initial_input = NULL;
        surfaceConfig.wait_after_command = false;
        surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_WINDOW;

        ghostty_surface_t surface = ghostty_surface_new(app, &surfaceConfig);
        if (!surface) {
            ctx->app = NULL;
            ctx->window = NULL;
            ghostty_app_free(app);
            ghostty_config_free(config);
            return 1;
        }
        ctx->surface = surface;
        view.surface = surface;

        [window makeKeyAndOrderFront:nil];
        [window makeFirstResponder:view];
        [NSApp activateIgnoringOtherApps:YES];

        double scale = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1.0;
        NSRect backing = [view convertRectToBacking:view.bounds];
        ghostty_surface_set_content_scale(surface, scale, scale);
        ghostty_surface_set_focus(surface, true);
        ghostty_surface_set_size(surface,
                                 (uint32_t)MAX(1, llround(backing.size.width)),
                                 (uint32_t)MAX(1, llround(backing.size.height)));
        ghostty_surface_refresh(surface);

        [NSApp run];

        window.delegate = nil;
        view.surface = NULL;
        // Disarm `ctx` before tearing down the native objects it points at. Any
        // block still queued against it from this cycle now sees NULLs and does
        // nothing, instead of touching pointers we are about to free. `ctx`
        // itself is intentionally not freed — see the allocation comment above.
        ctx->app = NULL;
        ctx->surface = NULL;
        ctx->window = NULL;
        ghostty_surface_free(surface);
        ghostty_app_free(app);
        ghostty_config_free(config);

        return 0;
    }
}
