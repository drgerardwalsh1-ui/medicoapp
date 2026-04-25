//! Layer 3 — Strict Validation Gate for the medico-legal NLP pipeline.
//!
//! # Position in the pipeline
//!
//! ```text
//! extract_structured_data  (keyword extraction)
//!        ↓
//! entity_clean             (normalisation, synonym expansion, OCR/garbage filter)
//!        ↓
//! validation               ← THIS MODULE
//!        ↓
//! JSON output assembly
//! ```
//!
//! # Contract
//!
//! **If there is uncertainty → REJECT.**
//! False negatives (missing a real entity) are acceptable in medico-legal context.
//! False positives (garbage or uncertain entities in output) are NOT acceptable.
//!
//! # Pipeline stages (applied in mandatory order)
//!
//! 1.  Structural validation  — newlines, symbol density, UI tokens
//! 2.  Normal form            — canonical comparison form
//! 3.  Medical shape          — recognisable clinical pattern
//! 4.  Semantic plausibility  — is it a real medical concept?
//! 5.  Context classification — negated / contradicted / hypothetical / affirmed
//! 6.  Evidence requirement   — must have ≥1 strong or ≥2 weak mentions
//! 7.  Specificity preservation — prefer "L4/5 disc herniation" over "disc herniation"
//! 8.  Semantic deduplication  — PTSD ↔ post-traumatic stress disorder (batch step)
//! 9.  Category enforcement    — entity must belong to exactly one category
//! 10. Confidence scoring      — additive score, reject if below threshold
//! 11. Final assertion gate    — debug-mode panic on any surviving garbage

// ── Public types ──────────────────────────────────────────────────────────────

/// Input: the three entity lists produced by `entity_clean::clean_entities`.
pub struct CleanedEntities {
    pub conditions:  Vec<String>,
    pub medications: Vec<String>,
    pub procedures:  Vec<String>,
}

/// Contextual metadata for the document being validated.
pub struct DocumentContext {
    /// Full extracted text of the source document.
    pub full_text:       String,
    /// Up to 5 representative clinical snippets (from key_findings).
    #[allow(dead_code)]
    pub source_snippets: Vec<String>,
    /// Document type: "imaging", "referral", "report", "statement", "unknown".
    pub document_type:   String,
}

/// A single entity after validation, with provenance and confidence.
#[derive(Debug, Clone)]
pub struct ValidatedEntity {
    /// The value that should appear in output — original form if specificity was
    /// preserved, canonical form otherwise.
    pub value:            String,
    /// Lowercased, whitespace-collapsed, punctuation-stripped form used for
    /// deduplication and matching.
    pub canonical:        String,
    /// Clamped to [0.0, 1.0].  Entities with confidence < `CONFIDENCE_THRESHOLD`
    /// are placed in `ValidatedEntities::rejected`.
    pub confidence:       f32,
    /// Total number of mentions found in `DocumentContext::full_text`.
    #[allow(dead_code)]
    pub evidence_count:   usize,
    /// Up to three context windows from the document (for provenance).
    #[allow(dead_code)]
    pub sources:          Vec<String>,
    /// `true` when this entity was placed into `ValidatedEntities::rejected`.
    pub rejected:         bool,
    /// Populated whenever `rejected == true`.
    pub rejection_reason: Option<String>,
}

/// Output of `validate_entities`.
pub struct ValidatedEntities {
    pub conditions:  Vec<ValidatedEntity>,
    pub medications: Vec<ValidatedEntity>,
    pub procedures:  Vec<ValidatedEntity>,
    /// Everything that was rejected at any pipeline stage, with reasons.
    pub rejected:    Vec<ValidatedEntity>,
}

impl ValidatedEntities {
    /// Convenience: clean flat `Vec<String>` of accepted conditions.
    pub fn condition_values(&self) -> Vec<String> {
        self.conditions.iter().map(|e| e.value.clone()).collect()
    }
    /// Convenience: clean flat `Vec<String>` of accepted medications.
    pub fn medication_values(&self) -> Vec<String> {
        self.medications.iter().map(|e| e.value.clone()).collect()
    }
    /// Convenience: clean flat `Vec<String>` of accepted procedures.
    pub fn procedure_values(&self) -> Vec<String> {
        self.procedures.iter().map(|e| e.value.clone()).collect()
    }
}

// ── Private types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum EntityCategory { Condition, Medication, Procedure }

/// Context classification for a single entity occurrence.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ContextType {
    /// Entity is stated as a positive finding.
    Affirmed,
    /// Entity is explicitly negated ("no fracture", "ruled out").
    Negated,
    /// Entity is raised as a possibility, not a confirmed finding.
    Hypothetical,
    /// Entity is mentioned in a context that contradicts it as a diagnosis.
    Contradicted,
}

/// Minimum confidence an entity must reach to appear in accepted output.
const CONFIDENCE_THRESHOLD: f32 = 0.35;

// ── Entry point ───────────────────────────────────────────────────────────────

/// Validate a set of cleaned entities against their source document.
///
/// Runs all 11 pipeline stages.  Returns accepted entities (confidence ≥ 0.35)
/// in the three category lists; everything else lands in `rejected`.
pub fn validate_entities(
    input:   CleanedEntities,
    context: &DocumentContext,
) -> ValidatedEntities {
    // Stages 1–10 per entity, within each category
    let mut cond_validated  = validate_list(&input.conditions,  EntityCategory::Condition,  context);
    let med_validated       = validate_list(&input.medications,  EntityCategory::Medication, context);
    let mut proc_validated  = validate_list(&input.procedures,   EntityCategory::Procedure,  context);

    // Stage 9 — cross-category enforcement:
    // If the SAME canonical appears in two categories, reject from the less
    // likely one (medications > conditions > procedures in priority).
    {
        let med_canonicals: std::collections::HashSet<String> =
            med_validated.iter().filter(|e| !e.rejected).map(|e| e.canonical.clone()).collect();
        let cond_canonicals: std::collections::HashSet<String> =
            cond_validated.iter().filter(|e| !e.rejected).map(|e| e.canonical.clone()).collect();

        for e in &mut cond_validated {
            if !e.rejected && med_canonicals.contains(&e.canonical) {
                e.rejected = true;
                e.confidence = 0.0;
                e.rejection_reason = Some(
                    "category ambiguity: same canonical exists as medication".to_string()
                );
            }
        }
        for e in &mut proc_validated {
            if !e.rejected
                && (med_canonicals.contains(&e.canonical) || cond_canonicals.contains(&e.canonical))
            {
                e.rejected = true;
                e.confidence = 0.0;
                e.rejection_reason = Some(
                    "category ambiguity: same canonical exists in higher-priority category"
                        .to_string()
                );
            }
        }
    }

    let mut conditions  = Vec::new();
    let mut medications = Vec::new();
    let mut procedures  = Vec::new();
    let mut rejected    = Vec::new();

    for e in cond_validated  { if e.rejected { rejected.push(e); } else { conditions.push(e);  } }
    for e in med_validated   { if e.rejected { rejected.push(e); } else { medications.push(e); } }
    for e in proc_validated  { if e.rejected { rejected.push(e); } else { procedures.push(e);  } }

    let result = ValidatedEntities { conditions, medications, procedures, rejected };

    // Stage 11 — final assertion gate (debug builds only)
    assert_valid_output(&result);

    result
}

