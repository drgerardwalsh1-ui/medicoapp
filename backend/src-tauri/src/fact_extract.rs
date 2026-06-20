//! Deterministic fact extraction over `clean_text`.
//!
//! Table-driven, no ML, no regex crate — a fixed set of phrase rules maps known
//! surface forms to normalised `(subject, attribute, value, polarity)` facts.
//! Date-bearing attributes additionally capture a nearby normalised date.
//!
//! Determinism: rules are scanned in a fixed order; all occurrences are emitted;
//! the output is sorted by `(attribute, subject, char_offset_start)`. Matching is
//! ASCII-case-insensitive; offsets index the original text (ASCII assumption —
//! the medico-legal corpus is effectively ASCII; non-ASCII bytes only shift the
//! advisory provenance offsets, never correctness of the value).

#![allow(dead_code)]

use std::collections::BTreeMap;

use crate::fact_assertion::{fact_domain_of, FactAssertion, FactPolarity};

/// One surface-form rule. `needle` is matched case-insensitively; `value` is the
/// normalised value emitted; `temporal` requests a nearby-date capture.
struct Rule {
    subject: &'static str,
    attribute: &'static str,
    needle: &'static str,
    value: &'static str,
    polarity: FactPolarity,
    temporal: bool,
}

const A: FactPolarity = FactPolarity::Affirmed;
const N: FactPolarity = FactPolarity::Negated;

