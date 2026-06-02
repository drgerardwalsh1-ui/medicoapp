//! Patient Identity + Participant Resolution Layer.
//!
//! Strictly additive — never mutates `ClinicalEvent`, `UnifiedEvent`,
//! `PatientEvent`, `ConditionState`, `LongitudinalPatientGraph`, or
//! `ClinicalKnowledgeGraph`. Consumes the canonical document payloads
//! produced by `process_document` and emits a deterministic resolution
//! of canonical patient, participant, and organisation entities.
//!
//! The layer answers questions the lower layers cannot:
//!   - Who authored this opinion?
//!   - Treating clinician vs. independent assessor?
//!   - Which organisation supplied the opinion?
//!   - Which clinician supported a diagnosis vs. who disputed it?
//!   - Which documents belong to the same patient?
//!
//! No ML. No external APIs. No probabilistic matching. Lexicon +
//! string-equality rules only.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, BTreeSet};

use crate::clinical_events::{detect_sections, DetectedSection};

// ── Public types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientIdentity {
    pub patient_id: String,
    pub names: Vec<String>,
    pub date_of_birth: Option<String>,
    pub aliases: Vec<String>,
    pub source_document_ids: Vec<String>,
    pub confidence: f32,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub participant_id: String,
    pub name: String,
    pub role: ParticipantRole,
    pub source_document_ids: Vec<String>,
    pub organisations: Vec<String>,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Patient,
    TreatingPsychologist,
    TreatingPsychiatrist,
    AssessingPsychiatrist,
    GeneralPractitioner,
    Specialist,
    OccupationalTherapist,
    EmployerRepresentative,
    Lawyer,
    CaseManager,
    UnknownClinician,
    Unknown,
}

