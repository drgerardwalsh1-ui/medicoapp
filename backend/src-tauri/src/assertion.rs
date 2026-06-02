//! Assertion / status classifier.
//!
//! Given the clean text and an entity mention, classify how it is being
//! asserted in the surrounding sentence:
//!
//!   AssertionStatus::Affirmed       — "Diagnosis: PTSD"
//!   AssertionStatus::Queried        — "? PTSD", "query PTSD"
//!   AssertionStatus::Negated        — "no PTSD", "denies PTSD"
//!   AssertionStatus::Contradicted   — "presentation inconsistent with PTSD"
//!   AssertionStatus::Differential   — "PTSD vs depression"
//!   AssertionStatus::SymptomOnly    — "reports anxiety" (symptom verb, no
//!                                     diagnostic framing)
//!   AssertionStatus::Historical     — "history of PTSD", "previous diagnosis"
//!
//! Operates purely on cleaned text. Rule-based and fully deterministic.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionStatus {
    Affirmed,
    Queried,
    Negated,
    Contradicted,
    Differential,
    SymptomOnly,
    Historical,
}

impl AssertionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AssertionStatus::Affirmed => "affirmed",
            AssertionStatus::Queried => "queried",
            AssertionStatus::Negated => "negated",
            AssertionStatus::Contradicted => "contradicted",
            AssertionStatus::Differential => "differential",
            AssertionStatus::SymptomOnly => "symptom_only",
            AssertionStatus::Historical => "historical",
        }
    }
}

/// A condition/diagnosis mention with assertion context.
#[derive(Debug, Clone, Serialize)]
pub struct ConditionMention {
    pub term: String,
    pub status: AssertionStatus,
    /// Up to ~200 chars of surrounding sentence — the evidence the
    /// classifier used.
    pub snippet: String,
    /// Byte offset of the start of `snippet` in the `clean_text` argument
    /// passed to the classifier. Invariant:
    /// `clean_text[start..end] == snippet`.
    pub start: usize,
    /// Byte offset just past the end of `snippet` in `clean_text`.
    pub end: usize,
}

/// Classify one mention given the full clean text.
///
/// Strategy:
///   1. Find the sentence (delimited by `.`, `!`, `?`, `;`, newline) that
///      contains the mention.
///   2. Inspect a small lexicon of cues around the term:
///        question marks before the term  → Queried
///        "inconsistent with", "rules out" → Contradicted
///        "denies", "no", "without"       → Negated
///        "vs", "versus", "differential"   → Differential
///        "history of", "previous", "past" → Historical
///        diagnosis verbs / labels         → Affirmed
///        symptom verbs ("reports", "c/o") → SymptomOnly
///   3. Default to Affirmed when none fire AND the term is in a
///      diagnosis-like construction; default SymptomOnly otherwise.
#[allow(dead_code)] // Public API kept for callers (and unit tests).
pub fn classify_mention(
    clean_text: &str,
    term: &str,
    treat_as_symptom_by_default: bool,
) -> Option<ConditionMention> {
    classify_mention_at(clean_text, term, 0, treat_as_symptom_by_default)
        .map(|(m, _)| m)
}

/// Find ALL occurrences of `term` in `clean_text` and classify each one
/// independently. Useful when a single canonical condition (e.g. PTSD)
/// is mentioned multiple times with different statuses — affirmed by
/// one clinician, contradicted by another.
pub fn classify_all_mentions(
    clean_text: &str,
    term: &str,
    treat_as_symptom_by_default: bool,
) -> Vec<ConditionMention> {
    let mut out = Vec::new();
    let mut from = 0usize;
    while let Some((m, next)) =
        classify_mention_at(clean_text, term, from, treat_as_symptom_by_default)
    {
        out.push(m);
        if next <= from {
            from += 1;
        } else {
            from = next;
        }
    }
    out
}

/// Classify the first occurrence of `term` at byte offset ≥ `from`. Returns
/// the classified mention plus the byte offset just past the matched span,
/// so callers can iterate without re-finding the same hit.
fn classify_mention_at(
    clean_text: &str,
    term: &str,
    from: usize,
    treat_as_symptom_by_default: bool,
) -> Option<(ConditionMention, usize)> {
    let lower_full = clean_text.to_lowercase();
    let lower_term = term.to_lowercase();
    if from >= lower_full.len() {
        return None;
    }
    let rel = lower_full[from..].find(&lower_term)?;
    let pos = from + rel;
    let next = pos + lower_term.len();
    let m = classify_at_position(clean_text, &lower_full, &lower_term, pos, term, treat_as_symptom_by_default);
    Some((m, next))
}

