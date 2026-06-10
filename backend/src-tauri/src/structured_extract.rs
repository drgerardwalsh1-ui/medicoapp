//! Deterministic structured-fact extraction over `clean_text`.
//!
//! Table/lexicon-driven (no ML, no regex crate). For each domain we anchor on a
//! known head term, then read a SENTENCE-BOUNDED context window around it to fill
//! the domain's optional attributes via [`crate::structured_normalise`]. Every
//! emitted [`StructuredFact`] carries confidence + evidence (snippet + offsets) +
//! polarity + optional source attribution + an optional date span; attributes
//! that are not clearly stated are left `None`/empty (uncertainty preserved).
//!
//! Anti-hallucination rules (hardening pass):
//!   - Context never bleeds across sentence terminators (`. ; \n`), so an
//!     attribute can only come from the SAME factual context as its head term.
//!   - Medication attributes (status/indication/dates/…) are read only from the
//!     sentences that actually mention that drug — never the whole document.
//!   - Symptom `onset_date` is set ONLY when explicit onset wording is present;
//!     historical / first-documented / recurrent mentions set `prior_history`
//!     instead of fabricating an onset.
//!   - Competing assertions are PRESERVED: opposing values (and opposing
//!     polarities) in a domain are emitted as separate facts, never collapsed.
//!
//! Determinism: anchors scanned in fixed order; output sorted by (domain, entity,
//! offset) via [`StructuredFactSet::sorted`]. Offsets index the original text.

#![allow(dead_code)]

use crate::fact_extract::first_date_in_lower;
use crate::structured_fact::{
    Attribution, DateSpan, Effectiveness, Evidence, FactDetails, FactDomainKind, FactPolarity,
    FunctionalArea, FunctionalImpactFact, InjuryEventKind, InjuryFact, MedicationFact,
    MedicationStatus, StructuredFact, StructuredFactSet, SymptomFact, TreatmentFact,
    TreatmentStatus,
};
use crate::structured_normalise as norm;

/// Extract the full structured fact set for one document.
pub fn extract_structured_facts(clean_text: &str, doc_id: &str) -> StructuredFactSet {
    let lower = clean_text.to_ascii_lowercase();
    let mut facts: Vec<StructuredFact> = Vec::new();

    extract_medications(clean_text, &lower, doc_id, &mut facts);
    extract_symptoms(clean_text, &lower, doc_id, &mut facts);
    extract_injuries(clean_text, &lower, doc_id, &mut facts);
    extract_treatments(clean_text, &lower, doc_id, &mut facts);
    extract_functional(clean_text, &lower, doc_id, &mut facts);

    StructuredFactSet::sorted(doc_id, facts)
}

/// H2: the meaning of a `FactPolarity` WITHIN a domain. Resolves the cross-domain
/// ambiguity of the shared enum for any extractor-side reasoning. Pure, internal,
/// not persisted — `FactPolarity` and `StructuredFact` are unchanged.
pub fn interpret_polarity(domain: FactDomainKind, polarity: FactPolarity) -> &'static str {
    use FactDomainKind as D;
    use FactPolarity as P;
    match (domain, polarity) {
        (D::Symptom, P::Affirmed) => "symptom_present",
        (D::Symptom, P::Denied) => "symptom_not_present",
        (D::Symptom, P::Absent) => "symptom_ruled_out",
        (D::Symptom, P::Uncertain) => "symptom_queried",

        (D::Medication, P::Affirmed) => "medication_taken",
        (D::Medication, P::Denied) => "medication_refused_or_not_taken",
        (D::Medication, P::Absent) => "medication_not_present",
        (D::Medication, P::Uncertain) => "medication_uncertain",

        (D::FunctionalImpact, P::Affirmed) => "capability_present",
        (D::FunctionalImpact, P::Denied) => "inability",
        (D::FunctionalImpact, P::Absent) => "capability_absent",
        (D::FunctionalImpact, P::Uncertain) => "capability_uncertain",

        (D::Injury, P::Affirmed) => "event_occurred",
        (D::Injury, P::Denied) => "event_did_not_occur",
        (D::Injury, P::Absent) => "event_absent",
        (D::Injury, P::Uncertain) => "event_uncertain",

        (D::Treatment, P::Affirmed) => "treatment_received",
        (D::Treatment, P::Denied) => "treatment_declined",
        (D::Treatment, P::Absent) => "treatment_not_present",
        (D::Treatment, P::Uncertain) => "treatment_uncertain",
    }
}

/// H2.5: domain-aware semantic opposition between two polarities — the single
/// entry point for FUTURE contradiction detection over structured facts.
///
/// Uses the same per-domain contract as [`interpret_polarity`]: a pair is
/// opposed iff one side asserts the positive relation (`Affirmed` — present /
/// taken / capable / occurred / received) and the other asserts its negative
/// (`Denied` or `Absent`). Within every domain `Denied` and `Absent` are both
/// negative readings (e.g. "symptom_not_present" vs "symptom_ruled_out"), so
/// they do NOT oppose each other; `Uncertain` (queried/hedged) opposes nothing.
/// Symmetric and irreflexive by construction. Pure; not persisted; touches no
/// schema, extraction, or `StructuredFact`.
pub fn facts_are_semantically_opposed(
    domain: FactDomainKind,
    left: FactPolarity,
    right: FactPolarity,
) -> bool {
    use FactPolarity as P;
    // The domain parameter pins this helper to the interpret_polarity contract:
    // every (domain, polarity) pair below has a defined meaning there, and any
    // future domain whose contract diverges (e.g. a domain where Denied/Absent
    // are NOT both negative) must be special-cased here. Today the positive/
    // negative split is uniform across all five domains.
    let _ = interpret_polarity(domain, left);
    let _ = interpret_polarity(domain, right);

    matches!(
        (left, right),
        (P::Affirmed, P::Denied)
            | (P::Denied, P::Affirmed)
            | (P::Affirmed, P::Absent)
            | (P::Absent, P::Affirmed)
    )
}

// ── shared window / sentence helpers ────────────────────────────────────────

fn occurrences(lower: &str, needle: &str) -> Vec<usize> {
    let hb = lower.as_bytes();
    let nb = needle.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(rel) = lower[i..].find(needle) {
        let start = i + rel;
        let end = start + nb.len();
        let left = start == 0 || !is_word(hb[start - 1]);
        let right = end >= hb.len() || !is_word(hb[end]);
        if left && right {
            out.push(start);
        }
        i = end;
    }
    out
}

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-'
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Sentence terminator bytes.
fn is_terminator(c: u8) -> bool {
    c == b'.' || c == b'\n' || c == b';'
}

