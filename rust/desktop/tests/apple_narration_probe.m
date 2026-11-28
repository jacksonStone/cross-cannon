// Real native media adapter, authenticated loopback mock, no UI or paid provider.
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>
// Include the production adapter so this probe can exercise its system seek
// handler during a real pending download without exporting a test-only app API.
#import "../src/apple_audio.m"
extern void cross_canon_audio_play(const char *json);
extern void cross_canon_audio_command(int command);
extern char *cross_canon_audio_poll(void);
extern void cross_canon_audio_free(char *event);
void cross_canon_audio_wake(void) {}
static void play(NSString *origin, BOOL completedChapter) {
    NSMutableArray *units = [NSMutableArray new];
    for (NSString *letter in completedChapter ? @[@"a"] : @[@"a",@"b"]) {
        NSString *identifier = [@"" stringByPaddingToLength:64 withString:letter startingAtIndex:0];
        [units addObject:@{@"id":@"anf03:vi.iv.i",@"title":@"On Prayer 1 · AI narration",@"audio":@{@"url":[NSString stringWithFormat:@"%@/api/narration/%@/%@",origin,completedChapter ? @"chapter" : @"audio",identifier],@"startSeconds":@0,@"endSeconds":NSNull.null},@"fallback":NSNull.null}];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"chapters":units,@"index":@0,@"private_token":@"private-mock-session"} options:0 error:nil];
    cross_canon_audio_play([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static int retryCurrentUnit(void) {
    NSUInteger played=0; BOOL retried=NO; NSDate *started=NSDate.date;
    while (-started.timeIntervalSinceNow < 12 && played < 2) {
        [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.03]];
        char *raw;
        while ((raw=cross_canon_audio_poll())) {
            NSString *text=[NSString stringWithUTF8String:raw];puts(raw);fflush(stdout);cross_canon_audio_free(raw);
            NSDictionary *event=[NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
            if ([event[@"type"] isEqual:@"playing"]) played++;
            if ([event[@"type"] isEqual:@"error"]) {
                if (retried || engine.index != 1 || engine.chapters.count != 2 || !engine.privateToken.length || engine.wantsPlay || engine.privateTask) return 7;
                retried=YES;cross_canon_audio_command(0);
            }
        }
    }
    if (!retried || played != 2 || engine.index != 1) return 8;
    cross_canon_audio_command(1);
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.2]];
    NSUInteger files=0;
    for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:NSTemporaryDirectory() error:nil]) if ([name hasPrefix:@"cc-private-narration-"]) files++;
    if (engine.chapters.count || engine.privateToken.length || engine.privateTask || files) return 9;
    puts("PASS: native Play retries failed unit B without replaying A, explicit Stop clears private state");
    return 0;
}
int main(int argc,char **argv) {
    @autoreleasepool {
        if (argc != 2 && argc != 3) return 2;
        BOOL completedChapter = argc == 3 && strcmp(argv[2],"--completed-chapter") == 0;
        play([NSString stringWithUTF8String:argv[1]], completedChapter);
        if (completedChapter) {
            NSUInteger playing = 0; NSDate *started = NSDate.date;
            while (-started.timeIntervalSinceNow < 8 && playing < 2) {
                [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.03]];
                char *raw;
                while ((raw = cross_canon_audio_poll())) {
                    NSString *text = [NSString stringWithUTF8String:raw]; puts(raw); cross_canon_audio_free(raw);
                    NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                    if ([event[@"type"] isEqual:@"error"]) return 10;
                    if ([event[@"type"] isEqual:@"playing"]) {
                        playing++;
                        if (playing == 1) { cross_canon_audio_command(0); cross_canon_audio_command(0); }
                    }
                }
            }
            BOOL valid = playing == 2 && engine.chapters.count == 1 && engine.privateFile && [engine.url containsString:@"/api/narration/chapter/"];
            cross_canon_audio_command(1);
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
            if (!valid || engine.privateFile || engine.privateToken.length) return 11;
            puts("PASS: native completed chapter single private WAV, pause/resume, stop cleanup");
            return 0;
        }
        if (argc == 3 && strcmp(argv[2],"--retry-unit") == 0) return retryCurrentUnit();
        NSUInteger playing = 0, loading = 0; BOOL paused = NO, resumed = NO, loadingSeek = NO;
        NSDate *started = NSDate.date; double pauseTime = 0;
        while (-started.timeIntervalSinceNow < 15 && playing < 3) {
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.03]];
            if (paused && !resumed && -started.timeIntervalSinceNow > pauseTime + 0.25) { cross_canon_audio_command(0); resumed = YES; }
            char *raw;
            while ((raw = cross_canon_audio_poll())) {
                NSString *text = [NSString stringWithUTF8String:raw]; puts(raw); fflush(stdout); cross_canon_audio_free(raw);
                NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                if ([event[@"type"] isEqual:@"error"]) return 3;
                if ([event[@"type"] isEqual:@"loading"]) {
                    loading++;
                    if (!loadingSeek) {
                        if (!engine.privateTask || engine.privateFile) return 5;
                        NSUInteger generation = engine.generation;
                        [engine seek:15];
                        if (engine.generation != generation) return 6;
                        loadingSeek = YES;
                    }
                }
                if ([event[@"type"] isEqual:@"playing"]) {
                    playing++;
                    if (!paused) { cross_canon_audio_command(0);paused=YES;pauseTime=-started.timeIntervalSinceNow; }
                }
            }
        }
        BOOL label = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo[MPMediaItemPropertyTitle] containsString:@"AI narration"];
        cross_canon_audio_command(1);
        [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.2]];
        NSUInteger files=0;
        for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:NSTemporaryDirectory() error:nil]) if ([name hasPrefix:@"cc-private-narration-"]) files++;
        if (!(playing >= 3 && loading == 2 && loadingSeek && paused && resumed && label && files == 0)) { fprintf(stderr,"Native unit playback failed: plays=%lu loads=%lu files=%lu label=%d\n",playing,loading,files,label); return 4; }
        puts("PASS: authenticated native AI units, sequential playback, ignored seek during pending download, pause/resume, AI Now Playing label, stop cleanup");
    }
    return 0;
}
