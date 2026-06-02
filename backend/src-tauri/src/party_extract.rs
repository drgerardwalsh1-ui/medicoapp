//! Deterministic person / party extraction from cleaned medico-legal text.
//!
//! This runs in addition to spaCy NER — NER is broad and noisy, while
//! this module is narrow and high-precision. It targets the structured
//! patterns that appear in medico-legal documents (authoring lines,
//! provider labels, patient identifiers) and extracts the named person
//! with a role tag, the supporting snippet, and a confidence score.
//!
//! Design constraints:
//!   - Only structured contexts produce a match — never bare capitalised
//!     tokens (those are spaCy's job and the user has explicitly said we
//!     should not loosen NER filtering).
//!   - Each rule pulls a short name window after the trigger (Dr Lewis,
//!     Dr Jane Smith, Professor Smith). Long phrases beyond a sensible
//!     name length are rejected.
//!   - Diagnoses, medications, and UI fragments are never returned, even
//!     if they happen to follow a trigger.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Person {
    /// Cleaned display form ("Dr Lewis", "Prof Jane Smith", "John Smith").
    pub name: String,
    /// Role inferred from the surrounding context.
    pub role: PersonRole,
    /// The matched line (up to ~120 chars) used as evidence. Byte-equal
    /// to `clean_text[snippet_start..snippet_end]` per the persistence
    /// boundary's integrity rule.
    pub source_snippet: String,
    /// Byte offset of `source_snippet` in the `clean_text` passed to
    /// [`extract_people`]. Invariant: `clean_text[start..end] == source_snippet`.
    pub snippet_start: usize,
    /// Byte offset just past the end of `source_snippet` in `clean_text`.
    pub snippet_end: usize,
    /// Rule-derived confidence in [0, 1]. Higher = stronger evidence.
    /// Authoring/role-labelled lines score highest (0.95); a bare
    /// "Dr Surname" mid-sentence scores 0.75.
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonRole {
    Author,
    Doctor,
    Gp,
    Psychiatrist,
    Psychologist,
    Specialist,
    Consultant,
    TreatingDoctor,
    Patient,
    Client,
    Claimant,
    Unknown,
}

impl PersonRole {
    #[allow(dead_code)] // Used by lib.rs to serialise role; cargo's per-crate dead-code check misses it
    pub fn as_str(self) -> &'static str {
        match self {
            PersonRole::Author          => "author",
            PersonRole::Doctor          => "doctor",
            PersonRole::Gp              => "gp",
            PersonRole::Psychiatrist    => "psychiatrist",
            PersonRole::Psychologist    => "psychologist",
            PersonRole::Specialist      => "specialist",
            PersonRole::Consultant      => "consultant",
            PersonRole::TreatingDoctor  => "treating_doctor",
            PersonRole::Patient         => "patient",
            PersonRole::Client          => "client",
            PersonRole::Claimant        => "claimant",
            PersonRole::Unknown         => "unknown",
        }
    }
}

