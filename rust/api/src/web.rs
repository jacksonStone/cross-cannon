//! Web reader compatibility: refine existing vectors and preserve the web contracts.
use crate::engine::Engine;
use anyhow::{Context, Result};
use cross_canon_core::{Corpus, SearchRequest};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct Source {
    pub embedding: Vec<f32>,
    pub metadata: Value,
    pub database_id: String,
}

impl Engine {
    pub(crate) fn connection(&self, corpus: Corpus) -> Result<Connection> {
        let path = match corpus {
            Corpus::Scripture => &self.scripture_db,
            Corpus::EarlyChristian => &self.fathers_db,
            Corpus::ChristianClassics => &self.classics_db,
        };
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }

    pub fn source(&self, id: &str, target: Option<Corpus>) -> Result<Source> {
        let local = self.library.passage(id);
        let corpus = local
            .map(|p| p.corpus)
            .or_else(|| id.starts_with("ecw:").then_some(Corpus::EarlyChristian))
            .or_else(|| id.starts_with("ccw:").then_some(Corpus::ChristianClassics))
            .context("Unknown source passage")?;
        if self.config(Some(corpus))? != self.config(target)? {
            anyhow::bail!("Source and target embedding configurations differ");
        }
        let db = self.connection(corpus)?;
        let (database_id, reference, text, bytes) = if corpus == Corpus::Scripture {
            db.query_row("SELECT id, reference, text, embedding FROM passages WHERE id=? AND embedding IS NOT NULL", [id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Vec<u8>>(3)?)))?
        } else {
            let (clause, arguments) = if let Some(p) = local {
                (
                    "pm.chapter_id=? AND p.verse_start=? AND p.verse_end=?",
                    vec![
                        rusqlite::types::Value::Text(p.chapter_id.clone()),
                        p.verse_start.into(),
                        p.verse_end.into(),
                    ],
                )
            } else {
                ("p.id=?", vec![rusqlite::types::Value::Text(id.into())])
            };
            db.query_row(&format!("SELECT p.id,p.reference,p.text,p.embedding,pm.chapter_id FROM passages p JOIN early_christian_passage_metadata pm ON pm.passage_id=p.id WHERE {clause} AND p.embedding IS NOT NULL LIMIT 1"), params_from_iter(arguments), |r| {
                let chapter:String=r.get(4)?;
                if self.library.chapter(&chapter).is_none() { return Err(rusqlite::Error::QueryReturnedNoRows); }
                Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Vec<u8>>(3)?))
            })?
        };
        let embedding = crate::engine::decode_embedding(&bytes, self.config(target)?.dimensions)?;
        let metadata = if corpus == Corpus::Scripture {
            json!({"id":database_id,"reference":reference})
        } else {
            json!({"id":database_id,"reference":reference,"text":text})
        };
        Ok(Source {
            embedding,
            metadata,
            database_id,
        })
    }

    pub fn web_results(
        &self,
        query: &[f32],
        request: &SearchRequest,
        source: Option<&Source>,
    ) -> Result<Vec<Value>> {
        match request
            .corpus
            .context("Web searches require one target corpus")?
        {
            Corpus::Scripture => self.scripture_web_results(query, request),
            Corpus::EarlyChristian | Corpus::ChristianClassics => {
                self.fathers_web_results(query, request, source)
            }
        }
    }
    fn scripture_web_results(&self, query: &[f32], request: &SearchRequest) -> Result<Vec<Value>> {
        let hits = self.semantic(query, request)?;
        let db = self.connection(Corpus::Scripture)?;
        let mut verses=db.prepare("SELECT verse,embedding FROM paragraph_verses WHERE paragraph_id=? AND embedding IS NOT NULL ORDER BY verse")?;
        hits.into_iter().map(|hit|{
            let mut best:Option<(u32,f32)>=None;
            let mut rows=verses.query([&hit.id])?;
            while let Some(row)=rows.next()? {
                let bytes:Vec<u8>=row.get(1)?;
                let vector=crate::engine::decode_embedding(&bytes,query.len())?;
                let score=dot(query,&vector);
                if best.is_none_or(|(_,s)|score>s){best=Some((row.get(0)?,score));}
            }
            let mut result=json!({"id":hit.id,"reference":hit.reference,"type":"paragraph","score":hit.score});
            if let Some((verse,score))=best.filter(|(_,s)|*s>hit.score){ let _=score;result["highlightVerse"]=json!(verse); }
            Ok(result)
        }).collect()
    }
    fn fathers_web_results(
        &self,
        query: &[f32],
        request: &SearchRequest,
        source: Option<&Source>,
    ) -> Result<Vec<Value>> {
        let mut candidates = request.clone();
        candidates.limit = if request.authors.is_empty() {
            (request.limit * 40).max(300)
        } else {
            self.library
                .books
                .iter()
                .filter(|b| Some(b.corpus) == request.corpus)
                .map(|b| b.chapters.len())
                .sum()
        };
        let chapters = self.semantic(query, &candidates)?;
        if chapters.is_empty() {
            return Ok(vec![]);
        }
        let db = self.connection(request.corpus.context("Missing Work collection")?)?;
        let marks = vec!["?"; chapters.len()].join(",");
        let sql=format!("SELECT p.id,p.reference,p.text,p.embedding,p.verse_start,p.verse_end,c.id,c.reference,w.title,w.author,w.authorship_date_range,w.ccel_id FROM passages p JOIN early_christian_passage_metadata pm ON pm.passage_id=p.id JOIN early_christian_chapters c ON c.id=pm.chapter_id LEFT JOIN early_christian_works w ON w.id=pm.work_id WHERE p.embedding IS NOT NULL AND pm.chapter_id IN ({marks})");
        let excluded = source.map(|s| s.database_id.as_str());
        let mut statement = db.prepare(&sql)?;
        let mut rows = statement.query(params_from_iter(chapters.iter().map(|h| &h.chapter_id)))?;
        let mut best: HashMap<String, (f32, Value)> = HashMap::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            if excluded == Some(id.as_str()) {
                continue;
            }
            let bytes: Vec<u8> = row.get(3)?;
            let vector = crate::engine::decode_embedding(&bytes, query.len())?;
            let score = dot(query, &vector);
            let chapter: String = row.get(6)?;
            if best.get(&chapter).is_some_and(|(s, _)| *s >= score) {
                continue;
            }
            let start: Option<u32> = row.get(4)?;
            let end: Option<u32> = row.get(5)?;
            let range = match (start, end) {
                (Some(a), Some(b)) if a != b => format!("{a}-{b}"),
                (Some(a), _) => a.to_string(),
                _ => String::new(),
            };
            let result = json!({"author":row.get::<_,Option<String>>(9)?,"chapterId":chapter,"chapterReference":row.get::<_,String>(7)?,"date":row.get::<_,Option<String>>(10)?,"highlightPassage":{"id":id,"rangeLabel":range,"reference":row.get::<_,String>(1)?,"text":row.get::<_,String>(2)?,"verseStart":start,"verseEnd":end},"score":score,"source":row.get::<_,Option<String>>(11)?.unwrap_or_default(),"title":row.get::<_,Option<String>>(8)?.unwrap_or_default()});
            best.insert(chapter, (score, result));
        }
        let mut results: Vec<_> = best.into_values().collect();
        results.sort_unstable_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then_with(|| a.1["chapterId"].as_str().cmp(&b.1["chapterId"].as_str()))
        });
        results.truncate(request.limit);
        Ok(results.into_iter().map(|(_, v)| v).collect())
    }
}
fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}
