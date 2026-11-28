// Thin OS playback adapter. Rust owns the library, chapter plan and rendered UI.
// AVPlayer owns progressive/range loading, seek, interruptions and background audio.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <TargetConditionals.h>

static NSMutableArray<NSString *> *events;
extern void cross_canon_audio_wake(void);
static void prepareEvents(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{ events = [NSMutableArray new]; });
}
static void emit(NSDictionary *event) {
    prepareEvents();
    NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
    if (!data) return;
    @synchronized(events) {
        if (events.count >= 128) [events removeObjectAtIndex:0];
        [events addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    }
    cross_canon_audio_wake();
}

@interface CrossCanonAudio : NSObject <NSURLSessionTaskDelegate>
@property AVPlayer *player;
@property NSArray<NSDictionary *> *chapters;
@property NSInteger index;
@property NSUInteger generation;
@property BOOL wantsPlay;
@property BOOL fallback;
@property BOOL seeking;
@property BOOL interruptionResume;
@property id observer;
@property id endedObserver;
@property NSString *url;
@property NSString *privateToken;
@property NSURLSession *privateSession;
@property NSURLSessionDownloadTask *privateTask;
@property NSURL *privateFile;
- (void)clearPrivateUnit;
- (void)loadPrivate:(NSString *)url generation:(NSUInteger)generation;
- (void)failPrivate:(NSString *)message;
- (void)load:(BOOL)seek;
- (void)toggle;
- (void)pause;
- (void)resume;
- (void)stop;
- (void)advance;
- (void)next;
- (void)updateNowPlaying;
- (void)replaceItem:(AVPlayerItem *)item;
- (void)seek:(double)seconds;
@end

@implementation CrossCanonAudio
- (instancetype)init {
    if ((self = [super init])) {
        // Remove only our private transient units after an interrupted prior run.
        NSURL *temporary = [NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES];
        for (NSURL *file in [NSFileManager.defaultManager contentsOfDirectoryAtURL:temporary includingPropertiesForKeys:nil options:0 error:nil]) {
            if ([file.lastPathComponent hasPrefix:@"cc-private-narration-"]) [NSFileManager.defaultManager removeItemAtURL:file error:nil];
        }
        self.player = [AVPlayer new];
        self.chapters = @[];
        [self.player addObserver:self forKeyPath:@"timeControlStatus" options:0 context:NULL];
        __weak CrossCanonAudio *weakSelf = self;
        self.observer = [self.player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.25, 600) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) {
            CrossCanonAudio *s = weakSelf;
            if (!s || !s.chapters.count || s.seeking) return;
            double position = CMTimeGetSeconds(time);
            if (!isfinite(position)) return;
            NSDictionary *track = s.chapters[s.index];
            NSDictionary *audio = track[@"audio"];
            id end = s.fallback ? nil : audio[@"endSeconds"];
            if (s.wantsPlay && [end isKindOfClass:NSNumber.class] && position >= [end doubleValue] - 0.03) {
                [s advance]; return;
            }
            // Only chapter boundaries need periodic attention. The reader has no
            // elapsed-time UI; Now Playing extrapolates time from time + rate.
        }];
        MPRemoteCommandCenter *commands = MPRemoteCommandCenter.sharedCommandCenter;
        [commands.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) { [weakSelf resume]; return MPRemoteCommandHandlerStatusSuccess; }];
        [commands.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) { [weakSelf pause]; return MPRemoteCommandHandlerStatusSuccess; }];
        [commands.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) { [weakSelf toggle]; return MPRemoteCommandHandlerStatusSuccess; }];
        [commands.nextTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) { [weakSelf next]; return MPRemoteCommandHandlerStatusSuccess; }];
        [commands.previousTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
            CrossCanonAudio *s = weakSelf;
            if (s.index > 0) s.index--;
            s.fallback = NO; if (s.chapters.count) [s load:YES];
            return MPRemoteCommandHandlerStatusSuccess;
        }];
        commands.skipForwardCommand.preferredIntervals = @[@15];
        commands.skipBackwardCommand.preferredIntervals = @[@15];
        [commands.skipForwardCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            [weakSelf seek:CMTimeGetSeconds(weakSelf.player.currentTime) + ((MPSkipIntervalCommandEvent *)event).interval]; return MPRemoteCommandHandlerStatusSuccess;
        }];
        [commands.skipBackwardCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            [weakSelf seek:CMTimeGetSeconds(weakSelf.player.currentTime) - ((MPSkipIntervalCommandEvent *)event).interval]; return MPRemoteCommandHandlerStatusSuccess;
        }];
        [commands.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            [weakSelf seek:((MPChangePlaybackPositionCommandEvent *)event).positionTime]; return MPRemoteCommandHandlerStatusSuccess;
        }];