/// Extract people from `clean_text`. Returns a deduplicated list,
/// ordered by first occurrence in the text. When the same name appears
/// in multiple roles, the highest-confidence labelled role wins.
pub fn extract_people(clean_text: &str) -> Vec<Person> {
    let mut hits: Vec<(usize, Person)> = Vec::new();
    // Walk lines while tracking each line's byte position in clean_text.
    // We can't rely on `clean_text.find(line)` because the same line
    // text can recur and we need the snippet offsets to be precise for
    // the persistence-layer snippet-integrity check.
    let mut line_byte_start: usize = 0;
    for raw_line in clean_text.split_inclusive('\n') {
        let line_no_nl = raw_line.trim_end_matches('\n');
        let leading_ws_bytes = line_no_nl
            .bytes()
            .take_while(|b| b.is_ascii_whitespace())
            .count();
        let trailing_ws_bytes = line_no_nl
            .bytes()
            .rev()
            .take_while(|b| b.is_ascii_whitespace())
            .count();
        let trimmed_start = line_byte_start + leading_ws_bytes;
        let trimmed_end = line_byte_start + line_no_nl.len() - trailing_ws_bytes;

        // Defensive: trimmed range must be valid and aligned. If a line
        // contains only whitespace, skip it without advancing line_byte_start
        // logic (which we still update at the bottom).
        let line_start_for_next = line_byte_start + raw_line.len();
        let trimmed = if trimmed_start < trimmed_end {
            &clean_text[trimmed_start..trimmed_end]
        } else {
            // Empty after trim — advance and continue.
            line_byte_start = line_start_for_next;
            continue;
        };

        // Compute snippet bounds: take up to 120 chars from trimmed_start.
        let (snippet, snip_start, snip_end) =
            cap_snippet(clean_text, trimmed_start, trimmed_end, 120);

        // 1. Authoring / role-labelled patterns: "Author: Dr X",
        //    "Psychologist: Dr Brown", "Patient: John Smith", etc.
        for &(trigger, role, conf) in ROLE_TRIGGERS {
            if let Some(idx) = match_trigger(trimmed, trigger) {
                let rest = trimmed[idx..].trim_start_matches(|c: char| {
                    matches!(c, ':' | '-' | '–' | '—' | ' ')
                });
                if let Some(name) = pull_person_name(rest) {
                    if accept_name(&name) {
                        hits.push((
                            trimmed_start,
                            Person {
                                name,
                                role,
                                source_snippet: snippet.clone(),
                                snippet_start: snip_start,
                                snippet_end: snip_end,
                                confidence: conf,
                            },
                        ));
                    }
                }
            }
        }

        // 2. "Report by Dr X" / "Prepared by Dr X" → Author.
        for prefix in ["report by", "prepared by", "completed by", "written by"] {
            if let Some(idx) = match_trigger(trimmed, prefix) {
                let rest = trimmed[idx..].trim_start();
                if let Some(name) = pull_person_name(rest) {
                    if accept_name(&name) {
                        hits.push((
                            trimmed_start,
                            Person {
                                name,
                                role: PersonRole::Author,
                                source_snippet: snippet.clone(),
                                snippet_start: snip_start,
                                snippet_end: snip_end,
                                confidence: 0.95,
                            },
                        ));
                    }
                }
            }
        }

        // 3. Free-floating title + name: "Dr Lewis", "Prof Jane Smith".
        //    Scan the whole line for occurrences. Lower confidence; the
        //    role is Doctor by default (it's a title-prefixed name).
        for cap in iter_title_name(trimmed) {
            if accept_name(&cap.name) {
                hits.push((
                    trimmed_start + cap.offset_in_line,
                    Person {
                        name: cap.name,
                        role: cap.role,
                        source_snippet: snippet.clone(),
                        snippet_start: snip_start,
                        snippet_end: snip_end,
                        confidence: 0.75,
                    },
                ));
            }
        }

        line_byte_start = line_start_for_next;
    }

    // Sort by occurrence; then dedupe by name keeping the highest-confidence
    // role. If equal confidence, prefer the one that was found first.
    hits.sort_by_key(|(pos, _)| *pos);
    let mut by_name: std::collections::HashMap<String, Person> =
        std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for (_, p) in hits {
        let key = canonical_name_key(&p.name);
        match by_name.get(&key) {
            None => {
                order.push(key.clone());
                by_name.insert(key, p);
            }
            Some(existing) => {
                if p.confidence > existing.confidence
                    || (existing.role == PersonRole::Doctor
                        && p.role != PersonRole::Doctor
                        && p.role != PersonRole::Unknown)
                {
                    by_name.insert(key, p);
                }
            }
        }
    }
    order.into_iter().filter_map(|k| by_name.remove(&k)).collect()
}

/// Return the first doctor-ish or author person in `people`, if any.
/// Used by `parties.doctor` for back-compat with the existing payload.
pub fn first_doctor(people: &[Person]) -> Option<&Person> {
    people
        .iter()
        .find(|p| matches!(
            p.role,
            PersonRole::Author
                | PersonRole::Doctor
                | PersonRole::Gp
                | PersonRole::Psychiatrist
                | PersonRole::Psychologist
                | PersonRole::Specialist
                | PersonRole::Consultant
                | PersonRole::TreatingDoctor,
        ))
}

/// Return the first patient/client/claimant in `people`, if any.
pub fn first_patient(people: &[Person]) -> Option<&Person> {
    people.iter().find(|p| matches!(
        p.role,
        PersonRole::Patient | PersonRole::Client | PersonRole::Claimant,
    ))
}

// ── Trigger table ────────────────────────────────────────────────────────

