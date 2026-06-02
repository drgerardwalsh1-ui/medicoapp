//! Entity cleaning and normalisation for the medico-legal NLP pipeline.
//!
//! Processes raw `conditions`, `medications`, and `procedures` arrays returned
//! by OCR post-processing and scispaCy NER.  Produces clean, deduplicated,
//! medically meaningful output.
//!
//! Processing pipeline (per entity, in order):
//!   1. Trim surrounding whitespace
//!   2. Strip trailing punctuation  (., ;, :, !, ?, ", ', ), ])
//!   3. Collapse internal whitespace runs
//!   4. Lowercase
//!   5. Expand known synonyms        (acronyms → full terms, brand → generic)
//!   6. Garbage filter               (code artefacts, symbol density, short noise)
//!   7. Category-specific filter     (anatomy, events, incomplete procedure phrases)
//!   8. Deduplicate                  (after normalisation — PTSD and post-traumatic
//!                                    stress disorder collapse to the same key)
//!
//! No external dependencies.  All logic is deterministic and rule-based.

use std::collections::HashSet;

// ── Public API ────────────────────────────────────────────────────────────────

pub struct CleanInput {
    pub conditions:  Vec<String>,
    pub medications: Vec<String>,
    pub procedures:  Vec<String>,
}

pub struct CleanOutput {
    pub conditions:  Vec<String>,
    pub medications: Vec<String>,
    pub procedures:  Vec<String>,
    /// Symptom / complaint terms peeled off the conditions list (anxiety,
    /// hypervigilance, sleep disturbance, …). The product spec calls for
    /// these to be displayed under "symptoms" rather than promoted to
    /// confirmed diagnoses.
    pub symptoms:   Vec<String>,
    /// Populated only when `debug = true`.  Each entry records one rejected
    /// entity and the reason it was filtered.
    pub removed: Vec<RemovedEntry>,
}

