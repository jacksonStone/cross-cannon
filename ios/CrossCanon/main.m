#import <UIKit/UIKit.h>
#import <AVFAudio/AVFAudio.h>

extern int cross_canon_start(void);

// Matches Rust mobile::Insets. Accessed only on UIKit's main thread.
typedef struct {
    float top, left, bottom, right;
} CrossCanonInsets;

CrossCanonInsets cross_canon_safe_area(void) {
    UIWindow *window = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if ([scene isKindOfClass:UIWindowScene.class]) {
            for (UIWindow *candidate in ((UIWindowScene *)scene).windows) {
                if (candidate.isKeyWindow) { window = candidate; break; }
            }
        }
        if (window) break;
    }
    // Winit 0.30 can use the pre-scene application lifecycle.
    if (!window) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        for (UIWindow *candidate in UIApplication.sharedApplication.windows) {
            if (candidate.isKeyWindow) { window = candidate; break; }
        }
#pragma clang diagnostic pop
    }
    UIEdgeInsets insets = window ? window.safeAreaInsets : UIEdgeInsetsZero;
    return (CrossCanonInsets){insets.top, insets.left, insets.bottom, insets.right};
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        // Reading requires only the resources bundled with this application.
        NSString *library = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"library"];
        setenv("CROSS_CANON_DATA_DIR", library.fileSystemRepresentation, 1);
        // Native playback uses the existing recordings and timestamp manifests.
        NSError *error = nil;
        [AVAudioSession.sharedInstance setCategory:AVAudioSessionCategoryPlayback error:&error];
        if (error) NSLog(@"Audio session: %@", error.localizedDescription);
        return cross_canon_start();
    }
}