/// Sentence-bounded window: clipped to the nearest sentence terminators so
/// context never bleeds across sentences.
fn sentence_window(lower: &str, start: usize, end: usize, max_back: usize, max_fwd: usize) -> (usize, usize) {
    let s0 = floor_char_boundary(lower, start.saturating_sub(max_back));
    let s = lower[s0..start]
        .rfind(|c| is_terminator(c as u8) || c == ';')
        .map(|p| s0 + p + 1)
        .unwrap_or(s0);
    let e_cap = floor_char_boundary(lower, (end + max_fwd).min(lower.len()));
    let e = lower[end..e_cap]
        .find(|c| is_terminator(c as u8))
        .map(|p| end + p)
        .unwrap_or(e_cap);
    (floor_char_boundary(lower, s), floor_char_boundary(lower, e))
}

/// The byte span of the single sentence containing `pos`.
fn sentence_of(lower: &str, pos: usize) -> (usize, usize) {
    let b = lower.as_bytes();
    let mut s = pos;
    while s > 0 && !is_terminator(b[s - 1]) {
        s -= 1;
    }
    let mut e = pos;
    while e < b.len() && !is_terminator(b[e]) {
        e += 1;
    }
    (floor_char_boundary(lower, s), floor_char_boundary(lower, e))
}

/// Lowercased text of every sentence that mentions `needle` (whole word),
/// joined by ". ". This is the ONLY context a medication's attributes are read
/// from — preventing cross-sentence / cross-drug bleed.
fn sentences_mentioning(lower: &str, needle: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let mut last_end = 0usize;
    for start in occurrences(lower, needle) {
        if start < last_end {
            continue; // already covered by a prior sentence slice
        }
        let (s, e) = sentence_of(lower, start);
        parts.push(&lower[s..e]);
        last_end = e;
    }
    parts.join(". ")
}

fn snippet(original: &str, s: usize, e: usize) -> String {
    original.get(s..e).unwrap_or("").trim().to_string()
}

fn window(lower: &str, start: usize, end: usize, back: usize, fwd: usize) -> (usize, usize) {
    let s = floor_char_boundary(lower, start.saturating_sub(back));
    let e = floor_char_boundary(lower, (end + fwd).min(lower.len()));
    (s, e)
}

fn bump(base: f32, cond: bool, amt: f32) -> f32 {
    if cond {
        base + amt
    } else {
        base
    }
}

/// First ISO-ish date, OR a standalone 4-digit year. Used in verb-anchored
/// contexts where a bare year is a reliable temporal marker.
fn first_date_or_year(slice: &str) -> Option<String> {
    if let Some(d) = first_date_in_lower(slice) {
        return Some(d);
    }
    let b = slice.as_bytes();
    let mut i = 0;
    while i + 4 <= b.len() {
        if b[i].is_ascii_digit() {
            let run: String = b[i..]
                .iter()
                .take_while(|c| c.is_ascii_digit())
                .map(|c| *c as char)
                .collect();
            if run.len() == 4 {
                if let Ok(y) = run.parse::<u32>() {
                    if (1900..=2100).contains(&y) {
                        return Some(run);
                    }
                }
            }
            i += run.len().max(1);
        } else {
            i += 1;
        }
    }
    None
}

/// H1: the clause within `window` that contains byte position `rel` (relative
/// to `window`). Clause boundaries approximate without any NLP dependency:
///   - punctuation: ',' ';' ':'
///   - spaced separators / conjunctions: " - ", " but ", " however ", " whereas "
/// Negation cues are evaluated on this clause-local slice only, so a negation of
/// one entity cannot flip another entity in the same sentence. A bare intra-word
/// '-' ("work-related") is NOT a boundary — only a space-flanked dash is.
fn clause_local(window: &str, rel: usize) -> &str {
    let rel = floor_char_boundary(window, rel.min(window.len()));
    let bytes = window.as_bytes();
    let mut start = 0usize;
    let mut end = window.len();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b',' || b == b';' || b == b':' {
            if i < rel {
                start = i + 1;
            } else {
                end = i;
                break;
            }
        }
    }
    const SEPS: &[&str] = &[" - ", " but ", " however ", " whereas "];
    for sep in SEPS {
        if let Some(p) = window[start..rel].rfind(sep) {
            start += p + sep.len();
        }
        if let Some(p) = window[rel..end].find(sep) {
            end = rel + p;
        }
    }
    window.get(start..end).map(str::trim).unwrap_or(window)
}

/// True iff the position is immediately preceded (within ~12 chars) by a
/// negation, so a positive-polarity phrase rule does not fire inside a negated
/// statement (e.g. "returned to work" inside "has not returned to work").
fn preceded_by_negation(lower: &str, start: usize) -> bool {
    let s0 = floor_char_boundary(lower, start.saturating_sub(12));
    let pre = &lower[s0..start];
    pre.contains("not ")
        || pre.contains("never ")
        || pre.contains("cannot ")
        || pre.contains("unable ")
        || pre.contains("no longer ")
}

// ── source attribution (lightweight; reads the fact's sentence) ──────────────

/// Detect `reported_by` + `source_type` from cues in the fact's context.
/// Clinician / objective-source cues are checked BEFORE generic self-report
/// verbs so "the psychiatrist reports …" attributes to the psychiatrist, not
/// the claimant.
fn detect_attribution(ctx_lower: &str) -> Attribution {
    const CUES: &[(&str, &str, &str)] = &[
        // (needle, reported_by, source_type) — most specific first.
        ("surveillance", "surveillance", "surveillance"),
        ("pharmacy record", "pharmacy", "pharmacy_records"),
        ("dispensing", "pharmacy", "pharmacy_records"),
        ("vocational", "vocational_assessor", "vocational_assessment"),
        ("orthopaedic surgeon", "orthopaedic_surgeon", "specialist"),
        ("orthopaedic", "orthopaedic_surgeon", "specialist"),
        ("psychiatrist", "psychiatrist", "specialist"),
        ("psychiatric", "psychiatrist", "specialist"),
        ("psychologist", "psychologist", "specialist"),
        ("rehabilitation provider", "rehabilitation_provider", "rehabilitation"),
        ("rehabilitation", "rehabilitation_provider", "rehabilitation"),
        ("medico-legal", "medico_legal_examiner", "medico_legal"),
        ("independent medical", "medico_legal_examiner", "medico_legal"),
        ("general practitioner", "gp", "gp"),
        ("gp ", "gp", "gp"),
        ("specialist", "specialist", "specialist"),
        // self-report cues (generic; checked last)
        ("self-report", "claimant", "self_report"),
        ("self report", "claimant", "self_report"),
        ("claimant", "claimant", "self_report"),
        ("emma reports", "claimant", "self_report"),
        ("reports", "claimant", "self_report"),
        ("describes", "claimant", "self_report"),
        ("states", "claimant", "self_report"),
    ];
    for (needle, rb, st) in CUES {
        if ctx_lower.contains(needle) {
            return Attribution::new(rb, st);
        }
    }
    Attribution::default()
}

// ── 1. Medications (attributes read ONLY from the drug's own sentences) ──────