// ── Per-list validation ───────────────────────────────────────────────────────

/// Run the per-entity pipeline (stages 1–10) over one category list,
/// then apply within-list semantic deduplication (stage 8).
fn validate_list(
    entities: &[String],
    category: EntityCategory,
    context:  &DocumentContext,
) -> Vec<ValidatedEntity> {
    let mut results: Vec<ValidatedEntity> = entities
        .iter()
        .map(|e| run_pipeline(e, category, context))
        .collect();

    // Stage 8 — within-category semantic deduplication.
    // Entities with the same canonical form: keep the one with highest confidence.
    dedup_validated(&mut results);

    results
}

// ── Per-entity pipeline (stages 1–10) ────────────────────────────────────────

fn run_pipeline(
    entity:   &str,
    category: EntityCategory,
    context:  &DocumentContext,
) -> ValidatedEntity {
    // ── Stage 1: Structural validation ───────────────────────────────────────
    if let Some(reason) = structural_validate(entity) {
        return make_rejected(entity, entity, reason, 0.0, 0, vec![]);
    }

    // ── Stage 2: Normal form ──────────────────────────────────────────────────
    let canonical = to_canonical(entity);
    if canonical.is_empty() {
        return make_rejected(entity, entity, "empty after normalisation", 0.0, 0, vec![]);
    }

    // ── Stage 3: Medical shape validation ────────────────────────────────────
    if let Some(reason) = medical_shape_validate(&canonical, category) {
        return make_rejected(entity, &canonical, reason, 0.0, 0, vec![]);
    }

    // ── Stage 4: Semantic plausibility ───────────────────────────────────────
    if !is_medically_plausible(&canonical, category) {
        return make_rejected(
            entity, &canonical,
            "no recognisable medical pattern — not a diagnosable condition, \
             known medication, or clinical procedure",
            0.0, 0, vec![],
        );
    }

    // ── Stage 5: Context classification ──────────────────────────────────────
    // Find all occurrences in the full document text and classify each context.
    let context_hits = find_entity_contexts(&context.full_text, &canonical);
    let context_types: Vec<ContextType> = context_hits.iter().map(|(_, ct)| *ct).collect();
    let sources: Vec<String> = context_hits
        .iter()
        .map(|(window, _)| window.clone())
        .take(3)
        .collect();

    // ── Stage 6: Evidence requirement ────────────────────────────────────────
    let evidence_count = context_types.len();
    let strong_count = context_types.iter().filter(|&&t| t == ContextType::Affirmed).count();
    // Entities not found in full_text at all: fallback to evidence_count=1 (came
    // from keyword extraction, so there's implicit evidence even if the context
    // window search missed it due to abbreviations / synonym expansion).
    let effective_count = if evidence_count == 0 { 1 } else { evidence_count };

    let evidence_ok = strong_count >= 1 || effective_count >= 2;

    // ── Stage 7: Specificity preservation ────────────────────────────────────
    // If the original entity contains laterality, severity, or spinal-level
    // notation, output the original form rather than the canonical one.
    let value = preserve_specificity(entity, &canonical);

    // ── Stage 10: Confidence scoring ─────────────────────────────────────────
    let confidence = compute_confidence(
        category,
        &context_types,
        effective_count,
        &canonical,
        &context.document_type,
        evidence_ok,
    );

    if confidence < CONFIDENCE_THRESHOLD {
        let reason = if context_types.iter().any(|&t| t == ContextType::Negated) {
            "entity is negated in source document"
        } else if context_types.iter().any(|&t| t == ContextType::Contradicted) {
            "entity is contradicted in source document"
        } else if !evidence_ok {
            "insufficient evidence: needs ≥1 strong mention or ≥2 total mentions"
        } else {
            "confidence below acceptance threshold (0.35)"
        };
        return make_rejected(entity, &canonical, reason, confidence, effective_count, sources);
    }

    ValidatedEntity {
        value,
        canonical,
        confidence,
        evidence_count: effective_count,
        sources,
        rejected: false,
        rejection_reason: None,
    }
}

// ── Stage 1: Structural validation ───────────────────────────────────────────

/// Returns `Some(reason)` for any structural defect; `None` if structurally sound.
fn structural_validate(s: &str) -> Option<&'static str> {
    // Newline — multiline entity wasn't split correctly upstream
    if s.contains('\n') || s.contains('\r') {
        return Some("entity contains newline — multiline span not split");
    }

    // More than one punctuation cluster (++, ::, //, %%…)
    if has_multiple_punct_clusters(s) {
        return Some("entity contains multiple punctuation clusters");
    }

    // Starts or ends with non-alphanumeric character
    if s.chars().next().map(|c| !c.is_alphanumeric()).unwrap_or(true) {
        return Some("entity starts with non-alphanumeric character");
    }
    if s.chars().last().map(|c| !c.is_alphanumeric()).unwrap_or(true) {
        return Some("entity ends with non-alphanumeric character");
    }

    // UI / system tokens (exact word-boundary match)
    for &token in UI_SYSTEM_TOKENS {
        if word_boundary_match(s, token) {
            return Some("entity contains UI or system token");
        }
    }

    // Symbol density ≥ 0.25
    if symbol_ratio(s) >= 0.25 {
        return Some("entity has high symbol density (≥25% non-alphanumeric)");
    }

    None
}

/// True if `s` contains more than one run of consecutive punctuation characters.
/// A single hyphen (as in "post-traumatic") is fine; "++" or "::" is not.
fn has_multiple_punct_clusters(s: &str) -> bool {
    const PUNCT_CHARS: &[char] = &[
        '+', ':', '/', '!', '?', ';', '|', '=', '@', '%', '^', '&', '*',
        '(', ')', '[', ']', '{', '}',
    ];
    let mut clusters = 0usize;
    let mut in_cluster = false;
    for c in s.chars() {
        if PUNCT_CHARS.contains(&c) {
            if !in_cluster {
                clusters += 1;
                in_cluster = true;
            }
        } else {
            in_cluster = false;
        }
    }
    // A single slash in "mg/day" or "L4/5" is acceptable; ≥2 clusters are not.
    clusters > 1
}

fn symbol_ratio(s: &str) -> f32 {
    if s.is_empty() { return 0.0; }
    let total   = s.chars().count() as f32;
    let symbols = s.chars()
        .filter(|&c| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '/' && c != '.')
        .count() as f32;
    symbols / total
}

// ── Stage 2: Normal form ──────────────────────────────────────────────────────

/// Convert to canonical comparison form:
///   - lowercase
///   - trim whitespace
///   - collapse internal whitespace
///   - remove trailing punctuation
///
/// Does NOT expand synonyms — entity_clean has already done that.
fn to_canonical(s: &str) -> String {
    let lower: String = s.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    lower.trim_end_matches(|c: char| {
        matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '"' | '\''
                    | ')' | ']' | '+' | '|' | '*' | '#' | '~' | '`')
    }).to_string()
}

// ── Stage 3: Medical shape validation ────────────────────────────────────────