/// The rule corpus. Longer / more specific needles should precede shorter ones
/// for the same attribute so the specific form wins where they overlap (we emit
/// every match; de-duplication by value happens in the contradiction stage).
const RULES: &[Rule] = &[
    // ── marital_status (family) ───────────────────────────────────────────
    Rule { subject: "patient", attribute: "marital_status", needle: "divorced", value: "divorced", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "marital_status", needle: "separated", value: "separated", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "marital_status", needle: "widowed", value: "widowed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "marital_status", needle: "married", value: "married", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "marital_status", needle: "single", value: "single", polarity: A, temporal: false },

    // ── smoking_history (clinical) ────────────────────────────────────────
    Rule { subject: "patient", attribute: "smoking_history", needle: "never smoked", value: "never", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "smoking_history", needle: "non-smoker", value: "never", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "smoking_history", needle: "ex-smoker", value: "ex_smoker", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "smoking_history", needle: "former smoker", value: "ex_smoker", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "smoking_history", needle: "smoker", value: "smoker", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "smoking_history", needle: "smokes", value: "smoker", polarity: A, temporal: false },

    // ── alcohol_history (clinical) ────────────────────────────────────────
    Rule { subject: "patient", attribute: "alcohol_history", needle: "does not drink", value: "none", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "alcohol_history", needle: "non-drinker", value: "none", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "alcohol_history", needle: "teetotal", value: "none", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "alcohol_history", needle: "drinks heavily", value: "heavy", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "alcohol_history", needle: "heavy drinker", value: "heavy", polarity: A, temporal: false },

    // ── driving_ability (clinical) ────────────────────────────────────────
    Rule { subject: "patient", attribute: "driving_ability", needle: "unable to drive", value: "cannot_drive", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "cannot drive", value: "cannot_drive", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "no longer drives", value: "cannot_drive", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "stopped driving", value: "cannot_drive", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "drives independently", value: "drives", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "able to drive", value: "drives", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "driving_ability", needle: "continues to drive", value: "drives", polarity: A, temporal: false },

    // ── functional_status (clinical) ──────────────────────────────────────
    Rule { subject: "patient", attribute: "functional_status", needle: "requires assistance", value: "dependent", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "functional_status", needle: "needs help with", value: "dependent", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "functional_status", needle: "fully independent", value: "independent", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "functional_status", needle: "independent in all activities", value: "independent", polarity: A, temporal: false },

    // ── father / mother / spouse vital status (family) ────────────────────
    Rule { subject: "father", attribute: "father_vital_status", needle: "father is deceased", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father deceased", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father died", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father passed away", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "late father", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father is alive", value: "alive", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father is well", value: "alive", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father is living", value: "alive", polarity: A, temporal: false },

    Rule { subject: "mother", attribute: "mother_vital_status", needle: "mother is deceased", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "mother", attribute: "mother_vital_status", needle: "mother died", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "mother", attribute: "mother_vital_status", needle: "late mother", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "mother", attribute: "mother_vital_status", needle: "mother is alive", value: "alive", polarity: A, temporal: false },
    Rule { subject: "mother", attribute: "mother_vital_status", needle: "mother is well", value: "alive", polarity: A, temporal: false },

    Rule { subject: "spouse", attribute: "spouse_vital_status", needle: "widowed", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "spouse", attribute: "spouse_vital_status", needle: "spouse died", value: "deceased", polarity: A, temporal: false },

    // ── work_status (clinical, temporal) ──────────────────────────────────
    Rule { subject: "patient", attribute: "work_status", needle: "ceased work", value: "ceased", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "stopped working", value: "ceased", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "unable to work", value: "ceased", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "off work", value: "ceased", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "worked until", value: "working", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "continued working", value: "working", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "remained at work", value: "working", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "work_status", needle: "still working", value: "working", polarity: A, temporal: true },

    // ── return_to_work (clinical, temporal) ───────────────────────────────
    Rule { subject: "patient", attribute: "return_to_work", needle: "has not returned to work", value: "not_returned", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "return_to_work", needle: "not returned to work", value: "not_returned", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "return_to_work", needle: "returned to work", value: "returned", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "return_to_work", needle: "return to work", value: "returned", polarity: A, temporal: true },

    // ── injury_date (clinical, temporal) ──────────────────────────────────
    Rule { subject: "patient", attribute: "injury_date", needle: "date of injury", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "injury date", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "injured on", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "injury occurred on", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "accident occurred on", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "date of accident", value: "", polarity: A, temporal: true },
    Rule { subject: "patient", attribute: "injury_date", needle: "injury at work on", value: "", polarity: A, temporal: true },

    // ── marital_status — periphrastic forms (Emma audit recall fixes) ──────
    Rule { subject: "patient", attribute: "marital_status", needle: "lives with her husband", value: "married", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "marital_status", needle: "lives with his wife", value: "married", polarity: A, temporal: false },

    // ── smoking_history — "N-year smoking history" (digit-guarded needle) ──
    Rule { subject: "patient", attribute: "smoking_history", needle: "smoking history", value: "smoker", polarity: A, temporal: false },

    // ── father_vital_status — reported/indirect forms ───────────────────────
    Rule { subject: "father", attribute: "father_vital_status", needle: "father is described as deceased", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father as deceased", value: "deceased", polarity: A, temporal: false },
    Rule { subject: "father", attribute: "father_vital_status", needle: "father as alive", value: "alive", polarity: A, temporal: false },

    // ── ptsd_status (clinical) — diagnosis vs criteria-not-met ─────────────
    Rule { subject: "patient", attribute: "ptsd_status", needle: "diagnosed post-traumatic stress disorder", value: "diagnosed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "ptsd_status", needle: "diagnosis of post-traumatic stress disorder", value: "diagnosed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "ptsd_status", needle: "diagnosed ptsd", value: "diagnosed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "ptsd_status", needle: "criteria for ptsd were not met", value: "not_met", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "ptsd_status", needle: "criteria for post-traumatic stress disorder were not met", value: "not_met", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "ptsd_status", needle: "does not meet criteria for ptsd", value: "not_met", polarity: N, temporal: false },

    // ── opioid_use (clinical) — denial vs dispensing evidence ──────────────
    Rule { subject: "patient", attribute: "opioid_use", needle: "denied taking opioid", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "opioid_use", needle: "denies taking opioid", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "opioid_use", needle: "denies opioid", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "opioid_use", needle: "dispensing of oxycodone", value: "dispensed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "opioid_use", needle: "prescribed oxycodone", value: "dispensed", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "opioid_use", needle: "oxycodone dispensed", value: "dispensed", polarity: A, temporal: false },

    // ── children_count (family) ─────────────────────────────────────────────
    Rule { subject: "patient", attribute: "children_count", needle: "one child", value: "1", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "children_count", needle: "two children", value: "2", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "children_count", needle: "three dependent children", value: "3", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "children_count", needle: "three children", value: "3", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "children_count", needle: "four children", value: "4", polarity: A, temporal: false },

    // ── sibling_count (family) — compound forms FIRST; no bare "two brothers"
    //    needle, so the compound phrase cannot double-fire. ───────────────────
    Rule { subject: "patient", attribute: "sibling_count", needle: "two brothers and one sister", value: "2_brothers_1_sister", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sibling_count", needle: "one brother and one sister", value: "1_brother_1_sister", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sibling_count", needle: "has one brother", value: "1_brother", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sibling_count", needle: "has one sister", value: "1_sister", polarity: A, temporal: false },

    // ── sleep_hours (clinical) ──────────────────────────────────────────────
    Rule { subject: "patient", attribute: "sleep_hours", needle: "three hours per night", value: "3", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sleep_hours", needle: "four hours per night", value: "4", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sleep_hours", needle: "five hours per night", value: "5", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sleep_hours", needle: "seven to eight hours per night", value: "7-8", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "sleep_hours", needle: "eight hours per night", value: "8", polarity: A, temporal: false },

    // ── mobility (functional) — aid dependence vs unaided observation ──────
    Rule { subject: "patient", attribute: "mobility", needle: "requires a walking stick", value: "aided", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "mobility", needle: "uses a walking stick", value: "aided", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "mobility", needle: "requires a walking frame", value: "aided", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "mobility", needle: "walking unassisted", value: "unassisted", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "mobility", needle: "walks unassisted", value: "unassisted", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "mobility", needle: "mobilising independently", value: "unassisted", polarity: A, temporal: false },

    // ── cognition_status (clinical) ─────────────────────────────────────────
    Rule { subject: "patient", attribute: "cognition_status", needle: "significant cognitive deficits", value: "impaired", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "cognition_status", needle: "severe memory impairment", value: "impaired", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "cognition_status", needle: "cognitive functioning was within normal limits", value: "normal", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "cognition_status", needle: "cognition within normal limits", value: "normal", polarity: A, temporal: false },

    // ── prior_back_history (clinical) — denial vs documented history ───────
    Rule { subject: "patient", attribute: "prior_back_history", needle: "denies any prior history of lower back", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "prior_back_history", needle: "no prior history of lower back", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "prior_back_history", needle: "no previous back problems", value: "denied", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "prior_back_history", needle: "recurrent lower back pain", value: "documented", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "prior_back_history", needle: "previous episodes of back pain", value: "documented", polarity: A, temporal: false },

    // ── lumbar_disc_prolapse (clinical) — imaging dispute ───────────────────
    Rule { subject: "patient", attribute: "lumbar_disc_prolapse", needle: "diagnosed a lumbar disc prolapse", value: "present", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "lumbar_disc_prolapse", needle: "lumbar disc prolapse confirmed", value: "present", polarity: A, temporal: false },
    Rule { subject: "patient", attribute: "lumbar_disc_prolapse", needle: "no disc prolapse", value: "absent", polarity: N, temporal: false },
    Rule { subject: "patient", attribute: "lumbar_disc_prolapse", needle: "no evidence of disc prolapse", value: "absent", polarity: N, temporal: false },
];

/// Needles that fire only when a digit occurs within a few characters before
/// the match (e.g. "a 20-year smoking history", but NOT the bare heading
/// "Smoking history is inconsistent"). Deterministic context guard.
const DIGIT_GUARDED_NEEDLES: &[&str] = &["smoking history"];

/// True iff any ASCII digit occurs within `window` bytes before `start`.
fn digit_before(lower: &str, start: usize, window: usize) -> bool {
    let from = start.saturating_sub(window);
    lower.as_bytes()[from..start].iter().any(|b| b.is_ascii_digit())
}

const MONTHS: &[(&str, u8)] = &[
    ("january", 1), ("february", 2), ("march", 3), ("april", 4), ("may", 5), ("june", 6),
    ("july", 7), ("august", 8), ("september", 9), ("october", 10), ("november", 11), ("december", 12),
    ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4), ("jun", 6), ("jul", 7), ("aug", 8),
    ("sep", 9), ("sept", 9), ("oct", 10), ("nov", 11), ("dec", 12),
];

/// Extract structured facts from `clean_text`. `doc_id` is recorded as the
/// provenance source. Deterministic; order = (attribute, subject, offset).
pub fn extract_facts(clean_text: &str, doc_id: &str) -> Vec<FactAssertion> {
    let lower = clean_text.to_ascii_lowercase();
    let mut out: Vec<FactAssertion> = Vec::new();

    for rule in RULES {
        let mut from = 0usize;
        while let Some(rel) = lower[from..].find(rule.needle) {
            let start = from + rel;
            let end = start + rule.needle.len();
            from = end;

            // Word-boundary guard: reject matches embedded in a larger token so
            // e.g. "smoker" does not fire inside "non-smoker", nor "married"
            // inside "unmarried", nor "able to drive" inside "unable to drive".
            if !boundary_ok(&lower, start, end) {
                continue;
            }

            // Digit-context guard (e.g. "20-year smoking history" yes,
            // section heading "Smoking history is inconsistent" no).
            if DIGIT_GUARDED_NEEDLES.contains(&rule.needle)
                && !digit_before(&lower, start, 10)
            {
                continue;
            }

            // Date-bearing rules: capture the first date in a forward window.
            let temporal = if rule.temporal {
                find_date_after(&lower, end, 48)
            } else {
                None
            };

            // For injury_date / temporal-only date facts the rule `value` is
            // empty — the captured date IS the value. Skip if no date found.
            let value = if rule.value.is_empty() {
                match &temporal {
                    Some(d) => d.clone(),
                    None => continue,
                }
            } else {
                rule.value.to_string()
            };

            let raw_text = clean_text.get(start..end).unwrap_or(rule.needle).to_string();
            out.push(FactAssertion {
                subject: rule.subject.to_string(),
                attribute: rule.attribute.to_string(),
                fact_domain: fact_domain_of(rule.attribute),
                value,
                polarity: rule.polarity,
                temporal,
                source_ids: vec![doc_id.to_string()],
                char_offset_start: start,
                char_offset_end: end,
                raw_text,
                sentence: sentence_around(clean_text, start, end),
            });
        }
    }

    let mut out = normalise_evidence_spans(out);

    out.sort_by(|a, b| {
        a.attribute
            .cmp(&b.attribute)
            .then(a.subject.cmp(&b.subject))
            .then(a.char_offset_start.cmp(&b.char_offset_start))
    });
    out
}

/// Deterministic evidence normalisation: ONE textual span contributes AT MOST
/// ONE value per attribute. Within each attribute, matches are ordered by
/// (span length DESC, start ASC, value ASC) and accepted greedily; a match is
/// dropped when its span is contained within (or identical to) an already
/// accepted span. Longer (more specific) surface forms therefore win — e.g.
/// "seven to eight hours per night" suppresses the nested "eight hours per
/// night", and "has not returned to work" suppresses both nested needles
/// (including the polarity-flipping "returned to work"). Partial overlaps and
/// genuinely distinct spans are NEVER removed. Generic across all attribute
/// families; fully deterministic (BTreeMap grouping, total ordering).
fn normalise_evidence_spans(facts: Vec<FactAssertion>) -> Vec<FactAssertion> {
    let mut by_attr: BTreeMap<String, Vec<FactAssertion>> = BTreeMap::new();
    for f in facts {
        by_attr.entry(f.attribute.clone()).or_default().push(f);
    }

    let mut kept: Vec<FactAssertion> = Vec::new();
    for (_, mut group) in by_attr {
        group.sort_by(|a, b| {
            let la = a.char_offset_end - a.char_offset_start;
            let lb = b.char_offset_end - b.char_offset_start;
            lb.cmp(&la)
                .then(a.char_offset_start.cmp(&b.char_offset_start))
                .then(a.value.cmp(&b.value))
        });
        let mut accepted_spans: Vec<(usize, usize)> = Vec::new();
        for f in group {
            let contained = accepted_spans
                .iter()
                .any(|&(s, e)| s <= f.char_offset_start && f.char_offset_end <= e);
            if contained {
                continue;
            }
            accepted_spans.push((f.char_offset_start, f.char_offset_end));
            kept.push(f);
        }
    }
    kept
}

/// The full sentence containing `[start, end)` — sentence-level provenance.
/// Bounds are the nearest `.`/newline before `start` and the next `.`/newline
/// at/after `end` (inclusive of the closing `.`). Deterministic, byte-based
/// (ASCII corpus assumption shared with the offset model above).
fn sentence_around(text: &str, start: usize, end: usize) -> String {
    let bytes = text.as_bytes();
    let mut s = start.min(bytes.len());
    while s > 0 && bytes[s - 1] != b'.' && bytes[s - 1] != b'\n' {
        s -= 1;
    }
    let mut e = end.min(bytes.len());
    while e < bytes.len() && bytes[e] != b'.' && bytes[e] != b'\n' {
        e += 1;
    }
    if e < bytes.len() && bytes[e] == b'.' {
        e += 1; // keep the terminating full stop
    }
    text.get(s..e).unwrap_or("").trim().to_string()
}

/// A token character for word-boundary purposes: ASCII alphanumeric or `-`
/// (so hyphenated tokens like `non-smoker` are treated as one word).
fn is_word_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-'
}

/// True iff `[start, end)` is not embedded inside a larger token.
fn boundary_ok(lower: &str, start: usize, end: usize) -> bool {
    let b = lower.as_bytes();
    let left_ok = start == 0 || !is_word_char(b[start - 1]);
    let right_ok = end >= b.len() || !is_word_char(b[end]);
    left_ok && right_ok
}

/// Crate-internal reuse hook: find the first ISO-ish date anywhere in an
/// already-lowercased slice. Used by the structured-fact extractor so date
/// parsing has a single implementation. Additive; does not change extraction.
pub(crate) fn first_date_in_lower(lower_slice: &str) -> Option<String> {
    find_date_after(lower_slice, 0, lower_slice.len())
}

/// Find the first date in `lower[from .. from+window]`. Recognises
/// `D Mon YYYY`, `Mon YYYY`, `D/M/YYYY`, `YYYY-MM-DD`. Returns ISO-ish
/// (`YYYY-MM-DD` or `YYYY-MM`).
fn find_date_after(lower: &str, from: usize, window: usize) -> Option<String> {
    let end = (from + window).min(lower.len());
    let slice = lower.get(from..end)?;

    // 1. Month-name forms: optional day, month word, 4-digit year.
    for (name, num) in MONTHS {
        if let Some(mpos) = slice.find(name) {
            // year: first 4-digit run after the month word
            let after = &slice[mpos + name.len()..];
            if let Some(year) = first_year(after) {
                // day: trailing 1-2 digits immediately before the month word
                let before = slice[..mpos].trim_end();
                let day = trailing_day(before);
                return Some(match day {
                    Some(d) => format!("{year:04}-{num:02}-{d:02}"),
                    None => format!("{year:04}-{num:02}"),
                });
            }
        }
    }

    // 2. Numeric D/M/YYYY or YYYY-MM-DD.
    if let Some(iso) = numeric_date(slice) {
        return Some(iso);
    }
    None
}

fn first_year(s: &str) -> Option<u32> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if bytes[i].is_ascii_digit() {
            let run: String = bytes[i..]
                .iter()
                .take_while(|b| b.is_ascii_digit())
                .map(|b| *b as char)
                .collect();
            if run.len() == 4 {
                if let Ok(y) = run.parse::<u32>() {
                    if (1900..=2100).contains(&y) {
                        return Some(y);
                    }
                }
            }
            i += run.len();
        } else {
            i += 1;
        }
    }
    None
}

fn trailing_day(s: &str) -> Option<u8> {
    let digits: String = s
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if digits.is_empty() || digits.len() > 2 {
        return None;
    }
    digits.parse::<u8>().ok().filter(|d| (1..=31).contains(d))
}

fn numeric_date(slice: &str) -> Option<String> {
    // YYYY-MM-DD
    let bytes = slice.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i].is_ascii_digit() {
            let rest = &slice[i..];
            // ISO YYYY-MM-DD
            if rest.len() >= 10
                && rest.as_bytes()[4] == b'-'
                && rest.as_bytes()[7] == b'-'
                && rest[..4].bytes().all(|b| b.is_ascii_digit())
                && rest[5..7].bytes().all(|b| b.is_ascii_digit())
                && rest[8..10].bytes().all(|b| b.is_ascii_digit())
            {
                return Some(rest[..10].to_string());
            }
            // D/M/YYYY or DD/MM/YYYY
            if let Some(d) = slash_date(rest) {
                return Some(d);
            }
            break;
        }
    }
    None
}