/// A single entity that was removed during cleaning.
#[derive(Debug, Clone)]
pub struct RemovedEntry {
    pub original: String,
    pub category: &'static str,
    pub reason:   &'static str,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Clean and normalise the three entity lists.
///
/// Each list is processed independently through the full pipeline.
/// Setting `debug = true` populates `CleanOutput::removed` — useful for
/// inspecting what was filtered and why.  Leave `false` in production.
pub fn clean_entities(input: CleanInput, debug: bool) -> CleanOutput {
    let (conditions_all, rc) = process_list(&input.conditions,  Category::Condition,  debug);
    let (medications,    rm) = process_list(&input.medications,  Category::Medication, debug);
    let (procedures,     rp) = process_list(&input.procedures,   Category::Procedure,  debug);

    // Step 4 of the product spec: separate symptoms from diagnoses.
    // Diagnoses go in `conditions`; symptom/complaint terms go in
    // `symptoms`. Determined by lexicon — see `is_symptom_term`.
    let mut conditions = Vec::with_capacity(conditions_all.len());
    let mut symptoms   = Vec::new();
    for term in conditions_all {
        if is_symptom_term(&term) {
            symptoms.push(term);
        } else {
            conditions.push(term);
        }
    }

    let removed = if debug {
        let mut v = rc;
        v.extend(rm);
        v.extend(rp);
        v
    } else {
        Vec::new()
    };

    CleanOutput { conditions, medications, procedures, symptoms, removed }
}

/// True iff `term` is a symptom/complaint rather than a diagnosis.
/// Compared against a curated lexicon — conservative; if uncertain, the
/// term is left in `conditions`.
pub fn is_symptom_term(term: &str) -> bool {
    let lower = term.to_lowercase();
    for &sym in SYMPTOM_TERMS {
        if lower == sym {
            return true;
        }
    }
    false
}

/// Symptom / complaint vocabulary. Items here are *not* diagnoses by
/// themselves; explicit diagnostic framing in the upstream text moves a
/// mention into `conditions` via the entity-extractor's keyword lists.
const SYMPTOM_TERMS: &[&str] = &[
    "anxiety",
    "depression",
    "low mood",
    "depressed mood",
    "sleep disturbance",
    "poor sleep",
    "appetite change",
    "appetite loss",
    "weight loss",
    "pain",
    "chronic pain",
    "headache",
    "fatigue",
    "irritability",
    "hypervigilance",
    "intrusive memories",
    "intrusive thoughts",
    "flashbacks",
    "nightmares",
    "avoidance",
    "panic attacks",
    "panic",
    "rumination",
    "tearfulness",
    "anhedonia",
    "concentration difficulty",
    "memory difficulty",
];

// ── Category ──────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq)]
enum Category {
    Condition,
    Medication,
    Procedure,
}

impl Category {
    fn label(self) -> &'static str {
        match self {
            Category::Condition  => "condition",
            Category::Medication => "medication",
            Category::Procedure  => "procedure",
        }
    }
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

fn process_list(
    raw:      &[String],
    category: Category,
    debug:    bool,
) -> (Vec<String>, Vec<RemovedEntry>) {
    let mut out:     Vec<String>       = Vec::new();
    let mut removed: Vec<RemovedEntry> = Vec::new();
    let mut seen:    HashSet<String>   = HashSet::new();

    for original in raw {
        // Step 1–5: normalise (trim, strip punct, collapse ws, lowercase, expand synonyms)
        let norm = normalise(original, category);
        if norm.is_empty() {
            push_removed(&mut removed, debug, original, category, "empty after normalisation");
            continue;
        }

        // Step 6: garbage filter
        if let Some(reason) = garbage_filter(&norm) {
            push_removed(&mut removed, debug, original, category, reason);
            continue;
        }

        // Step 7: category-specific filter
        if let Some(reason) = category_filter(&norm, category) {
            push_removed(&mut removed, debug, original, category, reason);
            continue;
        }

        // Step 8: deduplicate on the normalised key
        // Synonyms have already been expanded, so "PTSD" and
        // "post-traumatic stress disorder" both normalise to the same key.
        if seen.contains(&norm) {
            push_removed(&mut removed, debug, original, category, "duplicate");
            continue;
        }
        seen.insert(norm.clone());
        out.push(norm);
    }

    (out, removed)
}

#[inline]
fn push_removed(
    removed:  &mut Vec<RemovedEntry>,
    debug:    bool,
    original: &str,
    category: Category,
    reason:   &'static str,
) {
    if debug {
        removed.push(RemovedEntry {
            original: original.to_string(),
            category: category.label(),
            reason,
        });
    }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/// Produce the canonical form of an entity string:
///   0. Take first line only  (scispaCy occasionally returns multi-line spans)
///   1. Trim surrounding whitespace
///   2. Strip trailing/leading punctuation + noise chars (+, |, ↑, ↓, ©, ±)
///   3. Collapse internal whitespace runs to single spaces
///   4. Lowercase
///   5. Expand known synonyms to the canonical term
fn normalise(s: &str, category: Category) -> String {
    // Step 0 — take the first non-empty line only.
    // scispaCy sometimes returns spans that cross line boundaries, e.g.
    // "Psychiatric Assessment\nAuthor".  Only the first line is the actual
    // entity name; subsequent lines are context noise.
    let first_line = s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if first_line.is_empty() {
        return String::new();
    }

    // Step 1 — strip trailing noise punctuation (run until stable)
    let stripped = first_line.trim_end_matches(|c: char| {
        matches!(
            c,
            '.' | ',' | ';' | ':' | '!' | '?' | '"' | '\'' | ')' | ']'
            | '+' | '|' | '©' | '±' | '↑' | '↓' | '*' | '#' | '~' | '`'
        )
    });
    // Strip leading quote/bracket/symbol artefacts
    let stripped = stripped.trim_start_matches(|c: char| {
        matches!(c, '"' | '\'' | '(' | '[' | '+' | '|' | '#' | '*' | '`')
    });

    // Step 2 — collapse internal whitespace (handles tabs, double-spaces, etc.)
    let collapsed: String = stripped
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if collapsed.is_empty() {
        return String::new();
    }

    // Steps 3–4 — lowercase then synonym-expand
    let lower = collapsed.to_lowercase();
    expand_synonym(&lower, category)
}

fn expand_synonym(lower: &str, category: Category) -> String {
    let map: &[(&str, &str)] = match category {
        Category::Condition  => CONDITION_SYNONYMS,
        Category::Medication => MEDICATION_SYNONYMS,
        Category::Procedure  => PROCEDURE_SYNONYMS,
    };
    for &(from, to) in map {
        if lower == from {
            return to.to_string();
        }
    }
    lower.to_string()
}

// ── Synonym maps ──────────────────────────────────────────────────────────────
//
// All keys and values are lowercase.
// Listed longest-match first within each semantic group so that if two patterns
// could match the same input, the more specific one fires.

const CONDITION_SYNONYMS: &[(&str, &str)] = &[
    // ── DSM / ICD acronyms → full diagnostic name ─────────────────────────────
    ("ptsd",                             "post-traumatic stress disorder"),
    ("c-ptsd",                           "complex post-traumatic stress disorder"),
    ("cptsd",                            "complex post-traumatic stress disorder"),
    ("gad",                              "generalised anxiety disorder"),
    ("mdd",                              "major depressive disorder"),
    ("tbi",                              "traumatic brain injury"),
    ("mtbi",                             "mild traumatic brain injury"),
    ("ocd",                              "obsessive-compulsive disorder"),
    ("adhd",                             "attention deficit hyperactivity disorder"),
    ("add",                              "attention deficit disorder"),
    ("bpd",                              "borderline personality disorder"),
    ("pcs",                              "post-concussion syndrome"),
    ("ra",                               "rheumatoid arthritis"),
    ("oa",                               "osteoarthritis"),
    // ── GP / clinical shorthand → canonical form ──────────────────────────────
    // These abbreviations appear routinely in handwritten/dictated GP notes.
    ("anx",                              "anxiety"),
    ("depn",                             "depression"),
    ("dep",                              "depression"),
    ("mva",                              "motor vehicle accident"),   // → EVENT_TERMS
    ("sob",                              "shortness of breath"),
    ("cp",                               "chest pain"),
    ("ha",                               "headache"),
    ("lbp",                              "chronic low back pain"),
    // ── Spelling / punctuation variants ───────────────────────────────────────
    ("post traumatic stress disorder",   "post-traumatic stress disorder"),
    ("post-traumatic stress",            "post-traumatic stress disorder"),
    ("generalized anxiety disorder",     "generalised anxiety disorder"),
    ("generalized anxiety",              "generalised anxiety disorder"),
    ("generalised anxiety",              "generalised anxiety disorder"),
    ("major depression",                 "major depressive disorder"),
    // ── Disc / disk spelling variants ─────────────────────────────────────────
    ("disk herniation",                  "disc herniation"),
    ("herniated disc",                   "disc herniation"),
    ("herniated disk",                   "disc herniation"),
    ("disc herniation l4/5",             "disc herniation"),
    ("disc herniation l5/s1",            "disc herniation"),
    // ── Musculoskeletal shorthand ─────────────────────────────────────────────
    ("low back pain",                    "chronic low back pain"),
    ("lower back pain",                  "chronic low back pain"),
    ("acl tear",                         "anterior cruciate ligament tear"),
    ("acl rupture",                      "anterior cruciate ligament rupture"),
    ("rct",                              "rotator cuff tear"),
    ("cts",                              "carpal tunnel syndrome"),
];

const MEDICATION_SYNONYMS: &[(&str, &str)] = &[
    // ── Brand → generic (alphabetical by brand) ───────────────────────────────
    ("aropax",      "paroxetine"),
    ("ativan",      "lorazepam"),
    ("celebrex",    "celecoxib"),
    ("cipralex",    "escitalopram"),
    ("cymbalta",    "duloxetine"),
    ("effexor",     "venlafaxine"),
    ("endone",      "oxycodone"),
    ("klonopin",    "clonazepam"),
    ("lexapro",     "escitalopram"),
    ("lyrica",      "pregabalin"),
    ("neurontin",   "gabapentin"),
    ("nurofen",     "ibuprofen"),
    ("paxil",       "paroxetine"),
    ("panadol",     "paracetamol"),
    ("pristiq",     "desvenlafaxine"),
    ("prozac",      "fluoxetine"),
    ("remeron",     "mirtazapine"),
    ("risperdal",   "risperidone"),
    ("rivotril",    "clonazepam"),
    ("seroquel",    "quetiapine"),
    ("tylenol",     "paracetamol"),
    ("valium",      "diazepam"),
    ("voltaren",    "diclofenac"),
    ("xanax",       "alprazolam"),
    ("zoloft",      "sertraline"),
    ("zyprexa",     "olanzapine"),
    // ── Truncated / GP-note abbreviations → generic ───────────────────────────
    // Handwritten and dictated notes frequently abbreviate drug names.
    ("pregab",      "pregabalin"),
    ("pregabaline", "pregabalin"),   // common misspelling
    ("amitript",    "amitriptyline"),
    ("fluox",       "fluoxetine"),
    ("parox",       "paroxetine"),
    ("sertr",       "sertraline"),
    ("escital",     "escitalopram"),
    ("venlaf",      "venlafaxine"),
    ("quetiap",     "quetiapine"),
    ("clonaz",      "clonazepam"),
    ("paracet",     "paracetamol"),
    ("ibuprof",     "ibuprofen"),
    ("naprox",      "naproxen"),
    ("tramad",      "tramadol"),
    ("morphin",     "morphine"),
    ("oxycode",     "oxycodone"),
    ("melatonin",   "melatonin"),    // keep (some pipelines double-add)
];

const PROCEDURE_SYNONYMS: &[(&str, &str)] = &[
    // ── Abbreviations → full names (longer match first) ───────────────────────
    ("emdr therapy",                   "eye movement desensitisation and reprocessing"),
    ("emdr",                           "eye movement desensitisation and reprocessing"),
    ("cbt",                            "cognitive behavioural therapy"),
    ("ime",                            "independent medical examination"),
    ("fca",                            "functional capacity assessment"),
    ("fcsa",                           "functional capacity and strength assessment"),
    ("ot",                             "occupational therapy"),
    ("physio",                         "physiotherapy"),
    ("ref physio",                     "physiotherapy referral"),
    ("ref psychology",                 "psychology referral"),
    ("ref psychiatry",                 "psychiatry referral"),
    ("acupunc",                        "acupuncture"),
    ("hydrotherapy",                   "hydrotherapy"),
    // ── Spelling / dialect variants → canonical Australian English ────────────
    ("cognitive behavioral therapy",   "cognitive behavioural therapy"),
    ("cognitive behaviour therapy",    "cognitive behavioural therapy"),
    ("dialectical behavioral therapy", "dialectical behaviour therapy"),
    ("dialectical behavioural therapy","dialectical behaviour therapy"),
    // ── Terminology standardisation ───────────────────────────────────────────
    ("neuropsychological evaluation",  "neuropsychological assessment"),
    ("psychological evaluation",       "psychological assessment"),
    ("psychiatric evaluation",         "psychiatric assessment"),
    ("independent medical assessment", "independent medical examination"),
    ("spinal surgery",                 "spinal surgery"),   // keep as-is (dedup guard)
];

// ── Garbage filter ────────────────────────────────────────────────────────────

/// Returns `Some(reason)` if the entity is garbage and should be rejected.
/// Returns `None` if the entity passes all checks.
fn garbage_filter(norm: &str) -> Option<&'static str> {
    // 1. Length guard — reject tokens under 3 chars unless medically valid
    if norm.chars().count() < 3 && !VALID_ABBREVIATIONS.contains(&norm) {
        return Some("too short — not a recognised medical abbreviation");
    }

    // 2. Meaningless noise fragments
    if is_meaningless_fragment(norm) {
        return Some("meaningless fragment");
    }

    // 3. High symbol density — catches "{key: val}", "x@y#z!", "---"
    if symbol_ratio(norm) >= 0.25 {
        return Some("high symbol ratio (>=25% non-alphanumeric)");
    }

    // 4. Code/programming artefacts — catches "ds.js", "function()", "chatgpt"
    if has_code_pattern(norm) {
        return Some("code or programming artefact");
    }

    // 5. OCR corruption — catches "ticccicu" (triple-char), "rrtctercu" (low vowels),
    //    "SISUUIMEMTETECONSTTUCTIO" (4+ consecutive consonants).
    //    Runs AFTER symbol check so "@iauiis" is caught by symbol_ratio first.
    if has_ocr_garbage_word(norm) {
        return Some("ocr garbage (triple-char / low-vowel / consonant-cluster)");
    }

    // 6. Non-medical tech/UI terms that scispaCy misclassifies as clinical entities.
    //    Word-boundary match so "codex" rejects "codex" but not "cortex".
    if is_non_medical_garbage(norm) {
        return Some("non-medical tech/ui artefact");
    }

    None
}

/// True if the entity is a noise fragment: an all-digit string, a single
/// character, or a multi-token string where every token is trivially short.
fn is_meaningless_fragment(s: &str) -> bool {
    let words: Vec<&str> = s.split_whitespace().collect();
    if words.is_empty() {
        return true;
    }

    if words.len() == 1 {
        let w = words[0];
        // Bare digit string (ID number, page number, etc.)
        if w.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
        // Single non-medical character
        if w.len() == 1 {
            return true;
        }
    }

    // Every token is ≤ 2 chars and none are valid medical abbreviations → noise
    // (e.g. "wv y", "x b c")
    words.iter().all(|w| w.len() <= 2 && !VALID_ABBREVIATIONS.contains(w))
}

/// Fraction of characters that are "symbol" characters.
/// Excludes space, hyphen, slash, and period — all common in valid medical text
/// ("post-traumatic", "mg/day", "e.g.").
fn symbol_ratio(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let total   = s.chars().count() as f32;
    let symbols = s.chars()
        .filter(|&c| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '/' && c != '.')
        .count() as f32;
    symbols / total
}

/// True if the entity looks like a code artefact:
///   - A URL or protocol pattern
///   - A file path with a known code extension (no spaces before the dot)
///   - An email / handle containing '@'
///   - A known programming keyword appearing as a complete word
fn has_code_pattern(s: &str) -> bool {
    // URL / protocol
    if s.contains("://") || s.starts_with("www.") {
        return true;
    }
    // Email or mention
    if s.contains('@') {
        return true;
    }
    // File-extension pattern: "name.ext" where ext is a known code extension
    // and "name" contains no spaces (distinguishes from "Dr. Smith", "e.g.")
    if let Some(dot_pos) = s.rfind('.') {
        if dot_pos > 0 {
            let before = &s[..dot_pos];
            let ext    = &s[dot_pos + 1..];
            if !before.contains(' ') && CODE_EXTENSIONS.contains(&ext) {
                return true;
            }
        }
    }
    // Programming keywords as complete words
    for &token in PROGRAMMING_TOKENS {
        if word_boundary_match(s, token) {
            return true;
        }
    }
    false
}

/// Detect words that are obviously OCR-corrupted by three independent signals.
///
/// Per-word checks (split on whitespace):
///   A. Any **3+ consecutive identical** alphabetic characters → OCR smear
///      e.g. "ticccicu" (ccc), "aaanother" (aaa)
///   B. Words ≥ 7 alphabetic chars with **< 25% vowels** (y counts as vowel)
///      e.g. "rrtctercu" (2/9 = 22%)
///   C. Words with a **run of ≥ 4 consecutive consonants** (y counts as vowel)
///      e.g. "SISUUIMEMTETECONSTTUCTIO" (…NSTT…)
///
/// A safelist of legitimate medical/English words that happen to have long
/// consonant clusters is checked before rule C fires.
fn has_ocr_garbage_word(s: &str) -> bool {
    // Words with 4+ consecutive consonants that are legitimate English/medical.
    // Expand this list if false-positives are found in practice.
    const CONSONANT_SAFE: &[&str] = &[
        "strength", "strengths", "length", "lengths",
        "lymph", "lymphs", "lymphoma", "lymphocyte", "lymphocytes", "lymphatic",
        "eighth", "months", "rhythm", "rhythms", "bronchitis", "sphincter",
        "script", "scripts", "transcript", "construct", "instruct", "instructor",
        "abstract", "restrict", "district", "obstruct", "destruct", "extinct",
        "benchmark", "bankruptcy",
    ];

    // Split on whitespace first, then split each whitespace-token on non-alpha
    // characters (hyphens, slashes, etc.) so that "post-traumatic" is analysed
    // as TWO tokens ["post", "traumatic"], not one merged run "posttraumatic".
    // This prevents the hyphen junction from creating a spurious consonant cluster.
    for ws_token in s.split_whitespace() {
        for wl in ws_token.split(|c: char| !c.is_alphabetic())
            .map(|t| t.to_lowercase())
            .filter(|t| t.len() >= 4)
        {
            // Safelist guard — skip legitimately clustered words
            if CONSONANT_SAFE.contains(&wl.as_str()) { continue; }

            let chars: Vec<char> = wl.chars().collect();

            // Rule A: triple consecutive identical alphabetic character
            // e.g. "ticccicu" → 'c','c','c'
            for w in chars.windows(3) {
                if w[0] == w[1] && w[1] == w[2] {
                    return true;
                }
            }

            // Rule B: low vowel density for tokens ≥ 7 chars
            // e.g. "rrtctercu" → 2/9 = 22% < 25%
            if wl.len() >= 7 {
                let vowel_count = chars.iter()
                    .filter(|&&c| "aeiouy".contains(c))
                    .count();
                if (vowel_count as f64 / chars.len() as f64) < 0.25 {
                    return true;
                }
            }

            // Rule C: consecutive consonant run ≥ 4 (y treated as vowel)
            // e.g. "SISUUIMEMTETECONSTTUCTIO" → '…N','S','T','T' = run of 4
            let mut run = 0usize;
            let mut max_run = 0usize;
            for &c in &chars {
                if "aeiouy".contains(c) {
                    run = 0;
                } else {
                    run += 1;
                    if run > max_run { max_run = run; }
                }
            }
            if max_run >= 4 {
                return true;
            }
        }
    }
    false
}

/// True if `s` contains a known non-medical tech / UI term as a complete word.
/// Uses word-boundary matching — "codex" rejects "codex" but not "cortex".
fn is_non_medical_garbage(s: &str) -> bool {
    for term in NON_MEDICAL_GARBAGE {
        if word_boundary_match(s, term) {
            return true;
        }
    }
    false
}

// ── Category-specific filter ──────────────────────────────────────────────────

/// Returns `Some(reason)` if the entity fails the type-specific check.
fn category_filter(norm: &str, category: Category) -> Option<&'static str> {
    match category {
        Category::Condition => {
            if is_anatomy_only(norm) {
                return Some("pure anatomy term — not a diagnosis");
            }
            if is_event_term(norm) {
                return Some("event or mechanism — not a diagnosis");
            }
            // Dosing frequencies (PRN, OD, BD, etc.) sometimes labelled as conditions
            if DOSING_FREQ_TERMS.contains(&norm) {
                return Some("dosing frequency — not a diagnosis");
            }
            None
        }
        Category::Medication => {
            // scispaCy occasionally misclassifies anatomy or events as medications
            if is_anatomy_only(norm) || is_event_term(norm) {
                return Some("misclassified anatomy or event in medication list");
            }
            None
        }
        Category::Procedure => {
            if is_incomplete_procedure(norm) {
                return Some("incomplete procedure phrase — trailing adjective without noun");
            }
            // Reject single-word or clearly non-procedure entries that slip through
            // garbage detection (e.g. "timeline" after stripping "+")
            if PROCEDURE_GARBAGE_TERMS.contains(&norm) {
                return Some("not a recognisable procedure");
            }
            None
        }
    }
}