const MED_LEXICON: &[&str] = &[
    "pregabalin", "gabapentin", "amitriptyline", "nortriptyline", "duloxetine",
    "sertraline", "escitalopram", "fluoxetine", "paroxetine", "venlafaxine",
    "mirtazapine", "quetiapine", "diazepam", "clonazepam", "temazepam",
    "paracetamol", "ibuprofen", "naproxen", "celecoxib", "tramadol",
    "oxycodone", "endone", "targin", "morphine", "codeine", "panadeine",
    "meloxicam", "diclofenac", "baclofen", "propranolol",
];

fn extract_medications(original: &str, lower: &str, doc_id: &str, out: &mut Vec<StructuredFact>) {
    for &med in MED_LEXICON {
        let occ = occurrences(lower, med);
        if occ.is_empty() {
            continue;
        }
        let first = occ[0];
        let med_end = first + med.len();

        // The ONLY context: sentences that actually mention this drug.
        let ctx = sentences_mentioning(lower, med);
        let ctx = ctx.as_str();

        let status = norm::normalise_medication_status(ctx);
        let start_date = date_near_any(ctx, med, &["commenced", "started", "initiated", "began"]);
        let stop_date = date_near_any(ctx, med, &["ceased", "stopped", "discontinued", "withdrawn"]);
        let dosage = norm::normalise_dosage(ctx);
        let frequency = norm::normalise_frequency(ctx);
        let route = norm::normalise_route(ctx);
        let effectiveness = opt_eff(norm::normalise_effectiveness(ctx));
        let indication = indication_near(ctx);
        let side_effects = side_effects_near(ctx);
        let reason_ceased = reason_ceased_near(ctx, med);
        let prescriber = prescriber_near(ctx);
        // Recommenced ONLY if this drug's own context says so.
        let recommenced = matches!(status, MedicationStatus::Recommenced).then_some(true);

        // H1: scope refusal/decline detection to the clause naming this drug.
        let mclause = clause_local(ctx, ctx.find(med).unwrap_or(0));
        let polarity = if mclause.contains("declined")
            || mclause.contains("refused")
            || mclause.contains("not prescribed")
        {
            FactPolarity::Denied
        } else {
            FactPolarity::Affirmed
        };
        let attribution = detect_attribution(ctx);

        let mut conf = 0.8;
        conf = bump(conf, start_date.is_some() || stop_date.is_some(), 0.05);
        conf = bump(conf, dosage.is_some() || frequency.is_some(), 0.05);
        conf = bump(conf, status != MedicationStatus::Unknown, 0.05);
        conf = conf.min(0.95);

        let (ss, se) = window(lower, first, med_end, 24, 40);
        let evidence = Evidence::new(doc_id, &snippet(original, ss, se), first, med_end);
        let date = start_date
            .as_deref()
            .map(DateSpan::from)
            .or_else(|| stop_date.as_deref().map(DateSpan::until));

        out.push(
            StructuredFact::new(
                med,
                conf,
                evidence,
                date,
                FactDetails::Medication(MedicationFact {
                    indication,
                    dosage,
                    frequency,
                    route,
                    start_date,
                    stop_date,
                    status: Some(status),
                    recommenced_after_cessation: recommenced,
                    effectiveness,
                    side_effects,
                    reason_ceased,
                    prescriber,
                }),
            )
            .with_polarity(polarity)
            .with_attribution(attribution),
        );
    }
}

fn opt_eff(e: Effectiveness) -> Option<Effectiveness> {
    match e {
        Effectiveness::Unknown => None,
        other => Some(other),
    }
}

/// First date within 40 chars after any of `verbs` when that verb is within 60
/// chars of `anchor`. Operates on whatever scoped `ctx` is passed.
fn date_near_any(ctx: &str, anchor: &str, verbs: &[&str]) -> Option<String> {
    let anchor_pos = occurrences(ctx, anchor);
    for &verb in verbs {
        for vpos in occurrences(ctx, verb) {
            let near = anchor_pos.iter().any(|&a| a.abs_diff(vpos) <= 60);
            if !near {
                continue;
            }
            let vend = vpos + verb.len();
            let end = (vend + 40).min(ctx.len());
            if let Some(d) = first_date_or_year(&ctx[vend..floor_char_boundary(ctx, end)]) {
                return Some(d);
            }
        }
    }
    None
}

fn indication_near(ctx: &str) -> Option<String> {
    for marker in ["for ", "due to ", "to manage ", "to treat "] {
        if let Some(p) = ctx.find(marker) {
            let after = &ctx[p + marker.len()..];
            let phrase: String = after
                .split(|c| c == '.' || c == ',' || c == ';')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !phrase.is_empty() && phrase.len() <= 40 {
                return Some(phrase);
            }
        }
    }
    None
}

fn side_effects_near(ctx: &str) -> Vec<String> {
    const SE: &[&str] = &["nausea", "drowsiness", "dizziness", "weight gain", "dry mouth", "constipation", "sedation", "headache"];
    let mut v: Vec<String> = Vec::new();
    if ctx.contains("side effect") || ctx.contains("side-effect") || ctx.contains("tolerated poorly") {
        for s in SE {
            if ctx.contains(s) {
                v.push((*s).to_string());
            }
        }
    }
    v
}

fn reason_ceased_near(ctx: &str, med: &str) -> Option<String> {
    let med_pos = occurrences(ctx, med);
    for vpos in occurrences(ctx, "ceased").into_iter().chain(occurrences(ctx, "stopped")) {
        if med_pos.iter().any(|&a| a.abs_diff(vpos) <= 60) {
            let end = (vpos + 80).min(ctx.len());
            let win = &ctx[vpos..floor_char_boundary(ctx, end)];
            for marker in ["due to ", "because of ", "owing to "] {
                if let Some(p) = win.find(marker) {
                    let phrase: String = win[p + marker.len()..]
                        .split(|c| c == '.' || c == ',' || c == ';')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if !phrase.is_empty() && phrase.len() <= 40 {
                        return Some(phrase);
                    }
                }
            }
        }
    }
    None
}

fn prescriber_near(ctx: &str) -> Option<String> {
    if let Some(p) = ctx.find("dr ") {
        let after = &ctx[p..];
        let name: String = after.chars().take(20).collect();
        let name = name.split(|c: char| c == '.' || c == ',').next().unwrap_or("").trim().to_string();
        if name.len() > 3 {
            return Some(name);
        }
    }
    None
}

// ── 2. Symptoms (strict onset; competing polarities preserved) ───────────────

const SYMPTOM_LEXICON: &[&str] = &[
    // diagnoses / findings that frequently carry competing polarity
    "post-traumatic stress disorder", "ptsd", "disc prolapse", "disc protrusion", "disc bulge",
    "major depressive disorder", "depression",
    // somatic / psychological symptoms
    "low back pain", "lower back pain", "back pain", "neck pain", "shoulder pain",
    "headache", "headaches", "low mood", "depressed mood", "anxiety", "panic attacks",
    "insomnia", "poor sleep", "fatigue", "nightmares", "flashbacks", "irritability",
    "dizziness", "numbness", "tingling", "nausea",
];

