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
];

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
            });
        }
    }

    out.sort_by(|a, b| {
        a.attribute
            .cmp(&b.attribute)
            .then(a.subject.cmp(&b.subject))
            .then(a.char_offset_start.cmp(&b.char_offset_start))
    });
    out
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