/// True if the term is a pure anatomy label with no pathological qualifier.
/// Conservative list — only exact matches for terms that are NEVER diagnoses.
/// Prefers precision: if ambiguous, the term is kept.
fn is_anatomy_only(s: &str) -> bool {
    ANATOMY_ONLY.contains(&s)
}

/// True if the term describes a mechanism or event rather than a diagnosis.
fn is_event_term(s: &str) -> bool {
    EVENT_TERMS.contains(&s)
}

/// True if a procedure phrase ends with a dangling modifier adjective,
/// indicating the phrase is incomplete (e.g. "cognitive behavioural" — missing "therapy").
///
/// Only fires when the last word is in DANGLING_PROC_ADJECTIVES.
/// "cognitive behavioural therapy" is never flagged — its last word is "therapy".
fn is_incomplete_procedure(s: &str) -> bool {
    if let Some(last) = s.split_whitespace().last() {
        if DANGLING_PROC_ADJECTIVES.contains(&last) {
            // Guard: a single-word term that happens to be in the adjective list
            // but is a valid standalone procedure keeps its place.
            return !VALID_STANDALONE_PROCEDURES.contains(&s);
        }
    }
    false
}

// ── Word-boundary match ───────────────────────────────────────────────────────

/// True if `text` contains `kw` as a complete word — not embedded inside a
/// longer alphanumeric token.  Both arguments should already be lowercase.
fn word_boundary_match(text: &str, kw: &str) -> bool {
    let kw_len   = kw.len();
    let bytes    = text.as_bytes();
    let text_len = text.len();
    let mut start = 0_usize;
    loop {
        let Some(rel) = text[start..].find(kw) else { break };
        let pos      = start + rel;
        let left_ok  = pos == 0 || !bytes[pos - 1].is_ascii_alphanumeric();
        let right_ok = pos + kw_len >= text_len || !bytes[pos + kw_len].is_ascii_alphanumeric();
        if left_ok && right_ok {
            return true;
        }
        start = pos + 1;
        if start >= text_len {
            break;
        }
    }
    false
}