fn extract_symptoms(original: &str, lower: &str, doc_id: &str, out: &mut Vec<StructuredFact>) {
    let mut emitted_entity: Vec<&str> = Vec::new();
    for &sym in SYMPTOM_LEXICON {
        let occ = occurrences(lower, sym);
        if occ.is_empty() {
            continue;
        }
        // Suppress shorter overlapping terms ("back pain" when "low back pain" hit).
        if emitted_entity.iter().any(|s| s.contains(sym) || sym.contains(*s)) {
            continue;
        }
        emitted_entity.push(sym);

        // One fact per DISTINCT polarity (first occurrence of that polarity) —
        // so "diagnosed" and "criteria not met" survive as competing facts.
        let mut by_polarity: Vec<(FactPolarity, usize)> = Vec::new();
        for &start in &occ {
            let (ws, we) = sentence_window(lower, start, start + sym.len(), 50, 90);
            // H1: evaluate polarity on the clause containing this symptom only.
            let pol = symptom_polarity(clause_local(&lower[ws..we], start - ws));
            if !by_polarity.iter().any(|(p, _)| *p == pol) {
                by_polarity.push((pol, start));
            }
        }

        for (polarity, start) in by_polarity {
            let end = start + sym.len();
            let (ws, we) = sentence_window(lower, start, end, 60, 90);
            let ctx = &lower[ws..we];

            let progression = match norm::normalise_progression(ctx) {
                crate::structured_fact::Progression::Unknown => None,
                p => Some(p),
            };
            let severity = match norm::normalise_severity(ctx) {
                crate::structured_fact::Severity::Unknown => None,
                s => Some(s),
            };
            let prior_history = detect_prior_history(ctx);
            // Onset ONLY with explicit onset wording AND not a pure-history mention.
            let onset_date = if prior_history == Some(true) {
                None
            } else {
                onset_date_strict(ctx)
            };
            let treatment_response = opt_eff(norm::normalise_effectiveness(ctx));
            let current_status = current_status_near(ctx);
            let attribution = detect_attribution(ctx);

            let mut conf = 0.75;
            conf = bump(conf, progression.is_some(), 0.05);
            conf = bump(conf, severity.is_some(), 0.05);
            conf = bump(conf, onset_date.is_some(), 0.05);
            conf = bump(conf, polarity != FactPolarity::Affirmed, 0.05);
            conf = conf.min(0.95);

            let (ss, se) = window(lower, start, end, 16, 30);
            let evidence = Evidence::new(doc_id, &snippet(original, ss, se), start, end);

            out.push(
                StructuredFact::new(
                    sym,
                    conf,
                    evidence,
                    onset_date.as_deref().map(DateSpan::from),
                    FactDetails::Symptom(SymptomFact {
                        onset_date,
                        duration: None,
                        severity,
                        progression,
                        aggravating_factors: factors_near(ctx, &["aggravated by", "worse with", "worse on"]),
                        relieving_factors: factors_near(ctx, &["relieved by", "eased by", "better with"]),
                        treatment_response,
                        current_status,
                        prior_history,
                    }),
                )
                .with_polarity(polarity)
                .with_attribution(attribution),
            );
        }
    }
}

/// Symptom polarity from explicit cues. Conservative: defaults to Affirmed.
fn symptom_polarity(ctx: &str) -> FactPolarity {
    if ctx.contains("no evidence") || ctx.contains("absent") || ctx.contains("ruled out") || ctx.contains("not present") {
        FactPolarity::Absent
    } else if ctx.contains("criteria not met") || ctx.contains("not met") || ctx.contains("denies") || ctx.contains("denied") || ctx.contains("does not meet") {
        FactPolarity::Denied
    } else if ctx.contains("query") || ctx.contains("possible") || ctx.contains("suspected") || ctx.contains("may have") || ctx.contains("?") || ctx.contains("uncertain") {
        FactPolarity::Uncertain
    } else {
        FactPolarity::Affirmed
    }
}

/// Onset date ONLY when explicit onset wording precedes a nearby date in the
/// same sentence. Deliberately EXCLUDES "from" (which matches "records from
/// 2017") to avoid converting historical mentions into onset.
fn onset_date_strict(ctx: &str) -> Option<String> {
    const ONSET: &[&str] = &["since", "onset", "began", "started", "developed", "first noticed", "commenced"];
    for verb in ONSET {
        if let Some(p) = ctx.find(verb) {
            let after = &ctx[p + verb.len()..];
            let end = after.len().min(25);
            if let Some(d) = first_date_or_year(&after[..floor_char_boundary(after, end)]) {
                return Some(d);
            }
        }
    }
    None
}

/// Mark historical / first-documented / chronic mentions (NOT onset).
fn detect_prior_history(ctx: &str) -> Option<bool> {
    const HIST: &[&str] = &[
        "records from", "records dated", "history of", "recurrent", "previously",
        "long-standing", "longstanding", "chronic", "pre-existing", "preexisting",
        "background of", "documented", "past history",
    ];
    if HIST.iter().any(|h| ctx.contains(h)) {
        Some(true)
    } else {
        None
    }
}

fn current_status_near(ctx: &str) -> Option<String> {
    for kw in ["ongoing", "resolved", "persistent", "intermittent", "daily", "constant"] {
        if ctx.contains(kw) {
            return Some(kw.to_string());
        }
    }
    None
}

fn factors_near(ctx: &str, markers: &[&str]) -> Vec<String> {
    let mut v = Vec::new();
    for m in markers {
        if let Some(p) = ctx.find(m) {
            let phrase: String = ctx[p + m.len()..]
                .split(|c| c == '.' || c == ',' || c == ';')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !phrase.is_empty() && phrase.len() <= 40 {
                v.push(phrase);
            }
        }
    }
    v
}

// ── 3. Injuries (dedupe generic incidents; preserve competing dates) ─────────

