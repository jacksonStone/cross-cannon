// UIKit reading surface. Called exclusively on the main thread. The Metal UI
// continues to own search, library and study; all reader events use passage IDs.
#import <UIKit/UIKit.h>
#import <CoreText/CoreText.h>
extern void cross_canon_reader_event(const char *json);

static void CCEvent(NSString *action, NSString *identifier, NSString *book, double value) {
    NSDictionary *event = @{ @"action": action, @"id": identifier ?: @"",
        @"book": book ?: @"", @"value": @(value) };
    NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    cross_canon_reader_event(json.UTF8String);
}

static id CCValue(NSDictionary *dict, NSString *key) {
    id value = dict[key];
    return value == NSNull.null ? nil : value;
}

static UIColor *CCColor(NSString *hex) {
    unsigned value = 0;
    [[NSScanner scannerWithString:[hex stringByReplacingOccurrencesOfString:@"#" withString:@""]] scanHexInt:&value];
    return [UIColor colorWithRed:((value >> 16) & 255)/255.0 green:((value >> 8) & 255)/255.0 blue:(value & 255)/255.0 alpha:1];
}

static void CCIconPath(CGContextRef context, const CGPoint *points, size_t count, BOOL closed) {
    CGContextBeginPath(context);
    CGContextMoveToPoint(context, points[0].x, points[0].y);
    for (size_t i = 1; i < count; i++) CGContextAddLineToPoint(context, points[i].x, points[i].y);
    if (closed) CGContextClosePath(context);
    CGContextStrokePath(context);
}

// Preserve the original reader's vector artwork (icons.rs and the tools
// control in reader.rs) while UIKit continues to own the accessible buttons.
static UIImage *CCReaderIcon(NSString *action) {
    if (![@[@"highlight", @"note", @"commentary", @"similar", @"clear", @"tools"] containsObject:action]) return nil;
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(24, 24)];
    UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *rendererContext) {
        CGContextRef context = rendererContext.CGContext;
        CGContextTranslateCTM(context, 12, 12);
        CGContextSetLineWidth(context, 1.7);
        CGContextSetLineCap(context, kCGLineCapRound);
        CGContextSetLineJoin(context, kCGLineJoinRound);
        [UIColor.blackColor setStroke]; [UIColor.blackColor setFill];
        if ([action isEqual:@"highlight"]) {
            CCIconPath(context, (CGPoint[]){{-5, 1}, {3, -7}, {8, -2}, {0, 6}}, 4, YES);
            CCIconPath(context, (CGPoint[]){{-4, 4}, {-7, 7}}, 2, NO);
            CCIconPath(context, (CGPoint[]){{-8, 9}, {5, 9}}, 2, NO);
        } else if ([action isEqual:@"note"]) {
            CCIconPath(context, (CGPoint[]){{-6, -7}, {-8, -7}, {-8, 8}, {6, 8}, {6, 4}}, 5, NO);
            CCIconPath(context, (CGPoint[]){{-3, 3}, {-2, -1}, {5, -8}, {8, -5}, {1, 2}}, 5, YES);
        } else if ([action isEqual:@"commentary"]) {
            CCIconPath(context, (CGPoint[]){{-9, -6}, {-4, -7}, {0, -5}, {4, -7}, {9, -6},
                {9, 7}, {4, 6}, {0, 8}, {-4, 6}, {-9, 7}}, 10, YES);
            CCIconPath(context, (CGPoint[]){{0, -5}, {0, 8}}, 2, NO);
        } else if ([action isEqual:@"similar"]) {
            CGContextStrokeEllipseInRect(context, CGRectMake(-7.5, -7.5, 11, 11));
            CCIconPath(context, (CGPoint[]){{2, 2}, {7, 7}}, 2, NO);
        } else if ([action isEqual:@"clear"]) {
            CCIconPath(context, (CGPoint[]){{-5, -5}, {5, 5}}, 2, NO);
            CCIconPath(context, (CGPoint[]){{5, -5}, {-5, 5}}, 2, NO);
        } else if ([action isEqual:@"tools"]) {
            for (NSInteger y = -5; y <= 5; y += 5) CGContextFillEllipseInRect(context, CGRectMake(-1.3, y - 1.3, 2.6, 2.6));
        }
    }];
    return [image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
}

static UIWindow *CCWindow(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if ([scene isKindOfClass:UIWindowScene.class]) {
            for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow) return window;
        }
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    for (UIWindow *window in UIApplication.sharedApplication.windows) if (window.isKeyWindow) return window;
#pragma clang diagnostic pop
    return nil;
}

static CGRect keyboardFrame = {{0, 0}, {0, 0}};
float cross_canon_keyboard_height(void) {
    UIWindow *window = CCWindow();
    if (!window || CGRectIsEmpty(keyboardFrame)) return 0;
    CGRect rect = [window convertRect:keyboardFrame fromWindow:nil];
    if (CGRectGetMaxY(rect) < CGRectGetMaxY(window.bounds) - 1 || rect.size.width < window.bounds.size.width * 0.8) return 0;
    return MAX(0, CGRectGetMaxY(window.bounds) - MAX(0, CGRectGetMinY(rect)));
}

@interface CCReadingText : UITextView <UIAccessibilityReadingContent>
@end

@class CCReaderView;
@interface CCReaderSettings : UITableViewController
@property(nonatomic, weak) CCReaderView *reader;
@end

@interface CCReaderView : UIView <UITextViewDelegate, UIGestureRecognizerDelegate, UIEditMenuInteractionDelegate>
@property(nonatomic) CCReadingText *text;
@property(nonatomic) UIButton *titleButton;
@property(nonatomic) NSLayoutConstraint *titleHeight;
@property(nonatomic) UIButton *toolsButton;
@property(nonatomic) UIView *separator;
@property(nonatomic) UIStackView *footer;
@property(nonatomic) UILabel *reference;
@property(nonatomic) UIStackView *actions;
@property(nonatomic) UILabel *status;
@property(nonatomic) NSLayoutConstraint *readingBottom;
@property(nonatomic) NSLayoutConstraint *passageBottom;
@property(nonatomic) NSDictionary *model;
@property(nonatomic) NSArray<NSDictionary *> *chapters;
@property(nonatomic) NSArray<NSDictionary *> *chapterSpans;
@property(nonatomic) NSAttributedString *renderedText;
@property(nonatomic) NSMutableArray<NSDictionary *> *paragraphs;
@property(nonatomic) NSString *reportedLocation;
@property(nonatomic) NSString *edgeRequest;
@property(nonatomic) NSString *styleKey;
@property(nonatomic) NSString *highlightedPassage;
@property(nonatomic) BOOL updating;
@property(nonatomic) BOOL selectionActive;
@property(nonatomic) NSUInteger selectionGeneration;
@property(nonatomic) id editMenu;
@property(nonatomic) CGFloat laidOutWidth;
@property(nonatomic) CGFloat anchorDistance;
- (void)update:(NSDictionary *)model;
- (void)reflowTo:(NSString *)jump;
- (void)applyPassageHighlight;
- (void)reportLocation;
- (NSDictionary *)visibleParagraph;
- (void)showSettings;
@end

