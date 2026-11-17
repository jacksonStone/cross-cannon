//! Server-only normalized text cache. Reader caches retain their existing policy.
//! The budget covers retained normalized entry capacities. Active searches may
//! still hold evicted entries; the API separately limits concurrent searches.
use super::{Library, SearchText};
use std::{
    collections::VecDeque,
    mem::size_of,
    sync::{Arc, Mutex},
};

pub(super) const SERVER_CACHE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct KeywordCache(Arc<Mutex<Entries>>);

struct Entries {
    limit: usize,
    bytes: usize,
    books: VecDeque<(usize, Arc<Vec<SearchText>>, usize)>,
}

impl KeywordCache {
    pub(super) fn new(limit: usize) -> Self {
        Self(Arc::new(Mutex::new(Entries {
            limit,
            bytes: 0,
            books: VecDeque::new(),
        })))
    }

    pub(super) fn book(&self, book: usize, library: &Library) -> Option<Arc<Vec<SearchText>>> {
        let limit = {
            let mut cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(entries) = cache.get(book) {
                return Some(entries);
            }
            cache.limit
        };
        let passages = &library.book_passages[book];
        // Oversize books are searched one passage at a time instead of building
        // and discarding an entire normalized book on every request.
        let estimate = passages
            .iter()
            .map(|&i| {
                let p = &library.passages[i];
                size_of::<SearchText>() + p.text.len() + p.reference.len()
            })
            .sum::<usize>();
        if estimate > limit {
            return None;
        }
        let mut texts = Vec::with_capacity(passages.len());
        let mut bytes = texts.capacity() * size_of::<SearchText>();
        for &passage in passages {
            let p = &library.passages[passage];
            let entry = SearchText {
                passage,
                text: p.text.to_lowercase(),
                reference: p.reference.to_lowercase(),
            };
            bytes += entry.text.capacity() + entry.reference.capacity();
            if bytes > limit {
                return None;
            }
            texts.push(entry);
        }
        let mut cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // Concurrent searches may have prepared the same book while unlocked.
        if let Some(entries) = cache.get(book) {
            return Some(entries);
        }
        let texts = Arc::new(texts);
        cache.insert(book, texts.clone(), bytes);
        Some(texts)
    }

    pub(super) fn invalidate(&self, book: usize) {
        let mut cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = cache.books.iter().position(|(id, _, _)| *id == book) {
            let (_, _, bytes) = cache.books.remove(index).unwrap();
            cache.bytes -= bytes;
        }
    }
}

impl Entries {
    fn get(&mut self, book: usize) -> Option<Arc<Vec<SearchText>>> {
        let index = self.books.iter().position(|(id, _, _)| *id == book)?;
        let entry = self.books.remove(index).unwrap();
        let texts = entry.1.clone();
        self.books.push_back(entry);
        Some(texts)
    }

    fn insert(&mut self, book: usize, texts: Arc<Vec<SearchText>>, bytes: usize) {
        while self.bytes + bytes > self.limit {
            let (_, _, removed) = self.books.pop_front().unwrap();
            self.bytes -= removed;
        }
        self.bytes += bytes;
        self.books.push_back((book, texts, bytes));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Library {
        let mut library: Library = serde_json::from_value(serde_json::json!({
            "version":"fixture", "audio":{},
            "books":[{"id":"John","title":"John","corpus":"scripture","chapters":[{"id":"John:1","number":1,"title":"John 1","passageIds":["one","two"]}]}],
            "passages":[
                {"id":"one","corpus":"scripture","bookId":"John","book":"John","chapterId":"John:1","chapter":1,"reference":"John 1:1","text":"İ LOVE λόγος","originalText":"İ LOVE λόγος","verseStart":1,"verseEnd":1,"verses":[]},
                {"id":"two","corpus":"scripture","bookId":"John","book":"John","chapterId":"John:1","chapter":1,"reference":"John 1:2","text":"Love","originalText":"Love","verseStart":2,"verseEnd":2,"verses":[]}
            ]
        })).unwrap();
        library.rebuild_indexes().unwrap();
        library
    }

    #[test]
    fn normalized_capacity_is_bounded_and_concurrent_readers_share_cached_entries() {
        let library = library();
        let cache = KeywordCache::new(1024);
        let texts = cache.book(0, &library).unwrap();
        assert_eq!(texts[0].text, "İ LOVE λόγος".to_lowercase());
        let bytes = texts.capacity() * size_of::<SearchText>()
            + texts
                .iter()
                .map(|t| t.text.capacity() + t.reference.capacity())
                .sum::<usize>();
        assert_eq!(cache.0.lock().unwrap().bytes, bytes);
        assert!(bytes <= 1024);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let cache = &cache;
                let library = &library;
                let texts = &texts;
                scope.spawn(move || assert!(Arc::ptr_eq(texts, &cache.book(0, library).unwrap())));
            }
        });
        let tiny = KeywordCache::new(bytes - 1);
        assert!(tiny.book(0, &library).is_none());
        assert_eq!(tiny.0.lock().unwrap().bytes, 0);
    }

    #[test]
    fn cache_evicts_least_recent_book_and_invalidation_releases_budget() {
        let cache = KeywordCache::new(10);
        let mut entries = cache.0.lock().unwrap();
        entries.insert(1, Arc::new(vec![]), 4);
        entries.insert(2, Arc::new(vec![]), 4);
        entries.get(1).unwrap();
        entries.insert(3, Arc::new(vec![]), 4);
        assert!(entries.get(2).is_none());
        assert!(entries.get(1).is_some());
        assert_eq!(entries.bytes, 8);
        drop(entries);
        cache.invalidate(1);
        assert_eq!(cache.0.lock().unwrap().bytes, 4);
    }
}
