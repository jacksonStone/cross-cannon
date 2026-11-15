// Runs the real UIKit adapter in an isolated simulator app, without accounts,
// databases or recordings. Tests cross the same JSON interface as the reader.
#import <UIKit/UIKit.h>
static NSMutableArray<NSDictionary *> *events;
void cross_canon_reader_event(const char *json) {
    NSDictionary *event = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json]
        dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    [events addObject:event];
}
#import "../src/apple_reader.m"

// Match the rendering host: winit's UIView implements UIKeyInput and can become
// first responder even when the current egui dialog has no editable field.
@interface CCInputHost : UIView <UIKeyInput>
@end
@implementation CCInputHost
- (BOOL)canBecomeFirstResponder { return YES; }
- (BOOL)hasText { return YES; }
- (void)insertText:(NSString *)text {}
- (void)deleteBackward {}
@end

#define CHECK(condition, message) do { if (!(condition)) { fprintf(stderr, "FAIL: %s\n", message); exit(1); } } while (0)

static NSMutableDictionary *model(void) {
    NSMutableArray *chapters = [NSMutableArray new];
    for (int c = 1; c <= 3; c++) {
        NSMutableArray *paragraphs = [NSMutableArray new];
        for (int i = 0; i < 16; i++) [paragraphs addObject:@{
            @"id": [NSString stringWithFormat:@"John:%d:%d", c, i],
            @"reference": [NSString stringWithFormat:@"John %d:%d", c, i + 1],
            @"text": i == 0 ? @"For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life. “Café” — λόγος 🙏." :
                @"For God didn’t send his Son into the world to judge the world, but that the world should be saved through him. He who believes in him is not judged.",
            @"link": @"https://www.crosscanon.com/reader/John", @"highlight": i == 2 ? @"yellow" : NSNull.null,
            @"modernization": i == 1 ? @[@[@4, @3]] : @[] }];
        [chapters addObject:@{@"title":[NSString stringWithFormat:@"John %d", c],
            @"subtitle":@"WEB · World English Bible", @"paragraphs":paragraphs}];
    }
    return [@{@"visible":@YES, @"book":@"John", @"title":@"John 2", @"collection":@"Scripture",
        @"scripture":@YES, @"chapters":chapters, @"jump":@"John:2:0", @"location":@"John:2:0",
        @"selected":NSNull.null, @"reference":NSNull.null, @"fontScale":@1, @"lineHeight":@1.72,
        @"width":@820,
        @"paper":@"#fbfaf7", @"ink":@"#24211d", @"muted":@"#686058", @"accent":@"#8f3526",
        @"playing":@NO, @"audio":@YES, @"versionControl":@NO, @"original":@NO,
        @"previous":@NO, @"next":@YES, @"status":@"", @"theme":@0, @"translation":@0} mutableCopy];
}
static void update(NSDictionary *model) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:model options:0 error:nil];
    cross_canon_reader_update([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    [reader layoutIfNeeded];
}
static void setCurrentTitle(NSMutableDictionary *model, NSString *title) {
    model[@"title"] = title;
    NSMutableArray *chapters = [model[@"chapters"] mutableCopy];
    NSMutableDictionary *chapter = [chapters[1] mutableCopy];
    chapter[@"title"] = title;
    chapters[1] = chapter;
    model[@"chapters"] = chapters;
}
static void snapshot(NSString *name, UIView *view) {
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:view.bounds.size];
    NSData *data = [renderer PNGDataWithActions:^(UIGraphicsImageRendererContext *context) {
        [view.layer renderInContext:context.CGContext];
    }];
    NSString *directory = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    [data writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES];
}