fn classify_at_position(
    clean_text: &str,
    lower_full: &str,
    lower_term: &str,
    pos: usize,
    original_term: &str,
    treat_as_symptom_by_default: bool,
) -> ConditionMention {
    let term = original_term;
    let (sentence, sentence_start, sentence_end) = sentence_around(clean_text, pos);
    let sentence_lower = sentence.to_lowercase();
    let pre = char_window_before(lower_full, pos, 32);

    if pre.contains('?') || pre.contains("query") || pre.contains("queried") {
        return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Queried);
    }
    for cue in DIFFERENTIAL_CUES {
        if sentence_lower.contains(cue) {
            return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Differential);
        }
    }
    for cue in CONTRADICTION_CUES {
        if pre.contains(cue)
            || sentence_lower.contains(cue) && cue_before_term(&sentence_lower, cue, lower_term)
        {
            return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Contradicted);
        }
    }
    for cue in NEGATION_CUES {
        if pre.ends_with(cue)
            || pre.contains(&format!("{cue} "))
            || pre.contains(&format!("{cue},"))
        {
            return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Negated);
        }
    }
    for cue in HISTORICAL_CUES {
        if sentence_lower.contains(cue) {
            return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Historical);
        }
    }
    let has_dx_label = DIAGNOSIS_LABELS.iter().any(|l| sentence_lower.contains(l));
    if !has_dx_label {
        for cue in SYMPTOM_VERBS {
            if sentence_lower.contains(cue) {
                return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::SymptomOnly);
            }
        }
    }
    if has_dx_label {
        return mk(term, sentence, sentence_start, sentence_end, AssertionStatus::Affirmed);
    }
    let status = if treat_as_symptom_by_default {
        AssertionStatus::SymptomOnly
    } else {
        AssertionStatus::Affirmed
    };
    mk(term, sentence, sentence_start, sentence_end, status)
}

fn mk(
    term: &str,
    snippet: String,
    start: usize,
    end: usize,
    status: AssertionStatus,
) -> ConditionMention {
    ConditionMention {
        term: term.to_string(),
        status,
        snippet,
        start,
        end,
    }
}

/// Return up to `n` *chars* before byte position `pos` in `text`. Always
/// lands on char boundaries so the returned `&str` is valid even when
/// the input contains multi-byte characters.
fn char_window_before(text: &str, pos: usize, n: usize) -> &str {
    // Walk backwards from `pos` over up to `n` chars.
    let mut taken = 0;
    let mut start = pos;
    while start > 0 && taken < n {
        // Step back to the previous char boundary.
        let mut j = start - 1;
        while j > 0 && !text.is_char_boundary(j) {
            j -= 1;
        }
        start = j;
        taken += 1;
    }
    &text[start..pos]
}

fn cue_before_term(sentence_lower: &str, cue: &str, term_lower: &str) -> bool {
    if let (Some(p_cue), Some(p_term)) = (sentence_lower.find(cue), sentence_lower.find(term_lower))
    {
        p_cue < p_term
    } else {
        false
    }
}

/// Find the sentence that contains byte offset `pos`. Delimited by ., !, ?, ;
/// or newline. Returns `(snippet, start, end)` where the snippet is the
/// literal substring `text[start..end]`, with leading/trailing ASCII
/// whitespace trimmed and capped at 220 characters. The byte-equality
/// invariant — `&text[start..end] == &snippet` — is required by the
/// medico-legal persistence boundary's snippet-integrity check.
fn sentence_around(text: &str, pos: usize) -> (String, usize, usize) {
    let bytes = text.as_bytes();
    let is_delim = |b: u8| matches!(b, b'.' | b'!' | b'?' | b';' | b'\n');
    let mut start = pos;
    while start > 0 && !is_delim(bytes[start - 1]) {
        start -= 1;
    }
    let mut end = pos;
    while end < bytes.len() && !is_delim(bytes[end]) {
        end += 1;
    }
    // Trim leading/trailing whitespace bytes WITHIN the [start, end]
    // window. Both leading and trailing whitespace in cleaned text is
    // ASCII so byte-stepping is safe and lands on char boundaries.
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    // Cap at 220 chars (chars, not bytes — preserves UTF-8 boundaries).
    let raw_slice = &text[start..end];
    if raw_slice.chars().count() <= 220 {
        return (raw_slice.to_string(), start, end);
    }
    // Find the byte offset of the 221st character — that's where we cut.
    let cut = raw_slice
        .char_indices()
        .nth(220)
        .map(|(i, _)| i)
        .unwrap_or(raw_slice.len());
    let new_end = start + cut;
    (text[start..new_end].to_string(), start, new_end)
}