// Explicit reading-content support also serves Speak Screen's line geometry.
// TextKit's UTF-16 ranges are used throughout; Rust's UTF-8 offsets never cross
// this interface (including for non-ASCII source texts and emoji in notes).
@implementation CCReadingText
- (NSRange)cc_visibleGlyphRange {
    CGRect viewport = CGRectMake(0, MAX(0, self.contentOffset.y - self.textContainerInset.top),
        self.bounds.size.width - self.textContainerInset.left - self.textContainerInset.right, self.bounds.size.height);
    return [self.layoutManager glyphRangeForBoundingRect:viewport inTextContainer:self.textContainer];
}
- (NSInteger)accessibilityLineNumberForPoint:(CGPoint)point {
    CGPoint local = point;
    local.x -= self.textContainerInset.left;
    local.y -= self.textContainerInset.top;
    NSUInteger glyph = [self.layoutManager glyphIndexForPoint:local inTextContainer:self.textContainer];
    __block NSInteger line = 0, found = NSNotFound;
    [self.layoutManager enumerateLineFragmentsForGlyphRange:[self cc_visibleGlyphRange]
        usingBlock:^(__unused CGRect rect, __unused CGRect used, __unused NSTextContainer *container, NSRange range, BOOL *stop) {
            if (NSLocationInRange(glyph, range)) { found = line; *stop = YES; }
            line++;
        }];
    return found;
}
- (NSRange)cc_line:(NSInteger)line rect:(CGRect *)outRect {
    __block NSInteger index = 0;
    __block NSRange result = NSMakeRange(NSNotFound, 0);
    __block CGRect frame = CGRectZero;
    if (line < 0) return result;
    // Reading-content line numbers belong to the displayed page. Earlier
    // chapters remain in TextKit for scrolling, but are not the speech page.
    [self.layoutManager enumerateLineFragmentsForGlyphRange:[self cc_visibleGlyphRange]
        usingBlock:^(__unused CGRect rect, CGRect used, __unused NSTextContainer *container, NSRange range, BOOL *stop) {
            if (index++ == line) {
                result = [self.layoutManager characterRangeForGlyphRange:range actualGlyphRange:NULL];
                frame = used; *stop = YES;
            }
        }];
    if (outRect) *outRect = frame;
    return result;
}
- (NSString *)accessibilityContentForLineNumber:(NSInteger)line {
    NSRange range = [self cc_line:line rect:NULL];
    return range.location == NSNotFound ? nil : [self.text substringWithRange:range];
}
- (NSAttributedString *)accessibilityAttributedContentForLineNumber:(NSInteger)line {
    NSRange range = [self cc_line:line rect:NULL];
    return range.location == NSNotFound ? nil : [self.attributedText attributedSubstringFromRange:range];
}
- (CGRect)accessibilityFrameForLineNumber:(NSInteger)line {
    CGRect rect;
    NSRange range = [self cc_line:line rect:&rect];
    if (range.location == NSNotFound) return CGRectZero;
    rect = CGRectOffset(rect, self.textContainerInset.left, self.textContainerInset.top);
    return UIAccessibilityConvertFrameToScreenCoordinates(rect, self);
}
- (NSRange)cc_visibleRange {
    NSRange glyphs = [self cc_visibleGlyphRange];
    return [self.layoutManager characterRangeForGlyphRange:glyphs actualGlyphRange:NULL];
}
- (NSString *)accessibilityPageContent { return [self.text substringWithRange:[self cc_visibleRange]]; }
- (NSAttributedString *)accessibilityAttributedPageContent { return [self.attributedText attributedSubstringFromRange:[self cc_visibleRange]]; }
- (BOOL)accessibilityScroll:(UIAccessibilityScrollDirection)direction {
    BOOL forward = direction == UIAccessibilityScrollDirectionDown || direction == UIAccessibilityScrollDirectionNext;
    BOOL backward = direction == UIAccessibilityScrollDirectionUp || direction == UIAccessibilityScrollDirectionPrevious;
    if (!forward && !backward)
        return [super accessibilityScroll:direction];
    BOOL automatic = direction == UIAccessibilityScrollDirectionNext || direction == UIAccessibilityScrollDirectionPrevious;
    CGFloat y = self.contentOffset.y + self.bounds.size.height * (automatic ? 1 : 0.85) * (forward ? 1 : -1);
    if (direction == UIAccessibilityScrollDirectionNext) {
        // VoiceOver's read-all gesture requests Next when the visible page
        // ends. Start with the next unread line instead of repeating the last
        // partially visible line or skipping its remaining words.
        NSUInteger next = NSMaxRange([self cc_visibleRange]);
        if (next >= self.text.length) return NO;
        NSUInteger glyph = [self.layoutManager glyphIndexForCharacterAtIndex:next];
        y = [self.layoutManager lineFragmentRectForGlyphAtIndex:glyph effectiveRange:NULL].origin.y + self.textContainerInset.top;
    }
    y = MAX(0, MIN(MAX(0, self.contentSize.height - self.bounds.size.height), y));
    if (fabs(y - self.contentOffset.y) < 1) return NO;
    [self setContentOffset:CGPointMake(0, y) animated:!automatic && !UIAccessibilityIsReduceMotionEnabled()];
    UIAccessibilityPostNotification(UIAccessibilityPageScrolledNotification, nil);
    return YES;
}
@end

@implementation CCReaderSettings
- (instancetype)init {
    if (!(self = [super initWithStyle:UITableViewStyleInsetGrouped])) return nil;
    self.title = @"Reader settings";
    self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemDone
        target:self action:@selector(done)];
    return self;
}
- (void)done { [self dismissViewControllerAnimated:!UIAccessibilityIsReduceMotionEnabled() completion:nil]; }
- (NSInteger)numberOfSectionsInTableView:(UITableView *)tableView { return 5; }
- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    return section == 0 ? 7 : section == 1 ? 2 : section == 2 ? 4 : section == 3 ? 3 : 2;
}
- (NSString *)tableView:(UITableView *)tableView titleForHeaderInSection:(NSInteger)section {
    return @[@"Text", @"Bible translation", @"Theme", @"Scripture canon", @"Account and connection"][section];
}
- (NSString *)tableView:(UITableView *)tableView titleForFooterInSection:(NSInteger)section {
    if (section == 0) return @"Text follows your iPhone’s Larger Text and Bold Text settings. These adjustments apply on top of your system size.";
    if (section == 1) return @"Audio follows your translation. MSB recordings stream online. Offline audio downloads use WEB. Search uses the World English Bible index.";
    if (section == 4) return CCValue(self.reader.model, @"info");
    return nil;
}
- (void)adjust:(UIStepper *)stepper {
    NSString *key = @[@"font", @"spacing", @"width"][stepper.tag];
    NSMutableDictionary *model = [self.reader.model mutableCopy];
    model[@[@"fontScale", @"lineHeight", @"width"][stepper.tag]] = @(stepper.value);
    self.reader.model = model;
    [self.reader reflowTo:nil];
    CCEvent(@"preference", key, nil, stepper.value);
    [self.tableView reloadData];
}
- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)path {
    UITableViewCell *cell = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:nil];
    cell.textLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleBody];
    cell.textLabel.adjustsFontForContentSizeCategory = YES;
    cell.textLabel.numberOfLines = 0;
    cell.detailTextLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    cell.detailTextLabel.adjustsFontForContentSizeCategory = YES;
    cell.detailTextLabel.numberOfLines = 0;
    NSDictionary *model = self.reader.model;
    if (path.section == 0 && path.row < 3) {
        BOOL size = path.row == 0;
        BOOL width = path.row == 2;
        UIStepper *stepper = [UIStepper new];
        stepper.tag = path.row;
        stepper.minimumValue = width ? 620 : size ? 0.86 : 1.42;
        stepper.maximumValue = width ? 880 : size ? 1.35 : 2.08;
        stepper.stepValue = width ? 20 : size ? 0.05 : 0.1;
        stepper.value = [model[width ? @"width" : size ? @"fontScale" : @"lineHeight"] doubleValue];
        stepper.accessibilityLabel = width ? @"Reading column width" : size ? @"Reading text size" : @"Line spacing";
        [stepper sizeToFit];
        [stepper addTarget:self action:@selector(adjust:) forControlEvents:UIControlEventValueChanged];
        cell.textLabel.text = width ? @"Column width" : size ? @"Text size" : @"Line spacing";
        cell.detailTextLabel.text = width ? [NSString stringWithFormat:@"%.0f points maximum", stepper.value] : size ? [NSString stringWithFormat:@"%.0f%% of system size", stepper.value * 100] :
            [NSString stringWithFormat:@"%.2f", stepper.value];
        cell.accessoryView = stepper;
        cell.selectionStyle = UITableViewCellSelectionStyleNone;
    } else if (path.section == 0) {
        NSInteger preset = path.row - 3;
        cell.textLabel.text = @[@"Default", @"Compact", @"Open", @"Relaxed"][preset];
        NSArray *values = @[@[@1.0, @1.72, @820], @[@0.94, @1.54, @880], @[@1.07, @1.86, @760], @[@1.14, @1.96, @700]][preset];
        if (fabs([model[@"fontScale"] doubleValue] - [values[0] doubleValue]) < 0.001 &&
            fabs([model[@"lineHeight"] doubleValue] - [values[1] doubleValue]) < 0.001 &&
            fabs([model[@"width"] doubleValue] - [values[2] doubleValue]) < 0.1) cell.accessoryType = UITableViewCellAccessoryCheckmark;
    } else if (path.section == 1) {
        cell.textLabel.text = @[@"World English Bible", @"Majority Standard Bible"][path.row];
        cell.accessoryType = [model[@"translation"] integerValue] == path.row ? UITableViewCellAccessoryCheckmark : UITableViewCellAccessoryNone;
    } else if (path.section == 2) {
        cell.textLabel.text = @[@"Paper", @"Sepia", @"Dark", @"High contrast"][path.row];
        cell.accessoryType = [model[@"theme"] integerValue] == path.row ? UITableViewCellAccessoryCheckmark : UITableViewCellAccessoryNone;
    } else if (path.section == 3) {
        cell.textLabel.text = @[@"Protestant", @"Catholic", @"Orthodox"][path.row];
        cell.accessoryType = [model[@"canon"] integerValue] == path.row ? UITableViewCellAccessoryCheckmark : UITableViewCellAccessoryNone;
    } else {
        cell.textLabel.text = path.row == 0 ? @"Account and reading progress" : @"Search connection";
        cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    }
    if (path.section != 0 || path.row >= 3) {
        cell.isAccessibilityElement = YES;
        cell.accessibilityLabel = cell.textLabel.text;
        cell.accessibilityTraits = UIAccessibilityTraitButton;
        if (cell.accessoryType == UITableViewCellAccessoryCheckmark) cell.accessibilityTraits |= UIAccessibilityTraitSelected;
    }
    return cell;
}
- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)path {
    [tableView deselectRowAtIndexPath:path animated:NO];
    if (path.section == 0) {
        if (path.row < 3) return;
        NSArray *values = @[@[@1.0, @1.72, @820], @[@0.94, @1.54, @880], @[@1.07, @1.86, @760], @[@1.14, @1.96, @700]][path.row - 3];
        NSMutableDictionary *model = [self.reader.model mutableCopy];
        for (NSUInteger i = 0; i < 3; i++) {
            model[@[@"fontScale", @"lineHeight", @"width"][i]] = values[i];
            CCEvent(@"preference", @[@"font", @"spacing", @"width"][i], nil, [values[i] doubleValue]);
        }
        self.reader.model = model;
        [self.reader reflowTo:nil];
        [self.tableView reloadData];
        return;
    }
    if (path.section == 4 && path.row == 0) {
        [self dismissViewControllerAnimated:!UIAccessibilityIsReduceMotionEnabled() completion:^{ CCEvent(@"account", nil, nil, 0); }];
        return;
    }
    if (path.section == 4) {
        UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Search connection" message:@"Search service address" preferredStyle:UIAlertControllerStyleAlert];
        [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
            field.text = CCValue(self.reader.model, @"apiURL");
            field.keyboardType = UIKeyboardTypeURL; field.autocapitalizationType = UITextAutocapitalizationTypeNone;
            field.autocorrectionType = UITextAutocorrectionTypeNo; field.accessibilityLabel = @"Search service address";
        }];
        [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
        [alert addAction:[UIAlertAction actionWithTitle:@"Save" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
            NSString *address = [alert.textFields.firstObject.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            if (address.length) CCEvent(@"connection", address, nil, 0);
        }]];
        [self presentViewController:alert animated:!UIAccessibilityIsReduceMotionEnabled() completion:nil];
        return;
    }
    NSString *key = path.section == 1 ? @"translation" : path.section == 2 ? @"theme" : @"canon";
    CCEvent(@"preference", key, nil, path.row);
    NSMutableDictionary *model = [self.reader.model mutableCopy];
    model[key] = @(path.row);
    self.reader.model = model;
    if (path.section == 2) {
        UIUserInterfaceStyle style = path.row == 2 ? UIUserInterfaceStyleDark : UIUserInterfaceStyleLight;
        self.overrideUserInterfaceStyle = style;
        self.navigationController.overrideUserInterfaceStyle = style;
    }
    [self.tableView reloadData];
}
@end

