#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
extern void cross_canon_open_reader_link(const char *url);

#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
static IMP previousOpenURL;
static BOOL openReaderURL(id delegate, SEL selector, UIApplication *application, NSURL *url, NSDictionary *options) {
    if ([url.scheme isEqualToString:@"crosscanon"]) {
        cross_canon_open_reader_link(url.absoluteString.UTF8String);
        return YES;
    }
    return previousOpenURL ? ((BOOL(*)(id,SEL,UIApplication *,NSURL *,NSDictionary *))previousOpenURL)(delegate,selector,application,url,options) : NO;
}
@interface CrossCanonReaderLinkDelegate : NSObject <UIApplicationDelegate>
@end
@implementation CrossCanonReaderLinkDelegate
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary *)options {
    return openReaderURL(self, _cmd, application, url, options);
}
@end
static id<UIApplicationDelegate> readerDelegate;
void cross_canon_install_reader_links(void) {
    UIApplication *application = UIApplication.sharedApplication;
    // Winit deliberately supplies no UIApplicationDelegate, using lifecycle
    // notifications instead. Retain our small URL delegate in that configuration.
    if (!application.delegate) {
        readerDelegate = [CrossCanonReaderLinkDelegate new];
        application.delegate = readerDelegate;
        return;
    }
    id<UIApplicationDelegate> instance = application.delegate;
    Class delegate = object_getClass(instance);
    SEL selector = @selector(application:openURL:options:);
    previousOpenURL = class_replaceMethod(delegate, selector, (IMP)openReaderURL, "B@:@@@");
    application.delegate = instance;
}
#else
#import <AppKit/AppKit.h>
@interface CrossCanonReaderLinks : NSObject
- (void)open:(NSAppleEventDescriptor *)event reply:(NSAppleEventDescriptor *)reply;
@end
@implementation CrossCanonReaderLinks
- (void)open:(NSAppleEventDescriptor *)event reply:(__unused NSAppleEventDescriptor *)reply {
    NSString *url = [event paramDescriptorForKeyword:'----'].stringValue;
    if (url) cross_canon_open_reader_link(url.UTF8String);
}
@end
static CrossCanonReaderLinks *links;
void cross_canon_install_reader_links(void) {
    links = [CrossCanonReaderLinks new];
    [NSAppleEventManager.sharedAppleEventManager setEventHandler:links andSelector:@selector(open:reply:) forEventClass:'GURL' andEventID:'GURL'];
}
#endif
