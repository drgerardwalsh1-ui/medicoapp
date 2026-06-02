//! Post-processing for spaCy NER output.
//!
//! spaCy is run on cleaned text, but still produces a lot of false
//! positives on OCR'd medico-legal documents — single adjectives flagged
//! as PERSON, IDE chrome flagged as ORG. This module trims those down
//! using shape + lexicon rules.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NerEntities {
    #[serde(rename = "PERSON", default)]
    pub person: Vec<String>,
    #[serde(rename = "ORG", default)]
    pub org: Vec<String>,
    #[serde(rename = "DATE", default)]
    pub date: Vec<String>,
}

/// Filter raw spaCy NER output into something safe to display.
///
/// PERSON:
///   - allow 2-4 name tokens, or "Title Surname" (Dr/Mr/Ms/Mrs/Prof)
///   - reject single tokens unless preceded by a title in the cleaned text
///   - reject any candidate containing braces / `&&` / `.js` / digits / symbols
///   - reject clinical-term / medication / diagnosis-fragment singletons
///     ("Generalised", "Sertraline", "depn", …) regardless of casing
///
/// ORG:
///   - reject dev/UI/code tokens (JavaScript, GoLive, CODEX, ChatGPT, …)
///   - reject very short all-caps fragments (≤2 chars) unless flanked by
///     organisation context words in the source ("hospital", "clinic", …)
///   - keep candidates whose text or context includes an organisation
///     suffix (hospital, clinic, centre, …)
pub fn clean_ner_entities(raw: NerEntities, clean_text: &str) -> NerEntities {
    let lower_text = clean_text.to_lowercase();
    NerEntities {
        person: dedup_keep_order(raw.person.into_iter().filter(|p| keep_person(p, &lower_text))),
        org:    dedup_keep_order(raw.org   .into_iter().filter(|o| keep_org(o, &lower_text))),
        // Dates we leave to the structured date extractor; the spaCy
        // DATE list still passes through (consumers can ignore it).
        date: raw.date,
    }
}

fn dedup_keep_order<I: IntoIterator<Item = String>>(it: I) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in it {
        let key = s.trim().to_string();
        if key.is_empty() {
            continue;
        }
        if seen.insert(key.to_lowercase()) {
            out.push(key);
        }
    }
    out
}

fn keep_person(candidate: &str, lower_text: &str) -> bool {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Reject if it contains any obvious code / dev punctuation.
    for ch in trimmed.chars() {
        if matches!(ch, '{' | '}' | '<' | '>' | '&' | '|' | '=' | '/' | '\\' | '#' | '@') {
            return false;
        }
    }
    if trimmed.contains(".js")
        || trimmed.contains(".ts")
        || trimmed.contains(".py")
        || trimmed.contains("&&")
        || trimmed.contains("||")
    {
        return false;
    }
    // Reject if it contains digits.
    if trimmed.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let lower = trimmed.to_lowercase();
    // Reject known clinical / diagnostic / medication terms regardless
    // of capitalisation.
    for &term in PERSON_BLOCKLIST {
        if lower == term {
            return false;
        }
    }
    // Reject anything that begins with a clinical-adjective fragment.
    for &frag in PERSON_FRAGMENT_BLOCKLIST {
        if lower.starts_with(frag) {
            return false;
        }
    }
    // Shape check: count tokens, and look at their structure.
    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.is_empty() {
        return false;
    }
    let alpha_only = tokens
        .iter()
        .all(|t| t.chars().all(|c| c.is_alphabetic() || c == '-' || c == '\''));
    if !alpha_only {
        return false;
    }
    // Titled name: "Dr Smith", "Prof Jane Doe".
    let first_lc = tokens[0].to_lowercase().trim_end_matches('.').to_string();
    let has_title = PERSON_TITLES.contains(&first_lc.as_str());
    if has_title && tokens.len() >= 2 && tokens.len() <= 5 {
        return true;
    }
    // Multi-token (2-4) capitalised name.
    if (2..=4).contains(&tokens.len())
        && tokens
            .iter()
            .all(|t| t.chars().next().map_or(false, |c| c.is_uppercase()))
    {
        return true;
    }
    // Single-token candidate: only accept if a title precedes it in the
    // source text ("Dr Smith" got split by spaCy).
    if tokens.len() == 1 {
        for title in PERSON_TITLES {
            let probe = format!("{title} {lower}");
            if lower_text.contains(&probe) {
                return true;
            }
        }
        return false;
    }
    false
}

