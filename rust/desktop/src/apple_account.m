#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <AuthenticationServices/AuthenticationServices.h>
#import <TargetConditionals.h>
extern void cross_canon_open_reader_link(const char *url);
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

// Tokens never enter reader.ron, preferences, logs, or the application bundle.
static NSDictionary *credentialQuery(void) {
    return @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
             (__bridge id)kSecAttrService: TARGET_OS_IPHONE ? @"com.crosscanon.mobile.account" : @"com.crosscanon.desktop.account",
             (__bridge id)kSecAttrAccount: @"production-session"};
}
int cross_canon_account_read(char *buffer, size_t capacity) {
    NSMutableDictionary *query = [credentialQuery() mutableCopy];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) return 0;
    if (status != errSecSuccess) return -1;
    NSData *data = CFBridgingRelease(result);
    if (data.length + 1 > capacity) return -1;
    memcpy(buffer, data.bytes, data.length);
    buffer[data.length] = 0;
    return 1;
}
int cross_canon_account_write(const char *token) {
    if (!token) {
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)credentialQuery());
        return status == errSecSuccess || status == errSecItemNotFound;
    }
    NSData *data = [[NSString stringWithUTF8String:token] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *attributes = @{(__bridge id)kSecValueData: data};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)credentialQuery(), (__bridge CFDictionaryRef)attributes);
    if (status == errSecItemNotFound) {
        NSMutableDictionary *query = [credentialQuery() mutableCopy];
        [query addEntriesFromDictionary:attributes];
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
        status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    }
    return status == errSecSuccess;
}

#if !TARGET_OS_IPHONE
@interface CrossCanonAuthentication : NSObject <ASWebAuthenticationPresentationContextProviding>
@property(nonatomic, strong) ASWebAuthenticationSession *session;
@end
@implementation CrossCanonAuthentication
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    return NSApplication.sharedApplication.keyWindow;
}
@end
static CrossCanonAuthentication *authentication;
#endif
// Called on the render/main thread. Apple's system browser owns Google cookies.
int cross_canon_account_browser(const char *text) {
    NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:text]];
    if (!url || ![url.scheme isEqualToString:@"https"] || ![url.host isEqualToString:@"www.crosscanon.com"]) return 0;
#if TARGET_OS_IPHONE
    // Google account choices could highlight without navigating inside the
    // system authentication sheet in our iOS host. The same flow succeeds in
    // Safari. Open the full default browser; proof-held polling and the existing
    // crosscanon return link complete the handoff when the app resumes.
    if (![UIApplication.sharedApplication canOpenURL:url]) return 0;
    [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
    return 1;
#else
    [authentication.session cancel];
    authentication = [CrossCanonAuthentication new];
    authentication.session = [[ASWebAuthenticationSession alloc] initWithURL:url callbackURLScheme:@"crosscanon"
        completionHandler:^(NSURL *callback, __unused NSError *error) {
            // Forward only the short-lived ticket. The Rust client must match
            // its own request and supply its app-held proof to redeem it.
            if (callback) cross_canon_open_reader_link(callback.absoluteString.UTF8String);
        }];
    authentication.session.presentationContextProvider = authentication;
    return [authentication.session start];
#endif
}
void cross_canon_account_close_browser(void) {
#if !TARGET_OS_IPHONE
    [authentication.session cancel];
    authentication = nil;
#endif
}