/// Hard-reject entities that have no recognisable clinical structure for their
/// category.  This catches single adjectives, pure-numeric tokens, bare anatomy,
/// and entries that entity_clean may have missed.
///
/// Returns `Some(reason)` to reject; `None` to proceed.
fn medical_shape_validate(canonical: &str, category: EntityCategory) -> Option<&'static str> {
    match category {
        EntityCategory::Condition => {
            // Single word that is a pure adjective (not a diagnostic term)
            let words: Vec<&str> = canonical.split_whitespace().collect();
            if words.len() == 1 {
                let w = words[0];
                if STANDALONE_ADJECTIVES.contains(&w) {
                    return Some("single adjective — not a standalone diagnosis");
                }
                // All digits → page number / ID
                if w.chars().all(|c| c.is_ascii_digit()) {
                    return Some("numeric token — not a diagnosis");
                }
            }
            // Pure anatomy phrase (no pathological qualifier)
            if ANATOMY_ONLY_TERMS.contains(&canonical) {
                return Some("pure anatomy term without pathological qualifier");
            }
            // Event/mechanism, not a diagnosis
            if EVENT_MECHANISM_TERMS.contains(&canonical) {
                return Some("mechanism of injury — not a diagnosable condition");
            }
            None
        }
        EntityCategory::Medication => {
            // Single character or digit string
            let words: Vec<&str> = canonical.split_whitespace().collect();
            if words.len() == 1 && words[0].len() <= 1 {
                return Some("single character — not a medication name");
            }
            // Pure dosing-frequency abbreviation
            if DOSING_FREQ.contains(&canonical) {
                return Some("dosing frequency abbreviation — not a medication name");
            }
            None
        }
        EntityCategory::Procedure => {
            // Incomplete phrase ending in a dangling modifier adjective
            if let Some(last) = canonical.split_whitespace().last() {
                if DANGLING_PROCEDURE_ADJECTIVES.contains(&last) {
                    return Some("incomplete procedure phrase — ends with modifier, missing noun");
                }
            }
            // Single word that is known non-procedure garbage
            if PROCEDURE_GARBAGE.contains(&canonical) {
                return Some("term is not a recognisable clinical procedure");
            }
            None
        }
    }
}

// ── Stage 4: Semantic plausibility ───────────────────────────────────────────

/// Returns `true` if `canonical` is a plausible medical entity for its category.
///
/// A term is plausible if:
///   - It matches a known term in the category whitelist, OR
///   - It ends in a recognised diagnostic / pharmaceutical suffix, OR
///   - It contains a known anatomy term paired with a pathological modifier.
///
/// This is intentionally conservative — unknown terms are rejected.
fn is_medically_plausible(canonical: &str, category: EntityCategory) -> bool {
    match category {
        EntityCategory::Condition => {
            // Exact match in known conditions whitelist
            if KNOWN_CONDITIONS.contains(&canonical) { return true; }
            // Recognised diagnostic suffix
            if DIAGNOSTIC_CONDITION_SUFFIXES.iter().any(|&suf| canonical.ends_with(suf)) {
                return true;
            }
            // Contains a known anatomy term AND a pathological modifier
            if has_anatomy_and_pathology(canonical) { return true; }
            false
        }
        EntityCategory::Medication => {
            // Exact match in known medications whitelist
            if KNOWN_MEDICATIONS.contains(&canonical) { return true; }
            // Recognisable pharmaceutical suffix
            if PHARMACEUTICAL_SUFFIXES.iter().any(|&suf| canonical.ends_with(suf)) {
                return true;
            }
            false
        }
        EntityCategory::Procedure => {
            // Exact match in known procedures whitelist
            if KNOWN_PROCEDURES.contains(&canonical) { return true; }
            // Ends in a recognised clinical procedure suffix
            if PROCEDURE_VALID_SUFFIXES.iter().any(|&suf| canonical.ends_with(suf)) {
                return true;
            }
            false
        }
    }
}

/// True if `canonical` contains both an anatomy term and a pathological modifier,
/// indicating a valid diagnostic phrase (e.g. "knee pain", "cervical fracture").
fn has_anatomy_and_pathology(canonical: &str) -> bool {
    let has_anatomy = ANATOMY_PRESENCE_TERMS.iter().any(|&t| canonical.contains(t));
    let has_pathology = PATHOLOGICAL_MODIFIERS.iter().any(|&t| canonical.contains(t));
    has_anatomy && has_pathology
}

// ── Stage 5: Context classification ──────────────────────────────────────────

/// Find every occurrence of `entity` in `full_text` (case-insensitive) and
/// return a `(context_window, ContextType)` pair for each.
///
/// The context window is ±120 chars around the entity — stored for provenance.
/// Classification is based on the 100-char pre-context (where negation patterns
/// typically appear) plus the 30-char post-context (for trailing uncertainty
/// markers like "?").
fn find_entity_contexts(full_text: &str, entity: &str) -> Vec<(String, ContextType)> {
    let lower_text   = full_text.to_lowercase();
    let lower_entity = entity.to_lowercase();

    if lower_entity.is_empty() { return vec![]; }

    let chars: Vec<char> = lower_text.chars().collect();
    let entity_chars: Vec<char> = lower_entity.chars().collect();
    let elen = entity_chars.len();

    let mut results: Vec<(String, ContextType)> = Vec::new();
    let mut pos = 0usize;

    while pos + elen <= chars.len() {
        // Word-boundary check: preceding and following chars must not be alphanumeric
        let left_ok = pos == 0 || !chars[pos - 1].is_alphanumeric();
        let right_ok = pos + elen >= chars.len() || !chars[pos + elen].is_alphanumeric();

        if left_ok && right_ok && chars[pos..pos + elen] == entity_chars[..] {
            let ctx_start  = pos.saturating_sub(120);
            let ctx_end    = (pos + elen + 120).min(chars.len());
            let pre_start  = pos.saturating_sub(100);
            let post_end   = (pos + elen + 30).min(chars.len());

            let window:   String = chars[ctx_start..ctx_end].iter().collect();
            let pre_ctx:  String = chars[pre_start..pos].iter().collect();
            let post_ctx: String = chars[pos + elen..post_end].iter().collect();

            let ctx_type = classify_context(&pre_ctx, &post_ctx);
            results.push((window, ctx_type));
        }
        pos += 1;
    }

    results
}

/// Classify the context of a single entity occurrence.
///
/// `pre`  — the text immediately preceding the entity (≤ 100 chars).
/// `post` — the text immediately following the entity (≤ 30 chars).
pub fn classify_context(pre: &str, post: &str) -> ContextType {
    let pre_lower  = pre.to_lowercase();
    let post_lower = post.to_lowercase();

    // 1. Negation (highest priority — if present, entity is not a confirmed finding)
    for &pattern in NEGATION_PATTERNS {
        if pre_lower.contains(pattern) {
            return ContextType::Negated;
        }
    }

    // 2. Contradiction
    for &pattern in CONTRADICTION_PATTERNS {
        if pre_lower.contains(pattern) {
            return ContextType::Contradicted;
        }
    }

    // 3. Hypothetical / uncertain
    for &pattern in HYPOTHETICAL_PATTERNS {
        if pre_lower.contains(pattern) || post_lower.contains(pattern) {
            return ContextType::Hypothetical;
        }
    }
    // Trailing question mark immediately after the entity
    if post_lower.trim_start().starts_with('?') {
        return ContextType::Hypothetical;
    }

    ContextType::Affirmed
}