@implementation CCReaderView
- (UIButton *)button:(NSString *)symbol label:(NSString *)label action:(NSString *)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    [button setImage:CCReaderIcon(action) ?: [UIImage systemImageNamed:symbol] forState:UIControlStateNormal];
    button.accessibilityLabel = label;
    button.accessibilityIdentifier = [@"reader-" stringByAppendingString:action];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    if ([action isEqual:@"tools"] || [action isEqual:@"library"]) {
        button.layer.cornerRadius = [action isEqual:@"tools"] ? 8 : 13;
        button.layer.borderWidth = 1;
    }
    [button.widthAnchor constraintGreaterThanOrEqualToConstant:44].active = YES;
    [button.heightAnchor constraintGreaterThanOrEqualToConstant:44].active = YES;
    __weak CCReaderView *weak = self;
    if (![action isEqual:@"tools"]) {
        [button addAction:[UIAction actionWithHandler:^(__unused UIAction *a) {
            CCReaderView *self = weak;
            if ([action isEqual:@"commentary"] && ![self.model[@"scripture"] boolValue]) return;
            CCEvent(action, nil, self.model[@"book"], 0);
        }] forControlEvents:UIControlEventTouchUpInside];
    }
    button.showsLargeContentViewer = YES;
    [button addInteraction:[UILargeContentViewerInteraction new]];
    return button;
}
- (instancetype)initWithFrame:(CGRect)frame {
    if (!(self = [super initWithFrame:frame])) return nil;
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.accessibilityIdentifier = @"native-reader";
    self.titleButton = [UIButton buttonWithType:UIButtonTypeSystem];
    self.titleButton.titleLabel.font = [self font:18 heading:YES];
    self.titleButton.titleLabel.numberOfLines = 2;
    self.titleButton.titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
    self.titleButton.contentHorizontalAlignment = UIControlContentHorizontalAlignmentLeading;
    self.titleButton.accessibilityHint = @"Open Library to choose a collection, book, chapter or last place";
    self.titleButton.accessibilityIdentifier = @"reader-jump";
    __weak CCReaderView *weak = self;
    [self.titleButton addAction:[UIAction actionWithHandler:^(__unused UIAction *a) { CCEvent(@"library", nil, nil, 0); }]
        forControlEvents:UIControlEventTouchUpInside];
    self.toolsButton = [self button:@"ellipsis.circle" label:@"Reader tools" action:@"tools"];
    self.toolsButton.showsMenuAsPrimaryAction = YES;
    UIButton *searchButton = [self button:@"magnifyingglass" label:@"Search" action:@"search"];
    searchButton.accessibilityIdentifier = @"reader-search";
    UIStackView *header = [[UIStackView alloc] initWithArrangedSubviews:@[self.titleButton, searchButton, self.toolsButton]];
    header.alignment = UIStackViewAlignmentCenter;
    header.spacing = 4;
    header.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:header];
    self.separator = [UIView new];
    self.separator.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:self.separator];
    self.titleHeight = [self.titleButton.heightAnchor constraintEqualToConstant:44];
    self.titleHeight.active = YES;
    [self.titleButton.topAnchor constraintEqualToAnchor:header.topAnchor].active = YES;
    [self.titleButton.bottomAnchor constraintEqualToAnchor:header.bottomAnchor].active = YES;
    [searchButton.widthAnchor constraintEqualToConstant:44].active = YES;
    [self.toolsButton.widthAnchor constraintEqualToConstant:44].active = YES;

    self.text = [[CCReadingText alloc] initWithFrame:CGRectZero textContainer:nil];
    self.text.editable = NO;
    self.text.selectable = YES;
    self.text.delegate = self;
    self.text.alwaysBounceVertical = YES;
    self.text.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    self.text.textContainer.lineFragmentPadding = 0;
    self.text.textContainerInset = UIEdgeInsetsMake(8, 22, 16, 22);
    self.text.accessibilityIdentifier = @"reader-text";
    self.text.accessibilityTraits |= UIAccessibilityTraitCausesPageTurn;
    self.text.accessibilityHint = @"Select text for Copy, Look Up, Translate, or Speak. Use Actions for passage notes and highlights.";
    self.text.adjustsFontForContentSizeCategory = NO; // UIFontMetrics below scales custom typography exactly once.
    self.text.smartQuotesType = UITextSmartQuotesTypeNo;
    self.text.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:self.text];
    if (@available(iOS 16.0, *)) {
        self.editMenu = [[UIEditMenuInteraction alloc] initWithDelegate:self];
        [self.text addInteraction:self.editMenu];
    }
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(tapPassage:)];
    tap.cancelsTouchesInView = NO;
    tap.delegate = self;
    [self.text addGestureRecognizer:tap];

    self.reference = [UILabel new];
    self.reference.font = [UIFont preferredFontForTextStyle:UIFontTextStyleCaption1];
    self.reference.adjustsFontForContentSizeCategory = YES;
    self.reference.numberOfLines = 2;
    self.reference.accessibilityTraits = UIAccessibilityTraitHeader;
    self.actions = [[UIStackView alloc] initWithArrangedSubviews:@[
        [self button:@"highlighter" label:@"Highlight passage" action:@"highlight"],
        [self button:@"square.and.pencil" label:@"Passage notes" action:@"note"],
        [self button:@"text.book.closed" label:@"View commentaries" action:@"commentary"],
        [self button:@"magnifyingglass" label:@"Similar passages" action:@"similar"],
        [self button:@"xmark" label:@"Close passage actions" action:@"clear"]]];
    self.actions.distribution = UIStackViewDistributionEqualSpacing;
    UIView *controlRow = [UIView new];
    [controlRow.heightAnchor constraintEqualToConstant:44].active = YES;
    self.actions.translatesAutoresizingMaskIntoConstraints = NO;
    [controlRow addSubview:self.actions];
    self.footer = [[UIStackView alloc] initWithArrangedSubviews:@[self.reference, controlRow]];
    self.footer.axis = UILayoutConstraintAxisVertical;
    self.footer.spacing = 4;
    self.footer.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:self.footer];
    self.status = [UILabel new];
    self.status.font = [UIFont preferredFontForTextStyle:UIFontTextStyleCaption1];
    self.status.adjustsFontForContentSizeCategory = YES;
    self.status.numberOfLines = 2;
    self.status.lineBreakMode = NSLineBreakByTruncatingTail;
    self.status.translatesAutoresizingMaskIntoConstraints = NO;
    [controlRow addSubview:self.status];
    UILayoutGuide *safe = self.safeAreaLayoutGuide;
    self.readingBottom = [self.text.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor];
    self.passageBottom = [self.text.bottomAnchor constraintEqualToAnchor:self.footer.topAnchor constant:-4];
    self.readingBottom.active = YES;
    [NSLayoutConstraint activateConstraints:@[
        [header.topAnchor constraintEqualToAnchor:safe.topAnchor constant:2],
        [header.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [header.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
        [self.separator.topAnchor constraintEqualToAnchor:header.bottomAnchor constant:4],
        [self.separator.leadingAnchor constraintEqualToAnchor:header.leadingAnchor],
        [self.separator.trailingAnchor constraintEqualToAnchor:header.trailingAnchor],
        [self.separator.heightAnchor constraintEqualToConstant:1.0 / MAX(1, self.traitCollection.displayScale)],
        [self.text.topAnchor constraintEqualToAnchor:self.separator.bottomAnchor constant:4],
        [self.text.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor],
        [self.text.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor],
        [self.footer.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [self.footer.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
        [self.footer.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-2],
        [self.actions.leadingAnchor constraintEqualToAnchor:controlRow.leadingAnchor],
        [self.actions.trailingAnchor constraintEqualToAnchor:controlRow.trailingAnchor],
        [self.actions.centerYAnchor constraintEqualToAnchor:controlRow.centerYAnchor],
        [self.actions.heightAnchor constraintEqualToConstant:44],
        [self.status.leadingAnchor constraintEqualToAnchor:controlRow.leadingAnchor],
        [self.status.trailingAnchor constraintEqualToAnchor:controlRow.trailingAnchor],
        [self.status.centerYAnchor constraintEqualToAnchor:controlRow.centerYAnchor],
    ]];
    NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
    for (NSString *name in @[UIContentSizeCategoryDidChangeNotification, UIAccessibilityBoldTextStatusDidChangeNotification,
        UIAccessibilityDarkerSystemColorsStatusDidChangeNotification]) {
        [nc addObserver:self selector:@selector(preferencesChanged:) name:name object:nil];
    }
    [nc addObserver:self selector:@selector(flushLocation:) name:UIApplicationWillResignActiveNotification object:nil];
    [nc addObserver:self selector:@selector(keyboardChanged:) name:UIKeyboardWillChangeFrameNotification object:nil];
    [nc addObserver:self selector:@selector(keyboardChanged:) name:UIKeyboardWillHideNotification object:nil];
    // VoiceOver actions work even without tapping the reading text first.
    NSMutableArray *customActions = [NSMutableArray new];
    for (NSArray *item in @[@[@"Highlight passage", @"highlight"], @[@"Passage notes", @"note"],
        @[@"Similar passages", @"similar"]]) {
        [customActions addObject:[[UIAccessibilityCustomAction alloc] initWithName:item[0] actionHandler:^BOOL(__unused UIAccessibilityCustomAction *action) {
            CCReaderView *self = weak;
            [self selectVisiblePassage];
            CCEvent(item[1], nil, self.model[@"book"], 0);
            return YES;
        }]];
    }
    self.text.accessibilityCustomActions = customActions;
    return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)showSettings {
    CCReaderSettings *settings = [CCReaderSettings new];
    settings.reader = self;
    settings.overrideUserInterfaceStyle = [self.model[@"theme"] integerValue] == 2 ? UIUserInterfaceStyleDark : UIUserInterfaceStyleLight;
    UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:settings];
    navigation.view.tintColor = self.tintColor;
    navigation.modalPresentationStyle = UIModalPresentationPageSheet;
    navigation.sheetPresentationController.detents = @[UISheetPresentationControllerDetent.largeDetent];
    navigation.sheetPresentationController.prefersGrabberVisible = YES;
    UIViewController *host = CCWindow().rootViewController;
    while (host.presentedViewController) host = host.presentedViewController;
    [host presentViewController:navigation animated:!UIAccessibilityIsReduceMotionEnabled() completion:nil];
}
- (NSDictionary *)paragraphAtOffset:(NSUInteger)offset {
    for (NSDictionary *p in self.paragraphs) {
        NSRange range = [p[@"range"] rangeValue];
        if (offset < NSMaxRange(range)) return p;
    }
    return self.paragraphs.lastObject;
}
- (NSUInteger)visibleCharacter {
    CGPoint point = CGPointMake(2, MAX(0, self.text.contentOffset.y + 2 - self.text.textContainerInset.top));
    NSUInteger glyph = [self.text.layoutManager glyphIndexForPoint:point inTextContainer:self.text.textContainer];
    return [self.text.layoutManager characterIndexForGlyphAtIndex:MIN(glyph, self.text.layoutManager.numberOfGlyphs)];
}
- (CGRect)rectForParagraph:(NSDictionary *)p {
    NSRange range = [p[@"range"] rangeValue];
    if (range.length == 0 || range.location >= self.text.text.length) return CGRectZero;
    NSRange glyph = [self.text.layoutManager glyphRangeForCharacterRange:NSMakeRange(range.location, 1) actualCharacterRange:NULL];
    CGRect rect = [self.text.layoutManager boundingRectForGlyphRange:glyph inTextContainer:self.text.textContainer];
    return CGRectOffset(rect, self.text.textContainerInset.left, self.text.textContainerInset.top);
}
- (void)selectVisiblePassage {
    NSDictionary *p = self.text.selectedRange.length ? [self paragraphAtOffset:self.text.selectedRange.location] : [self visibleParagraph];
    if (p) CCEvent(@"select", p[@"id"], self.model[@"book"], 0);
}
- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gesture {
    return self.text.selectedRange.length == 0 && !self.text.isDragging && !self.text.isDecelerating;
}
- (BOOL)gestureRecognizer:(UIGestureRecognizer *)a shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)b { return YES; }
- (void)tapPassage:(UITapGestureRecognizer *)gesture {
    if (gesture.state != UIGestureRecognizerStateEnded || self.text.selectedRange.length) return;
    CGPoint point = [gesture locationInView:self.text];
    point.x -= self.text.textContainerInset.left;
    point.y -= self.text.textContainerInset.top;
    NSUInteger glyph = [self.text.layoutManager glyphIndexForPoint:point inTextContainer:self.text.textContainer];
    if (glyph >= self.text.layoutManager.numberOfGlyphs) return;
    NSUInteger character = [self.text.layoutManager characterIndexForGlyphAtIndex:glyph];
    // UIKit handles link activation (including VoiceOver) through its delegate.
    if ([self.text.attributedText attribute:NSLinkAttributeName atIndex:character effectiveRange:NULL]) return;
    NSDictionary *p = [self paragraphAtOffset:character];
    if (p) CCEvent([CCValue(self.model, @"selected") isEqual:p[@"id"]] ? @"clear" : @"select", p[@"id"], self.model[@"book"], 0);
}
- (BOOL)textView:(UITextView *)textView shouldInteractWithURL:(NSURL *)URL
    inRange:(NSRange)range interaction:(UITextItemInteraction)interaction {
    if (interaction != UITextItemInteractionInvokeDefaultAction) return NO;
    NSString *target = [textView.attributedText attribute:@"CCScriptureTarget" atIndex:range.location effectiveRange:NULL];
    NSDictionary *p = [self paragraphAtOffset:range.location];
    if (target && p) CCEvent(@"scripture", p[@"id"], target, 0);
    return NO;
}
- (void)textViewDidChangeSelection:(UITextView *)textView {
    if (self.updating) return;
    self.selectionActive = textView.selectedRange.length > 0;
    if (self.selectionActive) {
        NSDictionary *p = [self paragraphAtOffset:textView.selectedRange.location];
        if (p) CCEvent(@"select", p[@"id"], self.model[@"book"], 0);
        // Showing the passage action row resizes the text view. UIKit dismisses
        // an edit menu during that layout; present its own standard menu once
        // the selection and viewport have settled, retaining all system actions.
        NSUInteger generation = ++self.selectionGeneration;
        __weak CCReaderView *weak = self;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            CCReaderView *self = weak;
            if (!self || generation != self.selectionGeneration || !self.selectionActive || self.hidden || self.text.isDragging) return;
            [self.text becomeFirstResponder];
            CGRect rect = [self.text firstRectForRange:self.text.selectedTextRange];
            if (@available(iOS 16.0, *)) {
                UIEditMenuConfiguration *configuration = [UIEditMenuConfiguration configurationWithIdentifier:nil
                    sourcePoint:CGPointMake(CGRectGetMidX(rect), CGRectGetMinY(rect))];
                [self.editMenu presentEditMenuWithConfiguration:configuration];
            } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                // Required only for the app's supported iOS 15 deployment target.
                [UIMenuController.sharedMenuController showMenuFromView:self.text rect:rect];
#pragma clang diagnostic pop
            }
        });
    }
}
- (UIMenu *)editMenuInteraction:(UIEditMenuInteraction *)interaction menuForConfiguration:(UIEditMenuConfiguration *)configuration
    suggestedActions:(NSArray<UIMenuElement *> *)actions API_AVAILABLE(ios(16.0)) {
    return [UIMenu menuWithChildren:actions];
}
- (void)keyboardChanged:(NSNotification *)notification {
    keyboardFrame = [notification.name isEqual:UIKeyboardWillHideNotification] ? CGRectZero :
        [notification.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    CCEvent(@"keyboard", nil, nil, 0);
}
- (void)preferencesChanged:(NSNotification *)notification {
    self.styleKey = nil;
    self.titleButton.titleLabel.font = [self font:18 heading:YES];
    [self reflowTo:nil];
    [self setNeedsLayout];
}
- (void)flushLocation:(NSNotification *)notification { [self reportLocation]; }
- (void)prepareLayout {
    UIEdgeInsets insets = self.window.safeAreaInsets;
    // UIButton's intrinsic size is one line even for a multiline title label.
    // Measure its actual available width so long work names cannot paint over
    // the status area or chapter content above and below the header.
    CGFloat titleWidth = self.bounds.size.width - insets.left - insets.right - 16 - 16 - 44 - 4;
    if (titleWidth > 0) {
        UIFont *font = self.titleButton.titleLabel.font;
        CGRect rect = [self.titleButton.currentTitle boundingRectWithSize:CGSizeMake(titleWidth, CGFLOAT_MAX)
            options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading
            attributes:@{NSFontAttributeName:font} context:nil];
        CGFloat height = MAX(44, ceil(MIN(rect.size.height, font.lineHeight * 2)) + 4);
        if (fabs(self.titleHeight.constant - height) > 0.5) self.titleHeight.constant = height;
    }
}
- (void)layoutSubviews {
    BOOL updating = self.updating;
    self.updating = YES;
    [self prepareLayout];
    [super layoutSubviews];
    CGFloat width = self.text.bounds.size.width;
    BOOL reflow = width > 0 && fabs(width - self.laidOutWidth) > 0.5 && self.chapters.count;
    if (reflow) {
        self.laidOutWidth = width;
        [self reflowTo:nil];
    }
    self.updating = updating;
    if (reflow && !updating) [self reportLocation];
}
- (UIFont *)font:(CGFloat)size heading:(BOOL)heading {
    NSString *name = UIAccessibilityIsBoldTextEnabled() ? @"SourceSerif4-Bold" : @"SourceSerif4-Semibold";
    UIFont *base = [UIFont fontWithName:name size:size] ?: [UIFont systemFontOfSize:size weight:heading ? UIFontWeightSemibold : UIFontWeightRegular];
    return [[UIFontMetrics metricsForTextStyle:heading ? UIFontTextStyleHeadline : UIFontTextStyleBody]
        scaledFontForFont:base maximumPointSize:heading ? 36 : CGFLOAT_MAX compatibleWithTraitCollection:self.traitCollection];
}
- (void)reflowTo:(NSString *)jump {
    if (!self.chapters || self.text.bounds.size.width <= 0) return;
    self.text.linkTextAttributes = @{NSForegroundColorAttributeName:CCColor(self.model[@"accent"]),
        NSUnderlineStyleAttributeName:@(NSUnderlineStyleSingle)};
    NSDictionary *anchor = nil;
    for (NSDictionary *p in self.paragraphs) if ([p[@"id"] isEqual:self.reportedLocation]) { anchor = p; break; }
    if (!anchor && self.paragraphs.count) anchor = [self paragraphAtOffset:[self visibleCharacter]];
    CGFloat distance = anchor && self.reportedLocation ? self.anchorDistance : 0;
    NSRange selection = self.text.selectedRange;
    NSString *selectedText = selection.length && NSMaxRange(selection) <= self.text.text.length ? [self.text.text substringWithRange:selection] : nil;
    NSDictionary *selectedParagraph = selectedText ? [self paragraphAtOffset:selection.location] : nil;
    NSUInteger selectionInParagraph = selectedParagraph ? selection.location - [selectedParagraph[@"range"] rangeValue].location : 0;
    self.updating = YES;
    [self applyPassageHighlight];
    CGFloat width = [self.model[@"width"] doubleValue];
    CGFloat inset = MAX([self.model[@"scripture"] boolValue] ? 32 : 22,
        (self.text.bounds.size.width - (width > 0 ? width - 20 : 800)) / 2);
    self.text.textContainerInset = UIEdgeInsetsMake(8, inset, 16, inset);
    CGFloat scale = [self.model[@"fontScale"] doubleValue];
    UIFont *body = [self font:19.84 * scale heading:NO];
    NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
    // egui's reader uses an absolute line height, not a multiple of this font's
    // unusually tall intrinsic leading. Keep the existing rhythm after UIKit's
    // UIFontMetrics has applied the system accessibility size.
    style.minimumLineHeight = body.pointSize * [self.model[@"lineHeight"] doubleValue];
    style.maximumLineHeight = style.minimumLineHeight;
    style.paragraphSpacing = body.pointSize * 0.55;
    style.hyphenationFactor = 0;
    UIColor *ink = CCColor(self.model[@"ink"]);
    UIColor *muted = CCColor(self.model[@"muted"]);
    NSDictionary *bodyAttributes = @{NSFontAttributeName:body, NSForegroundColorAttributeName:ink, NSParagraphStyleAttributeName:style};
    NSMutableAttributedString *text = [NSMutableAttributedString new];
    NSMutableArray *paragraphs = [NSMutableArray new];
    NSMutableArray *spans = [NSMutableArray new];
    for (NSDictionary *chapter in self.chapters) {
        NSUInteger chapterStart = text.length;
        NSString *chapterKey = [chapter[@"paragraphs"] firstObject][@"id"] ?: chapter[@"title"];
        NSDictionary *opening = CCValue(chapter, @"opening");
        if (opening) {
            NSMutableParagraphStyle *opener = [NSMutableParagraphStyle new];
            opener.paragraphSpacingBefore = 24; opener.paragraphSpacing = 18;
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:@"B O O K\n"
                attributes:@{NSFontAttributeName:[UIFont preferredFontForTextStyle:UIFontTextStyleCaption1],
                    NSForegroundColorAttributeName:CCColor(self.model[@"accent"]), NSParagraphStyleAttributeName:opener}]];
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:[opening[@"title"] stringByAppendingString:@"\n"]
                attributes:@{NSFontAttributeName:[self font:MIN(50, self.text.bounds.size.width * 0.15) heading:YES],
                    NSForegroundColorAttributeName:ink, NSParagraphStyleAttributeName:opener, UIAccessibilityTextAttributeHeadingLevel:@1}]];
            NSString *details = [NSString stringWithFormat:@"%@\n%@ · %@ chapters\n", opening[@"author"], opening[@"collection"], opening[@"chapters"]];
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:details attributes:@{
                NSFontAttributeName:[UIFont preferredFontForTextStyle:UIFontTextStyleSubheadline],
                NSForegroundColorAttributeName:muted, NSParagraphStyleAttributeName:opener}]];
        }
        NSUInteger headingStart = text.length;
        NSMutableParagraphStyle *headingStyle = [style mutableCopy];
        headingStyle.paragraphSpacingBefore = body.pointSize;
        headingStyle.paragraphSpacing = body.pointSize * 0.45;
        headingStyle.minimumLineHeight = 0;
        headingStyle.maximumLineHeight = 0;
        [text appendAttributedString:[[NSAttributedString alloc] initWithString:[chapter[@"title"] stringByAppendingString:@"\n"]
            attributes:@{NSFontAttributeName:[self font:17 * scale heading:YES], NSForegroundColorAttributeName:muted,
                NSParagraphStyleAttributeName:headingStyle, UIAccessibilityTextAttributeHeadingLevel:@2}]];
        if ([chapter[@"subtitle"] length]) {
            NSMutableParagraphStyle *captionStyle = [headingStyle mutableCopy];
            captionStyle.paragraphSpacingBefore = 0;
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:[chapter[@"subtitle"] stringByAppendingString:@"\n"]
                attributes:@{NSFontAttributeName:[[UIFontMetrics metricsForTextStyle:UIFontTextStyleCaption1]
                    scaledFontForFont:[UIFont systemFontOfSize:12]], NSForegroundColorAttributeName:muted,
                    NSParagraphStyleAttributeName:captionStyle}]];
        }
        if ([chapter[@"edition"] length]) {
            NSMutableParagraphStyle *captionStyle = [headingStyle mutableCopy];
            captionStyle.paragraphSpacingBefore = 0;
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:[chapter[@"edition"] stringByAppendingString:@"\n"]
                attributes:@{NSFontAttributeName:[UIFont preferredFontForTextStyle:UIFontTextStyleCaption1],
                    NSForegroundColorAttributeName:muted, NSParagraphStyleAttributeName:captionStyle}]];
        }
        for (NSDictionary *source in chapter[@"paragraphs"]) {
            NSMutableDictionary *p = [source mutableCopy];
            p[@"chapterTitle"] = chapter[@"title"];
            p[@"chapterKey"] = chapterKey;
            NSString *value = [source[@"text"] stringByAppendingString:@"\n"];
            NSArray *quotations = source[@"quotations"];
            NSString *quoteLabel = quotations.count ? @"Scripture quotation\n" : @"";
            value = [quoteLabel stringByAppendingString:value];
            NSRange range = NSMakeRange(text.length, value.length);
            p[@"range"] = [NSValue valueWithRange:range];
            if (source == [chapter[@"paragraphs"] firstObject]) p[@"heading"] = @(headingStart);
            [paragraphs addObject:p];
            [text appendAttributedString:[[NSAttributedString alloc] initWithString:value attributes:bodyAttributes]];
            if (quoteLabel.length) {
                [text addAttributes:@{NSFontAttributeName:[UIFont preferredFontForTextStyle:UIFontTextStyleCaption1],
                    NSForegroundColorAttributeName:muted} range:NSMakeRange(range.location, quoteLabel.length)];
            }
            for (NSArray *quote in quotations) {
                NSRange quoted = NSMakeRange(range.location + quoteLabel.length + [quote[0] unsignedIntegerValue], [quote[1] unsignedIntegerValue]);
                if (NSMaxRange(quoted) <= NSMaxRange(range)) {
                    [text addAttribute:NSObliquenessAttributeName value:@0.18 range:quoted];
                }
            }
            NSString *highlight = CCValue(source, @"highlight");
            if (highlight) {
                UIColor *tint = [highlight isEqual:@"green"] ? UIColor.systemGreenColor :
                    [highlight isEqual:@"blue"] ? UIColor.systemBlueColor : UIColor.systemYellowColor;
                [text addAttribute:NSBackgroundColorAttributeName value:[tint colorWithAlphaComponent:0.22] range:range];
            }
            for (NSArray *mark in source[@"modernization"]) {
                NSRange changed = NSMakeRange(range.location + quoteLabel.length + [mark[0] unsignedIntegerValue], [mark[1] unsignedIntegerValue]);
                if (NSMaxRange(changed) <= NSMaxRange(range)) {
                    [text addAttributes:@{NSUnderlineStyleAttributeName:@(NSUnderlineStyleSingle | NSUnderlinePatternDot),
                        NSUnderlineColorAttributeName:[CCColor(self.model[@"accent"]) colorWithAlphaComponent:0.45]} range:changed];
                }
            }
            for (NSDictionary *link in source[@"scripture_links"]) {
                NSMutableParagraphStyle *linkStyle = [style mutableCopy];
                linkStyle.minimumLineHeight = 32;
                linkStyle.maximumLineHeight = 0;
                [text appendAttributedString:[[NSAttributedString alloc] initWithString:[link[@"reference"] stringByAppendingString:@"\n"]
                    attributes:@{NSFontAttributeName:[UIFont preferredFontForTextStyle:UIFontTextStyleCaption1],
                        NSForegroundColorAttributeName:CCColor(self.model[@"accent"]), NSParagraphStyleAttributeName:linkStyle,
                        NSLinkAttributeName:link[@"link"], @"CCScriptureTarget":link[@"id"]}]];
            }
            p[@"range"] = [NSValue valueWithRange:NSMakeRange(range.location, text.length - range.location)];
        }
        [spans addObject:@{@"id":chapterKey,
            @"range":[NSValue valueWithRange:NSMakeRange(chapterStart, text.length - chapterStart)]}];
    }
    self.paragraphs = paragraphs;
    // Keep TextKit's existing glyph/layout work for unchanged chapters. Only
    // splice the entering/leaving edges of the bounded window; replacing the
    // entire attributedText made every chapter load relayout the whole window.
    BOOL retained = NO;
    for (NSUInteger old = 0; old < self.chapterSpans.count && !retained; old++) {
        for (NSUInteger next = 0; next < spans.count && !retained; next++) {
            NSUInteger count = 0;
            while (old + count < self.chapterSpans.count && next + count < spans.count &&
                [self.chapterSpans[old + count][@"id"] isEqual:spans[next + count][@"id"]]) count++;
            if (!count) continue;
            NSRange oldRange = NSUnionRange([self.chapterSpans[old][@"range"] rangeValue], [self.chapterSpans[old + count - 1][@"range"] rangeValue]);
            NSRange newRange = NSUnionRange([spans[next][@"range"] rangeValue], [spans[next + count - 1][@"range"] rangeValue]);
            if (![[self.renderedText attributedSubstringFromRange:oldRange] isEqualToAttributedString:[text attributedSubstringFromRange:newRange]]) continue;
            NSTextStorage *storage = self.text.textStorage;
            [storage beginEditing];
            if (NSMaxRange(oldRange) < storage.length || NSMaxRange(newRange) < text.length)
                [storage replaceCharactersInRange:NSMakeRange(NSMaxRange(oldRange), storage.length - NSMaxRange(oldRange))
                    withAttributedString:[text attributedSubstringFromRange:NSMakeRange(NSMaxRange(newRange), text.length - NSMaxRange(newRange))]];
            if (oldRange.location || newRange.location)
                [storage replaceCharactersInRange:NSMakeRange(0, oldRange.location)
                    withAttributedString:[text attributedSubstringFromRange:NSMakeRange(0, newRange.location)]];
            [storage endEditing];
            retained = YES;
        }
    }
    if (!retained) self.text.attributedText = text;
    self.chapterSpans = spans;
    self.renderedText = text;
    if (!retained || jump) self.text.selectedRange = NSMakeRange(0, 0);
    [self.text.layoutManager ensureLayoutForTextContainer:self.text.textContainer];
    [self.text layoutIfNeeded];
    NSDictionary *destination = nil;
    NSString *identifier = jump ?: anchor[@"id"] ?: self.model[@"location"];
    for (NSDictionary *p in paragraphs) if ([p[@"id"] isEqual:identifier]) { destination = p; break; }
    if (destination) {
        CGFloat y = [self rectForParagraph:destination].origin.y - (jump ? 16 : distance);
        if (jump && destination[@"heading"]) {
            NSRange glyph = [self.text.layoutManager glyphRangeForCharacterRange:NSMakeRange([destination[@"heading"] unsignedIntegerValue], 1) actualCharacterRange:NULL];
            y = [self.text.layoutManager boundingRectForGlyphRange:glyph inTextContainer:self.text.textContainer].origin.y + self.text.textContainerInset.top - 16;
        }
        CGFloat maxY = MAX(0, self.text.contentSize.height - self.text.bounds.size.height);
        [self.text setContentOffset:CGPointMake(0, MAX(0, MIN(maxY, y))) animated:NO];
        self.reportedLocation = destination[@"id"];
        self.anchorDistance = [self rectForParagraph:destination].origin.y - self.text.contentOffset.y;
    }
    if (selectedText && !jump) {
        BOOL restored = NO;
        for (NSDictionary *p in paragraphs) if ([p[@"id"] isEqual:selectedParagraph[@"id"]]) {
            NSRange range = NSMakeRange([p[@"range"] rangeValue].location + selectionInParagraph, selection.length);
            if (NSMaxRange(range) <= text.length && [[text.string substringWithRange:range] isEqual:selectedText]) {
                if (!NSEqualRanges(self.text.selectedRange, range)) self.text.selectedRange = range;
                restored = YES;
            }
            break;
        }
        if (!restored) self.text.selectedRange = NSMakeRange(0, 0);
    } else self.text.selectedRange = NSMakeRange(0, 0);
    self.selectionActive = self.text.selectedRange.length > 0;
    self.highlightedPassage = nil;
    [self applyPassageHighlight];
    self.updating = NO;
}
- (void)applyPassageHighlight {
    NSString *selected = CCValue(self.model, @"selected");
    if ((selected == self.highlightedPassage) || [selected isEqual:self.highlightedPassage]) return;
    BOOL updating = self.updating;
    self.updating = YES;
    [self.text.textStorage beginEditing];
    for (NSDictionary *p in self.paragraphs) {
        BOOL active = [p[@"id"] isEqual:selected];
        if (!active && ![p[@"id"] isEqual:self.highlightedPassage]) continue;
        NSRange range = [p[@"range"] rangeValue];
        NSString *mark = CCValue(p, @"highlight");
        UIColor *background = mark ? ([mark isEqual:@"green"] ? UIColor.systemGreenColor :
            [mark isEqual:@"blue"] ? UIColor.systemBlueColor : UIColor.systemYellowColor) : nil;
        if (active) {
            UIColor *accent = CCColor(self.model[@"accent"]);
            if (background) {
                CGFloat r, g, b, a, ar, ag, ab, aa;
                [background getRed:&r green:&g blue:&b alpha:&a];
                [accent getRed:&ar green:&ag blue:&ab alpha:&aa];
                background = [UIColor colorWithRed:(r + ar) / 2 green:(g + ag) / 2 blue:(b + ab) / 2 alpha:0.30];
            } else background = [accent colorWithAlphaComponent:0.12];
        } else background = [background colorWithAlphaComponent:0.22];
        [self.text.textStorage removeAttribute:NSBackgroundColorAttributeName range:range];
        if (background) [self.text.textStorage addAttribute:NSBackgroundColorAttributeName value:background range:range];
    }
    [self.text.textStorage endEditing];
    self.highlightedPassage = selected;
    self.updating = updating;
}
- (NSDictionary *)visibleParagraph {
    NSDictionary *visible = [self paragraphAtOffset:[self visibleCharacter]];
    // A chapter heading can already occupy the reading area while the last
    // line of the preceding chapter remains at the very top. Follow that
    // canonical chapter before its first body paragraph reaches the top edge.
    CGFloat threshold = self.text.bounds.size.height * 0.25;
    for (NSDictionary *p in self.paragraphs) {
        if (!p[@"heading"]) continue;
        NSRange glyph = [self.text.layoutManager glyphRangeForCharacterRange:NSMakeRange([p[@"heading"] unsignedIntegerValue], 1) actualCharacterRange:NULL];
        CGFloat y = [self.text.layoutManager boundingRectForGlyphRange:glyph inTextContainer:self.text.textContainer].origin.y + self.text.textContainerInset.top - self.text.contentOffset.y;
        if (y >= 0 && y <= threshold) visible = p;
    }
    return visible;
}
- (void)reportLocation {
    if (self.hidden || self.updating || !self.paragraphs.count) return;
    NSDictionary *p = [self visibleParagraph];
    if (p) self.anchorDistance = [self rectForParagraph:p].origin.y - self.text.contentOffset.y;
    if (p) {
        BOOL report = ![self.reportedLocation isEqual:p[@"id"]] || ![self.model[@"location"] isEqual:p[@"id"]];
        self.reportedLocation = p[@"id"];
        NSString *title = p[@"chapterTitle"];
        NSString *libraryTitle = [@"Library · " stringByAppendingString:title ?: @""];
        if (title && ![self.titleButton.currentTitle isEqual:libraryTitle]) {
            [self.titleButton setTitle:libraryTitle forState:UIControlStateNormal];
            self.titleButton.accessibilityLabel = [NSString stringWithFormat:@"Library, %@, %@", self.model[@"collection"], title];
            self.text.accessibilityLabel = title;
            [self prepareLayout];
            [self setNeedsLayout];
            [self layoutIfNeeded];
            [self.titleButton layoutIfNeeded];
        }
        if (report) CCEvent(@"location", p[@"id"], self.model[@"book"], 0);
    }
}
- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
    if (self.updating || self.hidden) return;
    [self reportLocation];
    // Chapter splices preserve selected words by Passage and UTF-16 range;
    // selection must not stop the document from loading as reading continues.
    CGFloat y = scrollView.contentOffset.y, height = scrollView.bounds.size.height;
    NSDictionary *visible = [self visibleParagraph];
    NSString *edge = nil;
    if ([self.model[@"previous"] boolValue] && (y < height || [visible[@"chapterKey"] isEqual:self.paragraphs.firstObject[@"chapterKey"]])) edge = @"previous";
    else if ([self.model[@"next"] boolValue] && (y + height * 2 > scrollView.contentSize.height || [visible[@"chapterKey"] isEqual:self.paragraphs.lastObject[@"chapterKey"]])) edge = @"next";
    if (edge && ![edge isEqual:self.edgeRequest]) {
        self.edgeRequest = edge;
        CCEvent(edge, nil, self.model[@"book"], 0);
    }
}
- (void)update:(NSDictionary *)model {
    BOOL wasHidden = self.hidden;
    if (![model[@"visible"] boolValue]) {
        [self reportLocation];
        [self.text resignFirstResponder];
        // UIKit promotes the text view's responder to its UIKeyInput ancestor
        // (winit's rendering view). That opens a keyboard even for read-only
        // dialogs. Release this inherited focus; egui will request the host
        // again when an actual search or notes field needs text input.
        if (self.superview.isFirstResponder) [self.superview resignFirstResponder];
        self.hidden = YES;
        self.accessibilityElementsHidden = YES;
        return;
    }
    BOOL changedBook = self.model && ![model[@"book"] isEqual:self.model[@"book"]];
    self.model = model;
    self.hidden = NO;
    self.accessibilityElementsHidden = NO;
    UIUserInterfaceStyle interfaceStyle = [model[@"theme"] integerValue] == 2 ? UIUserInterfaceStyleDark : UIUserInterfaceStyleLight;
    CCWindow().overrideUserInterfaceStyle = interfaceStyle;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    // Info.plist intentionally uses application-managed status-bar appearance.
    // Keep it readable when the app theme differs from the system's theme.
    UIStatusBarStyle statusStyle = interfaceStyle == UIUserInterfaceStyleDark ? UIStatusBarStyleLightContent : UIStatusBarStyleDarkContent;
    if (UIApplication.sharedApplication.statusBarStyle != statusStyle) UIApplication.sharedApplication.statusBarStyle = statusStyle;
#pragma clang diagnostic pop
    UIColor *paper = CCColor(model[@"paper"]), *ink = CCColor(model[@"ink"]), *accent = CCColor(model[@"accent"]);
    self.backgroundColor = paper;
    self.text.backgroundColor = paper;
    self.text.tintColor = accent;
    self.tintColor = accent;
    UIViewController *presented = CCWindow().rootViewController.presentedViewController;
    if ([presented isKindOfClass:UINavigationController.class]) {
        UINavigationController *navigation = (UINavigationController *)presented;
        if ([navigation.viewControllers.firstObject isKindOfClass:CCReaderSettings.class]) {
            navigation.view.tintColor = accent;
            navigation.navigationBar.tintColor = accent;
        }
    }
    self.separator.backgroundColor = [accent colorWithAlphaComponent:0.16];
    self.text.accessibilityLabel = model[@"title"];
    self.reference.textColor = accent;
    self.status.textColor = CCColor(model[@"muted"]);
    self.status.text = CCValue(model, @"status");
    NSString *libraryTitle = [@"Library · " stringByAppendingString:model[@"title"] ?: @""];
    if (![self.titleButton.currentTitle isEqual:libraryTitle]) {
        [self.titleButton setTitle:libraryTitle forState:UIControlStateNormal];
        [self setNeedsLayout];
    }
    [self.titleButton setTitleColor:ink forState:UIControlStateNormal];
    self.titleButton.accessibilityLabel = [NSString stringWithFormat:@"Library, %@, %@", model[@"collection"], model[@"title"]];
    BOOL selected = CCValue(model, @"selected") != nil;
    if (!selected && self.selectionActive) {
        self.updating = YES;
        self.text.selectedRange = NSMakeRange(0, 0);
        self.updating = NO;
        self.selectionActive = NO;
        ++self.selectionGeneration;
        if (@available(iOS 16.0, *)) [self.editMenu dismissMenu];
        else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [UIMenuController.sharedMenuController hideMenu];
#pragma clang diagnostic pop
        }
    }
    self.reference.text = CCValue(model, @"reference");
    self.reference.hidden = !selected;
    self.actions.hidden = !selected;
    UIButton *commentary = (UIButton *)self.actions.arrangedSubviews[2];
    BOOL scripture = [model[@"scripture"] boolValue];
    commentary.hidden = !scripture;
    UIColor *controlBorder = [CCColor(model[@"muted"]) colorWithAlphaComponent:0.28];
    self.toolsButton.layer.borderColor = controlBorder.CGColor;
    self.status.hidden = selected;
    BOOL footerVisible = selected || self.status.text.length > 0;
    self.footer.hidden = !footerVisible;
    if (footerVisible) {
        self.readingBottom.active = NO;
        self.passageBottom.active = YES;
    } else {
        self.passageBottom.active = NO;
        self.readingBottom.active = YES;
    }
    NSArray *items = @[@[@"Reader settings", @"textformat.size", @"settings"],
        @[[model[@"playing"] boolValue] ? @"Pause audio" : @"Play audio", @"playpause", @"audio"],
        @[@"Audio downloads", @"arrow.down.circle", @"downloads"], @[@"Account and sync", @"person.crop.circle", @"account"]];
    NSMutableArray *menu = [NSMutableArray new];
    __weak CCReaderView *weak = self;
    for (NSArray *item in items) {
        UIAction *action = [UIAction actionWithTitle:item[0] image:[UIImage systemImageNamed:item[1]] identifier:nil handler:^(__unused UIAction *a) {
            CCReaderView *self = weak;
            if ([item[2] isEqual:@"settings"]) [self showSettings];
            else CCEvent(item[2], nil, self.model[@"book"], 0);
        }];
        if ([item[2] isEqual:@"audio"] && ![model[@"audio"] boolValue]) action.attributes = UIMenuElementAttributesDisabled;
        [menu addObject:action];
    }
    if ([model[@"versionControl"] boolValue]) {
        NSMutableArray *versions = [NSMutableArray new];
        for (NSString *title in @[@"Modernized", @"Original"]) {
            BOOL original = [title isEqual:@"Original"];
            UIAction *action = [UIAction actionWithTitle:title image:nil identifier:nil handler:^(__unused UIAction *a) {
                CCReaderView *self = weak;
                if (original != [self.model[@"original"] boolValue]) CCEvent(@"original", nil, self.model[@"book"], 0);
            }];
            action.state = original == [model[@"original"] boolValue] ? UIMenuElementStateOn : UIMenuElementStateOff;
            [versions addObject:action];
        }
        [menu addObject:[UIMenu menuWithTitle:@"Reading text" children:versions]];
    }
    self.toolsButton.menu = [UIMenu menuWithChildren:menu];
    NSString *styleKey = [NSString stringWithFormat:@"%@/%@/%@/%@/%@/%@", model[@"fontScale"], model[@"lineHeight"], model[@"width"], model[@"paper"], model[@"ink"], model[@"muted"]];
    NSArray *chapters = CCValue(model, @"chapters");
    BOOL contentChanged = chapters && ![chapters isEqual:self.chapters];
    if (chapters) { self.chapters = chapters; self.edgeRequest = nil; }
    NSString *jump = CCValue(model, @"jump");
    // Passive book changes keep TextKit's current Passage anchor.
    if (changedBook && jump) { self.paragraphs = nil; self.reportedLocation = nil; }
    [self prepareLayout];
    [self layoutIfNeeded];
    if (contentChanged || jump || ![styleKey isEqual:self.styleKey]) {
        self.styleKey = styleKey;
        [self reflowTo:jump ?: (!self.paragraphs.count ? model[@"location"] : nil)];
    }
    [self applyPassageHighlight];
    // A queued model may still describe the prior chapter. Reconcile it with
    // the stable native viewport after layout, reflow and explicit jumps.
    [self reportLocation];
    if (wasHidden || jump) UIAccessibilityPostNotification(UIAccessibilityScreenChangedNotification, self.text);
}
@end

