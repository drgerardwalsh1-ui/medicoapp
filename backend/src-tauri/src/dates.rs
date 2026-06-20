//! Date detection with precision tracking.
//!
//! Many medico-legal documents mention dates at varying specificity:
//!   "11 July 2021"  → day precision
//!   "March 2022"    → month precision
//!   "2020"          → year precision
//!
//! Promoting a bare year to "2020-01-01" silently invents day-level
//! certainty that wasn't in the source — a bug we explicitly want to
//! avoid. This module returns the canonical form preserved at its true
//! precision, so downstream consumers can decide how to render and how
//! to sort.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DatePrecision {
    Day,
    Month,
    Year,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedDate {
    /// Original surface form as it appears in the source text.
    pub raw: String,
    /// Canonical representation at the detected precision:
    ///   Day   → "YYYY-MM-DD"
    ///   Month → "YYYY-MM"
    ///   Year  → "YYYY"
    pub value: String,
    pub precision: DatePrecision,
    /// Byte offset of the start of `raw` in the source text passed to
    /// [`find_dates`]. Invariant: `text[start..end] == raw`.
    pub start: usize,
    /// Byte offset just past the end of `raw` in the source text.
    pub end: usize,
}

/// Scan `text` for date mentions. Returns deduplicated entries sorted by
/// canonical value.
pub fn find_dates(text: &str) -> Vec<ExtractedDate> {
    let mut out: Vec<ExtractedDate> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── 1. ISO-style YYYY-MM-DD ──────────────────────────────────────────
    for cap in iter_pattern(text, &iso_date_pattern) {
        push(&mut out, &mut seen, cap);
    }
    // ── 2. DMY slash dates: DD/MM/YYYY or DD/MM/YY ──────────────────────
    for cap in iter_pattern(text, &dmy_slash_pattern) {
        push(&mut out, &mut seen, cap);
    }
    // ── 3. "11 July 2021" or "March 2022" or bare year "2020" ───────────
    for cap in iter_pattern(text, &month_word_pattern) {
        push(&mut out, &mut seen, cap);
    }
    for cap in iter_pattern(text, &year_only_pattern) {
        push(&mut out, &mut seen, cap);
    }

    // Nested-span suppression: a lower-precision match whose span sits
    // inside a higher-precision match is the SAME date token, not a new
    // date. "14 June 1968" must yield one day-precision date — without
    // this filter the bare-year matcher also emits "1968" (offsets 49–53
    // inside 41–53) and the timeline double-counts it.
    let suppressed: Vec<ExtractedDate> = out
        .iter()
        .filter(|d| {
            !out.iter().any(|other| {
                rank(other.precision) > rank(d.precision)
                    && other.start <= d.start
                    && d.end <= other.end
            })
        })
        .cloned()
        .collect();
    let mut out = suppressed;

    out.sort_by(|a, b| a.value.cmp(&b.value));
    out
}

/// Precision ordering for nested-span suppression: Day > Month > Year.
fn rank(p: DatePrecision) -> u8 {
    match p {
        DatePrecision::Day => 2,
        DatePrecision::Month => 1,
        DatePrecision::Year => 0,
    }
}

fn push(
    out: &mut Vec<ExtractedDate>,
    seen: &mut std::collections::HashSet<String>,
    d: ExtractedDate,
) {
    if seen.insert(d.value.clone()) {
        out.push(d);
    }
}

/// Run `matcher` over `text`, yielding matches as ExtractedDate. The
/// matcher returns `Some((raw, value, precision))` for each hit and
/// updates `*pos` to the byte index past the match. `pos` only ever
/// lands on a char boundary, so the inner matchers can safely slice the
/// str via `text[pos..]`.
fn iter_pattern<F>(text: &str, matcher: &F) -> Vec<ExtractedDate>
where
    F: Fn(&str, usize) -> Option<(String, String, DatePrecision, usize)>,
{
    let mut hits = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        if !text.is_char_boundary(pos) {
            pos += 1;
            continue;
        }
        match matcher(text, pos) {
            Some((raw, value, precision, next)) => {
                // The matcher located `raw` starting at `pos` and ending
                // at `next` (exclusive). Persist those byte offsets so
                // downstream consumers can byte-locate the raw form in
                // the source text without re-searching.
                let start = next.checked_sub(raw.len()).unwrap_or(pos);
                hits.push(ExtractedDate { raw, value, precision, start, end: next });
                pos = next.max(pos + 1);
            }
            None => {
                // No match starting at this position — advance one char.
                pos = text[pos..].chars().next().map_or(pos + 1, |c| pos + c.len_utf8());
            }
        }
    }
    hits
}

// ── Pattern matchers ─────────────────────────────────────────────────────

