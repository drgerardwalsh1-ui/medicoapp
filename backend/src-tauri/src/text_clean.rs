//! Text cleaning layer — runs BEFORE every NLP / structured-extraction call.
//!
//! Goals:
//!   - Preserve raw text for audit.
//!   - Produce a `clean_text` suitable for spaCy / scispaCy / rule extraction.
//!   - Report which lines were removed and why, so the UI / tests can show it.
//!
//! Targets explicitly enumerated in the product spec:
//!   ChatGPT, Ask anything, Get Plus, Updates Available, Install Tonight,
//!   Remind Me Later, GoLive, Continue, CODEX, JavaScript, UTF-8, LF,
//!   random IDE/status/footer fragments, OCR garbage lines with very low
//!   alphabetic ratio, very short nonsense lines unless they are a known
//!   clinical abbreviation.
//!
//! This module is deterministic, fully unit-tested, and has no I/O.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct RemovedLine {
    /// The original line content (trimmed) that was discarded.
    pub line: String,
    /// Why it was removed — short, stable identifier suitable for assertions
    /// and for a UI legend.
    pub reason: &'static str,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct CleanedText {
    /// Original input, byte-for-byte. Stored so the UI can offer a "view raw"
    /// option and so tests can prove the cleaner did not silently mutate the
    /// raw representation.
    pub raw_text: String,
    /// Output of the cleaner — what NLP and rule-extraction consume.
    pub clean_text: String,
    /// Audit trail. Sorted by occurrence in the source.
    pub removed_lines: Vec<RemovedLine>,
    /// Stable counters useful in the UI summary.
    pub warnings: Vec<String>,
}

/// Run the full cleaning pipeline.
///
/// Pipeline (per line, in order):
/// 1. Trim. Collapse runs of blank lines (≤1).
/// 2. Exact-match UI-noise rejection (ChatGPT, GoLive, …).
/// 3. Prefix/contains UI-noise rejection — covers OCR'd buttons like
///    "Install Tonight  Remind Me Later" on one line.
/// 4. Code-artifact rejection (filenames with code extensions, IDE
///    status bar tokens like "UTF-8", "LF").
/// 5. Low alpha-ratio rejection (< 0.45) — OCR garbage.
/// 6. Very-short-noise rejection (≤2 chars and not a clinical abbreviation).
pub fn clean_extracted_text(raw: &str) -> CleanedText {
    let mut kept: Vec<&str> = Vec::new();
    let mut removed: Vec<RemovedLine> = Vec::new();
    let mut prev_blank = true; // suppress leading blanks

    for raw_line in raw.lines() {
        let trimmed = raw_line.trim();

        if trimmed.is_empty() {
            if !prev_blank {
                kept.push("");
            }
            prev_blank = true;
            continue;
        }

        if let Some(reason) = classify_line_as_noise(trimmed) {
            removed.push(RemovedLine {
                line: trimmed.to_string(),
                reason,
            });
            continue;
        }

        kept.push(raw_line); // keep original (preserves any meaningful indent)
        prev_blank = false;
    }

    // Drop trailing blank lines that survived collapsing.
    while kept.last().map_or(false, |l| l.trim().is_empty()) {
        kept.pop();
    }

    let mut warnings = Vec::new();
    if removed.len() >= 10 {
        warnings.push(format!(
            "Removed {} noise lines — review the audit panel before relying on extraction.",
            removed.len()
        ));
    }

    CleanedText {
        raw_text: raw.to_string(),
        clean_text: kept.join("\n"),
        removed_lines: removed,
        warnings,
    }
}