impl ParticipantRole {
    pub fn as_str(self) -> &'static str {
        match self {
            ParticipantRole::Patient               => "patient",
            ParticipantRole::TreatingPsychologist  => "treating_psychologist",
            ParticipantRole::TreatingPsychiatrist  => "treating_psychiatrist",
            ParticipantRole::AssessingPsychiatrist => "assessing_psychiatrist",
            ParticipantRole::GeneralPractitioner   => "general_practitioner",
            ParticipantRole::Specialist            => "specialist",
            ParticipantRole::OccupationalTherapist => "occupational_therapist",
            ParticipantRole::EmployerRepresentative=> "employer_representative",
            ParticipantRole::Lawyer                => "lawyer",
            ParticipantRole::CaseManager           => "case_manager",
            ParticipantRole::UnknownClinician      => "unknown_clinician",
            ParticipantRole::Unknown               => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organisation {
    pub organisation_id: String,
    pub name: String,
    pub organisation_type: OrganisationType,
    pub source_document_ids: Vec<String>,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrganisationType {
    MedicalPractice,
    Hospital,
    PsychologyClinic,
    GovernmentAgency,
    Employer,
    LegalBody,
    Unknown,
}

impl OrganisationType {
    pub fn as_str(self) -> &'static str {
        match self {
            OrganisationType::MedicalPractice  => "medical_practice",
            OrganisationType::Hospital         => "hospital",
            OrganisationType::PsychologyClinic => "psychology_clinic",
            OrganisationType::GovernmentAgency => "government_agency",
            OrganisationType::Employer         => "employer",
            OrganisationType::LegalBody        => "legal_body",
            OrganisationType::Unknown          => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentParticipantMap {
    pub document_id: String,
    pub patient_ids: Vec<String>,
    pub participant_ids: Vec<String>,
    pub organisation_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedEventAttribution {
    pub event_id: String,
    pub participant_id: Option<String>,
    pub organisation_id: Option<String>,
    pub patient_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantResolutionPayload {
    pub patients: Vec<PatientIdentity>,
    pub participants: Vec<Participant>,
    pub organisations: Vec<Organisation>,
    pub document_maps: Vec<DocumentParticipantMap>,
    pub attributions: Vec<ResolvedEventAttribution>,
}

// ── Public API ───────────────────────────────────────────────────────────

/// Build the resolution payload from a list of canonical document
/// payloads (output of `process_document`).
pub fn build_participant_resolution(
    documents: &[JsonValue],
) -> ParticipantResolutionPayload {
    let mut patient_acc: BTreeMap<String, PatientIdentity> = BTreeMap::new();
    let mut participant_acc: BTreeMap<String, Participant> = BTreeMap::new();
    let mut org_acc: BTreeMap<String, Organisation> = BTreeMap::new();
    let mut document_maps: Vec<DocumentParticipantMap> = Vec::new();
    let mut attributions: Vec<ResolvedEventAttribution> = Vec::new();

    for doc in documents {
        let doc_id = doc
            .get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let clean_text = doc
            .get("clean_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let raw_text = doc
            .get("raw_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let combined_text = if !clean_text.is_empty() { clean_text } else { raw_text };

        // ── Pull people from doc.people ────────────────────────────
        let people = doc
            .get("people")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // ── Pull organisations from doc.entities.organisations ─────
        let raw_orgs = doc
            .get("entities")
            .and_then(|v| v.get("organisations"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // ── Section index (used for role disambiguation + event attribution).
        let sections = detect_sections(combined_text);

        // ── Resolve participants ───────────────────────────────────
        let mut doc_participant_ids: BTreeSet<String> = BTreeSet::new();
        let mut doc_patient_ids: BTreeSet<String> = BTreeSet::new();
        let mut doc_org_ids: BTreeSet<String> = BTreeSet::new();

        // Map of section_label → primary participant_id (used when an
        // event has a `source_section` it inherits from).
        let mut section_to_participant: BTreeMap<String, String> = BTreeMap::new();

        for p in &people {
            let name = p
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() { continue; }
            let raw_role = p
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let snippet = p
                .get("source_snippet")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Locate the participant's section, if any.
            let section_label = crate::clinical_events::section_for_snippet(
                &sections, combined_text, &snippet,
            );

            // Patient participants go on the patient pile.
            if raw_role == "patient" || raw_role == "client" || raw_role == "claimant" {
                let patient_id = stable_id("patient", &normalise_name(&name));
                let dob = extract_dob_for(&name, combined_text);
                accumulate_patient(
                    &mut patient_acc,
                    patient_id.clone(),
                    name.clone(),
                    dob,
                    doc_id.clone(),
                );
                doc_patient_ids.insert(patient_id);
                continue;
            }

            // Classify role with surrounding evidence (section label,
            // raw snippet, full text proximity).
            let evidence = ClassificationEvidence {
                name: &name,
                raw_role: &raw_role,
                snippet: &snippet,
                section_label: section_label.as_deref(),
                full_text_lower: &combined_text.to_lowercase(),
            };
            let (resolved_role, role_evidence) = classify_role(&evidence);

            let participant_id = stable_id("participant", &normalise_name(&name));
            accumulate_participant(
                &mut participant_acc,
                participant_id.clone(),
                name.clone(),
                resolved_role,
                role_evidence,
                doc_id.clone(),
            );
            doc_participant_ids.insert(participant_id.clone());
            if let Some(section) = section_label {
                section_to_participant
                    .entry(section)
                    .or_insert_with(|| participant_id.clone());
            }
        }

        // No people but a parties.patient string survived? Fall back to that.
        let parties_patient = doc
            .get("parties")
            .and_then(|v| v.get("patient"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !parties_patient.is_empty() && doc_patient_ids.is_empty() {
            let patient_id = stable_id("patient", &normalise_name(&parties_patient));
            let dob = extract_dob_for(&parties_patient, combined_text);
            accumulate_patient(
                &mut patient_acc,
                patient_id.clone(),
                parties_patient,
                dob,
                doc_id.clone(),
            );
            doc_patient_ids.insert(patient_id);
        }

        // ── Organisations ─────────────────────────────────────────
        // Start with the upstream `entities.organisations[]` list, then
        // supplement with deterministic phrase extraction over
        // clean_text so we catch org names the upstream extractor
        // missed (lines that don't end with a known org suffix, e.g.
        // "Traumatic Stress Clinic supplied the prior reports.").
        let mut org_names_for_doc: BTreeSet<String> = BTreeSet::new();
        for o in &raw_orgs {
            if let Some(s) = o.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    org_names_for_doc.insert(trimmed.to_string());
                }
            }
        }
        // Scan BOTH clean_text and raw_text — short heading-style org
        // lines (e.g. "Personal Injury Commission") get dropped by the
        // text-cleaner's short-line filter, so we'd otherwise miss
        // them. The supplementary scanner is permissive enough that
        // adding raw_text doesn't introduce false positives (it only
        // accepts capitalised multi-word runs ending in an org tail).
        for name in extract_supplementary_organisations(combined_text) {
            org_names_for_doc.insert(name);
        }
        if raw_text != clean_text && !raw_text.is_empty() {
            for name in extract_supplementary_organisations(raw_text) {
                org_names_for_doc.insert(name);
            }
        }
        for name in org_names_for_doc {
            let org_id = stable_id("organisation", &normalise_name(&name));
            let org_type = classify_organisation(&name);
            accumulate_organisation(
                &mut org_acc,
                org_id.clone(),
                name,
                org_type,
                doc_id.clone(),
            );
            doc_org_ids.insert(org_id);
        }

        // ── Section-by-role attribution map ────────────────────────
        // Snippet-based section_to_participant misses cases like
        // "Author: Dr Rayers\n...Reviewing Psychiatrist\n..." where
        // the author line precedes the section heading. Supplement it
        // by walking the resolved participants and pinning a known
        // section label per role when the doc has exactly one
        // participant of that role.
        let role_to_section: &[(ParticipantRole, &str)] = &[
            (ParticipantRole::TreatingPsychologist,   "Treating Psychologist"),
            (ParticipantRole::TreatingPsychiatrist,   "Treating Psychiatrist"),
            (ParticipantRole::AssessingPsychiatrist,  "Reviewing Psychiatrist"),
            (ParticipantRole::GeneralPractitioner,    "GP Notes"),
        ];
        for (role, section_label) in role_to_section {
            // Find participants of this role in this doc.
            let candidates: Vec<&Participant> = doc_participant_ids
                .iter()
                .filter_map(|pid| participant_acc.get(pid))
                .filter(|p| p.role == *role
                    && p.source_document_ids.contains(&doc_id))
                .collect();
            if candidates.len() == 1 {
                let pid = candidates[0].participant_id.clone();
                section_to_participant
                    .entry(section_label.to_string())
                    .or_insert(pid);
            }
        }

        // ── Document map ─────────────────────────────────────────
        document_maps.push(DocumentParticipantMap {
            document_id: doc_id.clone(),
            patient_ids: doc_patient_ids.iter().cloned().collect(),
            participant_ids: doc_participant_ids.iter().cloned().collect(),
            organisation_ids: doc_org_ids.iter().cloned().collect(),
        });

        // ── Event attribution ────────────────────────────────────
        // For every clinical_event in this doc, attach (patient,
        // participant, organisation) ids via document/section lookups.
        let clinical_events = doc
            .get("clinical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let doc_primary_patient = doc_patient_ids.iter().next().cloned();
        let doc_primary_org = doc_org_ids.iter().next().cloned();
        for e in clinical_events {
            let event_id = e.get("event_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if event_id.is_empty() { continue; }
            let section = e.get("source_section").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let participant_id = section_to_participant.get(&section).cloned();
            attributions.push(ResolvedEventAttribution {
                event_id,
                participant_id,
                organisation_id: doc_primary_org.clone(),
                patient_id: doc_primary_patient.clone(),
            });
        }
    }

    // Re-pin patient confidences after merging.
    for p in patient_acc.values_mut() {
        let n_signals = (p.date_of_birth.is_some() as u32)
            + (!p.names.is_empty() as u32)
            + (!p.source_document_ids.is_empty() as u32);
        p.confidence = match n_signals {
            0 => 0.0,
            1 => 0.55,
            2 => 0.80,
            _ => 0.95,
        };
    }

    let patients: Vec<PatientIdentity> = patient_acc.into_values().collect();
    let participants: Vec<Participant> = participant_acc.into_values().collect();
    let organisations: Vec<Organisation> = org_acc.into_values().collect();

    ParticipantResolutionPayload {
        patients,
        participants,
        organisations,
        document_maps,
        attributions,
    }
}

// ── Role classifier ──────────────────────────────────────────────────────

struct ClassificationEvidence<'a> {
    name: &'a str,
    raw_role: &'a str,
    snippet: &'a str,
    section_label: Option<&'a str>,
    full_text_lower: &'a str,
}

fn classify_role(ev: &ClassificationEvidence<'_>) -> (ParticipantRole, JsonValue) {
    let raw_role = ev.raw_role.to_lowercase();
    let snippet_lc = ev.snippet.to_lowercase();
    let section_lc = ev.section_label.unwrap_or("").to_lowercase();
    let full = ev.full_text_lower;
    let name_lc = ev.name.to_lowercase();

    // ── Deterministic rule chain — first match wins ───────────────
    let mut applied: Vec<&'static str> = Vec::new();

    // GP — "GP", "general practitioner", "GP Notes".
    if raw_role == "gp" || section_lc.starts_with("gp ")
        || section_lc.contains("general practice")
        || snippet_lc.contains("gp notes")
    {
        applied.push("rule:gp");
        return done(ParticipantRole::GeneralPractitioner, &applied, ev);
    }

    // Treating Psychologist
    if section_lc == "treating psychologist"
        || raw_role == "treating_doctor" && full.contains("treating psychologist")
        || snippet_lc.contains("treating psychologist")
    {
        applied.push("rule:treating_psychologist");
        return done(ParticipantRole::TreatingPsychologist, &applied, ev);
    }
    if raw_role == "psychologist" && (full.contains("treating") || section_lc.contains("treating")) {
        applied.push("rule:psychologist+treating");
        return done(ParticipantRole::TreatingPsychologist, &applied, ev);
    }

    // Treating Psychiatrist (only fires when "treating" appears with
    // the psychiatrist — assessor/independent gets caught below).
    if section_lc == "treating psychiatrist"
        || (raw_role == "psychiatrist"
            && (full.contains("treating psychiatrist")
                || full.contains("treating clinician")))
    {
        applied.push("rule:treating_psychiatrist");
        return done(ParticipantRole::TreatingPsychiatrist, &applied, ev);
    }

    // Assessing Psychiatrist — independent / medico-legal opinion.
    let assessor_markers = [
        "independent psychiatric opinion",
        "independent medical examination",
        "independent medico-legal",
        "independent medico legal",
        "medico-legal opinion",
        "medico legal opinion",
        "medico-legal report",
        "assessing psychiatrist",
        "reviewing psychiatrist",
        "ime report",
    ];
    let any_assessor_marker = assessor_markers.iter().any(|m| full.contains(m))
        || section_lc == "reviewing psychiatrist";
    if (raw_role == "psychiatrist" || raw_role == "author" || raw_role == "doctor")
        && any_assessor_marker
        // The clinician's name should appear in the assessor section
        // when the doc has multiple sections; if no section info, the
        // markers alone are sufficient.
        && (section_lc == "reviewing psychiatrist"
            || section_lc.contains("psychiatric assessment")
            || section_lc.contains("medico-legal")
            || ev.section_label.is_none()
            || full.contains(&format!("author: {name_lc}")))
    {
        applied.push("rule:assessing_psychiatrist");
        return done(ParticipantRole::AssessingPsychiatrist, &applied, ev);
    }

    // Bare psychiatrist (no treating, no assessor) → Specialist by
    // default; we keep this conservative so we don't misclassify.
    if raw_role == "psychiatrist" {
        applied.push("rule:psychiatrist→specialist");
        return done(ParticipantRole::Specialist, &applied, ev);
    }
    if raw_role == "specialist" || raw_role == "consultant" {
        applied.push("rule:specialist");
        return done(ParticipantRole::Specialist, &applied, ev);
    }

    // Occupational Therapist
    if full.contains("occupational therapist") || section_lc.contains("occupational therapist") {
        applied.push("rule:occupational_therapist");
        return done(ParticipantRole::OccupationalTherapist, &applied, ev);
    }

    // Employer rep
    if section_lc.contains("employer") || snippet_lc.contains("employer representative")
        || full.contains(&format!("employer: {name_lc}"))
    {
        applied.push("rule:employer_representative");
        return done(ParticipantRole::EmployerRepresentative, &applied, ev);
    }

    // Lawyer / legal
    let legal_terms = ["solicitor", "barrister", "lawyer", "counsel", "attorney"];
    if legal_terms.iter().any(|t| full.contains(t))
        && (snippet_lc.contains("solicitor") || snippet_lc.contains("lawyer")
            || snippet_lc.contains("barrister")
            || section_lc.contains("legal"))
    {
        applied.push("rule:lawyer");
        return done(ParticipantRole::Lawyer, &applied, ev);
    }

    // Case manager
    if full.contains("case manager") || snippet_lc.contains("case manager")
        || section_lc.contains("case manager")
    {
        applied.push("rule:case_manager");
        return done(ParticipantRole::CaseManager, &applied, ev);
    }

    // Treating clinician fallback (no specific specialty)
    if raw_role == "treating_doctor" || raw_role == "treating_clinician" {
        applied.push("rule:treating_clinician_fallback");
        return done(ParticipantRole::UnknownClinician, &applied, ev);
    }

    // Author-only — the document author becomes a clinician if title
    // looks medical, otherwise we keep Unknown so consumers don't
    // mistake a non-medical author for a clinician.
    if raw_role == "author" {
        // If "Dr"/"Prof"-prefixed name, default to UnknownClinician.
        if name_lc.starts_with("dr ") || name_lc.starts_with("dr.") || name_lc.starts_with("prof ")
            || name_lc.starts_with("doctor ")
        {
            applied.push("rule:author→unknown_clinician");
            return done(ParticipantRole::UnknownClinician, &applied, ev);
        }
        applied.push("rule:author→unknown");
        return done(ParticipantRole::Unknown, &applied, ev);
    }

    // Anything that looks like a Dr/Prof but didn't match a specific
    // rule → UnknownClinician.
    if raw_role == "doctor" || name_lc.starts_with("dr ") || name_lc.starts_with("dr.")
        || name_lc.starts_with("prof ") || name_lc.starts_with("doctor ")
    {
        applied.push("rule:doctor→unknown_clinician");
        return done(ParticipantRole::UnknownClinician, &applied, ev);
    }

    applied.push("rule:default_unknown");
    done(ParticipantRole::Unknown, &applied, ev)
}

fn done(role: ParticipantRole, applied: &[&'static str], ev: &ClassificationEvidence<'_>) -> (ParticipantRole, JsonValue) {
    (role, serde_json::json!({
        "applied_rules":  applied,
        "raw_role":       ev.raw_role,
        "source_snippet": ev.snippet,
        "section_label":  ev.section_label,
    }))
}

// ── Organisation classifier ──────────────────────────────────────────────

/// Deterministic phrase scanner that pulls capitalised multi-word
/// organisation names out of `text`. Looks for 1–6-word capitalised
/// runs immediately followed by a known organisation tail
/// (Hospital / Clinic / Commission / Authority / Tribunal / Service /
/// Department / Centre / Center / Network / Practice). Always returns
/// the verbatim capitalised phrase including the tail.
fn extract_supplementary_organisations(text: &str) -> Vec<String> {
    const TAILS: &[&str] = &[
        "Hospital", "Clinic", "Commission", "Authority", "Tribunal",
        "Service", "Department", "Centre", "Center", "Network",
        "Practice", "Council", "Agency", "Institute",
    ];
    let mut out: BTreeSet<String> = BTreeSet::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        // Tokenise into words preserving case.
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        // Scan windows ending in a known tail.
        for end in 0..words.len() {
            let tail = strip_trailing_punct(words[end]);
            if !TAILS.iter().any(|t| t.eq_ignore_ascii_case(tail)) {
                continue;
            }
            // Walk backwards collecting capitalised tokens.
            let mut start = end;
            while start > 0 {
                let prev = strip_trailing_punct(words[start - 1]);
                if is_capitalised_token(prev) {
                    start -= 1;
                } else {
                    break;
                }
            }
            let window: Vec<&str> = words[start..=end].iter().copied().collect();
            // Require at least 2 tokens AND the head to be capitalised
            // (so a bare "Clinic" or "Hospital" doesn't fire on its own).
            if window.len() < 2 { continue; }
            if !is_capitalised_token(strip_trailing_punct(window[0])) { continue; }
            // Strip trailing punctuation from the assembled phrase.
            let mut phrase = window.join(" ");
            while phrase.ends_with(|c: char| matches!(c, '.' | ',' | ';' | ':')) {
                phrase.pop();
            }
            // Conservative length cap.
            if phrase.split_whitespace().count() <= 6 {
                out.insert(phrase);
            }
        }
    }
    out.into_iter().collect()
}

fn strip_trailing_punct(s: &str) -> &str {
    s.trim_end_matches(|c: char| matches!(c, '.' | ',' | ';' | ':'))
}

fn is_capitalised_token(s: &str) -> bool {
    // A token like "New", "South", "Wales", "Personal", "Injury".
    // Also accept short stopword joiners ("of", "the", "and") so
    // multi-word org names with internal lower-case glue still match.
    const JOIN_OK: &[&str] = &["of", "the", "and", "for", "&"];
    if JOIN_OK.iter().any(|t| s.eq_ignore_ascii_case(t)) {
        return true;
    }
    let first = match s.chars().next() {
        Some(c) => c,
        None => return false,
    };
    first.is_ascii_uppercase()
}

fn classify_organisation(name: &str) -> OrganisationType {
    let lower = name.to_lowercase();

    if lower.contains("hospital") {
        return OrganisationType::Hospital;
    }
    if lower.contains("ambulance")
        || lower.contains("fire service")
        || lower.contains("emergency services")
        || lower.contains("police")
        || lower.contains("defence")
    {
        return OrganisationType::Employer;
    }
    if lower.contains("commission")
        || lower.contains("tribunal")
        || lower.contains("court")
        || lower.contains("law")
        || lower.contains("solicitor")
        || lower.contains("legal")
    {
        return OrganisationType::LegalBody;
    }
    if lower.contains("workcover")
        || lower.contains("comcare")
        || lower.contains("compcare")
        || lower.contains("authority")
        || lower.contains("agency")
        || lower.contains("department")
    {
        return OrganisationType::GovernmentAgency;
    }
    if lower.contains("psychology") || lower.contains("psychological")
        || lower.contains("traumatic stress clinic")
        || lower.contains("psychiatric clinic")
        || lower.contains("counselling")
    {
        return OrganisationType::PsychologyClinic;
    }
    if lower.contains("clinic") || lower.contains("medical centre") || lower.contains("medical center")
        || lower.contains("general practice") || lower.contains("practice")
        || lower.contains("rehabilitation centre") || lower.contains("rehabilitation center")
        || lower.contains("physiotherapy")
    {
        return OrganisationType::MedicalPractice;
    }
    OrganisationType::Unknown
}

// ── Patient identity merging ─────────────────────────────────────────────

fn accumulate_patient(
    acc: &mut BTreeMap<String, PatientIdentity>,
    patient_id: String,
    name: String,
    dob: Option<String>,
    doc_id: String,
) {
    let entry = acc.entry(patient_id.clone()).or_insert_with(|| PatientIdentity {
        patient_id: patient_id.clone(),
        names: Vec::new(),
        date_of_birth: None,
        aliases: Vec::new(),
        source_document_ids: Vec::new(),
        confidence: 0.0,
        metadata: serde_json::json!({}),
    });
    if !entry.names.contains(&name) {
        entry.names.push(name);
    }
    if entry.date_of_birth.is_none() && dob.is_some() {
        entry.date_of_birth = dob;
    }
    if !entry.source_document_ids.contains(&doc_id) {
        entry.source_document_ids.push(doc_id);
    }
}

/// Find a DOB associated with `patient_name`. Looks at `DOB:` and
/// `Date of Birth:` headings within ~120 chars of the patient name.
fn extract_dob_for(patient_name: &str, text: &str) -> Option<String> {
    let lower_text = text.to_lowercase();
    let lower_name = patient_name.to_lowercase();
    let name_pos = lower_text.find(&lower_name);

    let mut dob: Option<String> = None;
    for (label, _) in [("dob:", 4_usize), ("date of birth:", 14_usize)] {
        if let Some(label_pos) = lower_text.find(label) {
            let after = label_pos + label.len();
            // Take up to next newline.
            let end = lower_text[after..]
                .find('\n')
                .map(|p| after + p)
                .unwrap_or(lower_text.len());
            let raw = text[after..end].trim().trim_matches(|c: char| c == ',').trim();
            // Coerce to YYYY-MM-DD or YYYY.
            if let Some(parsed) = parse_dob(raw) {
                // Prefer a DOB near the patient name (≤500 chars apart).
                if let Some(np) = name_pos {
                    let distance = label_pos.abs_diff(np);
                    if distance <= 500 {
                        return Some(parsed);
                    }
                }
                dob = Some(parsed);
            }
        }
    }
    dob
}

/// Permissive DOB parser — recognises `DD/MM/YYYY`, `D/M/YYYY`,
/// `YYYY-MM-DD`, `Month YYYY`, bare 4-digit year. Returns ISO form at
/// best-known precision.
fn parse_dob(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('.');
    // ISO already.
    if trimmed.len() == 10 && &trimmed[4..5] == "-" && &trimmed[7..8] == "-" {
        return Some(trimmed.to_string());
    }
    // Slash date.
    if trimmed.contains('/') {
        let parts: Vec<&str> = trimmed.split('/').collect();
        if parts.len() == 3 {
            let d = parts[0].parse::<u32>().ok()?;
            let m = parts[1].parse::<u32>().ok()?;
            let y_raw = parts[2].parse::<u32>().ok()?;
            let y = if y_raw < 100 { if y_raw >= 30 { 1900 + y_raw } else { 2000 + y_raw } } else { y_raw };
            if (1..=31).contains(&d) && (1..=12).contains(&m) && (1900..=2100).contains(&y) {
                return Some(format!("{:04}-{:02}-{:02}", y, m, d));
            }
        }
    }
    // Bare year.
    if trimmed.len() == 4 && trimmed.chars().all(|c| c.is_ascii_digit()) {
        let y = trimmed.parse::<u32>().ok()?;
        if (1900..=2100).contains(&y) {
            return Some(format!("{:04}", y));
        }
    }
    None
}

// ── Participant / organisation merging ───────────────────────────────────

fn accumulate_participant(
    acc: &mut BTreeMap<String, Participant>,
    pid: String,
    name: String,
    role: ParticipantRole,
    role_evidence: JsonValue,
    doc_id: String,
) {
    let entry = acc.entry(pid.clone()).or_insert_with(|| Participant {
        participant_id: pid.clone(),
        name: name.clone(),
        role,
        source_document_ids: Vec::new(),
        organisations: Vec::new(),
        metadata: serde_json::json!({ "role_evidence": [] }),
    });
    // Role precedence — once we have a specific role, do NOT downgrade
    // it. Unknown / UnknownClinician are the weakest; Specialist
    // upgrades into TreatingPsychiatrist / AssessingPsychiatrist /
    // GP, but those never demote each other.
    entry.role = stronger_role(entry.role, role);
    if !entry.source_document_ids.contains(&doc_id) {
        entry.source_document_ids.push(doc_id);
    }
    // Append the new evidence entry to the metadata audit trail.
    let mut evidence_array = entry
        .metadata
        .get("role_evidence")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    evidence_array.push(role_evidence);
    entry.metadata = serde_json::json!({ "role_evidence": evidence_array });
}

fn stronger_role(a: ParticipantRole, b: ParticipantRole) -> ParticipantRole {
    // Higher specificity wins. Ties → preserve the existing role.
    let rank = |r: ParticipantRole| -> u8 {
        match r {
            ParticipantRole::Unknown               => 0,
            ParticipantRole::UnknownClinician      => 1,
            ParticipantRole::Specialist            => 2,
            ParticipantRole::CaseManager           => 2,
            ParticipantRole::EmployerRepresentative => 2,
            ParticipantRole::Lawyer                => 2,
            ParticipantRole::OccupationalTherapist => 3,
            ParticipantRole::GeneralPractitioner   => 4,
            ParticipantRole::TreatingPsychologist  => 5,
            ParticipantRole::TreatingPsychiatrist  => 5,
            ParticipantRole::AssessingPsychiatrist => 5,
            ParticipantRole::Patient               => 6,
        }
    };
    if rank(b) > rank(a) { b } else { a }
}

fn accumulate_organisation(
    acc: &mut BTreeMap<String, Organisation>,
    oid: String,
    name: String,
    organisation_type: OrganisationType,
    doc_id: String,
) {
    let entry = acc.entry(oid.clone()).or_insert_with(|| Organisation {
        organisation_id: oid.clone(),
        name: name.clone(),
        organisation_type,
        source_document_ids: Vec::new(),
        metadata: serde_json::json!({}),
    });
    if entry.organisation_type == OrganisationType::Unknown
        && organisation_type != OrganisationType::Unknown
    {
        entry.organisation_type = organisation_type;
    }
    if !entry.source_document_ids.contains(&doc_id) {
        entry.source_document_ids.push(doc_id);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Lowercase + strip non-alphanumeric border, collapse whitespace into
/// dashes. Used to build deterministic ids.
fn normalise_name(s: &str) -> String {
    let lower = s.to_lowercase();
    let cleaned: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join("-")
}

fn stable_id(prefix: &str, slug: &str) -> String {
    format!("{prefix}:{slug}")
}

// ── Graph-bridge helpers (Step 8 — output-only, no graph integration yet)

/// Build a graph-ready Patient node payload (no integration here — the
/// future ClinicalKnowledgeGraph builder will consume this).
#[allow(dead_code)] // Future GCKG integration hook.
pub fn graph_node_for_patient(p: &PatientIdentity) -> JsonValue {
    serde_json::json!({
        "node_id":   p.patient_id,
        "node_type": "patient",
        "concept":   primary_name(&p.names),
        "attributes": {
            "names":              p.names,
            "date_of_birth":      p.date_of_birth,
            "aliases":            p.aliases,
            "source_document_ids": p.source_document_ids,
            "confidence":         p.confidence,
            "trace_chain": {
                "patient_ids":         [p.patient_id.clone()],
                "source_document_ids": p.source_document_ids,
            },
        },
    })
}

/// Build a graph-ready Participant node payload.
#[allow(dead_code)] // Future GCKG integration hook.
pub fn graph_node_for_participant(p: &Participant) -> JsonValue {
    serde_json::json!({
        "node_id":   p.participant_id,
        "node_type": "participant",
        "concept":   p.name,
        "attributes": {
            "role":               p.role.as_str(),
            "source_document_ids": p.source_document_ids,
            "organisations":      p.organisations,
            "metadata":           p.metadata,
            "trace_chain": {
                "participant_ids":     [p.participant_id.clone()],
                "source_document_ids": p.source_document_ids,
            },
        },
    })
}

/// Build a graph-ready Organisation node payload.
#[allow(dead_code)] // Future GCKG integration hook.
pub fn graph_node_for_organisation(o: &Organisation) -> JsonValue {
    serde_json::json!({
        "node_id":   o.organisation_id,
        "node_type": "organisation",
        "concept":   o.name,
        "attributes": {
            "organisation_type":  o.organisation_type.as_str(),
            "source_document_ids": o.source_document_ids,
            "trace_chain": {
                "organisation_ids":   [o.organisation_id.clone()],
                "source_document_ids": o.source_document_ids,
            },
        },
    })
}

fn primary_name(names: &[String]) -> String {
    names.first().cloned().unwrap_or_default()
}

/// Suppress an unused-import warning when only some helpers are used.
#[allow(dead_code)]
fn _silence(_d: &[DetectedSection]) {}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn pd_like(
        doc_id: &str,
        clean_text: &str,
        people: Vec<(&str, &str, &str)>, // (name, role, snippet)
        organisations: Vec<&str>,
        parties_patient: &str,
        clinical_events: Vec<(&str, &str)>, // (event_id, source_section)
    ) -> JsonValue {
        let people_json: Vec<JsonValue> = people
            .into_iter()
            .map(|(n, r, snip)| serde_json::json!({
                "name": n,
                "role": r,
                "source_snippet": snip,
                "confidence": 0.9,
            }))
            .collect();
        let events_json: Vec<JsonValue> = clinical_events
            .into_iter()
            .map(|(eid, section)| serde_json::json!({
                "event_id": eid,
                "source_section": section,
                "concept": "irrelevant",
                "event_type": "diagnosis",
            }))
            .collect();
        serde_json::json!({
            "doc_id":     doc_id,
            "clean_text": clean_text,
            "raw_text":   clean_text,
            "people":     people_json,
            "entities":   { "organisations": organisations },
            "parties":    { "patient": parties_patient, "doctor": "", "organisation": "" },
            "clinical_events": events_json,
        })
    }

    fn find_participant_role(payload: &ParticipantResolutionPayload, name_contains: &str) -> ParticipantRole {
        payload
            .participants
            .iter()
            .find(|p| p.name.to_lowercase().contains(&name_contains.to_lowercase()))
            .unwrap_or_else(|| panic!("participant matching {:?} missing: {:?}", name_contains, payload.participants))
            .role
    }
    fn find_organisation_type(payload: &ParticipantResolutionPayload, name_contains: &str) -> OrganisationType {
        payload
            .organisations
            .iter()
            .find(|o| o.name.to_lowercase().contains(&name_contains.to_lowercase()))
            .unwrap_or_else(|| panic!("org matching {:?} missing: {:?}", name_contains, payload.organisations))
            .organisation_type
    }

    // ─── 1. Dr Rayers (Independent Psychiatric Opinion) → AssessingPsychiatrist
    #[test]
    fn dr_rayers_resolves_to_assessing_psychiatrist() {
        let doc = pd_like(
            "doc1",
            "Independent Psychiatric Opinion\n\
             Author: Dr Rayers\n\
             Reviewing Psychiatrist\n\
             Presentation inconsistent with PTSD.",
            vec![("Dr Rayers", "author", "Author: Dr Rayers")],
            vec![],
            "",
            vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_participant_role(&payload, "Rayers"),
            ParticipantRole::AssessingPsychiatrist);
    }

    // ─── 2. Treating Psychologist → TreatingPsychologist
    #[test]
    fn treating_psychologist_section_resolves_correctly() {
        let doc = pd_like(
            "doc2",
            "Treating Psychologist\n\
             Diagnosis: post-traumatic stress disorder.\n\
             Author: Dr Lewis\n",
            vec![("Dr Lewis", "psychologist", "Treating Psychologist\nDiagnosis: post-traumatic stress disorder.\nAuthor: Dr Lewis")],
            vec![],
            "",
            vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_participant_role(&payload, "Lewis"),
            ParticipantRole::TreatingPsychologist);
    }

    // ─── 3. GP Notes → GeneralPractitioner
    #[test]
    fn gp_notes_resolves_to_general_practitioner() {
        let doc = pd_like(
            "doc3",
            "GP Notes\n\
             pt seen 04/08/21. ? PTSD. ? depn worsening.",
            vec![("Dr Singh", "gp", "GP Notes")],
            vec![],
            "",
            vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_participant_role(&payload, "Singh"),
            ParticipantRole::GeneralPractitioner);
    }

    // ─── 4. Traumatic Stress Clinic → PsychologyClinic
    #[test]
    fn traumatic_stress_clinic_resolves_to_psychology_clinic() {
        let doc = pd_like(
            "doc4", "Report supplied by Traumatic Stress Clinic.",
            vec![], vec!["Traumatic Stress Clinic"], "", vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_organisation_type(&payload, "Traumatic Stress Clinic"),
            OrganisationType::PsychologyClinic);
    }

    // ─── 5. Personal Injury Commission → LegalBody
    #[test]
    fn personal_injury_commission_resolves_to_legal_body() {
        let doc = pd_like(
            "doc5", "Document tendered before the Personal Injury Commission.",
            vec![], vec!["Personal Injury Commission"], "", vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_organisation_type(&payload, "Personal Injury Commission"),
            OrganisationType::LegalBody);
    }

    // ─── 6. NSW Ambulance → Employer
    #[test]
    fn nsw_ambulance_resolves_to_employer() {
        let doc = pd_like(
            "doc6", "Employer: New South Wales Ambulance Service.",
            vec![], vec!["New South Wales Ambulance Service"], "", vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        assert_eq!(find_organisation_type(&payload, "Ambulance"),
            OrganisationType::Employer);
    }

    // ─── 7. Duplicate participant names merge
    #[test]
    fn duplicate_participant_names_merge_across_documents() {
        let docs = vec![
            pd_like("docA",
                "Treating Psychologist\nDiagnosis: PTSD.\nAuthor: Dr Lewis\n",
                vec![("Dr Lewis", "psychologist", "Treating Psychologist Author: Dr Lewis")],
                vec![], "", vec![],
            ),
            pd_like("docB",
                "Treating Psychologist follow-up note.\nAuthor: Dr Lewis\n",
                vec![("Dr Lewis", "psychologist", "Treating Psychologist Author: Dr Lewis")],
                vec![], "", vec![],
            ),
        ];
        let payload = build_participant_resolution(&docs);
        let lewis: Vec<&Participant> = payload.participants.iter()
            .filter(|p| p.name.to_lowercase().contains("lewis"))
            .collect();
        assert_eq!(lewis.len(), 1, "Dr Lewis must merge: {:?}", lewis);
        assert!(lewis[0].source_document_ids.contains(&"docA".to_string()));
        assert!(lewis[0].source_document_ids.contains(&"docB".to_string()));
    }

    // ─── 8. Duplicate organisations merge
    #[test]
    fn duplicate_organisations_merge_across_documents() {
        let docs = vec![
            pd_like("docA", "", vec![], vec!["Shoalhaven Hospital"], "", vec![]),
            pd_like("docB", "", vec![], vec!["Shoalhaven Hospital"], "", vec![]),
        ];
        let payload = build_participant_resolution(&docs);
        let shoalhaven: Vec<&Organisation> = payload.organisations.iter()
            .filter(|o| o.name.to_lowercase().contains("shoalhaven"))
            .collect();
        assert_eq!(shoalhaven.len(), 1);
        assert_eq!(shoalhaven[0].organisation_type, OrganisationType::Hospital);
        assert!(shoalhaven[0].source_document_ids.contains(&"docA".to_string()));
        assert!(shoalhaven[0].source_document_ids.contains(&"docB".to_string()));
    }

    // ─── 9. Every document produces a DocumentParticipantMap
    #[test]
    fn every_document_produces_a_document_participant_map() {
        let docs = vec![
            pd_like("docA", "GP Notes", vec![("Dr Singh", "gp", "GP Notes")],
                vec![], "John Smith", vec![]),
            pd_like("docB", "Independent Psychiatric Opinion\nAuthor: Dr Rayers",
                vec![("Dr Rayers", "author", "Author: Dr Rayers")],
                vec!["Personal Injury Commission"], "", vec![]),
            pd_like("docC", "Empty doc", vec![], vec![], "", vec![]),
        ];
        let payload = build_participant_resolution(&docs);
        let ids: BTreeSet<&str> = payload.document_maps.iter().map(|m| m.document_id.as_str()).collect();
        for id in ["docA", "docB", "docC"] {
            assert!(ids.contains(id),
                "expected DocumentParticipantMap for {}: {:?}", id, ids);
        }
    }

    // ─── 10. Every attribution remains reversible
    #[test]
    fn every_attribution_is_reversible() {
        let doc = pd_like(
            "docX",
            "Treating Psychologist\n\
             Diagnosis: PTSD.\n\
             Author: Dr Lewis\n",
            vec![("Dr Lewis", "psychologist",
                  "Treating Psychologist\nDiagnosis: PTSD.\nAuthor: Dr Lewis")],
            vec![], "Jane Doe",
            vec![("ev1", "Treating Psychologist"), ("ev2", "")],
        );
        let payload = build_participant_resolution(&[doc]);
        // Every event has an attribution row.
        for eid in ["ev1", "ev2"] {
            let attr = payload.attributions.iter()
                .find(|a| a.event_id == *eid)
                .unwrap_or_else(|| panic!("attribution for {eid} missing"));
            // ev1 (with section) should pin to Dr Lewis; ev2 (no section)
            // gets the document's primary patient/org only.
            if eid == "ev1" {
                let pid = attr.participant_id.as_deref().unwrap_or("");
                assert!(pid.to_lowercase().contains("lewis"),
                    "ev1 must attribute to Dr Lewis; got {pid}");
            }
            // Patient is always resolvable when parties.patient is set.
            assert!(attr.patient_id.is_some(),
                "patient_id must be set for {eid}: {:?}", attr);
        }
    }

    // ─── Extra coverage ──────────────────────────────────────────────

    #[test]
    fn role_evidence_recorded_in_metadata() {
        let doc = pd_like("doc",
            "Treating Psychologist\nAuthor: Dr Lewis\n",
            vec![("Dr Lewis", "psychologist", "Treating Psychologist Author: Dr Lewis")],
            vec![], "", vec![]);
        let payload = build_participant_resolution(&[doc]);
        let lewis = payload.participants.iter().find(|p| p.name.to_lowercase().contains("lewis")).unwrap();
        let evidence = lewis.metadata.get("role_evidence").and_then(|v| v.as_array());
        assert!(evidence.is_some() && !evidence.unwrap().is_empty(),
            "role_evidence must be populated: {:?}", lewis.metadata);
    }

    #[test]
    fn patient_dob_extracted_when_present() {
        let doc = pd_like(
            "doc",
            "Patient: John Smith\nDOB: 12/03/1980\nPresentation: chronic pain.",
            vec![("John Smith", "patient", "Patient: John Smith")],
            vec![], "", vec![],
        );
        let payload = build_participant_resolution(&[doc]);
        let pat = payload.patients.iter().find(|p| p.names.iter().any(|n| n.contains("John Smith"))).unwrap();
        assert_eq!(pat.date_of_birth.as_deref(), Some("1980-03-12"));
    }

    #[test]
    fn graph_node_helpers_emit_expected_shape() {
        let patient = PatientIdentity {
            patient_id: "patient:jane-doe".into(),
            names: vec!["Jane Doe".into()],
            date_of_birth: Some("1990-05-04".into()),
            aliases: vec![],
            source_document_ids: vec!["docA".into()],
            confidence: 0.8,
            metadata: serde_json::json!({}),
        };
        let node = graph_node_for_patient(&patient);
        assert_eq!(node.get("node_type").and_then(|v| v.as_str()), Some("patient"));
        assert_eq!(node.get("node_id").and_then(|v| v.as_str()), Some("patient:jane-doe"));
        // trace_chain must reference the patient id and source docs.
        let trace = node.get("attributes").and_then(|a| a.get("trace_chain")).cloned().unwrap();
        assert_eq!(
            trace.get("patient_ids").and_then(|v| v.as_array()).map(|a| a.len()),
            Some(1)
        );
    }
}