static void benchmarkChapters(void) {
    NSURL *url = [NSBundle.mainBundle URLForResource:@"reader-performance" withExtension:@"json"];
    if (!url) return;
    NSArray *chapters = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:url] options:0 error:nil];
    NSMutableDictionary *m = model();
    m[@"book"] = @"Acts"; m[@"title"] = @"Acts 4";
    m[@"location"] = chapters[3][@"paragraphs"][0][@"id"];
    m[@"jump"] = m[@"location"]; m[@"chapters"] = [chapters subarrayWithRange:NSMakeRange(0, 7)];
    update(m); m[@"jump"] = NSNull.null;
    double worst = 0;
    for (NSUInteger retained = 0; retained < 2; retained++) {
        m[@"chapters"] = [chapters subarrayWithRange:NSMakeRange(0, 3)];
        m[@"jump"] = chapters[1][@"paragraphs"][0][@"id"]; update(m); m[@"jump"] = NSNull.null;
        for (NSUInteger count = 4; count <= 7; count++) {
            m[@"chapters"] = [chapters subarrayWithRange:NSMakeRange(0, count)];
            if (!retained) reader.chapterSpans = nil;
            CFAbsoluteTime began = CFAbsoluteTimeGetCurrent(); update(m);
            fprintf(stderr, "PERF: Acts append %s %.2f ms\n", retained ? "reuse" : "full", (CFAbsoluteTimeGetCurrent() - began) * 1000);
        }
    }
    for (NSUInteger start = 1; start <= 3; start++) {
        m[@"chapters"] = [chapters subarrayWithRange:NSMakeRange(start, 7)];
        CFAbsoluteTime began = CFAbsoluteTimeGetCurrent(); update(m);
        double ms = (CFAbsoluteTimeGetCurrent() - began) * 1000;
        worst = MAX(worst, ms);
        fprintf(stderr, "PERF: Acts chapter-window update %.2f ms, %lu characters\n", ms, (unsigned long)reader.text.text.length);
    }
    CHECK(worst < 50, "Loading the next Acts chapter must not block the main thread for 50 ms");
}