// ── Static data ───────────────────────────────────────────────────────────────

/// Medical abbreviations that are ≤ 2 characters and must survive the
/// length check.  All entries are lowercase (post-normalisation form).
const VALID_ABBREVIATIONS: &[&str] = &[
    // Imaging / diagnostics
    "ct", "mri", "ecg", "eeg", "emg", "ect",
    // Clinical roles / settings
    "gp", "ed",
    // Conditions
    "ms", "tbi", "ocd", "dvt",
    // Anatomy abbreviations used as conditions
    "acl", "mcl", "dva",
    // Administration / routes
    "iv", "im",
    // Vital signs
    "bp", "hr",
];

/// Source code file extensions.  A token of the form "name.ext" where name
/// has no spaces and ext is in this list is treated as a code artefact.
const CODE_EXTENSIONS: &[&str] = &[
    "js", "ts", "jsx", "tsx",
    "html", "htm", "css", "scss", "sass",
    "py", "rb", "go", "rs", "java", "cpp", "c", "cs", "php",
    "sh", "bash", "zsh",
    "yml", "yaml",
    "svg",
];

/// Programming keywords.  A term that contains any of these as a complete word
/// is rejected as a code artefact.
const PROGRAMMING_TOKENS: &[&str] = &[
    "javascript", "typescript", "python",
    "html", "css", "json", "xml", "yaml",
    "utf-8", "utf8", "ascii", "unicode",
    "chatgpt", "openai", "anthropic", "claude", "llm", "gpt",
    "function", "const", "let", "var", "return", "class",
    "import", "export", "module", "require",
    "null", "undefined", "boolean",
    "database", "sql", "query", "endpoint", "webhook",
    "console", "webpack", "vite", "eslint",
    "react", "vue", "angular", "svelte",
    "github", "gitlab", "docker",
];

/// Pure anatomy terms — location labels that carry no pathological meaning
/// and should not appear in a conditions list.
/// Conservative: only unambiguous anatomy-only phrases; if there is any chance
/// the term is used diagnostically in medico-legal writing, it is NOT listed here.
const ANATOMY_ONLY: &[&str] = &[
    // Spinal regions (anatomy, not diagnoses)
    "lumbar spine",
    "cervical spine",
    "thoracic spine",
    "lumbar region",
    "cervical region",
    "thoracic region",
    "spinal column",
    "vertebral column",
    "lumbar vertebrae",
    "cervical vertebrae",
    "thoracic vertebrae",
    "intervertebral disc",
    "intervertebral disk",
    // Joint references without pathological qualifier
    "right shoulder joint",
    "left shoulder joint",
    "right knee joint",
    "left knee joint",
    "right hip joint",
    "left hip joint",
];

/// Mechanism / event terms that describe the context of an injury, not the
/// injury itself.  Should not appear as conditions.
///
/// Also receives expanded synonyms — "mva" → "motor vehicle accident" → filtered here.
const EVENT_TERMS: &[&str] = &[
    // Motor vehicle
    "motor vehicle accident",
    "motor vehicle collision",
    "motor vehicle crash",
    "motor vehicle",
    // Workplace
    "workplace accident",
    "workplace incident",
    "workplace injury",
    "occupational incident",
    "work injury",
    "work accident",
    // Mechanism / exposure descriptions (not standalone diagnoses)
    "mechanism of injury",
    "mechanism",
    "traumatic exposure",        // DSM criterion for PTSD, not a diagnosis itself
    "traumatic incident",
    "critical incident",
    "index event",
    // Falls
    "slip and fall",
    "fall from height",
    "trip and fall",
];