/// (lowercased trigger, role, confidence).
/// Order matters only when triggers are prefixes of each other; the
/// longest prefix should appear first.
const ROLE_TRIGGERS: &[(&str, PersonRole, f32)] = &[
    // Authoring
    ("author",                  PersonRole::Author,         0.95),
    // Provider roles
    ("treating doctor",         PersonRole::TreatingDoctor, 0.95),
    ("treating psychiatrist",   PersonRole::Psychiatrist,   0.95),
    ("treating psychologist",   PersonRole::Psychologist,   0.95),
    ("treating physician",      PersonRole::TreatingDoctor, 0.95),
    ("treating clinician",      PersonRole::Doctor,         0.90),
    ("treating gp",             PersonRole::Gp,             0.95),
    ("psychiatrist",            PersonRole::Psychiatrist,   0.90),
    ("psychologist",            PersonRole::Psychologist,   0.90),
    ("specialist",              PersonRole::Specialist,     0.85),
    ("consultant",              PersonRole::Consultant,     0.85),
    ("gp",                      PersonRole::Gp,             0.85),
    ("general practitioner",    PersonRole::Gp,             0.90),
    // Patient identifiers
    ("patient",                 PersonRole::Patient,        0.90),
    ("claimant",                PersonRole::Claimant,       0.90),
    ("client",                  PersonRole::Client,         0.85),
];

// ── Trigger matching ─────────────────────────────────────────────────────

/// Return the byte index *after* the trigger if `trimmed` starts with
/// `trigger` (case-insensitive) followed by a colon / dash / em-dash / space.
fn match_trigger(trimmed: &str, trigger: &str) -> Option<usize> {
    let lower = trimmed.to_lowercase();
    if !lower.starts_with(trigger) {
        return None;
    }
    let after = trigger.len();
    let bytes = lower.as_bytes();
    if after == bytes.len() {
        return Some(after);
    }
    let next = bytes[after] as char;
    if matches!(next, ':' | '-' | ' ') || next == '–' || next == '—' {
        return Some(after);
    }
    // Also accept en/em dashes encoded as multi-byte; check the original
    // char at this position.
    if let Some(c) = trimmed[after..].chars().next() {
        if matches!(c, ':' | '-' | '–' | '—' | ' ') {
            return Some(after);
        }
    }
    None
}

// ── Title + name scanning ────────────────────────────────────────────────

struct TitleNameCapture {
    name: String,
    role: PersonRole,
    offset_in_line: usize,
}

const TITLES_DR_LIKE: &[&str] = &[
    "dr",   "dr.",   "doctor",
    "prof", "prof.", "professor",
];

const TITLES_HONORIFIC: &[&str] = &[
    "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "miss",
];

/// Yield every "title + name" capture in `line`. Returns offsets into
/// `line` so callers can locate the hit in the surrounding text.
fn iter_title_name(line: &str) -> Vec<TitleNameCapture> {
    let mut out = Vec::new();
    let lower = line.to_lowercase();
    // Scan by word: for each token boundary, check if the next token is
    // a recognised title.
    let mut start = 0usize;
    while start < line.len() {
        // Advance to next non-whitespace.
        while start < line.len()
            && line[start..]
                .chars()
                .next()
                .map_or(false, |c| c.is_whitespace())
        {
            start += line[start..].chars().next().unwrap().len_utf8();
        }
        if start >= line.len() {
            break;
        }
        // Read the token at `start`.
        let token_end = line[start..]
            .char_indices()
            .find(|(_, c)| c.is_whitespace())
            .map(|(i, _)| start + i)
            .unwrap_or(line.len());
        let token_lower = &lower[start..token_end];

        // Strip trailing colon/comma so "Dr:" still matches "dr".
        let title_token = token_lower
            .trim_end_matches(|c: char| matches!(c, ':' | ',' | '.'));
        let is_dr_like = TITLES_DR_LIKE
            .iter()
            .any(|t| t.trim_end_matches('.') == title_token);
        let is_honorific = TITLES_HONORIFIC
            .iter()
            .any(|t| t.trim_end_matches('.') == title_token);
        if is_dr_like || is_honorific {
            // Pull a person name from immediately after this title.
            let after_title = token_end
                + line[token_end..]
                    .chars()
                    .take_while(|c| matches!(c, ' ' | ':' | '-' | '\t'))
                    .map(|c| c.len_utf8())
                    .sum::<usize>();
            if let Some(name) = pull_person_name(&line[after_title..]) {
                let display = format!(
                    "{} {}",
                    proper_title(&line[start..token_end]),
                    name
                );
                let role = if is_dr_like {
                    PersonRole::Doctor
                } else {
                    PersonRole::Unknown
                };
                out.push(TitleNameCapture {
                    name: display,
                    role,
                    offset_in_line: start,
                });
            }
        }
        start = token_end + 1;
    }
    out
}