/// YYYY-MM-DD anywhere in the text.
fn iso_date_pattern(text: &str, from: usize) -> Option<(String, String, DatePrecision, usize)> {
    let mut i = from;
    while i + 10 <= text.len() {
        if text.is_char_boundary(i) {
            if let Some(d) = parse_iso_at(text, i) {
                return Some(d);
            }
        }
        i += 1;
    }
    None
}

fn parse_iso_at(text: &str, i: usize) -> Option<(String, String, DatePrecision, usize)> {
    if !text.is_char_boundary(i) {
        return None;
    }
    if i + 10 > text.len() || !text.is_char_boundary(i + 10) {
        return None;
    }
    if !at_token_boundary(text, i) {
        return None;
    }
    let segment = safe_slice(text, i, i + 10);
    if segment.len() != 10 { return None; }
    let segb = segment.as_bytes();
    if segb[4] != b'-' || segb[7] != b'-' {
        return None;
    }
    let y = std::str::from_utf8(&segb[0..4]).ok()?.parse::<u32>().ok()?;
    let m = std::str::from_utf8(&segb[5..7]).ok()?.parse::<u32>().ok()?;
    let d = std::str::from_utf8(&segb[8..10]).ok()?.parse::<u32>().ok()?;
    if !valid_y(y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    if !at_end_boundary(text, i + 10) {
        return None;
    }
    Some((
        segment.to_string(),
        format!("{:04}-{:02}-{:02}", y, m, d),
        DatePrecision::Day,
        i + 10,
    ))
}

/// DD/MM/YYYY or DD/MM/YY. Australian convention.
fn dmy_slash_pattern(text: &str, from: usize) -> Option<(String, String, DatePrecision, usize)> {
    let mut i = from;
    while i < text.len() {
        if text.is_char_boundary(i) {
            if let Some(d) = parse_dmy_slash_at(text, i) {
                return Some(d);
            }
        }
        i += 1;
    }
    None
}

fn parse_dmy_slash_at(text: &str, i: usize) -> Option<(String, String, DatePrecision, usize)> {
    if !text.is_char_boundary(i) {
        return None;
    }
    if !at_token_boundary(text, i) {
        return None;
    }
    let bytes = text.as_bytes();
    // Read up to 10 chars matching ^\d{1,2}/\d{1,2}/\d{2,4}$
    let mut j = i;
    while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
        j += 1;
    }
    let d_len = j - i;
    if !(1..=2).contains(&d_len) {
        return None;
    }
    if j >= bytes.len() || bytes[j] != b'/' {
        return None;
    }
    let m_start = j + 1;
    j = m_start;
    while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
        j += 1;
    }
    let m_len = j - m_start;
    if !(1..=2).contains(&m_len) {
        return None;
    }
    if j >= bytes.len() || bytes[j] != b'/' {
        return None;
    }
    let y_start = j + 1;
    j = y_start;
    while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
        j += 1;
    }
    let y_len = j - y_start;
    if !(y_len == 2 || y_len == 4) {
        return None;
    }
    if !at_end_boundary(text, j) {
        return None;
    }
    let d = safe_slice(text, i, i + d_len).parse::<u32>().ok()?;
    let m = safe_slice(text, m_start, m_start + m_len).parse::<u32>().ok()?;
    let y_raw = safe_slice(text, y_start, y_start + y_len).parse::<u32>().ok()?;
    let y = if y_len == 2 {
        if y_raw >= 70 { 1900 + y_raw } else { 2000 + y_raw }
    } else {
        y_raw
    };
    if !valid_y(y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let raw = safe_slice(text, i, j).to_string();
    Some((
        raw,
        format!("{:04}-{:02}-{:02}", y, m, d),
        DatePrecision::Day,
        j,
    ))
}

/// "11 July 2021", "11 Jul 2021", "March 2022" / "Mar 2022".
fn month_word_pattern(text: &str, from: usize) -> Option<(String, String, DatePrecision, usize)> {
    let mut i = from;
    while i < text.len() {
        if text.is_char_boundary(i) {
            if let Some(d) = parse_month_word_at(text, i) {
                return Some(d);
            }
        }
        i += 1;
    }
    None
}

