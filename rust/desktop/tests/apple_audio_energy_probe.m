// Exercise the real adapter while counting notifications at its OS/reader seam.
#import "../src/apple_audio.m"

static NSUInteger wakeCount, metadataUpdates;
void cross_canon_audio_wake(void) { wakeCount++; }
@interface MeasuredAudio : CrossCanonAudio
@end
@implementation MeasuredAudio
- (void)updateNowPlaying { metadataUpdates++; [super updateNowPlaying]; }
@end

static void pump(double seconds) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (until.timeIntervalSinceNow > 0)
        [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
}
static void drain(void) {
    char *raw;
    while ((raw = cross_canon_audio_poll())) cross_canon_audio_free(raw);
}
static void require(BOOL condition, NSString *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
}
static NSDictionary *info(void) { return MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo; }

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        engine = [MeasuredAudio new]; engine.player.volume = 0;
        NSString *url = [NSString stringWithUTF8String:argv[1]];
        NSMutableArray *tracks = [NSMutableArray new];
        for (int i = 0; i < 3; i++)
            [tracks addObject:@{@"id":[NSString stringWithFormat:@"chapter-%d",i],
                @"title":[NSString stringWithFormat:@"Chapter %d",i],
                @"audio":@{@"url":url,@"startSeconds":@(i*20),@"endSeconds":@((i+1)*20)},
                @"fallback":NSNull.null}];
        NSData *plan = [NSJSONSerialization dataWithJSONObject:@{@"chapters":tracks,@"index":@0} options:0 error:nil];
        cross_canon_audio_play([[NSString alloc] initWithData:plan encoding:NSUTF8StringEncoding].UTF8String);
        for (int i = 0; i < 100 && engine.player.timeControlStatus != AVPlayerTimeControlStatusPlaying; i++) pump(0.05);
        require(engine.player.timeControlStatus == AVPlayerTimeControlStatusPlaying, @"Audio must actually play");
        pump(0.5); drain(); metadataUpdates = 0; wakeCount = 0;
        double before = CMTimeGetSeconds(engine.player.currentTime);
        pump(1.5);
        printf("STEADY_PLAYBACK metadata=%lu readerWakeups=%lu\n", (unsigned long)metadataUpdates, (unsigned long)wakeCount);
        require(CMTimeGetSeconds(engine.player.currentTime) > before + 1, @"Player must continue during quiet interval");
        require(metadataUpdates == 0 && wakeCount == 0, @"Steady playback must not republish metadata or wake the reader");
        require([info()[MPMediaItemPropertyPlaybackDuration] doubleValue] > 60, @"Ready item must publish duration");

        [engine pause]; pump(0.1);
        require([info()[MPNowPlayingInfoPropertyPlaybackRate] doubleValue] == 0, @"Pause must stop lock-screen progress");
        // Paused seeks cannot rely on a playing time observer to repair metadata.
        [engine seek:44]; pump(0.4);
        require(engine.index == 2 && [info()[MPMediaItemPropertyTitle] isEqual:@"Chapter 2"], @"Seek must update chapter");
        require(fabs(CMTimeGetSeconds(engine.player.currentTime) - 44) < 0.1 &&
                fabs([info()[MPNowPlayingInfoPropertyElapsedPlaybackTime] doubleValue] - 44) < 0.1,
                @"Completed paused seek must publish its actual time");
        require([info()[MPNowPlayingInfoPropertyPlaybackRate] doubleValue] == 0, @"Seek must preserve pause");
        [engine resume]; pump(0.3);
        require([info()[MPNowPlayingInfoPropertyPlaybackRate] doubleValue] > 0, @"Resume must restart lock-screen progress");
        [engine seek:24]; pump(0.4);
        require(engine.index == 1 && fabs([info()[MPNowPlayingInfoPropertyElapsedPlaybackTime] doubleValue] - 24) < 0.7,
                @"Playing seek must refresh chapter and time");
        // Direct AVPlayer state changes use the same KVO path as system stalls/resumes.
        [engine.player pause]; pump(0.1);
        require(engine.wantsPlay && [info()[MPNowPlayingInfoPropertyPlaybackRate] doubleValue] == 0,
                @"Player state changes must refresh metadata even when play is still requested");
        [engine.player play]; pump(0.3);
        require([info()[MPNowPlayingInfoPropertyPlaybackRate] doubleValue] > 0, @"Player recovery must refresh metadata");
        [engine stop]; pump(0.1);
        require(info() == nil, @"Stop must clear metadata");
        puts("PASS: quiet real playback, duration, paused/playing seeks, pause/resume, player state changes, stop");
    }
    return 0;
}