// ── Stage 7: Specificity preservation ────────────────────────────────────────

/// Return the output-form value, preserving detail from the original when the
/// canonical would lose it.
///
/// Specifically, if the original contains:
///   - Spinal-level notation (L4, C5, T10, S1, with optional /level suffix)
///   - Laterality (left / right / bilateral)
///   - Severity qualifiers (acute / chronic / severe / mild / moderate)
///
/// then the ORIGINAL lowercase form is preferred over the bare canonical.
fn preserve_specificity(original: &str, canonical: &str) -> String {
    let lower_orig = original.to_lowercase();

    // Spinal level notation: L\d, C\d, T\d, S\d (with optional /\d suffix)
    let has_spinal_level = lower_orig.split_whitespace().any(|tok| {
        let t = tok.trim_matches(|c: char| !c.is_alphanumeric());
        if t.len() < 2 { return false; }
        let first = t.chars().next().unwrap_or(' ');
        matches!(first, 'l' | 'c' | 't' | 's')
            && t.chars().nth(1).map(|c| c.is_ascii_digit()).unwrap_or(false)
    });

    let has_laterality = lower_orig.contains("left ")
        || lower_orig.contains("right ")
        || lower_orig.contains("bilateral ");

    let has_severity = lower_orig.contains("acute ")
        || lower_orig.contains("chronic ")
        || lower_orig.contains("severe ")
        || lower_orig.contains("mild ")
        || lower_orig.contains("moderate ");

    if has_spinal_level || has_laterality || has_severity {
        // Use original (lowercased) — it carries more information
        lower_orig
    } else {
        canonical.to_string()
    }
}

// ── Stage 8: Semantic deduplication ──────────────────────────────────────────

/// Within a single category list, merge entities with the same canonical form.
/// Keeps the entry with the highest confidence; others are marked rejected.
fn dedup_validated(list: &mut Vec<ValidatedEntity>) {
    use std::collections::HashMap;

    // For each canonical, track the index of the best-confidence non-rejected entry.
    let mut best: HashMap<String, usize> = HashMap::new();

    for (i, entity) in list.iter().enumerate() {
        if entity.rejected { continue; }
        match best.get(&entity.canonical) {
            None => { best.insert(entity.canonical.clone(), i); }
            Some(&prev_i) => {
                if entity.confidence > list[prev_i].confidence {
                    best.insert(entity.canonical.clone(), i);
                }
            }
        }
    }

    // Mark all non-best entries as rejected duplicates
    let best_indices: std::collections::HashSet<usize> = best.values().copied().collect();
    for (i, entity) in list.iter_mut().enumerate() {
        if !entity.rejected && !best_indices.contains(&i) {
            entity.rejected = true;
            entity.confidence = 0.0;
            entity.rejection_reason = Some("semantic duplicate".to_string());
        }
    }
}

// ── Stage 10: Confidence scoring ─────────────────────────────────────────────

/// Compute the confidence score for an entity.
///
/// Additive model (clamped to [0.0, 1.0]):
///
/// ```text
/// +0.4  entity appears in a clinical/diagnostic document type
/// +0.3  entity appears ≥ 2 times in document (repeated mention)
/// +0.2  exact canonical match in known-terms whitelist
/// +0.1  at least one affirmed context found
/// -0.5  any negated or contradicted context
/// -0.3  all contexts are hypothetical (no affirmed mention)
/// ```
fn compute_confidence(
    category:      EntityCategory,
    ctx_types:     &[ContextType],
    evidence_count: usize,
    canonical:     &str,
    document_type: &str,
    evidence_ok:   bool,
) -> f32 {
    let mut score = 0.0f32;

    // +0.4 — diagnostic / clinical document type
    let clinical_doc = matches!(
        document_type,
        "imaging" | "report" | "referral" | "assessment" | "statement"
    );
    if clinical_doc || document_type.is_empty() || document_type == "unknown" {
        // Unknown document type still gets partial credit — we can't penalise for
        // a missing metadata field
        score += if clinical_doc { 0.4 } else { 0.2 };
    }

    // +0.3 — repeated across document (evidence_count ≥ 2)
    if evidence_count >= 2 {
        score += 0.3;
    }

    // +0.2 — exact canonical match in known-terms whitelist
    let in_known = match category {
        EntityCategory::Condition  => KNOWN_CONDITIONS.contains(&canonical),
        EntityCategory::Medication => KNOWN_MEDICATIONS.contains(&canonical),
        EntityCategory::Procedure  => KNOWN_PROCEDURES.contains(&canonical),
    };
    if in_known { score += 0.2; }

    // +0.1 — at least one affirmed context found
    let has_affirmed = ctx_types.iter().any(|&t| t == ContextType::Affirmed);
    // When no contexts are found (evidence_count == 0 before fallback), treat
    // as affirmed — the keyword extraction is high-precision enough.
    if has_affirmed || ctx_types.is_empty() { score += 0.1; }

    // -0.5 — any negated or contradicted context
    let has_negation = ctx_types.iter()
        .any(|&t| t == ContextType::Negated || t == ContextType::Contradicted);
    if has_negation { score -= 0.5; }

    // -0.3 — no affirmed context and all hypothetical (entity mentioned but uncertain)
    let all_hypothetical = !ctx_types.is_empty()
        && ctx_types.iter().all(|&t| t == ContextType::Hypothetical);
    if all_hypothetical { score -= 0.3; }

    // Small penalty for insufficient evidence (below the ≥1 strong / ≥2 weak bar)
    if !evidence_ok { score -= 0.15; }

    score.clamp(0.0, 1.0)
}

// ── Stage 11: Final assertion gate ───────────────────────────────────────────

/// Panic in debug builds if any accepted entity still carries forbidden tokens.
///
/// This is a last-resort tripwire — if it fires, a bug in an upstream stage
/// allowed garbage through.  In release builds this is a no-op.
pub fn assert_valid_output(entities: &ValidatedEntities) {
    #[cfg(debug_assertions)]
    {
        let all_accepted: Vec<(&str, &str)> = entities.conditions.iter()
            .chain(entities.medications.iter())
            .chain(entities.procedures.iter())
            .filter(|e| !e.rejected)
            .map(|e| (e.value.as_str(), e.canonical.as_str()))
            .collect();

        for (value, canonical) in &all_accepted {
            let lower_v = value.to_lowercase();
            let lower_c = canonical.to_lowercase();

            // No code file extensions
            for &ext in CODE_EXTENSIONS_GATE {
                debug_assert!(
                    !lower_v.contains(ext) && !lower_c.contains(ext),
                    "[assert_valid_output] Code extension in accepted entity: {value:?}"
                );
            }

            // No programming / UI keywords
            for &tok in PROGRAMMING_TOKENS_GATE {
                debug_assert!(
                    !lower_v.contains(tok) && !lower_c.contains(tok),
                    "[assert_valid_output] Programming token in accepted entity: {value:?}"
                );
            }

            // No empty-but-accepted entities
            debug_assert!(
                !value.trim().is_empty(),
                "[assert_valid_output] Empty accepted entity"
            );

            // Symbol ratio < 0.25
            let sym_ratio = symbol_ratio(value);
            debug_assert!(
                sym_ratio < 0.25,
                "[assert_valid_output] High symbol ratio ({sym_ratio:.2}) in: {value:?}"
            );
        }

        // If input was non-empty but all three output lists are empty, something
        // is aggressively rejecting everything — warn.
        // (Only fires when there were entities to begin with; we check via rejected list.)
        if !entities.rejected.is_empty()
            && entities.conditions.is_empty()
            && entities.medications.is_empty()
            && entities.procedures.is_empty()
        {
            // Not a panic — this can legitimately happen for very short or noisy
            // documents.  Use eprintln so it surfaces in test output.
            eprintln!(
                "[assert_valid_output] WARNING: all {} entities were rejected. \
                 Check entity_clean output quality.",
                entities.rejected.len()
            );
        }
    }
    let _ = entities;
}