const DIFFERENTIAL_CUES: &[&str] = &[
    " vs ", " vs. ", " versus ", "differential diagnosis", "ddx",
];

const CONTRADICTION_CUES: &[&str] = &[
    "inconsistent with",
    "not consistent with",
    "ruled out",
    "rules out",
    "rule out",
    "does not meet criteria for",
    "does not meet the criteria for",
];

const NEGATION_CUES: &[&str] = &[
    "no", "denies", "denied", "without", "negative for", "absent",
];

const HISTORICAL_CUES: &[&str] = &[
    "history of", "previous diagnosis", "past diagnosis", "previously diagnosed",
    "past history", "h/o",
];

const SYMPTOM_VERBS: &[&str] = &[
    "reports", "describes", "complains of", "c/o", "presents with",
    "endorses", "experiences", "experiencing",
];

/// Lexical markers that strongly indicate a diagnostic assertion, irrespective
/// of the term itself. Used to upgrade SymptomOnly to Affirmed when present.
const DIAGNOSIS_LABELS: &[&str] = &[
    "diagnosis:", "diagnosis of", "diagnoses:", "dx:", "dx of",
    "impression:", "impression of",
    "axis i:", "axis ii:",
    "consistent with a diagnosis", "meets criteria for",
    "confirmed diagnosis",
];

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn st(text: &str, term: &str) -> AssertionStatus {
        classify_mention(text, term, false).unwrap().status
    }

    #[test]
    fn queried_with_question_prefix() {
        assert_eq!(st("Impression — ? PTSD", "ptsd"), AssertionStatus::Queried);
        assert_eq!(st("? depn worsening", "depn"), AssertionStatus::Queried);
    }

    #[test]
    fn differential_vs() {
        assert_eq!(st("PTSD vs depression", "ptsd"), AssertionStatus::Differential);
        assert_eq!(st("PTSD vs depression", "depression"), AssertionStatus::Differential);
    }

    #[test]
    fn contradicted_inconsistent_with() {
        assert_eq!(
            st("Presentation inconsistent with PTSD.", "ptsd"),
            AssertionStatus::Contradicted
        );
    }

    #[test]
    fn negated_no_denies() {
        assert_eq!(st("no PTSD identified.", "ptsd"), AssertionStatus::Negated);
        assert_eq!(st("Patient denies PTSD.", "ptsd"), AssertionStatus::Negated);
    }

    #[test]
    fn affirmed_diagnosis_label() {
        assert_eq!(
            st("Diagnosis: major depressive disorder.", "major depressive disorder"),
            AssertionStatus::Affirmed
        );
    }

    #[test]
    fn symptom_only_for_symptom_verb_without_diagnosis_framing() {
        // "anxiety" with "reports" → symptom_only
        assert_eq!(st("She reports anxiety and poor sleep.", "anxiety"), AssertionStatus::SymptomOnly);
    }

    #[test]
    fn symptom_term_upgraded_when_explicit_diagnosis_present() {
        // "Diagnosis: anxiety disorder" → Affirmed
        let s = "Diagnosis: anxiety disorder.";
        assert_eq!(st(s, "anxiety disorder"), AssertionStatus::Affirmed);
    }

    #[test]
    fn historical_marker() {
        assert_eq!(
            st("History of PTSD as a child.", "ptsd"),
            AssertionStatus::Historical
        );
    }

    #[test]
    fn missing_term_returns_none() {
        assert!(classify_mention("nothing relevant here", "ptsd", false).is_none());
    }
}