fn slash_date(s: &str) -> Option<String> {
    let parts: Vec<&str> = s
        .split(|c: char| c == '/' || c == '.')
        .take(3)
        .collect();
    if parts.len() < 3 {
        return None;
    }
    let day: u8 = parts[0].trim().parse().ok()?;
    let month: u8 = parts[1].trim().parse().ok()?;
    // year may have trailing non-digits
    let yr: String = parts[2].chars().take_while(|c| c.is_ascii_digit()).collect();
    let year: u32 = yr.parse().ok()?;
    if (1..=31).contains(&day) && (1..=12).contains(&month) && (1900..=2100).contains(&year) {
        Some(format!("{year:04}-{month:02}-{day:02}"))
    } else {
        None
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn values_for(facts: &[FactAssertion], attribute: &str) -> Vec<String> {
        let mut v: Vec<String> = facts
            .iter()
            .filter(|f| f.attribute == attribute)
            .map(|f| f.value.clone())
            .collect();
        v.sort();
        v.dedup();
        v
    }

    #[test]
    fn extracts_marital_status_both_sides() {
        let t = "The patient is divorced. Elsewhere the report says she is married.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "marital_status"), vec!["divorced", "married"]);
    }

    #[test]
    fn extracts_smoking_both_sides() {
        let t = "She has never smoked. A later note records a 20-year smoker history.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "smoking_history"), vec!["never", "smoker"]);
    }

    #[test]
    fn extracts_father_vital_status_both_sides() {
        let t = "Her father is deceased. The GP letter states the father is alive.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "father_vital_status"), vec!["alive", "deceased"]);
    }

    #[test]
    fn extracts_driving_both_sides() {
        let t = "He cannot drive following the accident, yet he drives independently to work.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "driving_ability"), vec!["cannot_drive", "drives"]);
    }

    #[test]
    fn extracts_injury_dates_as_values() {
        let t = "Injury date 12 Feb 2022 was recorded. Another form gives injury date 18 Feb 2022.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "injury_date"), vec!["2022-02-12", "2022-02-18"]);
    }

    #[test]
    fn extracts_work_status_both_sides_with_temporal() {
        let t = "He ceased work Feb 2022. However he worked until Nov 2022 per payroll.";
        let f = extract_facts(t, "docA");
        assert_eq!(values_for(&f, "work_status"), vec!["ceased", "working"]);
        // temporal markers captured
        let ceased = f.iter().find(|x| x.value == "ceased").unwrap();
        assert_eq!(ceased.temporal.as_deref(), Some("2022-02"));
        let working = f.iter().find(|x| x.value == "working").unwrap();
        assert_eq!(working.temporal.as_deref(), Some("2022-11"));
    }

    #[test]
    fn deterministic_and_provenance_carried() {
        let t = "The patient is divorced.";
        let a = extract_facts(t, "docA");
        let b = extract_facts(t, "docA");
        assert_eq!(a, b);
        assert_eq!(a[0].source_ids, vec!["docA".to_string()]);
        assert!(a[0].char_offset_end > a[0].char_offset_start);
        assert_eq!(a[0].raw_text.to_lowercase(), "divorced");
    }

    #[test]
    fn no_facts_when_absent() {
        let t = "The MRI showed a fractured wrist and the patient reported fatigue.";
        let f = extract_facts(t, "docA");
        // None of the fact attributes should fire on a purely clinical sentence.
        assert!(f.is_empty(), "unexpected facts: {f:?}");
    }
}

#[cfg(test)]
mod evidence_normalisation_tests {
    use super::*;

    fn vals(facts: &[FactAssertion], attribute: &str) -> Vec<String> {
        let mut v: Vec<String> = facts
            .iter()
            .filter(|f| f.attribute == attribute)
            .map(|f| f.value.clone())
            .collect();
        v.sort();
        v
    }

    // sleep_hours: "seven to eight hours per night" fully contains "eight
    // hours per night" — exactly ONE value must survive (the longer span).
    #[test]
    fn nested_sleep_span_yields_one_value() {
        let f = extract_facts("She sleeps seven to eight hours per night with medication.", "d");
        assert_eq!(vals(&f, "sleep_hours"), vec!["7-8"]);
    }

    // …while genuinely distinct spans for the same attribute BOTH survive.
    #[test]
    fn distinct_sleep_spans_both_survive() {
        let f = extract_facts(
            "She reports three hours per night. Another record notes seven to eight hours per night.",
            "d",
        );
        assert_eq!(vals(&f, "sleep_hours"), vec!["3", "7-8"]);
    }

    // return_to_work triple nesting: "has not returned to work" contains
    // "not returned to work" AND the polarity-flipping "returned to work".
    // One sentence must yield ONE observation, never a self-contradiction.
    #[test]
    fn nested_return_to_work_yields_one_observation() {
        let f = extract_facts("She has not returned to work since the incident.", "d");
        let rtw: Vec<&FactAssertion> =
            f.iter().filter(|x| x.attribute == "return_to_work").collect();
        assert_eq!(rtw.len(), 1, "exactly one observation, got {rtw:?}");
        assert_eq!(rtw[0].value, "not_returned");
    }

    // smoking_history: digit-guarded "smoking history" + "never smoked" at
    // distinct spans → two values (a real contradiction), no nested double-fire.
    #[test]
    fn smoking_patterns_distinct_spans_survive() {
        let f = extract_facts(
            "One GP record states she has never smoked. Another notes a 20-year smoking history.",
            "d",
        );
        assert_eq!(vals(&f, "smoking_history"), vec!["never", "smoker"]);
        // Heading form without a digit context must not fire at all.
        let g = extract_facts("Smoking history is inconsistent.", "d");
        assert!(vals(&g, "smoking_history").is_empty());
    }

    // marital_status: periphrastic and direct forms at distinct spans coexist;
    // each span contributes exactly one observation.
    #[test]
    fn marital_patterns_one_observation_per_span() {
        let f = extract_facts(
            "Several records describe Emma as divorced. She lives with her husband and two children.",
            "d",
        );
        let marital: Vec<&FactAssertion> =
            f.iter().filter(|x| x.attribute == "marital_status").collect();
        assert_eq!(marital.len(), 2);
        assert_eq!(vals(&f, "marital_status"), vec!["divorced", "married"]);
    }

    // Future-pattern guarantee: identical spans (two rules matching the exact
    // same bytes for one attribute) collapse to a single deterministic winner,
    // and the normalisation is order-independent (deterministic re-run).
    #[test]
    fn normalisation_is_deterministic() {
        let text = "She has not returned to work. She sleeps seven to eight hours per night.";
        let a = extract_facts(text, "d");
        let b = extract_facts(text, "d");
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        // No two surviving facts of the same attribute may have nested spans.
        for x in &a {
            for y in &a {
                if x.attribute == y.attribute
                    && (x.char_offset_start, x.char_offset_end)
                        != (y.char_offset_start, y.char_offset_end)
                {
                    let nested = x.char_offset_start <= y.char_offset_start
                        && y.char_offset_end <= x.char_offset_end;
                    assert!(!nested, "nested spans survived: {x:?} ⊃ {y:?}");
                }
            }
        }
    }
}