/// Return Some(reason) if `trimmed` should be dropped.
///
/// Order matters:
///   1. Hard UI-noise rejection (lines that are NEVER clinical, like
///      "ChatGPT" or "JavaScript && GoLive").
///   2. PROTECTED check — if the line matches a clinical pattern
///      (date, diagnosis, heading, clinician verb, short abbr) it
///      bypasses every subsequent heuristic. The product spec says
///      preserving clinical signal beats removing every OCR fragment.
///   3. Remaining heuristics for unprotected, non-UI-token lines.
fn classify_line_as_noise(trimmed: &str) -> Option<&'static str> {
    let lower = trimmed.to_lowercase();

    // 1. Exact-match UI/chrome tokens.
    let stripped = lower
        .trim_end_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '>' | ')'))
        .trim()
        .to_string();
    for &noise in UI_NOISE_EXACT {
        if stripped == noise {
            return Some("ui-noise exact match");
        }
    }

    // 2. Contains-style UI noise (e.g. "Install Tonight  Remind Me Later").
    for &phrase in UI_NOISE_CONTAINS {
        if lower.contains(phrase) && trimmed.len() <= phrase.len() + 32 {
            return Some("ui-noise inline");
        }
    }

    // 3. Any line that mentions a known dev/editor token as a whole word
    //    is treated as IDE / chat-UI chrome. This is the most common
    //    failure mode in FakeClient1 — OCR captures something like
    //    "UTF-8 LF {} JavaScript && «GoLive Continue (NE)" which is a
    //    single status-bar strip that should be dropped entirely.
    for &tok in DEV_UI_TOKENS_BLOCK {
        if word_contains(&lower, tok) {
            return Some("dev/ui token line");
        }
    }

    // ── Protected clinical content ──────────────────────────────────────
    // After the explicit UI/dev-token rejections, but before any noise
    // heuristic, ask: does this line carry clinical signal? Date lines
    // ("Date: 10 May 2022"), diagnosis phrases ("Major depressive
    // disorder"), authoring ("Author: Dr Lewis"), section headings
    // ("Opinion:") all qualify. Anything that does is kept verbatim —
    // even if its alphabetic ratio looks low because of digits, or its
    // length is short. Per the spec: preserve clinical signal.
    if is_protected_clinical_line(trimmed, &lower) {
        return None;
    }

    // 4. Lines that look like code/editor fragments:
    //    {}, &&, ||, =>, ::, ===, //, /* — combined with high symbol
    //    density. We catch any single one of these.
    for marker in CODE_FRAGMENT_MARKERS {
        if lower.contains(marker) {
            return Some("code fragment marker");
        }
    }

    // 5. IDE status-bar lines — short and made up entirely of IDE tokens.
    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.iter().all(|t| {
        let lc = t.to_lowercase();
        IDE_STATUS_TOKENS.contains(&lc.as_str())
    }) && !tokens.is_empty()
        && tokens.len() <= 4
    {
        return Some("ide status fragment");
    }

    // 6. Code/filename lines — single token ending in a code extension.
    if !lower.contains(' ') {
        for ext in CODE_EXTENSIONS {
            if lower.ends_with(ext) {
                return Some("code or filename");
            }
        }
    }
    // 6b. Also drop lines that CONTAIN a `*.js`-style token even if there
    //     is other content on the same line — "ds.js M" pattern.
    for w in trimmed.split_whitespace() {
        let lw = w.to_lowercase();
        if let Some(dot) = lw.rfind('.') {
            if dot > 0 && dot + 1 < lw.len() {
                let ext = &lw[dot + 1..];
                if CODE_EXTENSIONS.iter().any(|e| e.trim_start_matches('.') == ext) {
                    return Some("contains code/filename token");
                }
            }
        }
    }

    // 7. Alphabetic ratio — letters as a fraction of non-whitespace chars.
    let non_ws: Vec<char> = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if !non_ws.is_empty() {
        let alpha_count = non_ws.iter().filter(|c| c.is_alphabetic()).count();
        let ratio = alpha_count as f64 / non_ws.len() as f64;
        if ratio < 0.55 && trimmed.len() >= 4 {
            return Some("low alphabetic ratio");
        }
    }

    // 8. OCR gibberish heuristics (general — NOT literal-token blocklists).
    //    Run per-token: any token in the line that looks like OCR garbage
    //    contributes a "garbage token" count. If >= half the alphabetic
    //    tokens look garbled, drop the line.
    let alpha_tokens: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|t| t.chars().any(|c| c.is_alphabetic()))
        .collect();
    if !alpha_tokens.is_empty() {
        let garbled = alpha_tokens
            .iter()
            .filter(|t| looks_garbled(t))
            .count();
        // Threshold: 50%+ tokens garbled AND the line has no recognised
        // clinical short abbreviation (so "GP saw px" is not dropped).
        let has_clinical_anchor = alpha_tokens.iter().any(|t| {
            let lc = t.trim_end_matches(|c: char| !c.is_alphabetic()).to_lowercase();
            CLINICAL_SHORT_ABBR.contains(&lc.as_str())
                || CLINICAL_ANCHOR_WORDS.contains(&lc.as_str())
        });
        if garbled * 2 >= alpha_tokens.len() && !has_clinical_anchor {
            return Some("ocr gibberish — low dictionary signal");
        }
    }

    // 9. Very short nonsense — ≤2 chars and not a recognised clinical
    //    abbreviation (preserve "GP", "CT", "BP", "MRI", …).
    if trimmed.len() <= 2 {
        let lc = lower.as_str();
        if !CLINICAL_SHORT_ABBR.contains(&lc) {
            return Some("very short / not a clinical abbreviation");
        }
    }

    // 10. Short noise without clinical / date context. Lines ≤ 35 chars
    //     with NO clinical anchor word AND no 4-digit year are dropped.
    //     This is the general rule that catches things like
    //     "measuircu, GO Tit", "ices: 2", "MITE E — SCENARIO 1", "I er os"
    //     — short fragments that look like words but are not clinical.
    if trimmed.len() <= 35 {
        let has_year = trimmed
            .split(|c: char| !c.is_ascii_digit())
            .any(|seg| {
                seg.len() == 4
                    && seg
                        .parse::<u32>()
                        .map_or(false, |y| (1900..=2100).contains(&y))
            });
        let has_anchor = tokens.iter().any(|t| {
            let lc = t
                .trim_matches(|c: char| !c.is_alphabetic())
                .to_lowercase();
            CLINICAL_SHORT_ABBR.contains(&lc.as_str())
                || CLINICAL_ANCHOR_WORDS.contains(&lc.as_str())
        });
        if !has_year && !has_anchor {
            return Some("short line without clinical / date context");
        }
    }

    None
}