/// Pretty-print the matched title token: "DR" → "Dr", "professor" → "Professor".
fn proper_title(raw: &str) -> String {
    let stripped = raw.trim_end_matches(|c: char| !c.is_alphabetic());
    let mut chars: Vec<char> = stripped.chars().collect();
    for (i, c) in chars.iter_mut().enumerate() {
        if i == 0 {
            *c = c.to_ascii_uppercase();
        } else {
            *c = c.to_ascii_lowercase();
        }
    }
    chars.into_iter().collect()
}

/// Pull 1-4 capitalised name tokens from the start of `rest`. Returns
/// `None` if the immediate token isn't a plausible name (e.g. starts
/// with a digit, contains symbols, is all lowercase).
fn pull_person_name(rest: &str) -> Option<String> {
    // Strip optional leading "Dr" / title if the upstream caller passed
    // us a fragment that still includes one ("Dr Lewis").
    let trimmed = rest.trim_start_matches(|c: char| matches!(c, ' ' | ':' | '-'));
    let mut tokens: Vec<String> = Vec::new();
    let mut cursor = trimmed;
    let mut took = 0;
    while took < 4 && !cursor.is_empty() {
        let next_token_end = cursor
            .char_indices()
            .find(|(_, c)| c.is_whitespace() || matches!(c, ',' | ';' | '.'))
            .map(|(i, _)| i)
            .unwrap_or(cursor.len());
        if next_token_end == 0 {
            break;
        }
        let raw = &cursor[..next_token_end];
        if !is_name_token(raw) {
            break;
        }
        tokens.push(raw.to_string());
        // Advance past the token + a single trailing separator.
        let mut adv = next_token_end;
        if let Some(c) = cursor[adv..].chars().next() {
            if c.is_whitespace() {
                adv += c.len_utf8();
            } else {
                break; // hit a sentence delimiter — stop after this token
            }
        }
        cursor = &cursor[adv..];
        took += 1;
    }
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

/// True iff `tok` looks like a personal-name token. Must start with an
/// uppercase letter, contain only letters / `-` / `'`, and be 2+ chars
/// (so initials like "J" don't qualify, but hyphenated names do).
fn is_name_token(tok: &str) -> bool {
    let mut chars = tok.chars();
    let Some(first) = chars.next() else { return false };
    if !first.is_uppercase() {
        return false;
    }
    if tok.chars().count() < 2 {
        return false;
    }
    tok.chars()
        .all(|c| c.is_alphabetic() || c == '-' || c == '\'')
}

/// Reject names that are obviously not people — diagnoses, medications,
/// UI tokens, single clinical adjectives. The blocklists overlap with
/// `ner_clean::PERSON_BLOCKLIST` on purpose; this module does its own
/// filtering because it doesn't share the same control flow.
fn accept_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    // Drop any leading title to check the underlying surname.
    let stripped = lower
        .trim_start_matches("dr ")
        .trim_start_matches("dr. ")
        .trim_start_matches("doctor ")
        .trim_start_matches("prof ")
        .trim_start_matches("prof. ")
        .trim_start_matches("professor ")
        .trim_start_matches("mr ")
        .trim_start_matches("mr. ")
        .trim_start_matches("mrs ")
        .trim_start_matches("mrs. ")
        .trim_start_matches("ms ")
        .trim_start_matches("ms. ")
        .trim_start_matches("miss ")
        .to_string();
    // Block list — diagnoses, medications, common UI tokens, generic
    // adjectives. Any token of the candidate appearing here rejects it.
    for &bad in NAME_BLOCKLIST {
        for token in stripped.split_whitespace() {
            if token == bad {
                return false;
            }
        }
        if stripped == bad {
            return false;
        }
    }

    // Document-keyword blocklist. These come from headings like
    // `CLIENT FILE`, `GP NOTES (SCANNED)`, `SOURCE A`, etc. Our role
    // triggers (Client, GP, …) match the heading prefix and then
    // greedily capture the next token — which is a doc-section word,
    // not a person. Reject any candidate that is just one of these
    // words OR whose only post-title token is one of these words.
    let title_count = name.split_whitespace().count() - stripped.split_whitespace().count();
    let post_title_tokens: Vec<&str> = stripped.split_whitespace().collect();
    let only_doc_keyword = post_title_tokens.len() == 1
        && DOC_KEYWORD_BLOCKLIST.contains(&post_title_tokens[0]);
    if only_doc_keyword {
        return false;
    }
    // Also reject "Dr NOTES" / "Dr FILE" — even with a title the captured
    // word is a doc-section heading and should not become a name.
    if title_count > 0 {
        for &doc in DOC_KEYWORD_BLOCKLIST {
            if post_title_tokens.iter().any(|t| *t == doc) {
                return false;
            }
        }
    }
    true
}