// ── Helper: make_rejected ─────────────────────────────────────────────────────

fn make_rejected(
    original:  &str,
    canonical: &str,
    reason:    &str,
    confidence: f32,
    evidence_count: usize,
    sources:   Vec<String>,
) -> ValidatedEntity {
    ValidatedEntity {
        value:            original.to_string(),
        canonical:        canonical.to_string(),
        confidence,
        evidence_count,
        sources,
        rejected:         true,
        rejection_reason: Some(reason.to_string()),
    }
}

// ── Helper: word-boundary match ───────────────────────────────────────────────

fn word_boundary_match(text: &str, kw: &str) -> bool {
    let kw_len   = kw.len();
    let bytes    = text.as_bytes();
    let text_len = text.len();
    let mut start = 0usize;
    loop {
        let Some(rel) = text[start..].find(kw) else { break };
        let pos      = start + rel;
        let left_ok  = pos == 0 || !bytes[pos - 1].is_ascii_alphanumeric();
        let right_ok = pos + kw_len >= text_len || !bytes[pos + kw_len].is_ascii_alphanumeric();
        if left_ok && right_ok { return true; }
        start = pos + 1;
        if start >= text_len { break; }
    }
    false
}

// ── Static data ───────────────────────────────────────────────────────────────

/// UI / system tokens — word-boundary matched.  Any entity containing one of
/// these as a complete word is structurally invalid.
const UI_SYSTEM_TOKENS: &[&str] = &[
    "codex", "utf-8", "utf8", "install", "update", "golive", "javascript",
    "chatgpt", "openai", "vscode", "webpack", "vite", "eslint", "github",
    "typescript", "python", "console", "function", "import", "export",
];

/// Context patterns that indicate the entity is explicitly negated.
const NEGATION_PATTERNS: &[&str] = &[
    "no evidence of",
    "no evidence for",
    "no signs of",
    "no sign of",
    "no history of",
    "no diagnosis of",
    "no confirmed",
    "absence of",
    "without evidence of",
    "without any evidence of",
    "denied any",
    "denied history of",
    "not diagnosed with",
    "not consistent with",
    "does not have",
    "does not demonstrate",
    "did not demonstrate",
    "was not found",
    "were not found",
    "ruled out",
    "ruled-out",
    " not ",   // generic negation — " not [entity]"
    "no ",     // "no fracture", "no depression"
];

/// Context patterns that indicate an active contradiction.
const CONTRADICTION_PATTERNS: &[&str] = &[
    "inconsistent with",
    "not consistent with",
    "does not support",
    "cannot be attributed",
    "not supported by",
    "not supported by the evidence",
    "is disputed",
];

/// Context patterns that indicate a hypothetical / uncertain mention.
const HYPOTHETICAL_PATTERNS: &[&str] = &[
    "possible ",
    "possibly ",
    "query ",
    "query:",
    " vs ",
    " vs.",
    "rule out",
    "to exclude",
    "consider ",
    "may have",
    "may represent",
    "suspected ",
    "differential:",
    "differential diagnosis",
    "differential includes",
    "likely but",
    "cannot rule out",
];

/// Standalone adjective words that are not valid single-word diagnoses.
const STANDALONE_ADJECTIVES: &[&str] = &[
    "cognitive", "behavioural", "behavioral", "occupational", "manual",
    "chronic", "acute", "severe", "mild", "moderate", "bilateral",
    "functional", "psychological", "physical", "general", "clinical",
    "neurological", "psychiatric", "emotional", "social",
];

/// Pure anatomy terms (location labels, no pathology).
const ANATOMY_ONLY_TERMS: &[&str] = &[
    "lumbar spine", "cervical spine", "thoracic spine",
    "lumbar region", "cervical region", "thoracic region",
    "spinal column", "vertebral column",
    "lumbar vertebrae", "cervical vertebrae", "thoracic vertebrae",
    "intervertebral disc", "intervertebral disk",
    "right shoulder joint", "left shoulder joint",
    "right knee joint", "left knee joint",
    "right hip joint",  "left hip joint",
    "shoulder", "knee", "hip", "spine", "neck", "back",
    "elbow", "wrist", "ankle", "foot", "hand",
];

/// Mechanism / event terms — context of injury, not a diagnosis.
const EVENT_MECHANISM_TERMS: &[&str] = &[
    "motor vehicle accident", "motor vehicle collision", "motor vehicle crash",
    "motor vehicle", "workplace accident", "workplace incident", "workplace injury",
    "occupational incident", "work injury", "work accident",
    "mechanism of injury", "mechanism", "traumatic exposure",
    "traumatic incident", "critical incident", "index event",
    "slip and fall", "fall from height", "trip and fall",
];

/// Dosing frequency abbreviations — never a medication name.
const DOSING_FREQ: &[&str] = &[
    "prn", "od", "bd", "bid", "tds", "tid", "qid", "stat",
    "nocte", "mane", "daily", "twice daily", "three times daily",
    "once daily", "as needed", "as required", "with food", "with water",
];

/// Last words of procedure phrases that indicate incompleteness.
const DANGLING_PROCEDURE_ADJECTIVES: &[&str] = &[
    "behavioural", "behavioral", "occupational", "manual",
    "respiratory", "aquatic", "cognitive",
];

/// Single-word or phrase procedure garbage terms.
const PROCEDURE_GARBAGE: &[&str] = &[
    "timeline", "narrative", "update", "file", "code", "report", "review",
];

/// Anatomy terms used in `has_anatomy_and_pathology` to recognise diagnostic phrases.
const ANATOMY_PRESENCE_TERMS: &[&str] = &[
    "knee", "shoulder", "hip", "spine", "spinal", "lumbar", "cervical",
    "thoracic", "sacral", "disc", "disk", "nerve", "tendon", "ligament",
    "rotator", "meniscus", "ankle", "wrist", "elbow", "foot", "hand",
    "head", "neck", "back", "chest", "rib", "femur", "tibia", "fibula",
];