fn keep_org(candidate: &str, lower_text: &str) -> bool {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();

    // Reject obvious dev / UI / code tokens.
    for &tok in ORG_BLOCKLIST {
        if lower == tok || lower.contains(tok) {
            return false;
        }
    }
    // Reject any candidate containing code / status fragments.
    if trimmed.contains("&&")
        || trimmed.contains("||")
        || trimmed.contains("{")
        || trimmed.contains("}")
        || trimmed.contains(".js")
        || trimmed.contains(".ts")
    {
        return false;
    }
    // Very short all-caps standalone fragments → reject unless flanked
    // by an org context word in the source text. "NE" alone is junk;
    // "NE Health Service" survives via the context check.
    let alpha_only: String = trimmed.chars().filter(|c| c.is_alphabetic()).collect();
    if alpha_only.len() <= 2 && alpha_only.chars().all(|c| c.is_ascii_uppercase()) {
        for ctx in ORG_CONTEXT_WORDS {
            if lower_text.contains(&format!("{lower} {ctx}"))
                || lower_text.contains(&format!("{ctx} {lower}"))
            {
                // Flanking context word → accept.
                return true;
            }
        }
        return false;
    }
    // Accept candidates that look like an organisation by suffix.
    for suffix in ORG_SUFFIXES {
        if lower.ends_with(suffix) {
            return true;
        }
    }
    // Or contain an org context word as part of the candidate itself.
    for ctx in ORG_CONTEXT_WORDS {
        if lower.contains(ctx) {
            return true;
        }
    }
    // Otherwise we accept multi-token capitalised candidates whose text
    // appears as a substring of the cleaned source — spaCy's defaults
    // are still useful when the candidate is multi-word.
    let token_count = trimmed.split_whitespace().count();
    if token_count >= 2 && trimmed.chars().all(|c| c.is_alphabetic() || c.is_whitespace() || c == '&' || c == '-') {
        // Capitalised tokens only.
        let cap_ok = trimmed
            .split_whitespace()
            .all(|t| t.chars().next().map_or(false, |c| c.is_uppercase()));
        if cap_ok {
            return true;
        }
    }
    false
}

const PERSON_TITLES: &[&str] = &[
    "dr", "dr.", "doctor", "mr", "mr.", "mrs", "mrs.", "ms", "ms.",
    "miss", "prof", "prof.", "professor", "associate",
];

/// Diagnoses / medications / shorthand that spaCy will often tag as PERSON
/// just because the source capitalises them.
const PERSON_BLOCKLIST: &[&str] = &[
    "generalised", "generalized", "depression", "anxiety",
    "ptsd", "gad", "mdd", "ocd", "tbi", "depn",
    "sertraline", "pregabalin", "fluoxetine", "paroxetine",
    "quetiapine", "venlafaxine", "duloxetine", "amitriptyline",
    "clonazepam", "lorazepam", "diazepam", "escitalopram",
    "paracetamol", "ibuprofen", "tramadol", "oxycodone",
    "cbt", "emdr", "physiotherapy", "psychiatry", "psychology",
    "imaging", "radiology",
];

/// Single-word adjective / fragment prefixes that are never people.
const PERSON_FRAGMENT_BLOCKLIST: &[&str] = &[
    "generalis", "generaliz", "chronic", "acute", "severe", "moderate",
    "mild", "post-traumatic", "post traumatic",
];

const ORG_BLOCKLIST: &[&str] = &[
    "javascript", "typescript", "utf-8", "utf8",
    "chatgpt", "codex", "golive", "claude.ai",
    "html", "css", "json", "xml", "yaml",
    "react", "vite", "webpack", "github", "gitlab", "docker",
    "openai", "anthropic", "claude",
    "continue", "regenerate", "share",
];

const ORG_CONTEXT_WORDS: &[&str] = &[
    "hospital", "clinic", "centre", "center", "service", "network",
    "practice", "insurance", "tribunal", "commission", "authority",
    "radiology", "pathology", "physio", "physiotherapy",
    "medical", "health", "psychology", "psychiatry",
];