// Expose egui dialogs to UIKit too, retaining element objects by stable IDs so
// VoiceOver focus survives ordinary redraws. Activation uses egui actions rather
// than guessed screen taps. The native reader has its own UIKit accessibility.
@interface CCElement : UIAccessibilityElement
@property(nonatomic) NSString *nodeID;
@property(nonatomic) NSString *role;
@end
@implementation CCElement
- (BOOL)accessibilityActivate { CCEvent(@"accessibility", self.nodeID, [self.role isEqual:@"input"] ? @"focus" : @"click", 0); return YES; }
- (void)accessibilityIncrement { CCEvent(@"accessibility", self.nodeID, @"increment", 0); }
- (void)accessibilityDecrement { CCEvent(@"accessibility", self.nodeID, @"decrement", 0); }
- (BOOL)accessibilityScroll:(UIAccessibilityScrollDirection)direction {
    if (direction != UIAccessibilityScrollDirectionDown && direction != UIAccessibilityScrollDirectionUp) return NO;
    UIView *view = self.accessibilityContainer;
    double amount = view.bounds.size.height * 0.7;
    CCEvent(@"scroll", self.nodeID, nil, direction == UIAccessibilityScrollDirectionDown ? -amount : amount);
    UIAccessibilityPostNotification(UIAccessibilityPageScrolledNotification, nil);
    return YES;
}
@end