/// True iff `trimmed` carries clinical signal that must NOT be removed by
/// the noise heuristics (short-line, low-alpha, OCR-gibberish).
///
/// Returns true for:
///   - Date lines (Date:, or any line containing a recognised date pattern)
///   - Lines containing a known diagnosis phrase / abbreviation
///   - Clinical section headings (Diagnosis:, Opinion:, Symptoms:, …)
///   - Source / report headings (SOURCE A, Emergency Department, …)
///   - Authoring lines (Author: Dr X, Treating Psychologist, …)
///   - Lines with a clinical verb (presents, complains, prescribed, …)
///   - Standalone clinical short abbreviations (PTSD, GP, ED, MRI, …)
fn is_protected_clinical_line(trimmed: &str, lower: &str) -> bool {
    // Date heading explicitly.
    if lower.starts_with("date:") || lower.starts_with("date ") {
        return true;
    }
    // Author heading explicitly.
    if lower.starts_with("author:") || lower.starts_with("author ") {
        return true;
    }
    // Treating clinician heading.
    if lower.starts_with("treating ") {
        return true;
    }

    // Any line that carries a recognisable date pattern. We don't try to
    // parse here — the dates module owns that — we just look for the
    // shapes that mean "this line names a date":
    //   - slash date: DD/MM/YYYY or DD/MM/YY
    //   - ISO date:   YYYY-MM-DD
    //   - month word + 4-digit year: "May 2022", "11 May 2022", "March 2022"
    if contains_date_shape(lower) {
        return true;
    }

    // Diagnosis phrases — substring match in lowercased form.
    for &phrase in PROTECTED_DIAGNOSIS_PHRASES {
        if lower.contains(phrase) {
            return true;
        }
    }

    // Section / source / report headings — exact match OR prefix.
    for &heading in PROTECTED_HEADINGS {
        if lower == heading || lower.starts_with(heading) {
            return true;
        }
    }

    // Clinical verbs as whole words.
    for &verb in CLINICAL_VERBS {
        if word_contains(lower, verb) {
            return true;
        }
    }

    // Clinical shorthand — common in GP notes and dictated narratives.
    // These tokens almost always indicate clinically meaningful content
    // that the alphabetic-ratio / short-line rules would otherwise eat.
    //   c/o low mood + anx ++ since MVA
    //   sleep poor, appetite J
    //   ? depn worsening
    //   pt seen 04/08/21
    for &cue in CLINICAL_SHORTHAND_CUES {
        if word_contains(lower, cue) {
            return true;
        }
    }
    // Lines starting with "?" followed by an alphabetic token are
    // queried-diagnosis shorthand ("? PTSD", "? depn"). Protect them.
    if trimmed.starts_with('?') {
        let rest = trimmed.trim_start_matches('?').trim_start();
        if rest.chars().next().map_or(false, |c| c.is_alphabetic()) {
            return true;
        }
    }

    // Standalone short clinical abbreviation (PTSD, GP, ED, …).
    // Only trust this rule when the line is essentially just the
    // abbreviation — otherwise OCR noise like "+@Oa" would be saved by
    // the "oa" → osteoarthritis lookup.
    let stripped = lower
        .trim_end_matches(|c: char| !c.is_alphanumeric())
        .trim_start_matches(|c: char| !c.is_alphanumeric());
    let symbol_ratio = trimmed
        .chars()
        .filter(|c| !c.is_alphanumeric() && !c.is_whitespace())
        .count() as f64
        / trimmed.chars().count().max(1) as f64;
    if symbol_ratio < 0.20 && CLINICAL_SHORT_ABBR.contains(&stripped) {
        return true;
    }

    // Trailing `:` plus an alphabetic token — generic short heading
    // ("Opinion:" / "Plan:" / "Findings:" — even if not in our explicit
    // list). Only fire when the line is just a single word followed by `:`.
    if let Some((word, rest)) = lower.split_once(':') {
        if rest.trim().is_empty()
            && !word.is_empty()
            && word.chars().all(|c| c.is_alphabetic())
        {
            return true;
        }
    }

    false
}