/// Document-section words that role triggers would otherwise capture as
/// names. Lowercased.
const DOC_KEYWORD_BLOCKLIST: &[&str] = &[
    "file", "files",
    "notes", "note",
    "scanned",
    "scenario", "scenarios",
    "report", "reports",
    "summary",
    "source",
    "assessment",
    "records", "record",
    "history",
    "plan",
    "impression", "impressions",
    "findings",
    "mechanism",
    "background",
    "opinion",
    "diagnosis", "diagnoses",
    "conclusion",
    "review",
    "consult", "consultation",
];

const NAME_BLOCKLIST: &[&str] = &[
    // Diagnoses / adjectives / medical fragments
    "generalised", "generalized", "chronic", "acute", "severe",
    "moderate", "mild", "depressive", "anxiety", "depression",
    "ptsd", "gad", "mdd", "ocd", "tbi", "adhd",
    // Medications (lowercase generic + common brand stems)
    "sertraline", "pregabalin", "fluoxetine", "paroxetine",
    "quetiapine", "venlafaxine", "duloxetine", "amitriptyline",
    "clonazepam", "lorazepam", "diazepam", "escitalopram",
    "paracetamol", "ibuprofen", "tramadol", "oxycodone",
    "zoloft", "lyrica", "lexapro", "valium",
    // UI / dev
    "javascript", "typescript", "chatgpt", "codex", "golive",
    "continue", "regenerate",
    // Other false-positive risks
    "diagnosis", "diagnoses", "opinion", "symptoms", "history",
    "imaging", "radiology", "physiotherapy", "psychiatry",
    "psychology",
];

