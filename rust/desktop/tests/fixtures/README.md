# Continuous audio regression fixture

`2-john.m4a` is copied byte for byte from the existing
`storage/audio/continuous/bible-2-john-cab33da20d546a07.m4a` World English Bible
recording. It is not re-encoded and no timestamps are generated. This small
existing MP4 recording exercises the real decoder failure without requiring
network access, local production storage or an audio device during tests.