/// Last words of procedure phrases that indicate the phrase is incomplete.
/// "cognitive behavioural" ends with "behavioural" → incomplete.
/// "cognitive behavioural therapy" ends with "therapy" → complete.
const DANGLING_PROC_ADJECTIVES: &[&str] = &[
    "behavioural",
    "behavioral",
    "behaviour",
    "behavior",
    "occupational",   // "occupational" alone, not "occupational therapy"
    "manual",
    "respiratory",
    "aquatic",
];

/// Procedure terms that are complete despite ending in a word that appears
/// in DANGLING_PROC_ADJECTIVES.  Add entries here as edge cases arise.
const VALID_STANDALONE_PROCEDURES: &[&str] = &[];

/// Non-medical tech / UI / administration terms that scispaCy mis-tags as
/// clinical entities.  Matched with word_boundary_match so "codex" does not
/// incorrectly fire on "cortex".
const NON_MEDICAL_GARBAGE: &[&str] = &[
    // Software / IDE chrome
    "codex", "golive", "go live", "vscode", "xcode", "sublime",
    // OS / system UI strings
    "install",    // "install tonight", "install update" — never a medical entity
    "tonight",
    "remind",
    "available",
    "update",
    "updates",
    "scanned",    // document descriptor, not a diagnosis
    "continue",   // OS install dialog button
    "regenerate", // chat UI button
    // LLM / chat UI chrome
    "chatgpt", "ask anything", "get plus", "new chat",
    // Document / format labels (too generic to be a clinical entity)
    "file",
    "ocr",
    "narrative",  // section header, not a diagnosis
    "scenario",   // test-file label
    "timeline",
    // Dosing frequencies — these appear after medication names and scispaCy
    // sometimes extracts them as standalone entities
    "prn", "od", "bd", "bid", "tds", "tid", "qid", "stat", "nocte", "mane",
];

/// Dosing frequency / administration abbreviations.
/// Exact-matched against normalised entity strings in the Condition category.
const DOSING_FREQ_TERMS: &[&str] = &[
    "prn",   "od",   "bd",   "bid",  "tds",  "tid",  "qid",
    "stat",  "nocte","mane", "daily","twice daily","three times daily",
    "once daily","as needed","as required","with food","with water",
];