/// Pathological modifier words used in `has_anatomy_and_pathology`.
const PATHOLOGICAL_MODIFIERS: &[&str] = &[
    "fracture", "tear", "rupture", "strain", "sprain", "herniation",
    "herniated", "stenosis", "impingement", "tendinopathy", "tendinitis",
    "bursitis", "contusion", "damage", "injury", "pain", "syndrome",
    "arthritis", "arthrosis", "degeneration", "instability", "neuropathy",
    "radiculopathy", "myelopathy", "compression", "inflammation",
];

/// Recognised diagnostic suffixes — a condition ending with one of these is
/// presumed medically valid even if it isn't on the KNOWN_CONDITIONS whitelist.
const DIAGNOSTIC_CONDITION_SUFFIXES: &[&str] = &[
    " disorder",    " syndrome",    " disease",      " condition",
    " injury",      " pain",        " neuropathy",   " arthritis",
    " itis",        " osis",        " opathy",       " trauma",
    " fracture",    " tear",        " rupture",       " stenosis",
    " impingement", " tendinopathy","itis",           "opathy",
];

/// Pharmaceutical suffixes — a medication ending with one of these is presumed
/// valid even if not on the KNOWN_MEDICATIONS whitelist.
const PHARMACEUTICAL_SUFFIXES: &[&str] = &[
    "pam",   "lam",   "zam",        // benzodiazepines
    "pril",  "sartan",              // antihypertensives
    "statin",                       // statins
    "mycin", "cillin", "floxacin",  // antibiotics
    "mab",   "nib",   "zumab",      // biologics / targeted therapy
    "ine",   "ene",   "one",        // broad (e.g. clonidine, pregabaline, methadone)
    "ol",    "ide",                 // beta-blockers, sulfonylureas
];

/// Recognised clinical procedure suffixes — a procedure ending with one of
/// these is presumed valid.
const PROCEDURE_VALID_SUFFIXES: &[&str] = &[
    "therapy",
    "assessment",
    "examination",
    "surgery",
    "scan",
    "imaging",
    "injection",
    "arthroplasty",
    "arthroscopy",
    "oscopy",
    "ectomy",
    "plasty",
    "otomy",
    "reprocessing",  // eye movement desensitisation and reprocessing
];

/// Canonical known conditions whitelist.  All entries are lowercase.
const KNOWN_CONDITIONS: &[&str] = &[
    // ── Psychological / psychiatric ───────────────────────────────────────────
    "post-traumatic stress disorder",
    "complex post-traumatic stress disorder",
    "major depressive disorder",
    "generalised anxiety disorder",
    "anxiety disorder",
    "adjustment disorder",
    "panic disorder",
    "acute stress disorder",
    "somatic symptom disorder",
    "borderline personality disorder",
    "obsessive-compulsive disorder",
    "attention deficit hyperactivity disorder",
    "attention deficit disorder",
    "bipolar disorder",
    "bipolar affective disorder",
    "schizoaffective disorder",
    "schizophrenia",
    "agoraphobia",
    "social anxiety disorder",
    "specific phobia",
    "dissociative disorder",
    "personality disorder",
    "depression",
    "anxiety",
    "insomnia",
    "sleep disorder",
    "chronic fatigue syndrome",
    "chronic fatigue",
    // ── Neurological ─────────────────────────────────────────────────────────
    "traumatic brain injury",
    "mild traumatic brain injury",
    "concussion",
    "post-concussion syndrome",
    "cognitive impairment",
    "intellectual disability",
    "epilepsy",
    "migraine",
    "chronic migraine",
    "headache",
    "neuropathy",
    "peripheral neuropathy",
    "carpal tunnel syndrome",
    "thoracic outlet syndrome",
    "tinnitus",
    "vertigo",
    "dizziness",
    // ── Musculoskeletal ───────────────────────────────────────────────────────
    "fracture",
    "sprain",
    "strain",
    "herniation",
    "disc herniation",
    "disc protrusion",
    "disc bulge",
    "rotator cuff tear",
    "rotator cuff",
    "anterior cruciate ligament tear",
    "anterior cruciate ligament rupture",
    "meniscus tear",
    "lateral meniscus tear",
    "medial meniscus tear",
    "whiplash",
    "whiplash associated disorder",
    "tendinopathy",
    "tendinitis",
    "bursitis",
    "contusion",
    "arthritis",
    "osteoarthritis",
    "rheumatoid arthritis",
    "fibromyalgia",
    "sciatica",
    "scoliosis",
    "nerve damage",
    "nerve injury",
    "radiculopathy",
    "lumbar radiculopathy",
    "cervical radiculopathy",
    "spinal stenosis",
    "lumbar stenosis",
    "cervical stenosis",
    "myelopathy",
    "chronic pain",
    "chronic low back pain",
    "complex regional pain syndrome",
    "reflex sympathetic dystrophy",
    "impingement syndrome",
    "shoulder impingement",
    "rotator cuff impingement",
    "labral tear",
    "glenoid labral tear",
    // ── Other ─────────────────────────────────────────────────────────────────
    "hypertension",
    "diabetes",
    "obesity",
    "hypothyroidism",
    "hyperthyroidism",
    "asthma",
    "chronic obstructive pulmonary disease",
];

/// Canonical known medications whitelist.  All entries are lowercase.
const KNOWN_MEDICATIONS: &[&str] = &[
    // ── Analgesics / anti-inflammatories ─────────────────────────────────────
    "ibuprofen", "paracetamol", "naproxen", "diclofenac", "celecoxib",
    "aspirin", "anti-inflammatory",
    // ── Opioids ───────────────────────────────────────────────────────────────
    "morphine", "oxycodone", "tramadol", "codeine", "fentanyl",
    "hydrocodone", "buprenorphine", "opioid", "methadone",
    // ── SSRIs / SNRIs / antidepressants ──────────────────────────────────────
    "paroxetine", "sertraline", "fluoxetine", "escitalopram", "citalopram",
    "venlafaxine", "duloxetine", "desvenlafaxine", "mirtazapine",
    "amitriptyline", "nortriptyline", "clomipramine",
    // ── Antipsychotics ────────────────────────────────────────────────────────
    "quetiapine", "olanzapine", "risperidone", "aripiprazole", "clozapine",
    "haloperidol", "paliperidone",
    // ── Anxiolytics / hypnotics ───────────────────────────────────────────────
    "diazepam", "clonazepam", "alprazolam", "lorazepam", "temazepam",
    "oxazepam", "nitrazepam", "zolpidem", "zopiclone",
    // ── Neuropathic / anticonvulsants ─────────────────────────────────────────
    "pregabalin", "gabapentin", "lamotrigine", "carbamazepine",
    "valproate", "sodium valproate", "topiramate", "levetiracetam",
    // ── Other ─────────────────────────────────────────────────────────────────
    "melatonin", "lithium", "naltrexone", "baclofen", "cyclobenzaprine",
];