const ORG_SUFFIXES: &[&str] = &[
    "hospital", "clinic", "centre", "center", "health service",
    "medical centre", "medical center", "rehabilitation centre",
    "physiotherapy centre", "general practice", "practice",
    "insurance", "tribunal", "commission", "authority",
    "network",
];

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn n(p: &[&str], o: &[&str]) -> NerEntities {
        NerEntities {
            person: p.iter().map(|s| s.to_string()).collect(),
            org:    o.iter().map(|s| s.to_string()).collect(),
            date:   vec![],
        }
    }

    #[test]
    fn ds_js_m_is_not_a_person() {
        let raw = n(&["ds.js M"], &[]);
        let out = clean_ner_entities(raw, "some clinical text");
        assert!(out.person.is_empty(), "ds.js M must be filtered: {:?}", out.person);
    }

    #[test]
    fn generalised_is_not_a_person() {
        let raw = n(&["Generalised", "Generalized"], &[]);
        let out = clean_ner_entities(raw, "patient reports generalised anxiety");
        assert!(out.person.is_empty(),
                "clinical adjective fragment must not be PERSON: {:?}", out.person);
    }

    #[test]
    fn medications_are_not_people() {
        let raw = n(&["Sertraline", "Pregabalin"], &[]);
        let out = clean_ner_entities(raw, "");
        assert!(out.person.is_empty(),
                "medication names must not be PERSON: {:?}", out.person);
    }

    #[test]
    fn titled_name_is_kept() {
        let raw = n(&["Dr Smith", "Prof Jane Doe"], &[]);
        let out = clean_ner_entities(raw, "Dr Smith reviewed the patient. Prof Jane Doe consulted.");
        assert!(out.person.contains(&"Dr Smith".to_string()),
                "titled name must be kept: {:?}", out.person);
        assert!(out.person.contains(&"Prof Jane Doe".to_string()),
                "titled name must be kept: {:?}", out.person);
    }

    #[test]
    fn capitalised_two_token_name_kept() {
        let raw = n(&["Jane Doe"], &[]);
        let out = clean_ner_entities(raw, "Jane Doe attended.");
        assert!(out.person.contains(&"Jane Doe".to_string()),
                "Jane Doe must survive: {:?}", out.person);
    }

    #[test]
    fn single_capitalised_token_dropped_without_title() {
        let raw = n(&["Smith"], &[]);
        let out = clean_ner_entities(raw, "Smith attended.");
        assert!(out.person.is_empty(),
                "single token without a leading title must be dropped: {:?}", out.person);
    }

    #[test]
    fn single_capitalised_token_kept_when_title_in_source() {
        let raw = n(&["Smith"], &[]);
        let out = clean_ner_entities(raw, "Dr Smith reviewed the patient.");
        assert!(out.person.contains(&"Smith".to_string()),
                "single token after Dr must be kept: {:?}", out.person);
    }

    #[test]
    fn javascript_amp_is_not_an_org() {
        let raw = n(&[], &["JavaScript &&"]);
        let out = clean_ner_entities(raw, "");
        assert!(out.org.is_empty(),
                "JavaScript && must not be ORG: {:?}", out.org);
    }

    #[test]
    fn ne_alone_is_not_an_org() {
        let raw = n(&[], &["NE"]);
        let out = clean_ner_entities(raw, "noise text");
        assert!(out.org.is_empty(),
                "short all-caps without context must not be ORG: {:?}", out.org);
    }

    #[test]
    fn ne_with_org_context_is_kept() {
        let raw = n(&[], &["NE"]);
        let out = clean_ner_entities(raw, "NE Health Service report.");
        assert!(out.org.contains(&"NE".to_string()),
                "NE with org context kept: {:?}", out.org);
    }

    #[test]
    fn hospital_suffix_kept() {
        let raw = n(&[], &["St Vincent's Hospital", "Royal Melbourne Hospital"]);
        let out = clean_ner_entities(raw, "");
        assert!(out.org.contains(&"St Vincent's Hospital".to_string()));
        assert!(out.org.contains(&"Royal Melbourne Hospital".to_string()));
    }

    #[test]
    fn dev_tokens_blocked_as_orgs() {
        let raw = n(&[], &["JavaScript", "GoLive", "CODEX", "ChatGPT", "Continue"]);
        let out = clean_ner_entities(raw, "");
        assert!(out.org.is_empty(),
                "all dev tokens must be blocked: {:?}", out.org);
    }
}