fn extract_injuries(original: &str, lower: &str, doc_id: &str, out: &mut Vec<StructuredFact>) {
    const ANCHORS: &[&str] = &["injury", "accident", "incident"];
    const INJURY_TYPES: &[&str] = &["fracture", "strain", "sprain", "whiplash", "tear", "contusion", "laceration"];

    // Dedupe key: (entity, incident_date, event_kind) — competing dates differ,
    // so they survive; bare duplicate generic "incident"s collapse.
    let mut seen: Vec<(String, Option<String>, InjuryEventKind)> = Vec::new();

    for &anchor in ANCHORS {
        for start in occurrences(lower, anchor) {
            let end = start + anchor.len();
            let (ws, we) = sentence_window(lower, start, end, 60, 80);
            let ctx = &lower[ws..we];

            let event_kind = classify_injury(ctx);
            let body_region = body_region_near(ctx);
            let injury_type = INJURY_TYPES.iter().find(|t| ctx.contains(**t)).map(|s| s.to_string());
            let incident_date = first_date_in_lower(ctx);
            let mechanism = mechanism_near(ctx);
            let work_related = work_related_near(ctx);

            // Require SOME unique signal beyond the bare anchor word.
            let signal = event_kind != InjuryEventKind::Unknown
                || injury_type.is_some()
                || incident_date.is_some()
                || body_region.is_some()
                || mechanism.is_some();
            if !signal {
                continue;
            }

            // Prefer a specific entity over the generic anchor.
            let entity = injury_type
                .clone()
                .or_else(|| (work_related == Some(true)).then(|| "work injury".to_string()))
                .unwrap_or_else(|| anchor.to_string());

            let key = (entity.clone(), incident_date.clone(), event_kind);
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);

            // H1: negation must be clause-local to this injury mention.
            let iclause = clause_local(ctx, start - ws);
            let polarity = if iclause.contains("denies") || iclause.contains("no injury") {
                FactPolarity::Denied
            } else {
                FactPolarity::Affirmed
            };
            let attribution = detect_attribution(ctx);

            let mut conf = 0.7;
            conf = bump(conf, incident_date.is_some(), 0.05);
            conf = bump(conf, event_kind != InjuryEventKind::Unknown, 0.05);
            conf = bump(conf, injury_type.is_some() || mechanism.is_some(), 0.05);
            conf = conf.min(0.95);

            let (ss, se) = window(lower, start, end, 24, 36);
            let evidence = Evidence::new(doc_id, &snippet(original, ss, se), start, end);

            out.push(
                StructuredFact::new(
                    &entity,
                    conf,
                    evidence,
                    incident_date.as_deref().map(DateSpan::on),
                    FactDetails::Injury(InjuryFact {
                        incident_date,
                        mechanism,
                        body_region,
                        immediate_symptoms: Vec::new(),
                        work_related,
                        event_kind: Some(event_kind),
                    }),
                )
                .with_polarity(polarity)
                .with_attribution(attribution),
            );
        }
    }
}

fn classify_injury(ctx: &str) -> InjuryEventKind {
    if ctx.contains("exacerbat") || ctx.contains("aggravat") {
        InjuryEventKind::Exacerbation
    } else if ctx.contains("recurren") || ctx.contains("recurred") || ctx.contains("flare") {
        InjuryEventKind::Recurrence
    } else if ctx.contains("prior") || ctx.contains("previous") || ctx.contains("pre-existing") || ctx.contains("preexisting") {
        InjuryEventKind::Prior
    } else if ctx.contains("subsequent") || ctx.contains("further") || ctx.contains("new injury") || ctx.contains("later injury") {
        InjuryEventKind::Subsequent
    } else if ctx.contains("index") || ctx.contains("initial") || ctx.contains("at work") || ctx.contains("sustained") {
        InjuryEventKind::Initial
    } else {
        InjuryEventKind::Unknown
    }
}

fn body_region_near(ctx: &str) -> Option<String> {
    const REGIONS: &[&str] = &["back", "neck", "shoulder", "knee", "wrist", "ankle", "hip", "lumbar", "cervical", "head"];
    REGIONS.iter().find(|r| ctx.contains(**r)).map(|s| s.to_string())
}

fn mechanism_near(ctx: &str) -> Option<String> {
    const MECH: &[&str] = &["lifting", "fall", "fell", "motor vehicle", "collision", "slip", "twisting", "struck"];
    MECH.iter().find(|m| ctx.contains(**m)).map(|s| s.to_string())
}

fn work_related_near(ctx: &str) -> Option<bool> {
    if ctx.contains("at work")
        || ctx.contains("work-related")
        || ctx.contains("work related")
        || ctx.contains("work injury")
        || ctx.contains("workplace")
        || ctx.contains("during employment")
    {
        Some(true)
    } else if ctx.contains("non-work") || ctx.contains("not work-related") || ctx.contains("at home") || ctx.contains("outside work") {
        Some(false)
    } else {
        None
    }
}

// ── 4. Treatments ───────────────────────────────────────────────────────────

const TREATMENT_LEXICON: &[(&str, &str, &str)] = &[
    ("physiotherapy", "physiotherapist", "physiotherapy"),
    ("physio", "physiotherapist", "physiotherapy"),
    ("psychology", "psychologist", "psychology"),
    ("counselling", "counsellor", "psychology"),
    ("cbt", "psychologist", "psychology"),
    ("psychiatry", "psychiatrist", "psychiatry"),
    ("surgery", "surgeon", "surgery"),
    ("cortisone injection", "proceduralist", "pain"),
    ("injection", "proceduralist", "pain"),
    ("rehabilitation", "rehab_provider", "rehabilitation"),
    ("hydrotherapy", "physiotherapist", "physiotherapy"),
    ("acupuncture", "practitioner", "complementary"),
];

fn extract_treatments(original: &str, lower: &str, doc_id: &str, out: &mut Vec<StructuredFact>) {
    let mut seen: Vec<&str> = Vec::new();
    for &(surface, provider, specialty) in TREATMENT_LEXICON {
        let occ = occurrences(lower, surface);
        if occ.is_empty() {
            continue;
        }
        if seen.iter().any(|s| s.contains(surface) || surface.contains(*s)) {
            continue;
        }
        seen.push(surface);

        let first = occ[0];
        let end = first + surface.len();
        // Sentence-bounded so adjacent treatments don't share effectiveness.
        let (ws, we) = sentence_window(lower, first, end, 70, 90);
        let ctx = &lower[ws..we];

        let effectiveness = opt_eff(norm::normalise_effectiveness(ctx));
        let status = match norm::normalise_treatment_status(ctx) {
            TreatmentStatus::Unknown => None,
            s => Some(s),
        };
        let outcome = current_status_near(ctx);
        let attribution = detect_attribution(ctx);

        let mut conf = 0.75;
        conf = bump(conf, effectiveness.is_some(), 0.07);
        conf = bump(conf, status.is_some(), 0.05);
        conf = conf.min(0.95);

        let (ss, se) = window(lower, first, end, 18, 30);
        let evidence = Evidence::new(doc_id, &snippet(original, ss, se), first, end);

        out.push(
            StructuredFact::new(
                surface,
                conf,
                evidence,
                first_date_in_lower(ctx).as_deref().map(DateSpan::on),
                FactDetails::Treatment(TreatmentFact {
                    provider_type: Some(provider.to_string()),
                    specialty: Some(specialty.to_string()),
                    outcome,
                    effectiveness,
                    status,
                }),
            )
            .with_attribution(attribution),
        );
    }
}

// ── 5. Functional impacts (phrase rules → competing facts + polarity) ────────