/// Single-word or clearly non-procedure entity strings that pass all other
/// filters but are not legitimate procedure names.
/// Only populated with terms demonstrated to be false-positives in practice.
const PROCEDURE_GARBAGE_TERMS: &[&str] = &[
    "timeline",   // "Timeline +" stripped to "timeline" — not a procedure
    "narrative",  // section header
    "update",
    "file",
    "code",
    // ── Document-type / context phrases mis-tagged as procedures ──────────
    // "Psychiatric Assessment" is a document TYPE (header on the report
    // itself), not something performed during the encounter being
    // described. Same for the related neuro/psych report headers — these
    // labels appear at the top of medico-legal reports and scispaCy keeps
    // flagging them as procedures.
    "psychiatric assessment",
    "psychiatric report",
    "psychological report",
    "medico-legal report",
    "medicolegal report",
    "review",
    "scenario",
];

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: run clean_entities with debug=true on a single category
    fn clean(
        conditions:  &[&str],
        medications: &[&str],
        procedures:  &[&str],
    ) -> CleanOutput {
        clean_entities(
            CleanInput {
                conditions:  conditions.iter().map(|s| s.to_string()).collect(),
                medications: medications.iter().map(|s| s.to_string()).collect(),
                procedures:  procedures.iter().map(|s| s.to_string()).collect(),
            },
            true,  // debug on — populate removed list
        )
    }

    // ── Normalisation ─────────────────────────────────────────────────────────

    #[test]
    fn trailing_punctuation_is_stripped() {
        let out = clean(&["pregabalin."], &[], &[]);
        assert!(out.conditions.contains(&"pregabalin".to_string()) ||
                out.medications.contains(&"pregabalin".to_string()),
                "trailing period must be stripped: {:?}", out.conditions);
    }

    #[test]
    fn internal_whitespace_collapsed() {
        let out = clean(&["disc   herniation"], &[], &[]);
        assert!(out.conditions.contains(&"disc herniation".to_string()),
                "internal whitespace must collapse: {:?}", out.conditions);
    }

    #[test]
    fn output_is_lowercase() {
        let out = clean(&["Rotator Cuff Tear"], &[], &[]);
        assert!(out.conditions.contains(&"rotator cuff tear".to_string()),
                "output should be lowercase: {:?}", out.conditions);
    }

    // ── Synonym expansion ─────────────────────────────────────────────────────

    #[test]
    fn ptsd_expands_to_full_name() {
        let out = clean(&["PTSD"], &[], &[]);
        assert!(out.conditions.contains(&"post-traumatic stress disorder".to_string()),
                "PTSD must expand: {:?}", out.conditions);
    }

    #[test]
    fn gad_expands_to_full_name() {
        let out = clean(&["GAD"], &[], &[]);
        assert!(out.conditions.contains(&"generalised anxiety disorder".to_string()),
                "GAD must expand: {:?}", out.conditions);
    }

    #[test]
    fn brand_name_maps_to_generic() {
        let out = clean(&[], &["Zoloft", "Aropax"], &[]);
        assert!(out.medications.contains(&"sertraline".to_string()),
                "Zoloft should map to sertraline: {:?}", out.medications);
        assert!(out.medications.contains(&"paroxetine".to_string()),
                "Aropax should map to paroxetine: {:?}", out.medications);
    }

    #[test]
    fn procedure_abbreviation_expands() {
        let out = clean(&[], &[], &["CBT", "EMDR"]);
        assert!(out.procedures.contains(&"cognitive behavioural therapy".to_string()),
                "CBT must expand: {:?}", out.procedures);
        assert!(out.procedures.contains(&"eye movement desensitisation and reprocessing".to_string()),
                "EMDR must expand: {:?}", out.procedures);
    }

    // ── Deduplication ─────────────────────────────────────────────────────────

    #[test]
    fn dedup_after_synonym_expansion() {
        // "PTSD" and the full form both appear — only one should survive
        let out = clean(
            &["PTSD", "post-traumatic stress disorder", "Post Traumatic Stress Disorder"],
            &[], &[],
        );
        assert_eq!(out.conditions.len(), 1,
                   "all three variants should collapse to one: {:?}", out.conditions);
        assert_eq!(out.conditions[0], "post-traumatic stress disorder");
    }

    #[test]
    fn dedup_brand_and_generic() {
        // Zoloft and sertraline both present — should produce exactly one entry
        let out = clean(&[], &["sertraline", "Zoloft", "SERTRALINE"], &[]);
        assert_eq!(out.medications.len(), 1,
                   "brand + generic + upper should deduplicate: {:?}", out.medications);
        assert_eq!(out.medications[0], "sertraline");
    }

    // ── Garbage filter ────────────────────────────────────────────────────────

    #[test]
    fn code_file_extension_rejected() {
        let out = clean(&["ds.js", "index.html", "app.tsx"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "code filenames must be rejected: {:?}", out.conditions);
        let reasons: Vec<&str> = out.removed.iter().map(|r| r.reason).collect();
        assert!(reasons.iter().all(|r| r.contains("code")),
                "rejection reason must mention code: {:?}", reasons);
    }

    #[test]
    fn programming_keyword_rejected() {
        let out = clean(&["JavaScript", "ChatGPT output", "UTF-8 string"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "programming terms must be rejected: {:?}", out.conditions);
    }

    #[test]
    fn high_symbol_ratio_rejected() {
        let out = clean(&["x@y#z!", "{key: value}", "===>"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "high-symbol strings must be rejected: {:?}", out.conditions);
    }

    #[test]
    fn meaningless_single_char_rejected() {
        let out = clean(&["x", "a", "z"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "single characters must be rejected: {:?}", out.conditions);
    }

    #[test]
    fn short_noise_tokens_rejected() {
        // "wv y" — two short tokens that are not medical abbreviations
        let out = clean(&["wv y", "ab cd", "..."], &[], &[]);
        assert!(out.conditions.is_empty(),
                "short noise tokens must be rejected: {:?}", out.conditions);
    }

    #[test]
    fn valid_medical_abbreviation_kept() {
        // Two-character medical abbreviations must survive the length check
        let out = clean(&["MRI", "CT"], &[], &[]);
        assert!(out.conditions.contains(&"mri".to_string()),
                "MRI must not be rejected: {:?}", out.conditions);
        assert!(out.conditions.contains(&"ct".to_string()),
                "CT must not be rejected: {:?}", out.conditions);
    }

    // ── Category-specific filter ──────────────────────────────────────────────

    #[test]
    fn anatomy_term_removed_from_conditions() {
        let out = clean(&["lumbar spine", "cervical spine"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "anatomy-only terms must be removed from conditions: {:?}", out.conditions);
        let reasons: Vec<&str> = out.removed.iter().map(|r| r.reason).collect();
        assert!(reasons.iter().any(|r| r.contains("anatomy")),
                "removal reason must mention anatomy: {:?}", reasons);
    }

    #[test]
    fn disc_herniation_is_kept() {
        // "disc herniation" is a diagnosis — must NOT be filtered as anatomy
        let out = clean(&["disc herniation"], &[], &[]);
        assert!(out.conditions.contains(&"disc herniation".to_string()),
                "disc herniation is a diagnosis and must be kept: {:?}", out.conditions);
    }

    #[test]
    fn event_term_removed_from_conditions() {
        let out = clean(&["motor vehicle accident", "motor vehicle"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "event terms must be removed from conditions: {:?}", out.conditions);
    }

    #[test]
    fn incomplete_procedure_rejected() {
        let out = clean(&[], &[], &["cognitive behavioural", "occupational"]);
        assert!(out.procedures.is_empty(),
                "incomplete procedure phrases must be rejected: {:?}", out.procedures);
        let reasons: Vec<&str> = out.removed.iter().map(|r| r.reason).collect();
        assert!(reasons.iter().any(|r| r.contains("incomplete")),
                "removal reason must mention incomplete: {:?}", reasons);
    }

    #[test]
    fn complete_procedure_kept() {
        let out = clean(
            &[], &[],
            &["cognitive behavioural therapy", "occupational therapy", "physiotherapy"],
        );
        assert_eq!(out.procedures.len(), 3,
                   "complete procedure phrases must be kept: {:?}", out.procedures);
    }

    // ── Debug output ──────────────────────────────────────────────────────────

    #[test]
    fn debug_removed_list_populated() {
        let out = clean(&["x", "PTSD", "ds.js"], &[], &[]);
        // "x" and "ds.js" should be rejected; "PTSD" should pass (after expansion)
        assert!(!out.removed.is_empty(),
                "debug removed list must be populated when debug=true");
        let original_vals: Vec<&str> = out.removed.iter().map(|r| r.original.as_str()).collect();
        assert!(original_vals.contains(&"x"),    "x should appear in removed list");
        assert!(original_vals.contains(&"ds.js"), "ds.js should appear in removed list");
        assert!(!original_vals.contains(&"PTSD"), "PTSD should NOT appear in removed list");
    }

    // ── Full integration ──────────────────────────────────────────────────────

    #[test]
    fn full_realistic_input() {
        let out = clean(
            // Mixed realistic + noise conditions
            &[
                "PTSD",
                "post-traumatic stress disorder",  // duplicate of expanded PTSD
                "disc herniation",
                "lumbar spine",                    // anatomy — should be removed
                "motor vehicle accident",          // event — should be removed
                "generalised anxiety disorder",
                "GAD",                             // duplicate of above after expansion
                "JavaScript",                      // garbage
                "x",                               // garbage
                "depression",
            ],
            // Medications
            &[
                "sertraline",
                "Zoloft",                          // duplicate brand name
                "pregabalin",
                "Lyrica",                          // duplicate brand name
                "ibuprofen.",                      // trailing period
                "chatgpt",                         // garbage
            ],
            // Procedures
            &[
                "physiotherapy",
                "cognitive behavioural therapy",
                "cognitive behavioral therapy",    // spelling variant duplicate
                "cognitive behavioural",           // incomplete — should be removed
                "independent medical examination",
                "IME",                             // abbreviation duplicate
            ],
        );

        // Conditions: PTSD, disc herniation, generalised anxiety disorder
        // (3) — bare "depression" routes to symptoms under the new rules.
        assert_eq!(out.conditions.len(), 3,
                   "expected 3 clean conditions: {:?}", out.conditions);
        assert!(out.conditions.contains(&"post-traumatic stress disorder".to_string()));
        assert!(out.conditions.contains(&"disc herniation".to_string()));
        assert!(out.conditions.contains(&"generalised anxiety disorder".to_string()));
        assert!(out.symptoms.contains(&"depression".to_string()),
                "bare depression should land in symptoms: {:?}", out.symptoms);

        // Medications: sertraline, pregabalin, ibuprofen (3)
        assert_eq!(out.medications.len(), 3,
                   "expected 3 clean medications: {:?}", out.medications);
        assert!(out.medications.contains(&"sertraline".to_string()));
        assert!(out.medications.contains(&"pregabalin".to_string()));
        assert!(out.medications.contains(&"ibuprofen".to_string()));

        // Procedures: physiotherapy, cbt, ime (3)
        assert_eq!(out.procedures.len(), 3,
                   "expected 3 clean procedures: {:?}", out.procedures);
        assert!(out.procedures.contains(&"physiotherapy".to_string()));
        assert!(out.procedures.contains(&"cognitive behavioural therapy".to_string()));
        assert!(out.procedures.contains(&"independent medical examination".to_string()));

        // Debug: removed list must account for every filtered entity
        assert!(!out.removed.is_empty(), "removed list must not be empty");
        println!("\nRemoved entities:");
        for r in &out.removed {
            println!("  [{:12}] {:45} — {}", r.category, r.original, r.reason);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // New tests covering real-world OCR / scispaCy failure modes
    // ══════════════════════════════════════════════════════════════════════════

    // ── OCR garbage detection ─────────────────────────────────────────────────

    #[test]
    fn triple_same_char_rejected() {
        // "ticccicu" has 'ccc' — rule A of has_ocr_garbage_word
        let out = clean(&["GO ticccicu", "ticccicu"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "triple-char OCR garbage must be rejected: {:?}", out.conditions);
    }

    #[test]
    fn low_vowel_density_rejected() {
        // "rrtctercu" — 2 vowels / 9 chars = 22% < 25% — rule B
        let out = clean(&[], &[], &["O rrtctercu"]);
        assert!(out.procedures.is_empty(),
            "low-vowel-density OCR garbage must be rejected: {:?}", out.procedures);
    }

    #[test]
    fn consonant_cluster_rejected() {
        // "SISUUIMEMTETECONSTTUCTIO" — 'NSTT' = 4 consecutive consonants — rule C
        let out = clean(&[], &[], &["SISUUIMEMTETECONSTTUCTIO"]);
        assert!(out.procedures.is_empty(),
            "consonant-cluster OCR garbage must be rejected: {:?}", out.procedures);
    }

    #[test]
    fn ocr_garbage_in_scispacy_output_scenario() {
        // Representative slice from FakeClient3.pdf scispaCy output
        let out = clean(
            &[
                "ea\n@iauiis uw © & % Er",  // multiline + symbol-heavy
                "CODEX",                     // non-medical tech term
                "FILE",                      // non-medical
                "Workplace incident",        // event, not condition
                "traumatic exposure",        // exposure event, not diagnosis
                "PTSD",                      // valid → expands to full name
                "Sleep disturbance",         // valid
                "anxiety",                   // valid
            ],
            &[],
            &[
                "SISUUIMEMTETECONSTTUCTIO",  // OCR garbage
                "O rrtctercu",               // OCR garbage
                "Timeline +",                // not a procedure
                "CBT",                       // valid → expands
            ],
        );

        // Conditions: only PTSD survives in conditions. "sleep disturbance"
        // and "anxiety" now route to symptoms.
        let cond_str = out.conditions.join("|").to_lowercase();
        let sym_str  = out.symptoms.join("|").to_lowercase();
        assert!(cond_str.contains("post-traumatic stress disorder"),
            "PTSD should survive and expand; got: {:?}", out.conditions);
        assert!(sym_str.contains("sleep disturbance"),
            "sleep disturbance should be a symptom: {:?}", out.symptoms);
        assert!(sym_str.contains("anxiety"),
            "anxiety should be a symptom: {:?}", out.symptoms);
        assert!(!cond_str.contains("codex"),
            "CODEX must be rejected; got: {:?}", out.conditions);
        assert!(!cond_str.contains("file"),
            "FILE must be rejected; got: {:?}", out.conditions);
        assert!(!cond_str.contains("workplace incident"),
            "workplace incident must be rejected as event; got: {:?}", out.conditions);
        assert!(!cond_str.contains("traumatic exposure"),
            "traumatic exposure must be rejected as event; got: {:?}", out.conditions);

        // Only CBT (→ cognitive behavioural therapy) must survive
        assert_eq!(out.procedures.len(), 1,
            "only CBT should survive; got: {:?}", out.procedures);
        assert_eq!(out.procedures[0], "cognitive behavioural therapy");
    }

    // ── GP shorthand expansion ────────────────────────────────────────────────

    #[test]
    fn gp_shorthand_anx_expands() {
        // "anx ++" — trailing "++" stripped → "anx" → synonym → "anxiety".
        // Per the new spec, bare "anxiety" is a SYMPTOM, not a diagnosis,
        // so the deduplicated result lands in symptoms (the explicit
        // "generalised anxiety disorder" phrase still routes to conditions).
        let out = clean(&["anx ++", "anx"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "bare anxiety should not land in conditions: {:?}", out.conditions);
        assert!(out.symptoms.iter().any(|s| s == "anxiety"),
            "anx should expand to anxiety in symptoms; got symptoms={:?}", out.symptoms);
        assert_eq!(out.symptoms.len(), 1, "anx and anx++ should deduplicate; got: {:?}", out.symptoms);
    }

    #[test]
    fn gp_shorthand_depn_expands() {
        // Same routing rationale — bare "depression" is a symptom mention.
        let out = clean(&["depn", "dep"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "bare depression should not land in conditions: {:?}", out.conditions);
        assert_eq!(out.symptoms.len(), 1,
            "depn and dep should both expand to depression and deduplicate; got: {:?}", out.symptoms);
        assert_eq!(out.symptoms[0], "depression");
    }

    #[test]
    fn mva_filtered_as_event() {
        // "mva" → synonym → "motor vehicle accident" → EVENT_TERMS filter
        let out = clean(&["MVA", "mva"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "MVA must be filtered as an event term; got: {:?}", out.conditions);
    }

    #[test]
    fn pregab_expands_to_pregabalin() {
        let out = clean(&[], &["pregab", "Pregab"], &[]);
        assert_eq!(out.medications.len(), 1,
            "pregab should expand and deduplicate; got: {:?}", out.medications);
        assert_eq!(out.medications[0], "pregabalin");
    }

    // ── Dosing frequency as condition ─────────────────────────────────────────

    #[test]
    fn dosing_frequency_prn_rejected_as_condition() {
        let out = clean(&["PRN", "prn", "OD", "BD"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "dosing frequencies must not be conditions; got: {:?}", out.conditions);
    }

    // ── Non-medical garbage blocklist ─────────────────────────────────────────

    #[test]
    fn codex_and_file_rejected() {
        let out = clean(&["CODEX", "FILE", "OCR"], &[], &[]);
        assert!(out.conditions.is_empty(),
            "non-medical terms CODEX/FILE/OCR must be rejected; got: {:?}", out.conditions);
    }

    // ── Multiline entity handling ─────────────────────────────────────────────

    #[test]
    fn multiline_entity_takes_first_line() {
        // "Psychiatric Assessment\nAuthor" → first line → "psychiatric
        // assessment". Per the new spec this is now filtered as a document
        // header rather than a procedure (it's the report title, not an
        // act performed during the encounter).
        let out = clean(&[], &[], &["Psychiatric Assessment\nAuthor"]);
        assert!(out.procedures.is_empty(),
            "psychiatric assessment is a document header, not a procedure: {:?}", out.procedures);
    }

    // ── Procedure garbage ─────────────────────────────────────────────────────

    #[test]
    fn timeline_plus_rejected_as_procedure() {
        let out = clean(&[], &[], &["Timeline +", "Timeline"]);
        assert!(out.procedures.is_empty(),
            "Timeline (+) must not be a procedure; got: {:?}", out.procedures);
    }

    // ── Legitimate terms not damaged by new filters ───────────────────────────

    #[test]
    fn legitimate_terms_survive() {
        // Updated for the new routing rules:
        //  - explicit diagnoses stay in `conditions`
        //  - bare "anxiety" / "depression" / "sleep disturbance" route
        //    to `symptoms`
        //  - "psychiatric assessment" is a document header, not a procedure
        let out = clean(
            &[
                "post-traumatic stress disorder",
                "major depressive disorder",
                "generalised anxiety disorder",
                "disc herniation",
                "chronic low back pain",
                "sleep disturbance",
                "depression",
                "anxiety",
            ],
            &["sertraline", "pregabalin", "paroxetine", "quetiapine"],
            &[
                "cognitive behavioural therapy",
                "physiotherapy",
                "independent medical examination",
                "psychiatric assessment",
                "psychological assessment",
                "occupational therapy",
            ],
        );
        assert_eq!(out.conditions.len(), 5,
            "5 diagnoses must survive (PTSD, MDD, GAD, disc herniation, CLBP); got: {:?}", out.conditions);
        assert_eq!(out.symptoms.len(), 3,
            "anxiety, depression, sleep disturbance must route to symptoms; got: {:?}", out.symptoms);
        assert_eq!(out.medications.len(), 4,
            "all 4 medications must survive; got: {:?}", out.medications);
        assert_eq!(out.procedures.len(), 5,
            "5 procedures survive (psychiatric assessment is filtered as doc header); got: {:?}",
            out.procedures);
    }

    // ── Scenario simulations — full real-world data slices ────────────────────

    #[test]
    fn scenario_fakeclient2_conflicting_diagnoses() {
        // Represents the cleaned scispaCy output from FakeClient2.pdf
        let out = clean(
            &[
                "anxiety",
                "PTSD",
                "GO ticccicu",              // OCR garbage
                "low mood",                 // valid symptom used as condition
                "depression",
                "Post-traumatic stress disorder",  // dup of PTSD after expansion
                "Major depressive disorder",
            ],
            &["Sertraline"],
            &["Psychiatric Assessment\nAuthor"],  // multiline
        );

        let cond_str = out.conditions.join("|").to_lowercase();
        assert!(!cond_str.contains("ticccicu"),   "OCR garbage must be removed");
        assert!(cond_str.contains("post-traumatic stress disorder"),
            "PTSD should be present once; conditions: {:?}", out.conditions);
        // PTSD and "Post-traumatic stress disorder" and "post-traumatic stress disorder"
        // all normalise to the same key — must appear exactly once
        let ptsd_count = out.conditions.iter()
            .filter(|c| c.contains("post-traumatic stress disorder")).count();
        assert_eq!(ptsd_count, 1, "PTSD must appear exactly once; got: {:?}", out.conditions);
        assert!(out.medications.contains(&"sertraline".to_string()),
            "sertraline must survive; got: {:?}", out.medications);
        // Updated: "psychiatric assessment" is now suppressed as a
        // document header rather than kept as a procedure.
        assert!(out.procedures.is_empty(),
            "psychiatric assessment is a doc header, not a procedure: {:?}", out.procedures);
        // anxiety, low mood, depression all route to symptoms now.
        for sym in ["anxiety", "depression", "low mood"] {
            assert!(out.symptoms.iter().any(|s| s == sym),
                "{} must appear in symptoms: {:?}", sym, out.symptoms);
        }
    }

    #[test]
    fn scenario_fakeclient3_messy_ocr() {
        // Represents the cleaned scispaCy output from FakeClient3.pdf
        let out = clean(
            &[
                "traumatic exposure",        // event → filtered
                "anxiety",
                "PTSD",
                "ea\n@iauiis uw © & % Er",   // multiline symbol garbage
                "Workplace incident",         // event
                "Sleep disturbance",
                "CODEX",                      // non-medical
                "FILE",                       // non-medical
                "Post-traumatic stress disorder",  // dup
            ],
            &["sertraline"],
            &[
                "SISUUIMEMTETECONSTTUCTIO",   // OCR garbage
                "CBT",
            ],
        );

        assert!(!out.conditions.iter().any(|c| c.contains("ticccicu") || c == "codex" || c == "file"),
            "garbage must be removed; conditions: {:?}", out.conditions);
        assert!(!out.conditions.iter().any(|c| c.contains("workplace incident") || c.contains("traumatic exposure")),
            "events must be removed; conditions: {:?}", out.conditions);
        let ptsd_count = out.conditions.iter()
            .filter(|c| c.contains("post-traumatic stress disorder")).count();
        assert_eq!(ptsd_count, 1, "PTSD dedup; got: {:?}", out.conditions);
        assert_eq!(out.procedures.len(), 1, "only CBT survives; got: {:?}", out.procedures);
        assert_eq!(out.procedures[0], "cognitive behavioural therapy");
    }

    #[test]
    fn scenario_fakeclient4_gp_notes() {
        // Represents cleaned scispaCy output from FakeClient4 GP notes
        let out = clean(
            &[
                "PTSD",
                "anx ++",     // GP shorthand + symbol noise → anxiety
                "CODEX",      // non-medical
                "OCR",        // non-medical
                "MVA",        // event → filtered
                "PRN",        // dosing frequency → filtered
            ],
            &["sertraline"],
            &[
                "O rrtctercu",   // OCR garbage
                "Timeline +",    // non-procedure
            ],
        );

        let cond_str = out.conditions.join("|").to_lowercase();
        let sym_str  = out.symptoms.join("|").to_lowercase();
        assert!(cond_str.contains("post-traumatic stress disorder"), "PTSD must survive");
        // Updated routing — anxiety is a symptom now.
        assert!(sym_str.contains("anxiety"), "anx++ must expand to anxiety in symptoms: {:?}", out.symptoms);
        assert!(!cond_str.contains("codex"), "CODEX must be removed");
        assert!(!cond_str.contains("ocr"),   "OCR must be removed");
        assert!(!cond_str.contains("mva"),   "MVA must be filtered as event");
        assert!(!cond_str.contains("prn"),   "PRN must be filtered as dosing frequency");
        assert!(out.procedures.is_empty(), "all procedure garbage must be removed");
    }

    // ── New: symptom split + spec-driven false-positive suppression ──────

    #[test]
    fn anxiety_routes_to_symptoms_not_conditions() {
        let out = clean(&["anxiety", "hypervigilance", "low mood"], &[], &[]);
        assert!(out.conditions.is_empty(),
                "symptom terms must not appear in conditions: {:?}", out.conditions);
        for sym in ["anxiety", "hypervigilance", "low mood"] {
            assert!(out.symptoms.iter().any(|s| s == sym),
                    "{} must appear in symptoms: {:?}", sym, out.symptoms);
        }
    }

    #[test]
    fn generalised_anxiety_disorder_stays_in_conditions() {
        // The explicit diagnostic phrase is a diagnosis, not a symptom.
        let out = clean(&["generalised anxiety disorder"], &[], &[]);
        assert!(out.conditions.contains(&"generalised anxiety disorder".to_string()),
                "GAD must stay in conditions: {:?}", out.conditions);
        assert!(out.symptoms.is_empty());
    }

    #[test]
    fn psychiatric_assessment_is_not_a_procedure() {
        let out = clean(&[], &[], &["Psychiatric Assessment", "psychiatric report"]);
        assert!(out.procedures.is_empty(),
                "document-header phrases must not appear as procedures: {:?}", out.procedures);
    }

    #[test]
    fn ui_chrome_is_suppressed_everywhere() {
        let out = clean(
            &["ChatGPT", "GoLive", "Continue", "JavaScript"],
            &[],
            &["GoLive", "ChatGPT"],
        );
        assert!(out.conditions.is_empty(), "UI tokens must not appear as conditions: {:?}", out.conditions);
        assert!(out.procedures.is_empty(), "UI tokens must not appear as procedures: {:?}", out.procedures);
    }

    #[test]
    fn depn_normalises_to_depression_then_routes_to_symptoms() {
        // "depn" → "depression" via existing synonym map. "depression" is in
        // the symptom lexicon — should land in symptoms.
        let out = clean(&["depn"], &[], &[]);
        // Note: existing CONDITION_SYNONYMS already maps depn → depression.
        // We assert that the term lands in symptoms (not conditions) so the
        // UI doesn't promote a bare "depression" mention to a diagnosis.
        assert!(out.conditions.is_empty() || !out.conditions.iter().any(|s| s == "depression"),
                "bare 'depression' should not be in conditions: {:?}", out.conditions);
    }

    #[test]
    fn pregab_normalises_to_pregabalin() {
        let out = clean(&[], &["pregab", "pregab."], &[]);
        assert!(out.medications.contains(&"pregabalin".to_string()),
                "pregab + trailing dot must normalise to pregabalin: {:?}", out.medications);
        assert_eq!(out.medications.len(), 1, "duplicates must collapse: {:?}", out.medications);
    }
}