fn canonical_name_key(name: &str) -> String {
    name.split_whitespace()
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Cap the substring `clean_text[start..end]` to at most `max_chars`
/// characters from the start, returning `(snippet, start, capped_end)`
/// with the invariant `clean_text[start..capped_end] == snippet`. Used
/// by the people extractor to produce snippets whose byte offsets are
/// preserved for the persistence boundary's snippet-integrity check.
fn cap_snippet(
    clean_text: &str,
    start: usize,
    end: usize,
    max_chars: usize,
) -> (String, usize, usize) {
    let slice = &clean_text[start..end];
    if slice.chars().count() <= max_chars {
        return (slice.to_string(), start, end);
    }
    let cut = slice
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(slice.len());
    let new_end = start + cut;
    (clean_text[start..new_end].to_string(), start, new_end)
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn extract(text: &str) -> Vec<Person> {
        extract_people(text)
    }

    #[test]
    fn author_dr_lewis_is_extracted_as_author() {
        let p = extract("Author: Dr Lewis");
        assert_eq!(p.len(), 1, "expected one person; got: {:?}", p);
        assert_eq!(p[0].name, "Dr Lewis");
        assert_eq!(p[0].role, PersonRole::Author);
        assert!(p[0].confidence >= 0.9);
    }

    #[test]
    fn author_full_name_is_extracted() {
        let p = extract("Author: Dr Jane Smith\n");
        assert!(p.iter().any(|x| x.name == "Dr Jane Smith"),
                "expected Dr Jane Smith; got: {:?}", p);
    }

    #[test]
    fn report_by_pattern_is_extracted() {
        let p = extract("Report by Dr Lewis on 12 June 2023.");
        assert!(p.iter().any(|x| x.name == "Dr Lewis" && x.role == PersonRole::Author),
                "report by → Author; got: {:?}", p);
    }

    #[test]
    fn psychologist_role_label_is_extracted() {
        let p = extract("Psychologist: Dr Brown");
        let found = p.iter().find(|x| x.name == "Dr Brown");
        assert!(found.is_some(), "Dr Brown missing: {:?}", p);
        assert_eq!(found.unwrap().role, PersonRole::Psychologist);
    }

    #[test]
    fn treating_psychiatrist_role_is_extracted() {
        let p = extract("Treating Psychiatrist: Dr Khan");
        let found = p.iter().find(|x| x.name == "Dr Khan");
        assert!(found.is_some(), "Dr Khan missing: {:?}", p);
        assert_eq!(found.unwrap().role, PersonRole::Psychiatrist);
    }

    #[test]
    fn patient_line_is_extracted() {
        let p = extract("Patient: John Smith");
        let found = p.iter().find(|x| x.name == "John Smith");
        assert!(found.is_some(), "John Smith missing: {:?}", p);
        assert_eq!(found.unwrap().role, PersonRole::Patient);
    }

    #[test]
    fn claimant_line_is_extracted() {
        let p = extract("Claimant: Jane Doe");
        let found = p.iter().find(|x| x.name == "Jane Doe");
        assert!(found.is_some());
        assert_eq!(found.unwrap().role, PersonRole::Claimant);
    }

    #[test]
    fn standalone_dr_name_in_text_is_extracted() {
        let p = extract("Dr Lewis saw the patient on 12 June 2023.");
        assert!(p.iter().any(|x| x.name == "Dr Lewis"));
    }

    #[test]
    fn prof_name_is_extracted() {
        let p = extract("Prof Smith provided an opinion.");
        assert!(p.iter().any(|x| x.name == "Prof Smith"),
                "expected Prof Smith; got: {:?}", p);
    }

    // ── Negative tests ────────────────────────────────────────────────

    #[test]
    fn medications_are_not_people() {
        let p = extract("Sertraline 50mg commenced.");
        assert!(p.is_empty(), "Sertraline should not be a person: {:?}", p);
    }

    #[test]
    fn generalised_adjective_is_not_a_person() {
        let p = extract("Patient has generalised anxiety disorder.");
        assert!(!p.iter().any(|x| x.name.to_lowercase().contains("generalised")),
                "Generalised should not be a person: {:?}", p);
    }

    #[test]
    fn ds_js_m_is_not_a_person() {
        let p = extract("ds.js M");
        assert!(p.is_empty(), "OCR fragment should not be a person: {:?}", p);
    }

    #[test]
    fn dedup_same_name_keeps_best_role() {
        let p = extract("Dr Lewis saw the patient.\nAuthor: Dr Lewis");
        assert_eq!(p.iter().filter(|x| x.name == "Dr Lewis").count(), 1,
                "Dr Lewis should be deduped; got: {:?}", p);
        let lewis = p.iter().find(|x| x.name == "Dr Lewis").unwrap();
        assert_eq!(lewis.role, PersonRole::Author,
                "Author label should win over free-floating Doctor; got: {:?}", lewis.role);
    }

    #[test]
    fn gp_notes_heading_does_not_create_a_doctor() {
        for input in [
            "GP NOTES (SCANNED)",
            "GP NOTES",
            "CLIENT FILE — SCENARIO 3",
            "CLIENT FILE",
            "SOURCE A",
            "SUMMARY",
        ] {
            let p = extract(input);
            assert!(p.is_empty(),
                "document heading {:?} must not create a person; got: {:?}",
                input, p);
        }
    }

    #[test]
    fn doc_keyword_after_title_is_rejected() {
        // Even "Dr NOTES" / "Dr FILE" must not become a person.
        for input in ["Dr NOTES", "Dr FILE", "Prof FILE"] {
            let p = extract(input);
            assert!(p.is_empty(),
                "title + doc-keyword must not produce a person: {:?} → {:?}",
                input, p);
        }
    }

    #[test]
    fn first_doctor_helper_picks_author_or_provider() {
        let p = extract("Patient: John Smith\nAuthor: Dr Lewis\n");
        let doc = first_doctor(&p).expect("expected a doctor");
        assert_eq!(doc.name, "Dr Lewis");
        let pat = first_patient(&p).expect("expected a patient");
        assert_eq!(pat.name, "John Smith");
    }
}