fn parse_month_word_at(text: &str, i: usize) -> Option<(String, String, DatePrecision, usize)> {
    if !text.is_char_boundary(i) {
        return None;
    }
    if !at_token_boundary(text, i) {
        return None;
    }
    // Optional leading day number (1–31)
    let bytes = text.as_bytes();
    let mut j = i;
    let day_start = j;
    while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
        j += 1;
    }
    let day_len = j - day_start;
    let day_opt: Option<u32> = if day_len > 0 {
        let day = safe_slice(text, day_start, day_start + day_len).parse::<u32>().ok()?;
        if !(1..=31).contains(&day) {
            return None;
        }
        // Skip optional ordinal suffix "11th", "1st", "2nd", "3rd".
        // The 2-byte window after `j` may land inside a multi-byte char
        // (e.g. the line "3 — Messy" puts an em dash right after the
        // digit), so we use safe_slice and accept the suffix only when
        // it's exactly two ASCII letters. Otherwise we panic.
        let mut k = j;
        let two = safe_slice(text, k, k + 2).to_lowercase();
        if two.len() == 2
            && two.bytes().all(|b| (b as char).is_ascii_alphabetic())
            && matches!(two.as_str(), "st" | "nd" | "rd" | "th")
        {
            k += 2;
        }
        j = k;
        // Must be followed by a space and then a month name.
        if j >= bytes.len() || bytes[j] != b' ' {
            return None;
        }
        j += 1;
        Some(day)
    } else {
        None
    };

    // Month name (3+ chars)
    let m_start = j;
    while j < bytes.len() && (bytes[j] as char).is_ascii_alphabetic() {
        j += 1;
    }
    let m_len = j - m_start;
    if m_len < 3 {
        return None;
    }
    let m_word = safe_slice(text, m_start, m_start + m_len);
    let m = month_name_to_num(m_word)?;
    // Must be followed by a space and then 2 or 4 digit year.
    if j >= bytes.len() || bytes[j] != b' ' {
        return None;
    }
    j += 1;
    let y_start = j;
    while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
        j += 1;
    }
    let y_len = j - y_start;
    if !(y_len == 2 || y_len == 4) {
        return None;
    }
    if !at_end_boundary(text, j) {
        return None;
    }
    let y_raw = safe_slice(text, y_start, y_start + y_len).parse::<u32>().ok()?;
    let y = if y_len == 2 {
        if y_raw >= 70 { 1900 + y_raw } else { 2000 + y_raw }
    } else {
        y_raw
    };
    if !valid_y(y) {
        return None;
    }
    let raw = safe_slice(text, i, j).to_string();
    if let Some(day) = day_opt {
        Some((raw, format!("{:04}-{:02}-{:02}", y, m, day), DatePrecision::Day, j))
    } else {
        Some((raw, format!("{:04}-{:02}", y, m), DatePrecision::Month, j))
    }
}

fn year_only_pattern(text: &str, from: usize) -> Option<(String, String, DatePrecision, usize)> {
    let mut i = from;
    while i < text.len() {
        if text.is_char_boundary(i) {
            if let Some(d) = parse_year_only_at(text, i) {
                return Some(d);
            }
        }
        i += 1;
    }
    None
}

