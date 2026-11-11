// Runs the real AVPlayer adapter and its main run loop, without a GUI or network.
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

extern void cross_canon_audio_play(const char *json);
extern void cross_canon_audio_command(int command);
extern char *cross_canon_audio_poll(void);
extern void cross_canon_audio_free(char *event);
static NSUInteger wakeCount;
void cross_canon_audio_wake(void) { wakeCount++; }

static NSDictionary *audio(NSString *url, double start, double end) {
    return @{@"url":url, @"startSeconds":@(start), @"endSeconds":@(end)};
}
static void play(NSArray *chapters) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"chapters":chapters,@"index":@0} options:0 error:nil];
    cross_canon_audio_play([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc == 4 && strcmp(argv[1], "--chapter-files") == 0) {
            NSString *first = [NSString stringWithUTF8String:argv[2]];
            NSString *second = [NSString stringWithUTF8String:argv[3]];
            play(@[
                @{@"id":@"first",@"title":@"First chapter",@"audio":@{@"url":first,@"startSeconds":@0,@"endSeconds":NSNull.null},@"fallback":NSNull.null},
                @{@"id":@"second",@"title":@"Second chapter",@"audio":@{@"url":second,@"startSeconds":@0,@"endSeconds":NSNull.null},@"fallback":NSNull.null}
            ]);
            BOOL secondStarted = NO, stopped = NO;
            NSInteger plays = 0;
            NSDate *start = NSDate.date;
            while (-start.timeIntervalSinceNow < 10 && !stopped) {
                [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
                char *raw;
                while ((raw = cross_canon_audio_poll())) {
                    NSString *text = [NSString stringWithUTF8String:raw]; puts(raw); cross_canon_audio_free(raw);
                    NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                    if ([event[@"type"] isEqual:@"playing"]) plays++;
                    if ([event[@"type"] isEqual:@"chapter"] && [event[@"chapter"] isEqual:@"second"]) secondStarted = YES;
                    if ([event[@"type"] isEqual:@"stopped"]) stopped = YES;
                    if ([event[@"type"] isEqual:@"error"]) return 7;
                }
            }
            if (!(secondStarted && stopped && plays >= 2 && wakeCount > 0)) { fprintf(stderr,"Original MP3 chapter-file continuation or notification failed\n"); return 8; }
            puts("PASS: real AVPlayer automatically continues between original MP3 chapter files");
            return 0;
        }
        if (argc != 2) return 2;
        NSString *fixture = [NSString stringWithUTF8String:argv[1]];
        play(@[
            @{@"id":@"first",@"title":@"First chapter",@"audio":audio(fixture,0,1.6),@"fallback":NSNull.null},
            @{@"id":@"second",@"title":@"Second chapter",@"audio":audio(fixture,1.6,3.2),@"fallback":NSNull.null}
        ]);
        BOOL second = NO, paused = NO, stopped = NO, advanced = NO;
        NSInteger plays = 0;
        NSDate *start = NSDate.date;
        BOOL pauseSent = NO, resumeSent = NO;
        while (-start.timeIntervalSinceNow < 9 && !stopped) {
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            double elapsed = -start.timeIntervalSinceNow;
            if (!pauseSent && plays > 0 && elapsed > 0.9) { cross_canon_audio_command(0); pauseSent = YES; }
            if (pauseSent && !resumeSent && elapsed > 1.4) { cross_canon_audio_command(0); resumeSent = YES; }
            char *raw;
            while ((raw = cross_canon_audio_poll())) {
                NSString *text = [NSString stringWithUTF8String:raw];
                puts(raw);cross_canon_audio_free(raw);
                NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                NSString *type = event[@"type"];
                if ([type isEqual:@"playing"]) plays++;
                if ([type isEqual:@"paused"]) paused = YES;
                if ([type isEqual:@"chapter"] && [event[@"chapter"] isEqual:@"second"]) second = YES;
                if ([type isEqual:@"position"] && [event[@"chapter"] isEqual:@"second"] && [event[@"seconds"] doubleValue] >= 1.6) advanced = YES;
                if ([type isEqual:@"stopped"]) stopped = YES;
                if ([type isEqual:@"error"]) return 3;
            }
        }
        if (!(second && paused && stopped && advanced && plays >= 2)) { fprintf(stderr,"Continuous playback / pause / resume failed\n"); return 4; }
        play(@[@{@"id":@"fallback",@"title":@"Fallback chapter",@"audio":audio(@"/private/tmp/crosscanon-missing-recording.m4a",0,1),@"fallback":audio(fixture,0,1)}]);
        BOOL fallback = NO, playing = NO;
        start = NSDate.date;
        while (-start.timeIntervalSinceNow < 6 && !playing) {
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            char *raw;
            while ((raw = cross_canon_audio_poll())) {
                NSString *text = [NSString stringWithUTF8String:raw];puts(raw);cross_canon_audio_free(raw);
                NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                if ([event[@"type"] isEqual:@"fallback"]) fallback = YES;
                if ([event[@"type"] isEqual:@"playing"]) playing = YES;
                if ([event[@"type"] isEqual:@"error"]) return 5;
            }
        }
        BOOL metadata = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo[MPMediaItemPropertyTitle] isEqual:@"Fallback chapter"];
        cross_canon_audio_command(1);
        [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        if (!(fallback && playing && metadata && wakeCount > 0)) { fprintf(stderr,"Fallback, notifications or system media metadata failed\n");return 6; }
        puts("PASS: real AVPlayer continuous chapters, pause/resume, original fallback, system media metadata");
    }
    return 0;
}
