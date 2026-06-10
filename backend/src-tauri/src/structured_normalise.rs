//! Normalisation helpers for the structured fact layer.
//!
//! Pure, deterministic, table-driven canonicalisers that map medico-legal
//! surface forms to the typed values in [`crate::structured_fact`]. No ML, no
//! regex crate, ASCII-case-insensitive. Each function PRESERVES UNCERTAINTY:
//! when the input does not clearly map, it returns the `Unknown` variant or
//! `None`, never a forced guess.

#![allow(dead_code)]

use crate::structured_fact::{
    Effectiveness, FunctionalArea, MedicationStatus, Progression, Severity, Trend, TreatmentStatus,
};

/// Lower-case + trim helper used by every matcher.
fn norm(s: &str) -> String {
    s.to_ascii_lowercase().trim().to_string()
}

/// Canonical dosage string, e.g. "20MG" → "20 mg", "5 mg" → "5 mg".
/// Returns `None` when no `<number><unit>` pattern is present.
pub fn normalise_dosage(text: &str) -> Option<String> {
    let lower = norm(text);
    const UNITS: &[&str] = &["mg", "mcg", "microgram", "micrograms", "g", "ml", "units", "unit"];
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            // capture the number (allow one decimal point)
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let number = &lower[start..i];
            let rest = lower[i..].trim_start();
            for u in UNITS {
                if rest.starts_with(u) {
                    let canon_unit = match *u {
                        "microgram" | "micrograms" => "mcg",
                        "unit" => "units",
                        other => other,
                    };
                    return Some(format!("{number} {canon_unit}"));
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Canonical frequency token, e.g. "bd"/"twice daily" → "twice_daily".
pub fn normalise_frequency(text: &str) -> Option<String> {
    let l = norm(text);
    const MAP: &[(&str, &str)] = &[
        ("once daily", "once_daily"),
        ("once a day", "once_daily"),
        ("od", "once_daily"),
        ("mane", "once_daily_morning"),
        ("nocte", "once_daily_night"),
        ("twice daily", "twice_daily"),
        ("twice a day", "twice_daily"),
        ("bd", "twice_daily"),
        ("bid", "twice_daily"),
        ("three times daily", "three_times_daily"),
        ("three times a day", "three_times_daily"),
        ("tds", "three_times_daily"),
        ("tid", "three_times_daily"),
        ("four times daily", "four_times_daily"),
        ("qid", "four_times_daily"),
        ("prn", "as_needed"),
        ("as needed", "as_needed"),
        ("as required", "as_needed"),
        ("weekly", "weekly"),
        ("nightly", "once_daily_night"),
    ];
    for (surface, canon) in MAP {
        if contains_token(&l, surface) {
            return Some((*canon).to_string());
        }
    }
    None
}

/// Canonical route, e.g. "po"/"by mouth" → "oral".
pub fn normalise_route(text: &str) -> Option<String> {
    let l = norm(text);
    const MAP: &[(&str, &str)] = &[
        ("oral", "oral"),
        ("by mouth", "oral"),
        ("po", "oral"),
        ("subcutaneous", "subcutaneous"),
        ("subcut", "subcutaneous"),
        ("sc", "subcutaneous"),
        ("intramuscular", "intramuscular"),
        ("im", "intramuscular"),
        ("intravenous", "intravenous"),
        ("iv", "intravenous"),
        ("topical", "topical"),
        ("patch", "transdermal"),
        ("transdermal", "transdermal"),
        ("inhaled", "inhaled"),
        ("nasal", "nasal"),
    ];
    for (surface, canon) in MAP {
        if contains_token(&l, surface) {
            return Some((*canon).to_string());
        }
    }
    None
}

pub fn normalise_severity(text: &str) -> Severity {
    let l = norm(text);
    if has_any(&l, &["severe", "severely", "debilitating", "extreme", "marked"]) {
        Severity::Severe
    } else if has_any(&l, &["moderate", "moderately"]) {
        Severity::Moderate
    } else if has_any(&l, &["mild", "minor", "slight", "minimal"]) {
        Severity::Mild
    } else {
        Severity::Unknown
    }
}

pub fn normalise_progression(text: &str) -> Progression {
    let l = norm(text);
    // Order matters: "fluctuating/variable" first (it can co-occur with others).
    if has_any(&l, &["fluctuat", "variable", "comes and goes", "waxing and waning", "intermittent"]) {
        Progression::Fluctuating
    } else if has_any(&l, &["worsen", "deteriorat", "getting worse", "progressive", "increasing"]) {
        Progression::Worsening
    } else if has_any(&l, &["improv", "getting better", "resolving", "settling", "easing"]) {
        Progression::Improving
    } else if has_any(&l, &["stable", "unchanged", "no change", "persistent", "ongoing"]) {
        Progression::Stable
    } else {
        Progression::Unknown
    }
}

pub fn normalise_trend(text: &str) -> Trend {
    let l = norm(text);
    if has_any(&l, &["fluctuat", "variable", "comes and goes"]) {
        Trend::Fluctuating
    } else if has_any(&l, &["worsen", "deteriorat", "declin", "reduced further", "getting worse"]) {
        Trend::Deteriorating
    } else if has_any(&l, &["improv", "better", "recover", "regained", "increasing capacity"]) {
        Trend::Improving
    } else if has_any(&l, &["stable", "unchanged", "no change", "remains"]) {
        Trend::Stable
    } else {
        Trend::Unknown
    }
}

pub fn normalise_effectiveness(text: &str) -> Effectiveness {
    let l = norm(text);
    if has_any(&l, &["no benefit", "ineffective", "did not help", "no improvement", "no relief", "unsuccessful"]) {
        Effectiveness::Ineffective
    } else if has_any(&l, &["some benefit", "partial", "partially", "mild improvement", "limited benefit"]) {
        Effectiveness::PartiallyEffective
    } else if has_any(&l, &["effective", "helped", "good response", "responded well", "beneficial", "improved with"]) {
        Effectiveness::Effective
    } else {
        Effectiveness::Unknown
    }
}

pub fn normalise_medication_status(text: &str) -> MedicationStatus {
    let l = norm(text);
    if has_any(&l, &["recommenced", "restarted", "resumed", "recommenced after", "back on"]) {
        MedicationStatus::Recommenced
    } else if has_any(&l, &["ceased", "stopped", "discontinued", "no longer taking", "withdrawn"]) {
        MedicationStatus::Ceased
    } else if has_any(&l, &["current", "ongoing", "continues", "commenced", "started", "remains on", "taking"]) {
        MedicationStatus::Current
    } else {
        MedicationStatus::Unknown
    }
}

pub fn normalise_treatment_status(text: &str) -> TreatmentStatus {
    let l = norm(text);
    if has_any(&l, &["ceased", "completed", "discharged", "concluded", "finished", "ended"]) {
        TreatmentStatus::Ceased
    } else if has_any(&l, &["ongoing", "continues", "attending", "current", "remains under"]) {
        TreatmentStatus::Ongoing
    } else {
        TreatmentStatus::Unknown
    }
}

pub fn normalise_functional_area(text: &str) -> FunctionalArea {
    let l = norm(text);
    if has_any(&l, &["work", "employment", "job", "occupation"]) {
        FunctionalArea::Work
    } else if has_any(&l, &["driv"]) {
        FunctionalArea::Driving
    } else if has_any(&l, &["household", "housework", "chores", "domestic", "cleaning", "cooking"]) {
        FunctionalArea::Household
    } else if has_any(&l, &["exercise", "gym", "sport", "running", "walking long"]) {
        FunctionalArea::Exercise
    } else if has_any(&l, &["sleep", "insomnia", "waking"]) {
        FunctionalArea::Sleep
    } else if has_any(&l, &["social", "friends", "isolat", "withdrawn"]) {
        FunctionalArea::Social
    } else if has_any(&l, &["dressing", "washing", "bathing", "self-care", "self care", "toileting", "adl"]) {
        FunctionalArea::Adls
    } else {
        FunctionalArea::Other
    }
}

// ── token helpers ───────────────────────────────────────────────────────────

fn has_any(haystack_lower: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack_lower.contains(n))
}

/// Whole-token containment for short abbreviations (so "od" does not match
/// inside "period"); multi-word needles fall back to substring containment.
fn contains_token(haystack_lower: &str, needle: &str) -> bool {
    if needle.contains(' ') {
        return haystack_lower.contains(needle);
    }
    let hb = haystack_lower.as_bytes();
    let nb = needle.as_bytes();
    let mut i = 0;
    while let Some(rel) = haystack_lower[i..].find(needle) {
        let start = i + rel;
        let end = start + nb.len();
        let left_ok = start == 0 || !is_word(hb[start - 1]);
        let right_ok = end >= hb.len() || !is_word(hb[end]);
        if left_ok && right_ok {
            return true;
        }
        i = end;
    }
    false
}

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric()
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dosage_canonicalises() {
        assert_eq!(normalise_dosage("20MG"), Some("20 mg".into()));
        assert_eq!(normalise_dosage("taken 5 mg nightly"), Some("5 mg".into()));
        assert_eq!(normalise_dosage("75micrograms"), Some("75 mcg".into()));
        assert_eq!(normalise_dosage("no dose here"), None);
    }

    #[test]
    fn frequency_canonicalises_and_respects_token_boundary() {
        assert_eq!(normalise_frequency("bd"), Some("twice_daily".into()));
        assert_eq!(normalise_frequency("twice daily"), Some("twice_daily".into()));
        assert_eq!(normalise_frequency("tds"), Some("three_times_daily".into()));
        // "od" must NOT fire inside "period"
        assert_eq!(normalise_frequency("for a period"), None);
        assert_eq!(normalise_frequency("od"), Some("once_daily".into()));
    }

    #[test]
    fn route_canonicalises() {
        assert_eq!(normalise_route("po"), Some("oral".into()));
        assert_eq!(normalise_route("by mouth"), Some("oral".into()));
        assert_eq!(normalise_route("transdermal patch"), Some("transdermal".into()));
        assert_eq!(normalise_route("no route"), None);
    }

    #[test]
    fn enums_preserve_uncertainty() {
        assert_eq!(normalise_severity("nothing relevant"), Severity::Unknown);
        assert_eq!(normalise_progression("nothing"), Progression::Unknown);
        assert_eq!(normalise_trend("nothing"), Trend::Unknown);
        assert_eq!(normalise_effectiveness("nothing"), Effectiveness::Unknown);
        assert_eq!(normalise_medication_status("nothing"), MedicationStatus::Unknown);
        assert_eq!(normalise_treatment_status("nothing"), TreatmentStatus::Unknown);
    }

    #[test]
    fn enums_map_known_forms() {
        assert_eq!(normalise_severity("severe pain"), Severity::Severe);
        assert_eq!(normalise_progression("symptoms worsening"), Progression::Worsening);
        assert_eq!(normalise_progression("now improving"), Progression::Improving);
        assert_eq!(normalise_trend("capacity deteriorating"), Trend::Deteriorating);
        assert_eq!(normalise_effectiveness("medication helped"), Effectiveness::Effective);
        assert_eq!(normalise_effectiveness("no benefit"), Effectiveness::Ineffective);
        assert_eq!(normalise_medication_status("recommenced"), MedicationStatus::Recommenced);
        assert_eq!(normalise_medication_status("discontinued"), MedicationStatus::Ceased);
        assert_eq!(normalise_functional_area("returned to work"), FunctionalArea::Work);
        assert_eq!(normalise_functional_area("unable to drive"), FunctionalArea::Driving);
    }
}