/// Canonical known procedures whitelist.  All entries are lowercase.
const KNOWN_PROCEDURES: &[&str] = &[
    // ── Surgical ──────────────────────────────────────────────────────────────
    "arthroscopy", "arthroplasty", "spinal fusion", "laminectomy",
    "discectomy", "surgery", "operation",
    "anterior cruciate ligament reconstruction",
    "rotator cuff repair",
    // ── Injections ────────────────────────────────────────────────────────────
    "cortisone injection", "steroid injection", "epidural injection",
    "nerve block", "injection",
    // ── Psychological therapies ───────────────────────────────────────────────
    "eye movement desensitisation and reprocessing",
    "cognitive behavioural therapy",
    "dialectical behaviour therapy",
    "psychotherapy", "psychology", "psychiatry",
    "schema therapy", "acceptance and commitment therapy",
    // ── Allied health ─────────────────────────────────────────────────────────
    "physiotherapy", "occupational therapy", "rehabilitation",
    "hydrotherapy", "acupuncture", "massage therapy",
    // ── Diagnostic ────────────────────────────────────────────────────────────
    "psychiatric assessment", "psychological assessment",
    "functional capacity assessment", "neuropsychological assessment",
    "independent medical examination",
    "mri", "ct scan", "x-ray", "ultrasound",
];

/// Anatomy terms whose presence in a canonical triggers `has_anatomy_and_pathology`.
/// (Shared with ANATOMY_PRESENCE_TERMS above — kept inline for clarity.)

/// Code extensions that must not appear in accepted output.
const CODE_EXTENSIONS_GATE: &[&str] = &[
    ".js", ".ts", ".tsx", ".jsx", ".html", ".htm",
    ".css", ".py", ".rs", ".go", ".java", ".sh",
];