/// (surface, area, polarity). One fact per occurrence; competing statements
/// (different polarity OR different surface) are all preserved.
const FUNCTIONAL_RULES: &[(&str, FunctionalArea, FactPolarity)] = &[
    // Work capacity
    ("ceased work", FunctionalArea::Work, FactPolarity::Affirmed),
    ("stopped working", FunctionalArea::Work, FactPolarity::Affirmed),
    ("not returned to work", FunctionalArea::Work, FactPolarity::Denied),
    ("not returned to employment", FunctionalArea::Work, FactPolarity::Denied),
    ("never returned to work", FunctionalArea::Work, FactPolarity::Denied),
    ("resumed part-time duties", FunctionalArea::Work, FactPolarity::Affirmed),
    ("resumed part-time", FunctionalArea::Work, FactPolarity::Affirmed),
    ("resumed part time", FunctionalArea::Work, FactPolarity::Affirmed),
    ("returned to work", FunctionalArea::Work, FactPolarity::Affirmed),
    ("continued working", FunctionalArea::Work, FactPolarity::Affirmed),
    ("still working", FunctionalArea::Work, FactPolarity::Affirmed),
    ("unable to work", FunctionalArea::Work, FactPolarity::Denied),
    // Driving
    ("cannot drive", FunctionalArea::Driving, FactPolarity::Denied),
    ("unable to drive", FunctionalArea::Driving, FactPolarity::Denied),
    ("drives independently", FunctionalArea::Driving, FactPolarity::Affirmed),
    ("drives weekly", FunctionalArea::Driving, FactPolarity::Affirmed),
    ("drives several times", FunctionalArea::Driving, FactPolarity::Affirmed),
    // Mobility
    ("requires walking stick", FunctionalArea::Mobility, FactPolarity::Affirmed),
    ("walking stick", FunctionalArea::Mobility, FactPolarity::Affirmed),
    ("walking unassisted", FunctionalArea::Mobility, FactPolarity::Affirmed),
    ("carrying shopping", FunctionalArea::Mobility, FactPolarity::Affirmed),
    // Sleep
    ("sleeps 3 hours", FunctionalArea::Sleep, FactPolarity::Affirmed),
    ("3 hours/night", FunctionalArea::Sleep, FactPolarity::Affirmed),
    ("sleeps 7", FunctionalArea::Sleep, FactPolarity::Affirmed),
    ("7-8 hours", FunctionalArea::Sleep, FactPolarity::Affirmed),
    ("7\u{2013}8 hours", FunctionalArea::Sleep, FactPolarity::Affirmed),
];

fn extract_functional(original: &str, lower: &str, doc_id: &str, out: &mut Vec<StructuredFact>) {
    // Dedupe identical (area, polarity, surface) occurrences only — competing
    // statements with different polarity/surface are kept.
    let mut seen: Vec<(FunctionalArea, FactPolarity, &str)> = Vec::new();

    for &(surface, area, polarity) in FUNCTIONAL_RULES {
        for start in occurrences(lower, surface) {
            // Skip a positive rule that is actually negated in situ.
            if polarity == FactPolarity::Affirmed && preceded_by_negation(lower, start) {
                continue;
            }
            let key = (area, polarity, surface);
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);

            let end = start + surface.len();
            let (ws, we) = sentence_window(lower, start, end, 60, 90);
            let ctx = &lower[ws..we];

            let trend = match norm::normalise_trend(ctx) {
                crate::structured_fact::Trend::Unknown => None,
                t => Some(t),
            };
            let restriction = restriction_near(ctx);
            let capacity = Some(snippet(original, start, floor_char_boundary(original, we)))
                .filter(|s| !s.is_empty());
            let date = first_date_or_year(ctx);
            let attribution = detect_attribution(ctx);

            let mut conf = 0.72;
            conf = bump(conf, trend.is_some(), 0.06);
            conf = bump(conf, restriction.is_some(), 0.05);
            conf = bump(conf, polarity != FactPolarity::Affirmed, 0.05);
            conf = conf.min(0.95);

            let (ss, se) = window(lower, start, end, 8, 30);
            let evidence = Evidence::new(doc_id, &snippet(original, ss, se), start, end);

            out.push(
                StructuredFact::new(
                    area_label(area),
                    conf,
                    evidence,
                    date.as_deref().map(DateSpan::on),
                    FactDetails::FunctionalImpact(FunctionalImpactFact {
                        area: Some(area),
                        capacity,
                        restriction,
                        trend,
                    }),
                )
                .with_polarity(polarity)
                .with_attribution(attribution),
            );
        }
    }
}

fn area_label(a: FunctionalArea) -> &'static str {
    match a {
        FunctionalArea::Work => "work",
        FunctionalArea::Driving => "driving",
        FunctionalArea::Household => "household",
        FunctionalArea::Exercise => "exercise",
        FunctionalArea::Sleep => "sleep",
        FunctionalArea::Social => "social",
        FunctionalArea::Adls => "adls",
        FunctionalArea::Mobility => "mobility",
        FunctionalArea::Other => "other",
    }
}

fn restriction_near(ctx: &str) -> Option<String> {
    for m in ["restricted to", "limited to", "unable to", "cannot", "restricted from", "no longer able to"] {
        if let Some(p) = ctx.find(m) {
            let phrase: String = ctx[p..]
                .split(|c| c == '.' || c == ';')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !phrase.is_empty() && phrase.len() <= 60 {
                return Some(phrase);
            }
        }
    }
    None
}