static void runChecks(UIWindow *window) {
    events = [NSMutableArray new];
    NSMutableDictionary *m = model();
    setCurrentTitle(m, @"The First Epistle of Clement to the Corinthians. 1");
    update(m);
    CHECK(reader && reader.text.selectable && !reader.text.editable, "Reader must be real, selectable, read-only UIKit text");
    CHECK(reader.superview == window.rootViewController.view, "Native menus require a view-controller responder chain");
    CHECK(reader.titleButton.titleLabel.lineBreakMode == NSLineBreakByTruncatingTail && reader.titleButton.titleLabel.numberOfLines == 2,
        "Long work titles must fit the compact two-line header");
    CHECK(reader.titleHeight.constant >= 44 && reader.titleHeight.constant <= ceil(reader.titleButton.titleLabel.font.lineHeight * 2) + 4
        && reader.titleButton.bounds.size.height >= reader.titleButton.titleLabel.bounds.size.height,
        "A compact multiline title must stay inside its measured header");
    CGRect titleFrame = [reader.titleButton convertRect:reader.titleButton.bounds toView:window];
    CGRect textFrame = [reader.text convertRect:reader.text.bounds toView:window];
    CHECK(CGRectGetMinY(titleFrame) >= window.safeAreaInsets.top && CGRectGetMaxY(titleFrame) < CGRectGetMinY(textFrame),
        "Long titles must stay below the status area and above the reading viewport");
    setCurrentTitle(m, @"The Imitation of Christ 2"); m[@"versionControl"] = @YES; update(m);
    CHECK(reader.titleHeight.constant == 44, "The Imitation of Christ must fit the minimum-height reading header");
    CHECK(reader.footer.hidden && fabs(CGRectGetMaxY(reader.text.frame) - (reader.bounds.size.height - reader.safeAreaInsets.bottom)) < 1,
        "Unselected reading must extend to the safe-area bottom without a reserved toolbar");
    CGFloat safeHeight = reader.bounds.size.height - reader.safeAreaInsets.top - reader.safeAreaInsets.bottom;
    CHECK(reader.text.bounds.size.height > safeHeight * 0.88, "Normal reading should dedicate at least 88 percent of the safe-area height to text");
    CGRect libraryFrame = [reader.libraryButton convertRect:reader.libraryButton.bounds toView:reader];
    CHECK(libraryFrame.size.width >= 44 && libraryFrame.size.height >= 44
        && CGRectGetMaxY(libraryFrame) <= CGRectGetMinY(reader.text.frame), "The books control must remain reachable in the header");
    UIMenu *readingMenu = (UIMenu *)reader.toolsButton.menu.children.lastObject;
    CHECK([readingMenu isKindOfClass:UIMenu.class] && [readingMenu.title isEqual:@"Reading text"] && readingMenu.children.count == 2,
        "Original and modernized text must remain available without a permanent bottom switch");
    snapshot(@"native-compact-reading.png", reader);
    setCurrentTitle(m, @"John 2"); m[@"versionControl"] = @NO; update(m);
    CHECK([reader.text conformsToProtocol:@protocol(UIAccessibilityReadingContent)], "Speak Screen requires reading content");
    CHECK(reader.paragraphs.count == 48, "Complete paragraphs across all bundled chapters");
    UIFont *font = [reader.text.attributedText attribute:NSFontAttributeName atIndex:200 effectiveRange:NULL];
    fprintf(stderr, "Reader font: %s %.2fpt\n", font.fontName.UTF8String, font.pointSize);
    CHECK([font.fontName containsString:@"SourceSerif"], "Keep the existing Source Serif typography");
    CHECK(reader.text.accessibilityCustomActions.count >= 3, "Passage actions must be available to VoiceOver");
    CHECK(reader.text.frame.size.height > 300 && (reader.footer.hidden || CGRectGetMaxY(reader.text.frame) <= CGRectGetMinY(reader.footer.frame)), "Footer must not cover reader text");
    NSDictionary *anchor = [reader paragraphAtOffset:[reader visibleCharacter]];
    CHECK([anchor[@"id"] isEqual:@"John:2:0"], "Explicit jumps restore the passage ID");
    snapshot(@"native-normal.png", reader);

    // A passage tap and iOS word selection are separate interactions. Mirror
    // the shared reader's selected ID update without selecting native words.
    m[@"jump"] = NSNull.null;
    m[@"selected"] = @"John:2:0"; m[@"reference"] = @"John 2:1";
    update(m);
    NSRange tappedRange = [reader.paragraphs[16][@"range"] rangeValue];
    UIColor *tappedBackground = [reader.text.attributedText attribute:NSBackgroundColorAttributeName atIndex:tappedRange.location effectiveRange:NULL];
    CHECK(tappedBackground && CGColorGetAlpha(tappedBackground.CGColor) > 0,
        "Tapping a passage must visibly highlight its text even without native word selection");
    CHECK(reader.text.selectedRange.length == 0, "Passage highlighting must not replace native word selection");
    CGRect actionFrame = [reader.actions.arrangedSubviews.firstObject convertRect:reader.actions.arrangedSubviews.firstObject.bounds toView:reader];
    for (UIButton *button in reader.actions.arrangedSubviews) {
        CGRect frame = [button convertRect:button.bounds toView:reader];
        CHECK(fabs(CGRectGetMidY(frame) - CGRectGetMidY(actionFrame)) < 1,
            "Selected passage actions must share a single bottom row");
    }
    CGRect readerFrame = reader.frame;
    reader.frame = CGRectMake(0, 0, 320, 700); update(m);
    actionFrame = [reader.actions.arrangedSubviews.firstObject convertRect:reader.actions.arrangedSubviews.firstObject.bounds toView:reader];
    for (UIButton *button in reader.actions.arrangedSubviews) {
        CGRect frame = [button convertRect:button.bounds toView:reader];
        CHECK(frame.size.width >= 44 && frame.size.height >= 44 && CGRectGetMaxX(frame) <= reader.bounds.size.width - 16
            && CGRectGetMinX(frame) >= 16 && fabs(CGRectGetMidY(frame) - CGRectGetMidY(actionFrame)) < 1,
            "All passage controls must fit one row at 320 points with 44-point targets");
    }
    reader.frame = readerFrame; update(m);
    snapshot(@"native-tapped-passage.png", reader);
    NSRange markedRange = [reader.paragraphs[18][@"range"] rangeValue];
    UIColor *savedMark = [reader.text.attributedText attribute:NSBackgroundColorAttributeName atIndex:markedRange.location effectiveRange:NULL];
    m[@"selected"] = @"John:2:2"; update(m);
    CHECK([reader.text.attributedText attribute:NSBackgroundColorAttributeName atIndex:tappedRange.location effectiveRange:NULL] == nil,
        "Moving selection must remove the previous passage's temporary highlight");
    m[@"selected"] = NSNull.null; m[@"reference"] = NSNull.null; update(m);
    CHECK([reader.text.attributedText attribute:NSBackgroundColorAttributeName atIndex:tappedRange.location effectiveRange:NULL] == nil,
        "Deselecting a passage must remove its temporary highlight");
    CHECK([[reader.text.attributedText attribute:NSBackgroundColorAttributeName atIndex:markedRange.location effectiveRange:NULL] isEqual:savedMark],
        "Deselecting a marked passage must restore the saved study highlight exactly");

    NSString *unicode = @"“Café” — λόγος 🙏.";
    NSRange selection = [reader.text.text rangeOfString:unicode options:0 range:[reader.paragraphs[16][@"range"] rangeValue]];
    CHECK(selection.location != NSNotFound, "Unicode fixture must exist");
    reader.text.selectedRange = selection;
    [reader textViewDidChangeSelection:reader.text];
    CHECK(reader.selectionActive, "Selection is active");
    CHECK([reader.text canPerformAction:@selector(copy:) withSender:nil], "Native Copy must be available");
    [reader.text copy:nil];
    CHECK([UIPasteboard.generalPasteboard.string isEqual:unicode], "Copy preserves Unicode text exactly");
    m[@"jump"] = NSNull.null;
    m[@"selected"] = @"John:2:0";
    m[@"reference"] = @"John 2:1";
    update(m);
    CHECK([[reader.text.text substringWithRange:reader.text.selectedRange] isEqual:unicode], "Passage actions must preserve word selection");
    snapshot(@"native-selection.png", reader);

    CGFloat oldY = [reader rectForParagraph:anchor].origin.y - reader.text.contentOffset.y;
    [reader reportLocation];
    m[@"fontScale"] = @1.3;
    update(m);
    NSDictionary *same = [reader paragraphAtOffset:[reader visibleCharacter]];
    CHECK([same[@"id"] isEqual:anchor[@"id"]], "Font reflow must preserve focused passage");
    CHECK(fabs(([reader rectForParagraph:same].origin.y - reader.text.contentOffset.y) - oldY) < 2, "Font reflow preserves the passage's viewport position");
    CHECK([[reader.text.text substringWithRange:reader.text.selectedRange] isEqual:unicode], "Font reflow preserves selected Unicode words");

    // Prepend an earlier chapter and then remove it again. The visible passage
    // and its exact viewport position must remain unchanged in both directions.
    NSMutableArray *extended = [m[@"chapters"] mutableCopy];
    NSMutableDictionary *earlier = [extended.firstObject mutableCopy];
    earlier[@"title"] = @"Earlier chapter";
    NSMutableArray *earlierParagraphs = [NSMutableArray new];
    for (NSDictionary *p in earlier[@"paragraphs"]) {
        NSMutableDictionary *copy = [p mutableCopy]; copy[@"id"] = [@"earlier-" stringByAppendingString:p[@"id"]];
        [earlierParagraphs addObject:copy];
    }
    earlier[@"paragraphs"] = earlierParagraphs;
    [extended insertObject:earlier atIndex:0];
    m[@"chapters"] = extended;
    update(m);
    CHECK([[reader paragraphAtOffset:[reader visibleCharacter]][@"id"] isEqual:anchor[@"id"]], "Prepending cannot move the reader to a different passage");
    CHECK([[reader.text.text substringWithRange:reader.text.selectedRange] isEqual:unicode], "Prepending preserves selection by paragraph and UTF-16 range");
    [extended removeObjectAtIndex:0]; m[@"chapters"] = [extended copy]; update(m);
    CHECK([[reader paragraphAtOffset:[reader visibleCharacter]][@"id"] isEqual:anchor[@"id"]], "Pruning an earlier chapter preserves focus");

    m[@"selected"] = NSNull.null; m[@"reference"] = NSNull.null; update(m);
    CHECK(!reader.selectionActive && reader.text.selectedRange.length == 0,
        "Closing passage actions must release native selection so chapter loading can continue");
    window.traitOverrides.preferredContentSizeCategory = UIContentSizeCategoryAccessibilityExtraExtraExtraLarge;
    [window layoutIfNeeded];
    [reader preferencesChanged:nil];
    UIFont *large = [reader.text.attributedText attribute:NSFontAttributeName atIndex:200 effectiveRange:NULL];
    CHECK(large.pointSize > font.pointSize * 2, "Largest accessibility system size must scale the custom font");
    CHECK([[reader paragraphAtOffset:[reader visibleCharacter]][@"id"] isEqual:anchor[@"id"]], "System Larger Text must preserve passage identity");
    CHECK(CGRectGetMaxX(reader.text.frame) <= CGRectGetWidth(reader.bounds) + 1, "Large text must fit the viewport horizontally");
    snapshot(@"native-largest-text.png", reader);
    CCReaderSettings *settings = [CCReaderSettings new]; settings.reader = reader;
    [settings loadViewIfNeeded]; settings.view.frame = reader.bounds; [settings.view layoutIfNeeded];
    CHECK([settings tableView:settings.tableView numberOfRowsInSection:0] == 7, "Native settings retain size, spacing, width and all four presets");
    UITableViewCell *sizeCell = [settings tableView:settings.tableView cellForRowAtIndexPath:[NSIndexPath indexPathForRow:0 inSection:0]];
    CHECK(sizeCell.accessoryView.bounds.size.width >= 80, "Text size stepper must be visible and tappable");
    snapshot(@"native-settings.png", settings.view);
    UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:settings];
    [settings tableView:settings.tableView didSelectRowAtIndexPath:[NSIndexPath indexPathForRow:2 inSection:2]];
    CHECK(settings.overrideUserInterfaceStyle == UIUserInterfaceStyleDark && navigation.overrideUserInterfaceStyle == UIUserInterfaceStyleDark,
        "Dark reader settings must update both the sheet and its navigation bar");

    [NSNotificationCenter.defaultCenter postNotificationName:UIKeyboardWillChangeFrameNotification object:nil
        userInfo:@{UIKeyboardFrameEndUserInfoKey:[NSValue valueWithCGRect:CGRectMake(0, window.bounds.size.height - 300, window.bounds.size.width, 300)]}];
    CHECK(fabs(cross_canon_keyboard_height() - 300) < 1, "Dialog viewports must exclude the software keyboard");
    [NSNotificationCenter.defaultCenter postNotificationName:UIKeyboardWillHideNotification object:nil];
    CHECK(cross_canon_keyboard_height() == 0, "Dismissing the keyboard restores the full viewport");

    NSInteger line = [reader.text accessibilityLineNumberForPoint:CGPointMake(30, reader.text.contentOffset.y + 30)];
    CHECK(line != NSNotFound && [[reader.text accessibilityContentForLineNumber:line] length], "Speak Screen can retrieve the visible line");
    CHECK(!CGRectIsEmpty([reader.text accessibilityFrameForLineNumber:line]), "Spoken line has usable screen geometry");
    CHECK([[reader.text accessibilityPageContent] length] > 0 && [[reader.text accessibilityPageContent] length] < reader.text.text.length,
        "Speak Screen reads the current viewport, not earlier cached chapters");
    CGFloat beforeTurn = reader.text.contentOffset.y;
    CHECK([reader.text accessibilityScroll:UIAccessibilityScrollDirectionNext] && reader.text.contentOffset.y > beforeTurn,
        "VoiceOver read-all must advance automatically to the next page");
    CHECK([reader.text accessibilityScroll:UIAccessibilityScrollDirectionPrevious] && reader.text.contentOffset.y < beforeTurn + reader.text.bounds.size.height,
        "VoiceOver must also support returning to the previous page");
    m[@"paper"] = @"#171717"; m[@"ink"] = @"#eee9de"; m[@"muted"] = @"#bbb1a2";
    m[@"accent"] = @"#f1b38c"; m[@"chapters"] = NSNull.null; update(m);
    snapshot(@"native-dark-largest.png", reader);

    [reader.text becomeFirstResponder];
    CHECK(reader.text.isFirstResponder, "Native text selection must own the responder before opening commentary");
    cross_canon_reader_update("{\"visible\":false}");
    CHECK(!window.rootViewController.view.isFirstResponder,
        "Opening a read-only dialog must not transfer the selection responder to the keyboard-capable rendering host");
    CHECK(reader.hidden && reader.accessibilityElementsHidden, "Dialogs must hide the reading accessibility surface");
    const char *tree = "{\"modal\":true,\"scale\":1,\"nodes\":[{\"id\":\"42\",\"label\":\"Close search\",\"value\":null,\"number\":null,\"selected\":false,\"role\":\"button\",\"rect\":[20,70,44,44]}]}";
    cross_canon_accessibility_update(tree);
    CCElement *element = elements[@"42"];
    CHECK(element && element.accessibilityLabel.length, "Native VoiceOver must reach dialog controls");
    [element accessibilityActivate];
    CHECK([events.lastObject[@"action"] isEqual:@"accessibility"] && [events.lastObject[@"id"] isEqual:@"42"], "VoiceOver activation reaches the real egui action");
    [element accessibilityScroll:UIAccessibilityScrollDirectionDown];
    CHECK([events.lastObject[@"action"] isEqual:@"scroll"] && [events.lastObject[@"id"] isEqual:@"42"] && [events.lastObject[@"value"] doubleValue] < 0,
        "VoiceOver scrolling must identify the focused control's viewport without a preceding touch");
    CHECK(![element accessibilityScroll:UIAccessibilityScrollDirectionLeft], "Unsupported accessibility scroll directions must not scroll vertically");
    cross_canon_accessibility_update(tree);
    CHECK(elements[@"42"] == element, "Ordinary redraws must preserve VoiceOver element identity");
    [window.rootViewController.view becomeFirstResponder];
    cross_canon_accessibility_update(tree);
    CHECK(window.rootViewController.view.isFirstResponder,
        "Dialog accessibility updates must preserve an intentional search or notes keyboard responder");
    [window.rootViewController.view resignFirstResponder];
    cross_canon_accessibility_update("{\"modal\":false,\"nodes\":[]}");
    CHECK(!window.rootViewController.view.accessibilityViewIsModal, "Closing a dialog must release the accessibility focus trap");
    update(m);
    CHECK(!reader.hidden && !reader.accessibilityElementsHidden, "Reader is restored after dialogs close");
    benchmarkChapters();
    m = model(); m[@"selected"] = @"John:2:0"; m[@"reference"] = @"John 2:1"; update(m);
    NSDictionary *thirdChapter = reader.paragraphs[32];
    [events removeAllObjects];
    NSRange headingGlyph = [reader.text.layoutManager glyphRangeForCharacterRange:NSMakeRange([thirdChapter[@"heading"] unsignedIntegerValue], 1) actualCharacterRange:NULL];
    CGFloat chapterHeadingY = [reader.text.layoutManager boundingRectForGlyphRange:headingGlyph inTextContainer:reader.text.textContainer].origin.y + reader.text.textContainerInset.top;
    [reader.text setContentOffset:CGPointMake(0, chapterHeadingY - reader.text.bounds.size.height * 0.20) animated:NO];
    [reader reportLocation];
    CHECK([reader.titleButton.currentTitle isEqual:@"John 3"],
        "The header must follow the new chapter heading in the reading area before its first paragraph reaches the top");
    [reader.text setContentOffset:CGPointMake(0, [reader rectForParagraph:thirdChapter].origin.y) animated:NO];
    [reader reportLocation];
    CHECK([reader.titleButton.currentTitle isEqual:@"John 3"],
        "Crossing a chapter must update the header immediately without waiting for a Rust render callback");
    CHECK([[events valueForKey:@"action"] containsObject:@"next"],
        "Entering the last loaded chapter must prefetch before reaching the bottom viewport");
    m[@"chapters"] = NSNull.null; m[@"jump"] = NSNull.null;
    [events removeAllObjects]; update(m);
    CHECK([reader.titleButton.currentTitle isEqual:@"John 3"],
        "A delayed render for the prior chapter must not overwrite the visible chapter title");
    CHECK([[events filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *event, NSDictionary *bindings) {
        return [event[@"action"] isEqual:@"location"] && [event[@"id"] isEqual:thirdChapter[@"id"]];
    }]] count] > 0, "A delayed prior-chapter render must receive the current canonical reading location again");
    m[@"location"] = thirdChapter[@"id"]; m[@"title"] = @"John 3";
    [events removeAllObjects]; update(m);
    CHECK(![[events valueForKey:@"action"] containsObject:@"location"],
        "Acknowledged reader location must stop reconciliation events without a redraw loop");
    m = model(); m[@"selected"] = @"John:2:0"; m[@"reference"] = @"John 2:1"; update(m);
    reader.text.selectedRange = [reader.text.text rangeOfString:@"Café" options:0 range:[reader.paragraphs[16][@"range"] rangeValue]];
    [reader textViewDidChangeSelection:reader.text];
    [events removeAllObjects];
    [reader.text setContentOffset:CGPointMake(0, [reader rectForParagraph:reader.paragraphs[32]].origin.y) animated:NO];
    [reader reportLocation];
    CHECK([reader.titleButton.currentTitle isEqual:@"John 3"], "Native word selection must not delay the visible chapter header");
    CHECK([[events valueForKey:@"action"] containsObject:@"next"], "Native word selection must not block next-chapter prefetch");
    NSMutableArray *loaded = [m[@"chapters"] mutableCopy];
    NSMutableDictionary *fourth = [loaded.lastObject mutableCopy];
    fourth[@"title"] = @"John 4";
    NSMutableArray *fourthParagraphs = [NSMutableArray new];
    for (NSDictionary *p in fourth[@"paragraphs"]) {
        NSMutableDictionary *copy = [p mutableCopy]; copy[@"id"] = [p[@"id"] stringByReplacingOccurrencesOfString:@"John:3:" withString:@"John:4:"];
        [fourthParagraphs addObject:copy];
    }
    fourth[@"paragraphs"] = fourthParagraphs; [loaded addObject:fourth];
    m[@"chapters"] = loaded; m[@"jump"] = NSNull.null; m[@"title"] = @"John 3"; update(m);
    CHECK([[reader.text.text substringWithRange:reader.text.selectedRange] isEqual:@"Café"],
        "Loading the next chapter after word selection must retain the selected words");
    // Classics keeps the preceding chapter in TextKit for smooth backtracking.
    // Reading-content line zero must start on the displayed page, not at the
    // beginning of that cached chapter window.
    m = model(); m[@"book"] = @"classics:reading-probe"; m[@"scripture"] = @NO;
    m[@"collection"] = @"Christian Classics"; m[@"title"] = @"Reading Probe 2";
    NSMutableArray *classics = [NSMutableArray new];
    for (NSUInteger c = 0; c < 3; c++) {
        NSMutableDictionary *chapter = [m[@"chapters"][c] mutableCopy];
        chapter[@"title"] = [NSString stringWithFormat:@"Reading Probe %lu", (unsigned long)c + 1];
        chapter[@"subtitle"] = [NSString stringWithFormat:@"Chapter %lu subtitle", (unsigned long)c + 1];
        NSMutableArray *passages = [NSMutableArray new];
        for (NSDictionary *p in chapter[@"paragraphs"]) {
            NSMutableDictionary *copy = [p mutableCopy];
            copy[@"text"] = [NSString stringWithFormat:@"Chapter %lu speaks here. %@", (unsigned long)c + 1, p[@"text"]];
            [passages addObject:copy];
        }
        chapter[@"paragraphs"] = passages; [classics addObject:chapter];
    }
    m[@"chapters"] = classics; update(m);
    NSString *spokenStart = [reader.text accessibilityContentForLineNumber:0];
    CHECK([spokenStart containsString:@"Chapter 2"] || [spokenStart containsString:@"Reading Probe 2"],
        "Accessibility reading must start at visible Classics chapter 2, not cached chapter 1");
    CHECK([[reader.text accessibilityAttributedContentForLineNumber:0].string isEqual:spokenStart],
        "Attributed and plain speech must start on the same visible line");
    CGRect firstSpeechFrame = [reader.text accessibilityFrameForLineNumber:0];
    CGRect readingFrame = UIAccessibilityConvertFrameToScreenCoordinates(reader.text.bounds, reader.text);
    CHECK(CGRectIntersectsRect(firstSpeechFrame, readingFrame), "The first spoken Classics line must be on screen");
    CGPoint firstSpeechPoint = [reader.text convertPoint:CGPointMake(CGRectGetMidX(firstSpeechFrame), CGRectGetMidY(firstSpeechFrame))
        fromCoordinateSpace:window.screen.coordinateSpace];
    CHECK([reader.text accessibilityLineNumberForPoint:firstSpeechPoint] == 0,
        "Speech point lookup and page-relative line geometry must agree after scrolling");
    reader.text.selectedRange = [reader.paragraphs.firstObject[@"range"] rangeValue];
    [reader textViewDidChangeSelection:reader.text];
    [reader.text setContentOffset:CGPointMake(0, [reader rectForParagraph:reader.paragraphs[32]].origin.y) animated:NO];
    NSString *thirdSpeechStart = [reader.text accessibilityContentForLineNumber:0];
    CHECK([thirdSpeechStart containsString:@"Chapter 3"] || [thirdSpeechStart containsString:@"Reading Probe 3"],
        "Scrolling Classics with older text selected must speak the newly visible chapter");
    CHECK(![[reader.text accessibilityPageContent] containsString:@"Chapter 2"],
        "The current Classics speech page must exclude the offscreen prior chapter");
    NSInteger visibleLines = 0;
    while ([reader.text accessibilityContentForLineNumber:visibleLines]) visibleLines++;
    CHECK(visibleLines > 0 && visibleLines < 100, "Speech line iteration must end at the displayed page boundary");
    fprintf(stderr, "PASS: UIKit selection, Unicode Copy, reader actions, passage jumps, reflow, chapter growth/pruning, largest system text, speech content/geometry, themes, dialog activation and stable accessibility focus.\n");
    exit(0);
}

@interface CCProbeDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic) UIWindow *window;
@end
@implementation CCProbeDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [UIViewController new];
    self.window.rootViewController.view = [CCInputHost new];
    [self.window makeKeyAndVisible];
    dispatch_async(dispatch_get_main_queue(), ^{ runChecks(self.window); });
    return YES;
}
@end
int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(CCProbeDelegate.class)); }
}
