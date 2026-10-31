use anyhow::{bail, Context, Result};
use cross_canon_core::{Corpus, Library, SearchHit, SearchRequest};
use rayon::prelude::*;
use rusqlite::{Connection, OpenFlags};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmbeddingConfig {
    pub model: String,
    pub dimensions: usize,
}
struct Vector {
    id: String,
    embedding: Vec<f32>,
    corpus: Corpus,
}
pub struct Engine {
    pub library: Arc<Library>,
    vectors: Vec<Vector>,
    configs: HashMap<u8, EmbeddingConfig>,
    pub(crate) scripture_db: PathBuf,
    pub(crate) fathers_db: PathBuf,
}
fn corpus_key(corpus: Corpus) -> u8 {
    if corpus == Corpus::Scripture {
        0
    } else {
        1
    }
}

impl Engine {
    pub fn load(library: Arc<Library>, scripture_db: &Path, fathers_db: &Path) -> Result<Self> {
        let mut engine = Self {
            library,
            vectors: vec![],
            configs: HashMap::new(),
            scripture_db: scripture_db.to_path_buf(),
            fathers_db: fathers_db.to_path_buf(),
        };
        for (corpus, path, table) in [
            (Corpus::Scripture, scripture_db, "passages"),
            (
                Corpus::EarlyChristian,
                fathers_db,
                "early_christian_chapters",
            ),
        ] {
            // Never run schema migrations or rebuild either the vectors or vector indexes.
            let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .with_context(|| format!("Open existing embedding DB {}", path.display()))?;
            let config = connection.query_row(
                "SELECT model, dimensions FROM scripture_embedding_config WHERE id='active'",
                [],
                |row| {
                    Ok(EmbeddingConfig {
                        model: row.get(0)?,
                        dimensions: row.get(1)?,
                    })
                },
            )?;
            if config.dimensions == 0 || config.dimensions > 16384 {
                bail!("Invalid indexed embedding dimensions")
            }
            let mut statement = connection.prepare(&format!(
                "SELECT id, embedding FROM {table} WHERE embedding IS NOT NULL"
            ))?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let source_id: String = row.get(0)?;
                let id = if corpus == Corpus::Scripture {
                    if engine.library.passage(&source_id).is_none() {
                        continue;
                    }
                    source_id
                } else {
                    let Some((_, chapter)) = engine.library.chapter(&source_id) else {
                        continue;
                    };
                    let Some(id) = chapter.passage_ids.first() else {
                        continue;
                    };
                    id.clone()
                };
                let bytes: Vec<u8> = row.get(1)?;
                let embedding = decode_embedding(&bytes, config.dimensions)?;
                engine.vectors.push(Vector {
                    id,
                    embedding,
                    corpus,
                });
            }
            engine.configs.insert(corpus_key(corpus), config);
        }
        if engine.vectors.is_empty() {
            bail!("No existing embeddings were found")
        }
        Ok(engine)
    }
    pub fn count(&self) -> usize {
        self.vectors.len()
    }
    pub fn config(&self, corpus: Option<Corpus>) -> Result<&EmbeddingConfig> {
        if corpus.is_none() && self.configs.get(&0) != self.configs.get(&1) {
            bail!("Cross-corpus embedding configurations differ; select one corpus")
        }
        self.configs
            .get(&corpus_key(corpus.unwrap_or_default()))
            .context("Missing indexed embedding configuration")
    }
    pub fn source_embedding(&self, id: &str, target: Option<Corpus>) -> Result<Vec<f32>> {
        Ok(self.source(id, target)?.embedding)
    }

    pub fn semantic(&self, query: &[f32], request: &SearchRequest) -> Result<Vec<SearchHit>> {
        let config = self.config(request.corpus)?;
        if query.len() != config.dimensions || query.iter().any(|n| !n.is_finite()) {
            bail!("Query embedding dimensions/values do not match the existing index")
        }
        let source_chapter = request
            .source_id
            .as_deref()
            .and_then(|id| self.library.passage(id))
            .map(|p| p.chapter_id.as_str());
        // Existing float32 vectors are normalized once on load. Exact parallel scoring
        // avoids SQLite vector-extension locks and never creates replacement artifacts.
        let mut results: Vec<_> = self
            .vectors
            .par_iter()
            .filter_map(|v| {
                let p = self.library.passage(&v.id)?;
                if (p.corpus == Corpus::Scripture && !request.canon.includes(&p.book))
                    || request.corpus.is_some_and(|c| c != v.corpus)
                    || (!request.books.is_empty() && !request.books.contains(&p.book_id))
                    || (request.source_id.as_deref() == Some(p.id.as_str())
                        && (p.corpus == Corpus::Scripture || !request.web))
                    || (p.corpus == Corpus::EarlyChristian
                        && !request.web
                        && source_chapter == Some(p.chapter_id.as_str()))
                    || (p.corpus == Corpus::EarlyChristian
                        && !request.authors.is_empty()
                        && !p
                            .author
                            .as_ref()
                            .is_some_and(|a| request.authors.contains(a)))
                {
                    return None;
                }
                let score = query
                    .iter()
                    .zip(&v.embedding)
                    .map(|(a, b)| a * b)
                    .sum::<f32>();
                Some(SearchHit {
                    id: p.id.clone(),
                    chapter_id: p.chapter_id.clone(),
                    reference: p.reference.clone(),
                    corpus: p.corpus,
                    score,
                })
            })
            .collect();
        results.sort_unstable_by(|a, b| b.score.total_cmp(&a.score).then(a.id.cmp(&b.id)));
        results.truncate(request.limit);
        Ok(results)
    }
}

pub fn normalize(vector: &mut [f32]) -> Result<()> {
    let norm = vector
        .iter()
        .map(|x| (*x as f64).powi(2))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm == 0.0 {
        bail!("Invalid zero/nonfinite embedding")
    }
    for value in vector {
        *value = (*value as f64 / norm) as f32;
    }
    Ok(())
}
pub(crate) fn decode_embedding(bytes: &[u8], dimensions: usize) -> Result<Vec<f32>> {
    if bytes.len() != dimensions * 4 {
        bail!("Stored embedding size does not match indexed dimensions")
    }
    let mut vector = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect::<Vec<_>>();
    normalize(&mut vector)?;
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn libsql_blob_contract_and_invalid_vectors() {
        let bytes = [3.0_f32, 4.0_f32]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect::<Vec<_>>();
        let vector = decode_embedding(&bytes, 2).unwrap();
        assert!((vector[0] - 0.6).abs() < 0.00001);
        assert!((vector[1] - 0.8).abs() < 0.00001);
        assert!(decode_embedding(&bytes, 3).is_err());
        assert!(normalize(&mut [0.0, 0.0]).is_err());
        assert!(normalize(&mut [f32::NAN]).is_err());
    }
}
