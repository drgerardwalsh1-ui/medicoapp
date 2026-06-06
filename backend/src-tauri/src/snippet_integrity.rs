//! Snippet integrity — the persistence boundary's audit gate.
//!
//! Every `ClinicalEvent` that flows into the persistent boundary table
//! must satisfy:
//!
//! ```text
//! clean_text[char_offset_start..char_offset_end] == source_snippet
//! ```
//!
//! This module defines that check exactly once so all writers, debug
//! assertions, and tests share a single canonical implementation.
//!
//! Why this matters: snippets are the verbatim source quotes that anchor
//! every medico-legal claim. If `char_offset_start`/`char_offset_end`
//! drift away from `source_snippet`, future audits cannot relocate the
//! quote in the original document, and the chain of custody is broken.
//! The projection-layer writer therefore rejects any event that fails
//! this check.
//!
//! Snippet model: `source_snippet` is sliced from the document's
//! `clean_text` (post text_clean normalisation). `raw_text` is retained
//! separately on the DOCUMENT row for forensic replay; snippet offsets
//! are not byte-mapped into raw_text by design (decision 2A).

use crate::clinical_events::ClinicalEvent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnippetIntegrityError {
    /// The recorded `char_offset_end` lies past the end of `clean_text`.
    OffsetOutOfRange { end: usize, clean_text_len: usize },
    /// `char_offset_start` is greater than `char_offset_end`.
    Reversed { start: usize, end: usize },
    /// One of the offsets does not land on a UTF-8 char boundary in
    /// `clean_text` — would panic if we attempted to slice.
    NotCharBoundary { start: usize, end: usize },
    /// `clean_text[start..end]` is not byte-equal to `source_snippet`.
    SnippetMismatch {
        event_id: String,
        expected_len: usize,
        actual_len: usize,
    },
}

impl std::fmt::Display for SnippetIntegrityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SnippetIntegrityError::OffsetOutOfRange { end, clean_text_len } => {
                write!(
                    f,
                    "snippet integrity: offset_end={end} exceeds clean_text length {clean_text_len}"
                )
            }
            SnippetIntegrityError::Reversed { start, end } => {
                write!(
                    f,
                    "snippet integrity: offset_start={start} > offset_end={end}"
                )
            }
            SnippetIntegrityError::NotCharBoundary { start, end } => {
                write!(
                    f,
                    "snippet integrity: offset_start={start} or offset_end={end} not on UTF-8 char boundary"
                )
            }
            SnippetIntegrityError::SnippetMismatch { event_id, expected_len, actual_len } => {
                write!(
                    f,
                    "snippet integrity: event={event_id} clean_text[start..end].len()={actual_len} \
                     does not byte-match source_snippet.len()={expected_len}"
                )
            }
        }
    }
}

impl std::error::Error for SnippetIntegrityError {}

/// Verify `clean_text[ev.char_offset_start..ev.char_offset_end] == ev.source_snippet`.
///
/// Empty snippets are accepted (the unanchored "last-ditch affirmed
/// mention" path records `start = end = 0` with an empty snippet — that
/// is consistent with `clean_text[0..0] == ""`).
pub fn verify(ev: &ClinicalEvent, clean_text: &str) -> Result<(), SnippetIntegrityError> {
    let s = ev.char_offset_start;
    let e = ev.char_offset_end;
    if s > e {
        return Err(SnippetIntegrityError::Reversed { start: s, end: e });
    }
    if e > clean_text.len() {
        return Err(SnippetIntegrityError::OffsetOutOfRange {
            end: e,
            clean_text_len: clean_text.len(),
        });
    }
    if !clean_text.is_char_boundary(s) || !clean_text.is_char_boundary(e) {
        return Err(SnippetIntegrityError::NotCharBoundary { start: s, end: e });
    }
    let actual = &clean_text[s..e];
    if actual != ev.source_snippet {
        return Err(SnippetIntegrityError::SnippetMismatch {
            event_id: ev.event_id.clone(),
            expected_len: ev.source_snippet.len(),
            actual_len: actual.len(),
        });
    }
    Ok(())
}

/// Boolean form for `debug_assert!` call sites that want a single
/// expression. Returns `true` when [`verify`] returns `Ok(())`.
pub fn ok(ev: &ClinicalEvent, clean_text: &str) -> bool {
    verify(ev, clean_text).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{AssertionStatus, ClinicalEvent, EventType};

    fn ev(snippet: &str, start: usize, end: usize) -> ClinicalEvent {
        ClinicalEvent {
            event_id: "t#diagnosis#0".to_string(),
            event_type: EventType::Diagnosis,
            concept: "test".to_string(),
            raw_concept: "test".to_string(),
            date: None,
            date_precision: None,
            assertion_status: Some(AssertionStatus::Affirmed),
            source_document_id: "t".to_string(),
            source_section: None,
            source_snippet: snippet.to_string(),
            char_offset_start: start,
            char_offset_end: end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({}),
        }
    }

    #[test]
    fn exact_match_ok() {
        let text = "Diagnosis: PTSD.";
        let s = "Diagnosis: PTSD";
        let e = ev(s, 0, 15);
        assert!(verify(&e, text).is_ok());
    }

    #[test]
    fn empty_snippet_at_origin_ok() {
        let text = "anything";
        let e = ev("", 0, 0);
        assert!(verify(&e, text).is_ok());
    }

    #[test]
    fn offset_past_end_errors() {
        let text = "short";
        let e = ev("short", 0, 100);
        assert!(matches!(verify(&e, text), Err(SnippetIntegrityError::OffsetOutOfRange { .. })));
    }

    #[test]
    fn reversed_errors() {
        let text = "anything";
        let e = ev("anything", 5, 2);
        assert!(matches!(verify(&e, text), Err(SnippetIntegrityError::Reversed { .. })));
    }

    #[test]
    fn snippet_mismatch_errors() {
        let text = "Diagnosis: PTSD";
        let e = ev("MDD", 0, 3);
        assert!(matches!(verify(&e, text), Err(SnippetIntegrityError::SnippetMismatch { .. })));
    }

    #[test]
    fn utf8_char_boundary_violation_errors() {
        // "—" (em dash) is 3 bytes. Pointing into the middle should
        // surface NotCharBoundary, not a panic.
        let text = "a — b";
        let e = ev("?", 2, 3);
        assert!(matches!(verify(&e, text), Err(SnippetIntegrityError::NotCharBoundary { .. })));
    }
}