#if TARGET_OS_IPHONE
        [NSNotificationCenter.defaultCenter addObserverForName:AVAudioSessionInterruptionNotification object:AVAudioSession.sharedInstance queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            CrossCanonAudio *s = weakSelf;
            if ([note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan) {
                s.interruptionResume = s.wantsPlay;
                [s pause];
            } else {
                BOOL resume = s.interruptionResume && ([note.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue] & AVAudioSessionInterruptionOptionShouldResume);
                s.interruptionResume = NO;
                if (resume) [s resume];
            }
        }];
        [NSNotificationCenter.defaultCenter addObserverForName:AVAudioSessionRouteChangeNotification object:AVAudioSession.sharedInstance queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            if ([note.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue] == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) [weakSelf pause];
        }];
#endif
    }
    return self;
}
- (void)updateNowPlaying {
    if (!self.chapters.count) return;
    NSDictionary *track = self.chapters[self.index];
    double position = CMTimeGetSeconds(self.player.currentTime);
    double duration = CMTimeGetSeconds(self.player.currentItem.duration);
    float rate = self.player.timeControlStatus == AVPlayerTimeControlStatusPlaying ? self.player.rate : 0;
    NSMutableDictionary *info = [@{MPMediaItemPropertyTitle:track[@"title"], MPMediaItemPropertyArtist:@"Cross Canon", MPNowPlayingInfoPropertyPlaybackRate:@(rate)} mutableCopy];
    if (isfinite(position)) info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
    if (isfinite(duration)) info[MPMediaItemPropertyPlaybackDuration] = @(duration);
    MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
}
- (void)pause { self.wantsPlay = NO; [self.player pause]; emit(@{@"type":@"paused"}); [self updateNowPlaying]; }
- (void)resume {
    if (!self.chapters.count) return;
#if TARGET_OS_IPHONE
    [AVAudioSession.sharedInstance setActive:YES error:nil];
#endif
    self.wantsPlay = YES;
    if (self.privateToken.length && !self.privateTask && (!self.player.currentItem || self.player.currentItem.status == AVPlayerItemStatusFailed)) {
        [self load:YES]; return;
    }
    [self.player play]; [self updateNowPlaying];
}
- (void)toggle { if (self.wantsPlay) [self pause]; else [self resume]; }
- (void)seek:(double)seconds {
    if (!isfinite(seconds) || !self.chapters.count) return;
    // A private unit has no seekable item until its authenticated download is
    // installed. Do not invalidate that load's generation with a system seek.
    if (self.privateToken.length && (self.privateTask || !self.privateFile)) return;
    self.seeking = YES;
    NSUInteger generation = ++self.generation;
    [self.player seekToTime:CMTimeMakeWithSeconds(MAX(0,seconds),600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(__unused BOOL finished) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.generation != generation) return;
            self.seeking = NO;
            // currentTime is reliable after the asynchronous seek completes,
            // including while paused (when no playing timer can repair it).
            [self updateNowPlaying];
        });
    }];
    if (!self.fallback) {
        for (NSUInteger index = 0; index < self.chapters.count; index++) {
            NSDictionary *audio = self.chapters[index][@"audio"];
            id end = audio[@"endSeconds"];
            if ([audio[@"url"] isEqual:self.url] && seconds >= [audio[@"startSeconds"] doubleValue] &&
                (![end isKindOfClass:NSNumber.class] || seconds < [end doubleValue])) {
                self.index = index;
                emit(@{@"type":@"chapter",@"chapter":self.chapters[index][@"id"]});
                break;
            }
        }
    }
}
- (void)stop {
    [self clearPrivateUnit]; self.privateToken = nil;
    self.wantsPlay = NO; self.generation++;
    [self.player pause]; [self replaceItem:nil];
    self.chapters = @[]; self.url = nil;
    MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
#if TARGET_OS_IPHONE
    [AVAudioSession.sharedInstance setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
#endif
    emit(@{@"type":@"stopped"});
}
- (void)replaceItem:(AVPlayerItem *)item {
    if (self.player.currentItem) {
        [self.player.currentItem removeObserver:self forKeyPath:@"status"];
        [self.player.currentItem removeObserver:self forKeyPath:@"duration"];
    }
    if (self.endedObserver) [NSNotificationCenter.defaultCenter removeObserver:self.endedObserver];
    self.endedObserver = nil;
    [self.player replaceCurrentItemWithPlayerItem:item];
    if (!item) return;
    [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:NULL];
    [item addObserver:self forKeyPath:@"duration" options:NSKeyValueObservingOptionNew context:NULL];
    __weak CrossCanonAudio *weakSelf = self;
    self.endedObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:item queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) { [weakSelf advance]; }];
}
- (void)load:(BOOL)seek {
    NSDictionary *track = self.chapters[self.index];
    NSDictionary *audio = self.fallback ? track[@"fallback"] : track[@"audio"];
    NSString *url = audio[@"url"];
    if (![url isKindOfClass:NSString.class]) { [self stop]; return; }
    [self clearPrivateUnit];
    if (self.privateToken.length) {
        self.seeking = NO; self.url = url;
        [self.player pause]; [self replaceItem:nil];
        emit(@{@"type":@"chapter", @"chapter":track[@"id"]});
        emit(@{@"type":@"loading"});
        [self loadPrivate:url generation:++self.generation];
        return;
    }
    self.seeking = seek;
    emit(@{@"type":@"chapter", @"chapter":track[@"id"]});
    emit(@{@"type":@"loading"});
    if (![self.url isEqualToString:url] || self.player.currentItem.status == AVPlayerItemStatusFailed) {
        self.url = url;
        NSURL *location = [url hasPrefix:@"/"] ? [NSURL fileURLWithPath:url] : [NSURL URLWithString:url];
        [self replaceItem:[AVPlayerItem playerItemWithURL:location]];
    }
    // AVPlayer can queue the seek before a remote item finishes loading.
    NSUInteger generation = ++self.generation;
    double start = [audio[@"startSeconds"] doubleValue];
    if (seek) {
        [self.player seekToTime:CMTimeMakeWithSeconds(MAX(0,start), 600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (self.generation != generation) return;
                self.seeking = NO;
                if (finished && self.wantsPlay) [self resume];
                else [self updateNowPlaying];
            });
        }];
    } else if (self.wantsPlay) { [self resume]; }
    [self updateNowPlaying];
}
// AI units use an ephemeral authenticated session. A unit is written only to
// a private random temporary file, removed before the next unit or on stop.
// Durable reuse is exclusively server-side, behind the verified account.
- (void)clearPrivateUnit {
    [self.privateTask cancel]; self.privateTask = nil;
    [self.privateSession invalidateAndCancel]; self.privateSession = nil;
    if (self.privateFile) [NSFileManager.defaultManager removeItemAtURL:self.privateFile error:nil];
    self.privateFile = nil;
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
    // Never forward a native bearer token through a media redirect.
    completionHandler(nil);
}
- (void)loadPrivate:(NSString *)url generation:(NSUInteger)generation {
    NSURL *location = [NSURL URLWithString:url];
    BOOL completedChapter = [location.path hasPrefix:@"/api/narration/chapter/"];
    if (!location || (![location.path hasPrefix:@"/api/narration/audio/"] && !completedChapter)) { [self stop]; emit(@{@"type":@"error",@"message":@"Invalid AI narration address"}); return; }
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.URLCache = nil; config.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    config.HTTPCookieStorage = nil; config.HTTPShouldSetCookies = NO;
    config.timeoutIntervalForRequest = 90; config.timeoutIntervalForResource = 120;
    self.privateSession = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:location];
    [request setValue:[@"Bearer " stringByAppendingString:self.privateToken] forHTTPHeaderField:@"Authorization"];
    [request setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"];
    __weak CrossCanonAudio *weak = self;
    self.privateTask = [self.privateSession downloadTaskWithRequest:request completionHandler:^(NSURL *temporary, NSURLResponse *response, NSError *error) {
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        NSNumber *size; [temporary getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
        BOOL valid = !error && http.statusCode == 200 && [http.MIMEType hasPrefix:@"audio/"] && size.unsignedLongLongValue > 44 && size.unsignedLongLongValue <= (completedChapter ? 512ULL : 16ULL) * 1024 * 1024;
        NSURL *file = valid ? [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES] URLByAppendingPathComponent:[NSString stringWithFormat:@"cc-private-narration-%@.wav",NSUUID.UUID.UUIDString]] : nil;
        if (valid) valid = [NSFileManager.defaultManager moveItemAtURL:temporary toURL:file error:nil];
        dispatch_async(dispatch_get_main_queue(), ^{
            CrossCanonAudio *self = weak;
            if (!self || self.generation != generation || !self.privateToken.length) { if(file) [NSFileManager.defaultManager removeItemAtURL:file error:nil]; return; }
            self.privateTask = nil;
            if (!valid) {
                if(file) [NSFileManager.defaultManager removeItemAtURL:file error:nil];
                [self failPrivate:http.statusCode == 429 ? @"Batch audio is paused by a generation limit. Saved batches remain available." : @"Batch audio paused. Tap Play to retry the saved chapter."]; return;
            }
            self.privateFile = file;
            [self replaceItem:[AVPlayerItem playerItemWithURL:file]];
            if (self.wantsPlay) [self resume]; else [self updateNowPlaying];
        });
    }];
    [self.privateTask resume];
}
- (void)failPrivate:(NSString *)message {
    // Keep this authenticated plan and its current unit index for Play retry.
    // Explicit stop/account changes still discard the complete private plan.
    self.wantsPlay = NO; self.generation++; self.seeking = NO;
    [self clearPrivateUnit]; [self.player pause]; [self replaceItem:nil];
    [self updateNowPlaying]; emit(@{@"type":@"error",@"message":message});
}
- (void)advance {
    if (!self.chapters.count) return;
    if ((NSUInteger)(self.index + 1) >= self.chapters.count) { [self stop]; return; }
    NSString *oldUrl = self.url;
    BOOL wasFallback = self.fallback;
    self.index++; self.fallback = NO;
    NSDictionary *track = self.chapters[self.index];
    // Keep the existing recording running across adjacent aligned chapters.
    NSDictionary *nextAudio = track[@"audio"];
    BOOL same = !wasFallback && [oldUrl isEqualToString:nextAudio[@"url"]];
    if (same) { emit(@{@"type":@"chapter", @"chapter":track[@"id"]}); [self updateNowPlaying]; }
    else [self load:YES];
}
- (void)next {
    if (!self.chapters.count) return;
    if ((NSUInteger)(self.index + 1) >= self.chapters.count) { [self stop]; return; }
    self.index++; self.fallback = NO;
    [self load:YES];
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    if (!NSThread.isMainThread) {
        dispatch_async(dispatch_get_main_queue(), ^{ [self observeValueForKeyPath:keyPath ofObject:object change:change context:context]; });
        return;
    }
    if ([keyPath isEqualToString:@"timeControlStatus"]) {
        if (self.player.timeControlStatus == AVPlayerTimeControlStatusPlaying) emit(@{@"type":@"playing"});
        else if (!self.wantsPlay) emit(@{@"type":@"paused"});
        // Includes buffering/stalls and recovery, not just explicit commands.
        [self updateNowPlaying];
        return;
    }
    if (object != self.player.currentItem || !self.chapters.count) return;
    if ([keyPath isEqualToString:@"duration"] || self.player.currentItem.status == AVPlayerItemStatusReadyToPlay) {
        [self updateNowPlaying];
        return;
    }
    if (self.player.currentItem.status != AVPlayerItemStatusFailed) return;
    NSDictionary *fallback = self.chapters[self.index][@"fallback"];
    if (!self.fallback && [fallback isKindOfClass:NSDictionary.class]) {
        emit(@{@"type":@"fallback"});
        self.fallback = YES; [self load:YES];
    } else if (self.privateToken.length) {
        [self failPrivate:@"Batch audio paused. Tap Play to retry the saved chapter."];
    } else {
        NSString *message = self.player.currentItem.error.localizedDescription ?: @"Recording is unavailable";
        [self stop]; emit(@{@"type":@"error", @"message":message});
    }
}
@end