static CCReaderView *reader;
static NSMutableDictionary<NSString *, CCElement *> *elements;
static BOOL modalVisible;
static NSString *modalScope;

void cross_canon_reader_update(const char *json) {
    NSCAssert(NSThread.isMainThread, @"Reader updates must run on UIKit's main thread");
    NSDictionary *model = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    UIWindow *window = CCWindow();
    UIView *host = window.rootViewController.view;
    if (!host || !model) return;
    if (!reader) {
        for (NSString *name in @[@"SourceSerif4-Regular", @"SourceSerif4-Semibold", @"SourceSerif4-Bold"]) {
            NSURL *url = [NSBundle.mainBundle URLForResource:name withExtension:@"ttf"];
            if (url) CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, NULL);
        }
        // The controller's view supplies the responder chain needed to present
        // UIKit selection menus, Look Up, Translate and button menus. A sibling
        // placed directly in UIWindow looks right but cannot present these.
        reader = [[CCReaderView alloc] initWithFrame:host.bounds];
        [host addSubview:reader];
    }
    [reader update:model];
}

void cross_canon_accessibility_update(const char *json) {
    NSDictionary *model = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    UIWindow *window = CCWindow();
    UIView *host = window.rootViewController.view;
    if (!host) return;
    if (!elements) elements = [NSMutableDictionary new];
    BOOL modal = [model[@"modal"] boolValue];
    NSString *scope = CCValue(model, @"scope");
    BOOL changed = modal != modalVisible || !((scope == modalScope) || [scope isEqual:modalScope]);
    modalVisible = modal;
    modalScope = scope;
    if (!modal) { host.accessibilityElements = nil; host.accessibilityViewIsModal = NO; return; }
    NSMutableArray *ordered = [NSMutableArray new];
    NSMutableSet *seen = [NSMutableSet new];
    double scale = [model[@"scale"] doubleValue];
    NSArray *nodes = [model[@"nodes"] sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        NSArray *ar = a[@"rect"], *br = b[@"rect"];
        double dy = [ar[1] doubleValue] - [br[1] doubleValue];
        if (fabs(dy) > 10) return dy < 0 ? NSOrderedAscending : NSOrderedDescending;
        return [ar[0] compare:br[0]];
    }];
    for (NSDictionary *node in nodes) {
        NSArray *r = node[@"rect"];
        CGRect frame = CGRectMake([r[0] doubleValue]*scale, [r[1] doubleValue]*scale, [r[2] doubleValue]*scale, [r[3] doubleValue]*scale);
        if (!CGRectIntersectsRect(frame, host.bounds)) continue;
        NSString *identifier = node[@"id"];
        CCElement *element = elements[identifier];
        if (!element) { element = [[CCElement alloc] initWithAccessibilityContainer:host]; elements[identifier] = element; }
        element.nodeID = identifier;
        element.role = node[@"role"];
        element.accessibilityLabel = node[@"label"];
        element.accessibilityValue = CCValue(node, @"value") ?: [CCValue(node, @"number") stringValue];
        element.accessibilityFrameInContainerSpace = frame;
        UIAccessibilityTraits traits = [element.role isEqual:@"text"] ? UIAccessibilityTraitStaticText :
            [element.role isEqual:@"adjustable"] ? UIAccessibilityTraitAdjustable : UIAccessibilityTraitButton;
        if ([CCValue(node, @"selected") boolValue]) traits |= UIAccessibilityTraitSelected;
        element.accessibilityTraits = traits;
        [seen addObject:identifier];
        [ordered addObject:element];
    }
    for (NSString *key in elements.allKeys) if (![seen containsObject:key]) [elements removeObjectForKey:key];
    host.accessibilityElements = ordered;
    host.accessibilityViewIsModal = YES;
    if (changed) {
        // Native menu dismissal must finish before announcing the egui dialog;
        // otherwise UIKit leaves VoiceOver on the disappearing menu's elements.
        NSString *expected = [scope copy];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            if (modalVisible && ((expected == modalScope) || [expected isEqual:modalScope]))
                UIAccessibilityPostNotification(UIAccessibilityScreenChangedNotification, host.accessibilityElements.firstObject);
        });
    }
}
