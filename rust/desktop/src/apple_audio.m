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

@interface CrossCanonAudio : NSObject
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
            emit(@{@"type":@"position", @"seconds":@(position), @"chapter":track[@"id"]});
            [s updateNowPlaying];
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
    NSMutableDictionary *info = [@{MPMediaItemPropertyTitle:track[@"title"], MPMediaItemPropertyArtist:@"Cross Canon", MPNowPlayingInfoPropertyPlaybackRate:@(self.player.rate)} mutableCopy];
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
    self.wantsPlay = YES; [self.player play]; [self updateNowPlaying];
}
- (void)toggle { if (self.wantsPlay) [self pause]; else [self resume]; }
- (void)seek:(double)seconds {
    if (!isfinite(seconds) || !self.chapters.count) return;
    [self.player seekToTime:CMTimeMakeWithSeconds(MAX(0,seconds),600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero];
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
    [self updateNowPlaying];
}
- (void)stop {
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
    if (self.player.currentItem) [self.player.currentItem removeObserver:self forKeyPath:@"status"];
    if (self.endedObserver) [NSNotificationCenter.defaultCenter removeObserver:self.endedObserver];
    self.endedObserver = nil;
    [self.player replaceCurrentItemWithPlayerItem:item];
    if (!item) return;
    [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:NULL];
    __weak CrossCanonAudio *weakSelf = self;
    self.endedObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:item queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) { [weakSelf advance]; }];
}
- (void)load:(BOOL)seek {
    NSDictionary *track = self.chapters[self.index];
    NSDictionary *audio = self.fallback ? track[@"fallback"] : track[@"audio"];
    NSString *url = audio[@"url"];
    if (![url isKindOfClass:NSString.class]) { [self stop]; return; }
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
            if (self.generation != generation) return;
            self.seeking = NO;
            if (finished && self.wantsPlay) [self resume];
        }];
    } else if (self.wantsPlay) { [self resume]; }
    [self updateNowPlaying];
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
        return;
    }
    if (object != self.player.currentItem || self.player.currentItem.status != AVPlayerItemStatusFailed || !self.chapters.count) return;
    NSDictionary *fallback = self.chapters[self.index][@"fallback"];
    if (!self.fallback && [fallback isKindOfClass:NSDictionary.class]) {
        emit(@{@"type":@"fallback"});
        self.fallback = YES; [self load:YES];
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