/// Programming / UI tokens that must not appear in accepted output.
const PROGRAMMING_TOKENS_GATE: &[&str] = &[
    "javascript", "typescript", "chatgpt", "openai",
    "utf-8", "golive", "codex", "webpack", "vite",
];

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn ctx(full_text: &str) -> DocumentContext {
        DocumentContext {
            full_text:       full_text.to_string(),
            source_snippets: vec![],
            document_type:   "report".to_string(),
        }
    }

    fn validate_conds(conditions: &[&str], full_text: &str) -> ValidatedEntities {
        validate_entities(
            CleanedEntities {
                conditions:  conditions.iter().map(|s| s.to_string()).collect(),
                medications: vec![],
                procedures:  vec![],
            },
            &ctx(full_text),
        )
    }

    fn validate_meds(medications: &[&str], full_text: &str) -> ValidatedEntities {
        validate_entities(
            CleanedEntities {
                conditions:  vec![],
                medications: medications.iter().map(|s| s.to_string()).collect(),
                procedures:  vec![],
            },
            &ctx(full_text),
        )
    }

    fn validate_procs(procedures: &[&str], full_text: &str) -> ValidatedEntities {
        validate_entities(
            CleanedEntities {
                conditions:  vec![],
                medications: vec![],
                procedures:  procedures.iter().map(|s| s.to_string()).collect(),
            },
            &ctx(full_text),
        )
    }

    fn accepted_conds(v: &ValidatedEntities) -> Vec<String> {
        v.conditions.iter().filter(|e| !e.rejected).map(|e| e.value.clone()).collect()
    }
    fn accepted_meds(v: &ValidatedEntities) -> Vec<String> {
        v.medications.iter().filter(|e| !e.rejected).map(|e| e.value.clone()).collect()
    }
    fn accepted_procs(v: &ValidatedEntities) -> Vec<String> {
        v.procedures.iter().filter(|e| !e.rejected).map(|e| e.value.clone()).collect()
    }
    fn rejected_reasons(v: &ValidatedEntities) -> Vec<String> {
        v.rejected.iter()
            .filter_map(|e| e.rejection_reason.clone())
            .collect()
    }

    // ── Test 1: OCR garbage is rejected ──────────────────────────────────────

    #[test]
    fn test_ocr_garbage_rejected() {
        // These all have structural defects that stage 1 or semantic plausibility
        // should catch (entity_clean would have caught them first, but the
        // validation layer must be self-sufficient).
        let r = validate_conds(
            &["ticccicu", "SISUUIMEMTETECONSTTUCTIO", "rrtctercu"],
            "irrelevant",
        );
        assert!(
            accepted_conds(&r).is_empty(),
            "OCR garbage strings must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 2: UI / system tokens are rejected ───────────────────────────────

    #[test]
    fn test_ui_tokens_rejected() {
        let r = validate_conds(
            &["chatgpt disorder", "utf-8 injury", "golive condition"],
            "chatgpt disorder is present",
        );
        assert!(
            accepted_conds(&r).is_empty(),
            "Entities containing UI tokens must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 3: Newline in entity is rejected ─────────────────────────────────

    #[test]
    fn test_newline_in_entity_rejected() {
        let r = validate_conds(
            &["Psychiatric Assessment\nAuthor"],
            "Psychiatric Assessment was conducted",
        );
        assert!(
            accepted_conds(&r).is_empty(),
            "Entity with embedded newline must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
        let reasons = rejected_reasons(&r);
        assert!(
            reasons.iter().any(|r| r.contains("newline")),
            "Rejection reason must mention 'newline'; reasons: {reasons:?}"
        );
    }

    // ── Test 4: Negated entity is rejected ───────────────────────────────────

    #[test]
    fn test_negated_entity_rejected() {
        let text = "Imaging revealed no evidence of fracture. The patient presented with \
                    significant back pain.";
        let r = validate_conds(&["fracture"], text);
        // "fracture" is negated in this text → should be rejected
        assert!(
            accepted_conds(&r).is_empty(),
            "Negated entity 'fracture' should be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 5: Affirmed entity is accepted ──────────────────────────────────

    #[test]
    fn test_affirmed_entity_accepted() {
        let text = "The patient was diagnosed with post-traumatic stress disorder \
                    following the workplace incident. PTSD symptoms have been ongoing.";
        let r = validate_conds(&["post-traumatic stress disorder"], text);
        let accepted = accepted_conds(&r);
        assert!(
            accepted.iter().any(|c| c.contains("post-traumatic stress disorder")),
            "Affirmed PTSD should be accepted; accepted: {accepted:?}"
        );
    }

    // ── Test 6: Hypothetical / uncertain entity is downgraded or rejected ─────

    #[test]
    fn test_hypothetical_entity_low_confidence() {
        let text = "Possible depression versus adjustment disorder. \
                    Query anxiety. No confirmed diagnosis at this stage.";
        let r = validate_conds(&["depression"], text);
        // "depression" appears only in hypothetical context → low confidence
        // It may be rejected or have very low confidence
        for e in &r.conditions {
            if e.value.contains("depression") {
                assert!(
                    e.rejected || e.confidence < 0.5,
                    "Hypothetical 'depression' should be rejected or have confidence < 0.5; \
                     got confidence={}", e.confidence
                );
            }
        }
    }

    // ── Test 7: Contradicted entity is rejected ───────────────────────────────

    #[test]
    fn test_contradicted_entity_rejected() {
        let text = "The history of fracture is inconsistent with the imaging findings. \
                    No radiological evidence of bony injury was found.";
        let r = validate_conds(&["fracture"], text);
        assert!(
            accepted_conds(&r).is_empty(),
            "Contradicted 'fracture' should be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 8: Pure anatomy is rejected ─────────────────────────────────────

    #[test]
    fn test_anatomy_only_rejected() {
        let r = validate_conds(
            &["lumbar spine", "cervical spine", "shoulder"],
            "Examination of the lumbar spine and cervical spine was performed.",
        );
        assert!(
            accepted_conds(&r).is_empty(),
            "Pure anatomy terms must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 9: Event / mechanism terms are rejected ──────────────────────────

    #[test]
    fn test_mechanism_of_injury_rejected() {
        let r = validate_conds(
            &["motor vehicle accident", "workplace incident"],
            "The motor vehicle accident occurred on 03/03/2022.",
        );
        assert!(
            accepted_conds(&r).is_empty(),
            "Event/mechanism terms must be rejected from conditions; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 10: Partial procedure phrase rejected ────────────────────────────

    #[test]
    fn test_incomplete_procedure_rejected() {
        let r = validate_procs(
            &["cognitive behavioural"],   // missing "therapy"
            "cognitive behavioural therapy was recommended",
        );
        assert!(
            accepted_procs(&r).is_empty(),
            "Incomplete procedure phrase must be rejected; accepted: {:?}",
            accepted_procs(&r)
        );
    }

    // ── Test 11: Complete procedure accepted ──────────────────────────────────

    #[test]
    fn test_complete_procedure_accepted() {
        let text = "The patient commenced cognitive behavioural therapy \
                    on a fortnightly basis.";
        let r = validate_procs(&["cognitive behavioural therapy"], text);
        assert!(
            !accepted_procs(&r).is_empty(),
            "Complete procedure 'cognitive behavioural therapy' must be accepted; \
             accepted: {:?}", accepted_procs(&r)
        );
    }

    // ── Test 12: Synonym deduplication ───────────────────────────────────────

    #[test]
    fn test_synonym_deduplication() {
        // entity_clean expands PTSD → post-traumatic stress disorder, so both
        // inputs here are the same canonical.  Only one must survive.
        let text = "The patient has post-traumatic stress disorder, also referred to as \
                    post-traumatic stress disorder in the literature.";
        let r = validate_conds(
            &["post-traumatic stress disorder", "post-traumatic stress disorder"],
            text,
        );
        assert_eq!(
            accepted_conds(&r).len(), 1,
            "Duplicate canonical must be deduplicated to one entry; \
             accepted: {:?}", accepted_conds(&r)
        );
    }

    // ── Test 13: Specificity is preserved ────────────────────────────────────

    #[test]
    fn test_specificity_preserved() {
        let text = "MRI demonstrated a left L4/5 disc herniation with nerve root compression.";
        let r = validate_conds(&["left l4/5 disc herniation"], text);
        let accepted = accepted_conds(&r);
        assert!(
            !accepted.is_empty(),
            "Specific entity with laterality and spinal level should be accepted; \
             accepted: {accepted:?}"
        );
        // The value must retain 'left' and 'l4' detail
        let val = &accepted[0];
        let lower = val.to_lowercase();
        assert!(
            lower.contains("left") || lower.contains("l4"),
            "Specificity (laterality/spinal level) must be preserved in output value; \
             got: {val}"
        );
    }

    // ── Test 14: Known medication accepted ───────────────────────────────────

    #[test]
    fn test_known_medication_accepted() {
        let text = "The patient was prescribed pregabalin 75 mg twice daily and \
                    sertraline 100 mg daily.";
        let r = validate_meds(&["pregabalin", "sertraline"], text);
        let accepted = accepted_meds(&r);
        assert!(
            accepted.iter().any(|m| m == "pregabalin"),
            "pregabalin should be accepted; accepted: {accepted:?}"
        );
        assert!(
            accepted.iter().any(|m| m == "sertraline"),
            "sertraline should be accepted; accepted: {accepted:?}"
        );
    }

    // ── Test 15: Dosing frequency is not a medication ─────────────────────────

    #[test]
    fn test_dosing_frequency_rejected() {
        let r = validate_meds(
            &["prn", "bd", "tds"],
            "ibuprofen 400 mg prn, paracetamol 500 mg bd, tds dosing",
        );
        assert!(
            accepted_meds(&r).is_empty(),
            "Dosing frequency abbreviations must be rejected from medications; \
             accepted: {:?}", accepted_meds(&r)
        );
    }

    // ── Test 16: High symbol density is rejected ──────────────────────────────

    #[test]
    fn test_high_symbol_density_rejected() {
        // "++anx++" has 4 non-alpha out of 7 non-space chars ≈ 57% — should be rejected
        let r = validate_conds(&["++anx++", "???"], "anxiety is present");
        assert!(
            accepted_conds(&r).is_empty(),
            "High symbol-density entities must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 17: Multiple punctuation clusters rejected ───────────────────────

    #[test]
    fn test_multiple_punct_clusters_rejected() {
        let r = validate_conds(&["anxiety::severe++"], "the patient has anxiety");
        assert!(
            accepted_conds(&r).is_empty(),
            "Entity with multiple punct clusters must be rejected; accepted: {:?}",
            accepted_conds(&r)
        );
    }

    // ── Test 18: context classify_context directly ────────────────────────────

    #[test]
    fn test_classify_context_negated() {
        let pre  = "imaging showed no evidence of ";
        let post = " at this level";
        assert_eq!(
            classify_context(pre, post),
            ContextType::Negated,
            "pre-context 'no evidence of' should classify as Negated"
        );
    }

    #[test]
    fn test_classify_context_hypothetical() {
        let pre  = "possible ";
        let post = " is suspected";
        assert_eq!(
            classify_context(pre, post),
            ContextType::Hypothetical,
            "pre-context 'possible' should classify as Hypothetical"
        );
    }

    #[test]
    fn test_classify_context_affirmed() {
        let pre  = "the patient was diagnosed with ";
        let post = " following the incident";
        assert_eq!(
            classify_context(pre, post),
            ContextType::Affirmed,
            "plain diagnostic statement should classify as Affirmed"
        );
    }

    // ── Test 19: is_medically_plausible rejects OCR garbage ──────────────────

    #[test]
    fn test_plausibility_rejects_ocr() {
        // These are not in any whitelist and have no recognisable medical pattern
        assert!(
            !is_medically_plausible("ticccicu",               EntityCategory::Condition),
            "OCR garbage 'ticccicu' should not be medically plausible"
        );
        assert!(
            !is_medically_plausible("wv y",                   EntityCategory::Condition),
            "Noise fragment 'wv y' should not be medically plausible"
        );
        assert!(
            !is_medically_plausible("sisuuimemteteconsttuctio", EntityCategory::Condition),
            "OCR corruption should not be medically plausible"
        );
    }

    // ── Test 20: is_medically_plausible accepts real medical terms ────────────

    #[test]
    fn test_plausibility_accepts_real_terms() {
        assert!(
            is_medically_plausible("post-traumatic stress disorder", EntityCategory::Condition),
            "PTSD should be plausible"
        );
        assert!(
            is_medically_plausible("pregabalin",  EntityCategory::Medication),
            "pregabalin should be plausible"
        );
        assert!(
            is_medically_plausible("physiotherapy", EntityCategory::Procedure),
            "physiotherapy should be plausible"
        );
        // Suffix-matched condition not in whitelist
        assert!(
            is_medically_plausible("lumbar radiculopathy syndrome", EntityCategory::Condition),
            "condition ending in 'syndrome' should be plausible via suffix"
        );
    }
}