/// True iff `lower` contains anything date-shaped: slash, ISO, or
/// month-word + year. Deliberately permissive — the structured date
/// extractor does the precise parsing later.
fn contains_date_shape(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    // Slash date: digit+digit+/digit+digit+/digit{2,4}
    for i in 0..bytes.len() {
        let c = bytes[i] as char;
        if !c.is_ascii_digit() {
            continue;
        }
        let mut j = i;
        while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
            j += 1;
        }
        let first_len = j - i;
        if !(1..=2).contains(&first_len) {
            continue;
        }
        if j >= bytes.len() || bytes[j] != b'/' {
            continue;
        }
        let m_start = j + 1;
        let mut k = m_start;
        while k < bytes.len() && (bytes[k] as char).is_ascii_digit() {
            k += 1;
        }
        if !(1..=2).contains(&(k - m_start)) {
            continue;
        }
        if k >= bytes.len() || bytes[k] != b'/' {
            continue;
        }
        let y_start = k + 1;
        let mut l = y_start;
        while l < bytes.len() && (bytes[l] as char).is_ascii_digit() {
            l += 1;
        }
        let y_len = l - y_start;
        if y_len == 2 || y_len == 4 {
            return true;
        }
    }
    // ISO date: YYYY-MM-DD — char-aware so multi-byte chars elsewhere
    // in the line don't cause byte-index panics.
    let chars: Vec<char> = lower.chars().collect();
    if chars.len() >= 10 {
        for i in 0..=chars.len() - 10 {
            let w = &chars[i..i + 10];
            if w[4] == '-'
                && w[7] == '-'
                && w[..4].iter().all(|c| c.is_ascii_digit())
                && w[5..7].iter().all(|c| c.is_ascii_digit())
                && w[8..10].iter().all(|c| c.is_ascii_digit())
            {
                return true;
            }
        }
    }
    // Month-word + 4-digit year.
    for mw in MONTH_WORDS {
        if let Some(pos) = lower.find(mw) {
            let after = pos + mw.len();
            // Allow optional ", " then 4 digits.
            let tail = &lower[after..].trim_start_matches(|c: char| c == ',' || c == ' ');
            let head: String = tail.chars().take(4).collect();
            if head.len() == 4 && head.chars().all(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

/// True if `text` contains `kw` as a whole word (lowercase comparison).
/// Advances by one char at a time so we never land mid-multi-byte-character.
fn word_contains(text: &str, kw: &str) -> bool {
    if kw.is_empty() {
        return false;
    }
    let bytes = text.as_bytes();
    let mut start = 0;
    while start <= text.len() {
        if !text.is_char_boundary(start) {
            start += 1;
            continue;
        }
        let Some(rel) = text[start..].find(kw) else { break };
        let pos = start + rel;
        let left_ok = pos == 0 || !(bytes[pos - 1] as char).is_alphanumeric();
        let right = pos + kw.len();
        let right_ok = right >= bytes.len() || !(bytes[right] as char).is_alphanumeric();
        if left_ok && right_ok {
            return true;
        }
        // Advance past this hit by one char to keep us on char boundaries.
        start = pos
            + text[pos..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    }
    false
}

/// True iff a single token looks like OCR gibberish. Heuristics applied
/// to the lowercased alphabetic prefix of the token:
///
///   A. 3+ identical alphabetic chars in a row     ("ticccicu")
///   B. ≥7 alpha chars with <25% vowels             ("rrtctercu")
///   C. ≥4 consecutive consonants run               ("tcTrecu")
///   D. ≥4 alpha chars, all uppercase, that contain no vowels at all
///      ("CRTRC", "TCT") — typical OCR consonant smear
///
/// Tokens shorter than 4 alpha chars are never considered garbled here
/// (they fall through to the very-short-nonsense check above if needed).
fn looks_garbled(raw: &str) -> bool {
    const CONSONANT_SAFE: &[&str] = &[
        "strength", "length", "lymph", "rhythm", "eighth", "months",
        "script", "scripts", "transcript", "construct", "instruct",
        "abstract", "restrict", "district", "obstruct", "destruct", "extinct",
        "benchmark", "bankruptcy", "sphincter",
    ];
    let alpha: String = raw.chars().filter(|c| c.is_alphabetic()).collect();
    if alpha.len() < 4 {
        return false;
    }
    let lower = alpha.to_lowercase();
    if CONSONANT_SAFE.contains(&lower.as_str()) {
        return false;
    }
    // Recognised clinical abbreviations / short clinical words are never gibberish.
    if CLINICAL_SHORT_ABBR.contains(&lower.as_str())
        || CLINICAL_ANCHOR_WORDS.contains(&lower.as_str())
    {
        return false;
    }
    let chars: Vec<char> = lower.chars().collect();

    // A — triple identical
    for w in chars.windows(3) {
        if w[0] == w[1] && w[1] == w[2] {
            return true;
        }
    }

    // B — low vowel density for long tokens
    if chars.len() >= 7 {
        let vowels = chars.iter().filter(|c| "aeiouy".contains(**c)).count();
        if (vowels as f64) / (chars.len() as f64) < 0.25 {
            return true;
        }
    }

    // C — long consonant run
    let mut run = 0;
    let mut max_run = 0;
    for &c in &chars {
        if "aeiouy".contains(c) {
            run = 0;
        } else {
            run += 1;
            if run > max_run {
                max_run = run;
            }
        }
    }
    if max_run >= 4 {
        return true;
    }

    // D — all-uppercase original AND no vowels in the alphabetic prefix
    let original_alpha: String = raw.chars().filter(|c| c.is_alphabetic()).collect();
    let all_upper = !original_alpha.is_empty()
        && original_alpha.chars().all(|c| c.is_ascii_uppercase());
    let has_vowel = chars.iter().any(|c| "aeiouy".contains(*c));
    if all_upper && !has_vowel && chars.len() >= 4 {
        return true;
    }

    false
}

// ── Reference data ───────────────────────────────────────────────────────

/// Exact-match UI/chrome strings, lowercased.
const UI_NOISE_EXACT: &[&str] = &[
    "chatgpt",
    "ask anything",
    "get plus",
    "updates available",
    "install tonight",
    "remind me later",
    "golive",
    "go live",
    "continue",
    "codex",
    "javascript",
    "utf-8",
    "utf8",
    "lf",
    "crlf",
    "ln 1",
    "col 1",
    "spaces: 2",
    "tab size: 2",
    "new chat",
    "regenerate",
    "share",
    "log in",
    "sign in",
    "send message",
    "type a message",
    "upgrade",
    "subscribe",
    "settings",
    "feedback",
    "copy code",
    "thumbs up",
    "thumbs down",
    "claude",
    "claude.ai",
];

/// Phrases that, when present anywhere in a short line, mark it as UI noise.
const UI_NOISE_CONTAINS: &[&str] = &[
    "install tonight",
    "remind me later",
    "updates available",
    "do you want to install",
    "ask anything",
    "get plus",
    "go live",
    "send message",
    "new chat",
];

/// IDE / editor status-bar tokens.
const IDE_STATUS_TOKENS: &[&str] = &[
    "utf-8", "utf8", "lf", "crlf", "spaces", "tab",
    "javascript", "typescript", "rust", "python", "json",
    "ln", "col",
];

/// Source code file extensions.
const CODE_EXTENSIONS: &[&str] = &[
    ".js", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css", ".scss",
    ".py", ".rb", ".go", ".rs", ".java", ".cpp", ".c", ".cs", ".php",
    ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml", ".lock", ".md",
    ".json", ".xml", ".svg",
];

/// Two-character medical abbreviations that survive the very-short filter
/// AND act as anchors that keep otherwise-noisy lines (e.g. handwritten GP
/// notes containing OCR-degraded tokens).
const CLINICAL_SHORT_ABBR: &[&str] = &[
    "ct", "gp", "ed", "bp", "hr", "iv", "im", "ms", "ra", "oa",
    "od", "bd", "bid", "qd", "h/o", "ed",
    "mri", "cbt", "ptsd", "gad", "mdd", "prn", "mva",
];

/// Word-level dev / UI tokens. Presence of any one of these as a whole
/// word in a line is sufficient to drop the entire line. Kept narrow on
/// purpose — these tokens are NEVER legitimate medico-legal content.
const DEV_UI_TOKENS_BLOCK: &[&str] = &[
    "javascript", "typescript", "utf-8", "utf8",
    "chatgpt", "codex", "golive",
    "claude.ai",
    // Reasonable "noise" buttons / status labels
    "remind me later", "install tonight", "updates available", "ask anything",
    "get plus",
];

/// Code-fragment substrings — if a line contains any one of these it is
/// almost certainly an editor pane, not clinical content.
const CODE_FRAGMENT_MARKERS: &[&str] = &[
    "{}", "&&", "||", "=>", "::", "===", "!==", "//", "/*", "*/", "<>", "</>",
];

/// Diagnosis phrases (lowercase) that protect a line from noise heuristics.
/// Substring match — "presents with major depressive disorder symptoms" is
/// protected because it contains "major depressive disorder".
const PROTECTED_DIAGNOSIS_PHRASES: &[&str] = &[
    "post-traumatic stress disorder",
    "post traumatic stress disorder",
    "complex post-traumatic stress disorder",
    "major depressive disorder",
    "generalised anxiety disorder",
    "generalized anxiety disorder",
    "anxiety disorder",
    "adjustment disorder",
    "panic disorder",
    "depressive disorder",
    "depressive episode",
    "disc herniation",
    "lumbar radiculopathy",
    "traumatic brain injury",
    "mild traumatic brain injury",
    "post-concussion syndrome",
    "obsessive-compulsive disorder",
    "attention deficit hyperactivity disorder",
    // Standalone abbreviations — matched whole-word elsewhere too, but
    // substring is safe here because they're distinctive.
    "ptsd", "gad", "mdd", "ocd", "tbi", "cptsd", "c-ptsd", "adhd",
];

/// Clinical / report section headings that protect their line.
const PROTECTED_HEADINGS: &[&str] = &[
    // Section labels (with or without trailing ':')
    "diagnosis", "diagnoses", "opinion", "symptoms", "medications",
    "meds", "plan", "history", "impression", "findings", "summary",
    "conclusion", "recommendation", "recommendations", "background",
    "discussion", "mechanism", "complaint", "complaints",
    // Source / report markers
    "source a", "source b", "source c", "source d", "source e",
    "source f", "source g",
    "emergency department", "radiology report", "imaging report",
    "gp notes", "gp note", "general practice", "consult note",
    "treating psychologist", "treating psychiatrist",
    "treating clinician", "treating doctor", "treating physician",
    "psychiatric assessment", "psychological report",
    "psychology report", "neuropsychological assessment",
    "medico-legal report", "medicolegal report",
    // Role-label prefixes: lines beginning with these typically name
    // the person, so the cleaner must keep them so party_extract can
    // pull the name. The prefix rule (lower.starts_with(heading))
    // catches "Psychologist: Dr Brown", "Patient: John Smith", etc.
    "psychologist", "psychiatrist", "specialist", "consultant",
    "patient", "client", "claimant", "doctor",
    "gp:", "gp -", "general practitioner",
    "report by", "prepared by", "completed by", "written by",
    "reviewing psychiatrist", "reviewing psychologist",
];

/// Clinical shorthand cues — short tokens that almost always indicate
/// clinical content even when surrounded by OCR noise. Matched as whole
/// words on the lowercased line.
const CLINICAL_SHORTHAND_CUES: &[&str] = &[
    // Symptom shorthand
    "anx", "depn", "mva", "c/o", "pt",
    // Pain / sleep / appetite shorthand fragments
    "sleep poor", "poor sleep", "appetite", "low mood",
    // Treatment shorthand
    "pregab", "physio", "ref physio", "ref psych",
    // Frequency / route (clinical, never UI)
    "prn", "wks",
];

/// Clinical verbs that signal the line is reporting clinical content.
const CLINICAL_VERBS: &[&str] = &[
    "presents", "presented", "complains", "complaining", "reports",
    "reported", "describes", "described", "demonstrates", "demonstrated",
    "requested", "started", "commenced", "engaged", "reviewed",
    "referred", "prescribed", "diagnosed", "denies", "denied",
    "endorses", "experiences", "experiencing", "noted", "noting",
    "examined", "examination", "follow-up", "follow up",
    "indicates", "indicated", "consulted", "consultation",
];

/// Month words used by `contains_date_shape`.
const MONTH_WORDS: &[&str] = &[
    "january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
    "oct", "nov", "dec",
];

/// Common everyday English / clinical words that act as anchors so the
/// OCR-gibberish-token-ratio check doesn't accidentally drop a noisy but
/// real clinical sentence ("GP noted ongoing pain in lumbar spine").
const CLINICAL_ANCHOR_WORDS: &[&str] = &[
    "pain", "back", "lower", "anxiety", "mood", "sleep", "depression",
    "patient", "diagnosis", "history", "presenting", "complaint", "review",
    "report", "ongoing", "started", "noted", "saw", "appointment",
    "lumbar", "spine", "knee", "shoulder", "neck", "shoulder",
    "physio", "physiotherapy", "ref", "referral", "treatment",
    "pregab", "pregabalin", "sertraline", "the", "and", "with", "for",
    "complains", "reports", "denies", "imaging", "mri", "scan",
    "findings", "impression", "source",
];

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn reasons(c: &CleanedText) -> Vec<&'static str> {
        c.removed_lines.iter().map(|r| r.reason).collect()
    }

    #[test]
    fn raw_text_is_preserved_verbatim() {
        let input = "ChatGPT\nDiagnosis: PTSD\n";
        let out = clean_extracted_text(input);
        assert_eq!(out.raw_text, input);
    }

    #[test]
    fn strips_chatgpt_and_ui_chrome() {
        let input = "\
ChatGPT
Ask anything
Get Plus
Updates Available
Install Tonight  Remind Me Later
GoLive
Continue
CODEX
Diagnosis: PTSD
";
        let out = clean_extracted_text(input);
        assert!(out.clean_text.contains("PTSD"), "should keep clinical content: {:?}", out.clean_text);
        for noise in ["ChatGPT", "Ask anything", "Get Plus", "GoLive", "CODEX", "Continue"] {
            assert!(
                !out.clean_text.contains(noise),
                "noise '{}' must not survive: {:?}",
                noise,
                out.clean_text
            );
        }
    }

    #[test]
    fn strips_ide_status_fragments() {
        let input = "Diagnosis: depression\nUTF-8\nLF\nJavaScript\nCol 1\n";
        let out = clean_extracted_text(input);
        assert!(out.clean_text.contains("depression"));
        assert!(!out.clean_text.contains("UTF-8"));
        assert!(!out.clean_text.contains("LF"));
        assert!(!out.clean_text.contains("JavaScript"));
    }

    #[test]
    fn keeps_clinical_short_abbreviations() {
        // "GP" should NOT be stripped by the short-line filter.
        let input = "GP\nThis is a real clinical line.";
        let out = clean_extracted_text(input);
        assert!(out.clean_text.contains("GP"), "GP must survive: {:?}", out.clean_text);
    }

    #[test]
    fn rejects_low_alpha_ratio_lines() {
        // 80% punctuation/digits. Either the dedicated low-alpha rule or
        // the code-fragment rule may fire first — both are correct.
        let input = "@@@ 12345 !!!\nDiagnosis: PTSD";
        let out = clean_extracted_text(input);
        assert!(out.clean_text.contains("PTSD"));
        assert!(reasons(&out).iter().any(|r| r.contains("alphabetic") || r.contains("symbol") || r.contains("code")),
            "expected an alpha/symbol/code rejection reason; got: {:?}", reasons(&out));
    }

    #[test]
    fn collapses_blank_runs_and_removes_leading_blanks() {
        // Use real content; single-character lines are filtered by the
        // "very short" rule, which is correct behaviour but would mask
        // the blank-collapse test we actually want to run here.
        let input = "\n\n\nDiagnosis: PTSD\n\n\n\nMedication: sertraline\n\n";
        let out = clean_extracted_text(input);
        assert_eq!(out.clean_text, "Diagnosis: PTSD\n\nMedication: sertraline");
    }

    #[test]
    fn warnings_fire_after_many_removals() {
        let mut s = String::new();
        for _ in 0..15 {
            s.push_str("ChatGPT\n");
        }
        s.push_str("Diagnosis: PTSD\n");
        let out = clean_extracted_text(&s);
        assert!(!out.warnings.is_empty(), "expected a removal warning");
    }

    #[test]
    fn removed_lines_carry_reason_codes() {
        let input = "ChatGPT\nDiagnosis: PTSD\n";
        let out = clean_extracted_text(input);
        assert_eq!(out.removed_lines.len(), 1);
        assert_eq!(out.removed_lines[0].line, "ChatGPT");
        assert_eq!(out.removed_lines[0].reason, "ui-noise exact match");
    }

    // ── Protected-line whitelist regression ──────────────────────────────
    // These were being dropped by the over-aggressive heuristics. Each
    // line MUST survive cleaning.
    #[test]
    fn protects_date_lines() {
        for input in [
            "Date: 10 May 2022",
            "Date: 12 June 2023",
            "pt seen 04/08/21",
            "Date 2023-04-11",
            "March 2022",
        ] {
            let out = clean_extracted_text(input);
            assert!(out.clean_text.contains(input.trim()),
                "date line {:?} must be preserved; got: {:?}", input, out.clean_text);
        }
    }

    #[test]
    fn protects_diagnosis_lines() {
        for input in [
            "Major depressive disorder",
            "Post-traumatic stress disorder",
            "Generalised anxiety disorder",
            "PTSD",
            "GAD",
            "Disc herniation",
        ] {
            let out = clean_extracted_text(input);
            assert!(out.clean_text.contains(input.trim()),
                "diagnosis {:?} must be preserved; got: {:?}", input, out.clean_text);
        }
    }

    #[test]
    fn protects_section_headings_and_authors() {
        for input in [
            "Diagnosis:",
            "Opinion:",
            "Symptoms:",
            "Author: Dr Lewis",
            "Treating Psychologist",
            "SOURCE A: Emergency Department Note",
            "Emergency Department",
            "GP Notes",
        ] {
            let out = clean_extracted_text(input);
            assert!(out.clean_text.contains(input.trim()),
                "heading {:?} must be preserved; got: {:?}", input, out.clean_text);
        }
    }

    #[test]
    fn protects_clinical_verb_lines() {
        let out = clean_extracted_text("She reports anxiety and low mood.");
        assert!(out.clean_text.contains("reports anxiety"),
            "clinical-verb line must survive: {:?}", out.clean_text);
    }

    #[test]
    fn protects_clinical_shorthand_lines() {
        for input in [
            "? depn",
            "? depn worsening",
            "? PTSD",
            "c/o low mood + anx ++ since MVA",
            "sleep poor, appetite J",
            "pt seen 04/08/21",
            "Started pregab PRN; ref physio",
        ] {
            let out = clean_extracted_text(input);
            assert!(
                out.clean_text.contains(input.trim()) || !out.removed_lines.iter().any(|r| r.line == input.trim()),
                "shorthand {:?} must be preserved; clean: {:?}; removed: {:?}",
                input, out.clean_text, out.removed_lines
            );
        }
    }

    #[test]
    fn still_removes_obvious_ui_garbage_even_with_protected_rule() {
        for noise in ["ChatGPT", "Ask anything", "Get Plus", "CODEX",
                      "JavaScript", "GoLive", "Updates Available"] {
            let out = clean_extracted_text(&format!("Diagnosis: PTSD\n{noise}\n"));
            assert!(!out.clean_text.contains(noise),
                "UI noise {:?} must still be removed; got: {:?}", noise, out.clean_text);
            assert!(out.clean_text.contains("PTSD"),
                "clinical content must survive alongside noise removal: {:?}",
                out.clean_text);
        }
    }

    // ── FakeClient1 garbage line regression ──────────────────────────────
    // The following lines all appeared in FakeClient1's cleaned output
    // before this hardening. They must all disappear.
    #[test]
    fn fakeclient1_noisy_lines_are_removed() {
        let input = "\
GP saw patient on 11 July 2021.
Complains of lower back pain and anxiety.
Diagnosis: L4/5 disc herniation.
ds.js M
measuircu, GO Tit
ices: 2
x GRO - CODEX
MITE E — SCENARIO 1
+@Oa
tcTrecu ou
I er os
UTF-8 LF {} JavaScript && «GoLive Continue (NE)
Pregabalin 75mg nocte.
";
        let out = clean_extracted_text(input);
        let noisy = [
            "ds.js M", "measuircu", "GO Tit", "x GRO - CODEX",
            "JavaScript &&", "GoLive Continue", "tcTrecu",
            "+@Oa", "UTF-8 LF", "MITE E",
        ];
        for n in noisy {
            assert!(
                !out.clean_text.contains(n),
                "noise {:?} must be removed; clean_text:\n{}",
                n, out.clean_text
            );
        }
        // Clinical content survives.
        assert!(out.clean_text.contains("lower back pain"),
                "clinical content must survive: {:?}", out.clean_text);
        assert!(out.clean_text.contains("L4/5 disc herniation"),
                "diagnosis line must survive: {:?}", out.clean_text);
        assert!(out.clean_text.contains("Pregabalin"),
                "medication line must survive: {:?}", out.clean_text);
    }
}