fn parse_year_only_at(text: &str, i: usize) -> Option<(String, String, DatePrecision, usize)> {
    if !text.is_char_boundary(i) {
        return None;
    }
    if !at_token_boundary(text, i) {
        return None;
    }
    if i + 4 > text.len() || !text.is_char_boundary(i + 4) {
        return None;
    }
    let segment = safe_slice(text, i, i + 4);
    if segment.len() != 4 { return None; }
    if !segment.bytes().all(|b| (b as char).is_ascii_digit()) {
        return None;
    }
    if !at_end_boundary(text, i + 4) {
        return None;
    }
    let y = segment.parse::<u32>().ok()?;
    if !valid_y(y) {
        return None;
    }
    Some((
        segment.to_string(),
        format!("{:04}", y),
        DatePrecision::Year,
        i + 4,
    ))
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn valid_y(y: u32) -> bool {
    (1900..=2100).contains(&y)
}

// ── Char-boundary-safe slicing helpers ───────────────────────────────────
// Regex / arithmetic offsets in this module are byte offsets. They are
// safe to slice with as long as they land on UTF-8 char boundaries — but
// any time we advance by a fixed byte count we MUST clamp to the nearest
// boundary first. Otherwise we panic on inputs with em dashes / curly
// apostrophes / OCR'd unicode symbols. See the regression test
// `dates_handles_em_dash_without_panic`.

#[inline]
fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

#[inline]
fn ceil_char_boundary(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

/// Slice safely between potentially-misaligned byte offsets.
#[inline]
fn safe_slice(s: &str, start: usize, end: usize) -> &str {
    let start = floor_char_boundary(s, start);
    let end = ceil_char_boundary(s, end);
    if start >= end {
        ""
    } else {
        &s[start..end]
    }
}

fn at_token_boundary(text: &str, pos: usize) -> bool {
    if pos == 0 {
        return true;
    }
    let ch = text.as_bytes()[pos - 1] as char;
    !(ch.is_ascii_alphanumeric() || ch == '/' || ch == '-')
}

fn at_end_boundary(text: &str, pos: usize) -> bool {
    if pos >= text.len() {
        return true;
    }
    let ch = text.as_bytes()[pos] as char;
    !(ch.is_ascii_alphanumeric() || ch == '/' || ch == '-')
}

fn month_name_to_num(s: &str) -> Option<u32> {
    let l = s.to_ascii_lowercase();
    Some(match l.as_str() {
        "january" | "jan" => 1,
        "february" | "feb" => 2,
        "march" | "mar" => 3,
        "april" | "apr" => 4,
        "may" => 5,
        "june" | "jun" => 6,
        "july" | "jul" => 7,
        "august" | "aug" => 8,
        "september" | "sep" | "sept" => 9,
        "october" | "oct" => 10,
        "november" | "nov" => 11,
        "december" | "dec" => 12,
        _ => return None,
    })
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn vals(text: &str) -> Vec<(String, DatePrecision)> {
        find_dates(text)
            .into_iter()
            .map(|d| (d.value, d.precision))
            .collect()
    }

    #[test]
    fn day_precision_iso() {
        let out = vals("Saw GP on 2021-07-11 for review.");
        assert!(out.contains(&("2021-07-11".into(), DatePrecision::Day)),
                "expected day-precision: {:?}", out);
    }

    #[test]
    fn day_precision_dmy_slash() {
        let out = vals("Date of accident 11/07/2021.");
        assert!(out.contains(&("2021-07-11".into(), DatePrecision::Day)),
                "expected day-precision via DMY: {:?}", out);
    }

    #[test]
    fn day_precision_named_month() {
        let out = vals("Onset 11 July 2021.");
        assert!(out.contains(&("2021-07-11".into(), DatePrecision::Day)),
                "expected day-precision via named month: {:?}", out);
    }

    #[test]
    fn day_precision_ordinal_suffix() {
        let out = vals("Onset 11th July 2021.");
        assert!(out.contains(&("2021-07-11".into(), DatePrecision::Day)),
                "ordinal suffix must be tolerated: {:?}", out);
    }

    #[test]
    fn month_precision_named() {
        let out = vals("Started CBT March 2022.");
        assert!(out.contains(&("2022-03".into(), DatePrecision::Month)),
                "expected month-precision: {:?}", out);
    }

    #[test]
    fn year_precision_bare() {
        let out = vals("First episode in 2020.");
        assert!(out.contains(&("2020".into(), DatePrecision::Year)),
                "expected year-precision: {:?}", out);
        // It must NOT have been silently promoted to 2020-01-01.
        assert!(out.iter().all(|(v, _)| v != "2020-01-01"),
                "year must not silently inflate to day-precision: {:?}", out);
    }

    #[test]
    fn invalid_dates_rejected() {
        let out = vals("Random 2020-13-99 or 99/99/2020 strings.");
        // The bare year inside the ISO-shaped token should still be found,
        // but the invalid full date itself must be rejected.
        assert!(out.iter().all(|(v, _)| v != "2020-13-99"));
        assert!(out.iter().all(|(v, _)| v != "2020-99-99"));
    }

    #[test]
    fn two_digit_year_disambiguates_century() {
        let out = vals("Born 11/07/85 admitted 11/07/05.");
        assert!(out.iter().any(|(v, _)| v == "1985-07-11"));
        assert!(out.iter().any(|(v, _)| v == "2005-07-11"));
    }

    // ── UTF-8 panic regression — must not crash on the exact lines that
    //    triggered the original panic (em dash directly after a digit).
    #[test]
    fn dates_handles_em_dash_without_panic() {
        let text = "ChatePT J ARIO 3 — Messy OCR / Abbrev.\npt seen 04/08/21";
        let dates = find_dates(text);
        assert!(
            dates.iter().any(|d| d.value == "2021-08-04"),
            "expected 2021-08-04 in {:?}",
            dates
        );
    }

    #[test]
    fn dates_handles_assorted_unicode_without_panic() {
        // Every input contains at least one multi-byte character at a
        // byte position that previously caused panics in dates.rs.
        let inputs = [
            "— pt seen 4 May 2022",
            "•• 11/07/2021 ••",
            "Don\u{2019}t panic 11 July 2021", // curly apostrophe ’
            "@+ 11/07/85 +@",
            "Mixed “quotes” 11 May 2022",      // smart quotes
            "Date — 12 June 2023",
            "ChatePT J ARIO 3 — Messy OCR / Abbrev.",
        ];
        for inp in &inputs {
            // Just calling find_dates here proves no panic.
            let _ = find_dates(inp);
        }
    }

    #[test]
    fn safe_slice_clamps_to_char_boundaries() {
        let s = "ab—cd"; // em dash = 3 bytes between b and c
        // Byte offsets inside the em dash must NOT panic.
        assert_eq!(safe_slice(s, 0, 4), "ab—");
        assert_eq!(safe_slice(s, 3, 5), "—");
        // Trying to slice purely inside the em dash returns the em dash.
        assert_eq!(safe_slice(s, 3, 4), "—");
        assert!(safe_slice(s, 100, 200).is_empty());
    }
}