// ════════════════════════════════════════════════════════════════════════
// Tests — original scenarios + hardening regression tests.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structured_fact::{FactDomainKind, Progression, Trend};

    fn med<'a>(set: &'a StructuredFactSet, name: &str) -> &'a MedicationFact {
        let f = set.facts.iter().find(|f| f.entity == name && f.domain == FactDomainKind::Medication).expect("med fact");
        match &f.details {
            FactDetails::Medication(m) => m,
            _ => panic!("not a med"),
        }
    }

    fn functional<'a>(set: &'a StructuredFactSet) -> Vec<&'a StructuredFact> {
        set.facts.iter().filter(|f| f.domain == FactDomainKind::FunctionalImpact).collect()
    }

    // ── invariants ──────────────────────────────────────────────────────────
    #[test]
    fn invariants_every_fact_has_confidence_and_evidence() {
        let t = "Commenced pregabalin 75mg bd for neuropathic pain. Low back pain is worsening. \
                 Physiotherapy was effective. He is unable to work.";
        let set = extract_structured_facts(t, "docA");
        assert!(!set.facts.is_empty());
        for f in &set.facts {
            assert!(f.confidence > 0.0 && f.confidence <= 1.0, "bad confidence {f:?}");
            assert!(!f.evidence.snippet.is_empty(), "missing snippet {f:?}");
            assert_eq!(f.evidence.document_id, "docA");
            assert!(f.evidence.char_offset_start.is_some());
        }
    }

    // ── original scenarios (must still pass) ─────────────────────────────────
    #[test]
    fn scenario_start_stop_medication() {
        let t = "He commenced amitriptyline in January 2021. Amitriptyline was ceased in March 2021.";
        let set = extract_structured_facts(t, "docA");
        let m = med(&set, "amitriptyline");
        assert_eq!(m.start_date.as_deref(), Some("2021-01"));
        assert_eq!(m.stop_date.as_deref(), Some("2021-03"));
        assert_eq!(m.status, Some(MedicationStatus::Ceased));
    }

    #[test]
    fn scenario_ceased_then_recommenced() {
        let t = "Pregabalin was commenced in 2020, ceased in March 2021, then recommenced in June 2021.";
        let set = extract_structured_facts(t, "docA");
        let m = med(&set, "pregabalin");
        assert_eq!(m.status, Some(MedicationStatus::Recommenced));
        assert_eq!(m.recommenced_after_cessation, Some(true));
    }

    #[test]
    fn scenario_symptom_progression() {
        let t = "The patient reports low back pain since 2019 which has been progressively worsening.";
        let set = extract_structured_facts(t, "docA");
        let f = set.facts.iter().find(|f| f.entity == "low back pain").expect("symptom");
        match &f.details {
            FactDetails::Symptom(s) => {
                assert_eq!(s.progression, Some(Progression::Worsening));
                assert_eq!(s.onset_date.as_deref(), Some("2019"));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn scenario_prior_vs_subsequent_injuries() {
        let t = "He had a prior back injury in 2015. He sustained a subsequent injury at work in 2021.";
        let set = extract_structured_facts(t, "docA");
        let kinds: Vec<InjuryEventKind> = set
            .facts
            .iter()
            .filter_map(|f| match &f.details {
                FactDetails::Injury(i) => i.event_kind,
                _ => None,
            })
            .collect();
        assert!(kinds.contains(&InjuryEventKind::Prior), "kinds={kinds:?}");
        assert!(kinds.contains(&InjuryEventKind::Subsequent), "kinds={kinds:?}");
    }

    #[test]
    fn scenario_treatment_effectiveness() {
        let t = "Physiotherapy was commenced and has been effective. Psychology counselling gave no benefit.";
        let set = extract_structured_facts(t, "docA");
        let physio = set.facts.iter().find(|f| f.entity == "physiotherapy").expect("physio");
        let psych = set.facts.iter().find(|f| f.entity == "psychology").expect("psych");
        match &physio.details {
            FactDetails::Treatment(tr) => assert_eq!(tr.effectiveness, Some(Effectiveness::Effective)),
            _ => panic!(),
        }
        match &psych.details {
            FactDetails::Treatment(tr) => assert_eq!(tr.effectiveness, Some(Effectiveness::Ineffective)),
            _ => panic!(),
        }
    }

    #[test]
    fn scenario_functional_capacity_change() {
        let t = "His work capacity has been deteriorating and he is now unable to work full-time.";
        let set = extract_structured_facts(t, "docA");
        let f = functional(&set)
            .into_iter()
            .find(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area == Some(FunctionalArea::Work)))
            .expect("work impact");
        match &f.details {
            FactDetails::FunctionalImpact(fi) => {
                assert_eq!(fi.trend, Some(Trend::Deteriorating));
                assert!(fi.restriction.is_some());
            }
            _ => panic!(),
        }
        assert_eq!(f.polarity, FactPolarity::Denied); // "unable to work"
    }

    // ── hardening: false positives ───────────────────────────────────────────
    #[test]
    fn no_medication_indication_or_recommencement_hallucination() {
        // The classic TEST CASE 4 false positive: oxycodone in a pharmacy line,
        // with "recommenced" + "indication" only present in OTHER sentences.
        let t = "The patient recommenced pregabalin for severe mobility restriction. \
                 Pharmacy records show regular dispensing of oxycodone throughout 2023.";
        let set = extract_structured_facts(t, "docA");
        let oxy = med(&set, "oxycodone");
        assert_ne!(oxy.status, Some(MedicationStatus::Recommenced), "recommencement bled across sentences");
        assert_eq!(oxy.recommenced_after_cessation, None);
        assert_eq!(oxy.indication, None, "indication hallucinated from neighbouring sentence");
        // attribution should reflect the pharmacy source
        let oxy_fact = set.facts.iter().find(|f| f.entity == "oxycodone").unwrap();
        assert_eq!(oxy_fact.attribution.source_type.as_deref(), Some("pharmacy_records"));
    }

    #[test]
    fn context_does_not_bleed_indication_between_drugs() {
        let t = "Commenced sertraline for depression. Oxycodone was dispensed.";
        let set = extract_structured_facts(t, "docA");
        assert_eq!(med(&set, "sertraline").indication.as_deref(), Some("depression"));
        assert_eq!(med(&set, "oxycodone").indication, None);
    }

    #[test]
    fn no_onset_hallucination_from_history() {
        let t = "Emma reports chronic lower back pain. GP records from 2017 document recurrent lower back pain.";
        let set = extract_structured_facts(t, "docA");
        let f = set.facts.iter().find(|f| f.entity == "lower back pain").expect("symptom");
        match &f.details {
            FactDetails::Symptom(s) => {
                assert_eq!(s.onset_date, None, "historical mention wrongly became onset");
                assert_eq!(s.prior_history, Some(true));
            }
            _ => panic!(),
        }
    }

    // ── hardening: competing facts preserved ─────────────────────────────────
    #[test]
    fn competing_injury_dates_preserved() {
        let t = "Injury date 12 Feb 2022 is recorded. A second form gives injury date 18 Feb 2022.";
        let set = extract_structured_facts(t, "docA");
        let dates: Vec<String> = set
            .facts
            .iter()
            .filter_map(|f| match &f.details {
                FactDetails::Injury(i) => i.incident_date.clone(),
                _ => None,
            })
            .collect();
        assert!(dates.contains(&"2022-02-12".to_string()), "dates={dates:?}");
        assert!(dates.contains(&"2022-02-18".to_string()), "dates={dates:?}");
    }

    #[test]
    fn competing_diagnoses_preserved_with_polarity() {
        let t = "The psychologist concluded PTSD diagnosed. The psychiatrist found PTSD criteria not met.";
        let set = extract_structured_facts(t, "docA");
        let ptsd: Vec<FactPolarity> = set
            .facts
            .iter()
            .filter(|f| f.entity == "ptsd")
            .map(|f| f.polarity)
            .collect();
        assert!(ptsd.contains(&FactPolarity::Affirmed), "polarities={ptsd:?}");
        assert!(ptsd.contains(&FactPolarity::Denied), "polarities={ptsd:?}");
    }

    #[test]
    fn competing_work_capacity_statements_preserved() {
        let t = "He ceased work immediately. He returned to work in April 2022. He has not returned to work since.";
        let set = extract_structured_facts(t, "docA");
        let work: Vec<(&str, FactPolarity)> = functional(&set)
            .into_iter()
            .filter(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area == Some(FunctionalArea::Work)))
            .map(|f| (f.evidence.snippet.as_str(), f.polarity))
            .collect();
        // ceased (affirmed) + not returned (denied) + returned (affirmed) all kept
        assert!(work.iter().any(|(_, p)| *p == FactPolarity::Denied), "work={work:?}");
        assert!(work.iter().filter(|(_, p)| *p == FactPolarity::Affirmed).count() >= 1, "work={work:?}");
        assert!(work.len() >= 2, "competing work statements collapsed: {work:?}");
    }

    #[test]
    fn competing_driving_statements_preserved() {
        let t = "He cannot drive because of pain. Surveillance shows he drives independently several times per week.";
        let set = extract_structured_facts(t, "docA");
        let drive: Vec<FactPolarity> = functional(&set)
            .into_iter()
            .filter(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area == Some(FunctionalArea::Driving)))
            .map(|f| f.polarity)
            .collect();
        assert!(drive.contains(&FactPolarity::Denied), "drive={drive:?}");
        assert!(drive.contains(&FactPolarity::Affirmed), "drive={drive:?}");
    }

    #[test]
    fn competing_sleep_statements_preserved() {
        let t = "He reports he sleeps 3 hours per night. Surveillance suggests he sleeps 7-8 hours.";
        let set = extract_structured_facts(t, "docA");
        let sleep: Vec<&StructuredFact> = functional(&set)
            .into_iter()
            .filter(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area == Some(FunctionalArea::Sleep)))
            .collect();
        assert!(sleep.len() >= 2, "sleep facts collapsed: {sleep:?}");
    }

    // ── hardening: attribution ───────────────────────────────────────────────
    #[test]
    fn surveillance_vs_self_report_attribution() {
        let t = "He reports he cannot drive. Surveillance shows he drives independently.";
        let set = extract_structured_facts(t, "docA");
        let cannot = set.facts.iter().find(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area==Some(FunctionalArea::Driving)) && f.polarity == FactPolarity::Denied).unwrap();
        let drives = set.facts.iter().find(|f| matches!(&f.details, FactDetails::FunctionalImpact(fi) if fi.area==Some(FunctionalArea::Driving)) && f.polarity == FactPolarity::Affirmed).unwrap();
        assert_eq!(cannot.attribution.source_type.as_deref(), Some("self_report"));
        assert_eq!(drives.attribution.source_type.as_deref(), Some("surveillance"));
    }

    #[test]
    fn claimant_vs_clinician_attribution() {
        let t = "The orthopaedic surgeon documented disc prolapse. Emma reports severe back pain.";
        let set = extract_structured_facts(t, "docA");
        let disc = set.facts.iter().find(|f| f.entity == "disc prolapse").unwrap();
        let pain = set.facts.iter().find(|f| f.entity == "back pain").unwrap();
        assert_eq!(disc.attribution.reported_by.as_deref(), Some("orthopaedic_surgeon"));
        assert_eq!(pain.attribution.reported_by.as_deref(), Some("claimant"));
    }

    // ── hardening: injury entity quality ─────────────────────────────────────
    #[test]
    fn injury_prefers_specific_entity_over_generic() {
        let t = "He sustained a work injury lifting archive boxes on 12 Feb 2022.";
        let set = extract_structured_facts(t, "docA");
        let inj = set.facts.iter().find(|f| f.domain == FactDomainKind::Injury).expect("injury");
        assert_eq!(inj.entity, "work injury");
        match &inj.details {
            FactDetails::Injury(i) => {
                assert_eq!(i.work_related, Some(true));
                assert_eq!(i.mechanism.as_deref(), Some("lifting"));
                assert_eq!(i.incident_date.as_deref(), Some("2022-02-12"));
            }
            _ => panic!(),
        }
    }

    // ── determinism / empties ────────────────────────────────────────────────
    #[test]
    fn deterministic_and_sorted() {
        let t = "Commenced pregabalin. Low back pain worsening. Physiotherapy effective. Unable to drive.";
        let a = extract_structured_facts(t, "docA");
        let b = extract_structured_facts(t, "docA");
        assert_eq!(a, b);
        let domains: Vec<&str> = a.facts.iter().map(|f| f.domain.as_str()).collect();
        let mut sorted = domains.clone();
        sorted.sort();
        assert_eq!(domains, sorted);
    }

    #[test]
    fn empty_when_nothing_relevant() {
        let set = extract_structured_facts("The weather was fine and the meeting adjourned.", "docA");
        assert!(set.facts.is_empty(), "unexpected: {:?}", set.facts);
    }

    // H1: a negation of one entity must not flip another in the same sentence.
    #[test]
    fn clause_scoped_negation_does_not_leak() {
        let t = "Denies headache but reports ongoing back pain.";
        let set = extract_structured_facts(t, "docA");
        let back = set.facts.iter().find(|f| f.entity == "back pain").expect("back pain");
        let head = set.facts.iter().find(|f| f.entity == "headache").expect("headache");
        assert_eq!(back.polarity, FactPolarity::Affirmed, "negation leaked onto back pain");
        assert_eq!(head.polarity, FactPolarity::Denied);
    }

    // H2: the same FactPolarity carries domain-specific meaning.
    #[test]
    fn polarity_meaning_is_domain_specific() {
        use FactDomainKind::*;
        assert_eq!(interpret_polarity(Symptom, FactPolarity::Denied), "symptom_not_present");
        assert_eq!(interpret_polarity(Medication, FactPolarity::Denied), "medication_refused_or_not_taken");
        assert_eq!(interpret_polarity(FunctionalImpact, FactPolarity::Denied), "inability");
        assert_eq!(interpret_polarity(Injury, FactPolarity::Denied), "event_did_not_occur");
    }

    // H2.5: semantic opposition — positive vs negative readings oppose; the two
    // negative readings do not; Uncertain opposes nothing; symmetric, irreflexive.
    #[test]
    fn semantic_opposition_follows_domain_contract() {
        use FactDomainKind as D;
        use FactPolarity as P;
        const DOMAINS: [D; 5] = [D::Symptom, D::Medication, D::Injury, D::Treatment, D::FunctionalImpact];
        const ALL: [P; 4] = [P::Affirmed, P::Denied, P::Absent, P::Uncertain];

        for d in DOMAINS {
            // Opposed pairs (both directions — symmetry).
            assert!(facts_are_semantically_opposed(d, P::Affirmed, P::Denied));
            assert!(facts_are_semantically_opposed(d, P::Denied, P::Affirmed));
            assert!(facts_are_semantically_opposed(d, P::Affirmed, P::Absent));
            assert!(facts_are_semantically_opposed(d, P::Absent, P::Affirmed));
            // Two negative readings are not opposed (denied vs ruled-out).
            assert!(!facts_are_semantically_opposed(d, P::Denied, P::Absent));
            assert!(!facts_are_semantically_opposed(d, P::Absent, P::Denied));
            // Uncertain opposes nothing, in either direction.
            for p in ALL {
                assert!(!facts_are_semantically_opposed(d, P::Uncertain, p));
                assert!(!facts_are_semantically_opposed(d, p, P::Uncertain));
            }
            // Irreflexive: no polarity opposes itself.
            for p in ALL {
                assert!(!facts_are_semantically_opposed(d, p, p));
            }
        }
    }
}
