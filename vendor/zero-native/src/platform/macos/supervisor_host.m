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