static CrossCanonAudio *engine;
void cross_canon_audio_play(const char *json) {
    NSString *text = [NSString stringWithUTF8String:json];
    dispatch_async(dispatch_get_main_queue(), ^{
        prepareEvents();
        if (!engine) engine = [CrossCanonAudio new];
        NSDictionary *plan = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        NSArray *chapters = plan[@"chapters"]; NSInteger index = [plan[@"index"] integerValue];
        if (![chapters isKindOfClass:NSArray.class] || index < 0 || (NSUInteger)index >= chapters.count) return;
        [engine clearPrivateUnit]; engine.generation++;
        id token = plan[@"private_token"]; engine.privateToken = [token isKindOfClass:NSString.class] ? token : nil;
        engine.chapters = chapters; engine.index = index; engine.fallback = NO; engine.wantsPlay = YES;
        [engine load:YES];
    });
}
void cross_canon_audio_command(int command) {
    dispatch_async(dispatch_get_main_queue(), ^{ if (command == 0) [engine toggle]; else [engine stop]; });
}
char *cross_canon_audio_poll(void) {
    prepareEvents();
    @synchronized(events) {
        if (!events.count) return NULL;
        NSString *event = events.firstObject; [events removeObjectAtIndex:0];
        return strdup(event.UTF8String);
    }
}
void cross_canon_audio_free(char *event) { free(event); }
