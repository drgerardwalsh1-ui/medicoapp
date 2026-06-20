//! OCR module — subprocess-based, always compiled.
//!
//! Shells out to the `tesseract` CLI (and `pdftoppm` for PDFs) rather than
//! linking against leptonica/leptess.  This eliminates native-library linking
//! issues entirely: as long as `tesseract` and `pdftoppm` are on PATH, OCR works.
//!
//! Requires:
//!   brew install tesseract poppler
//!
//! PATH note:
//!   macOS GUI apps launched from the Dock / Finder / Tauri do NOT inherit
//!   the user's shell PATH.  Homebrew tools live in /opt/homebrew/bin (Apple
//!   Silicon) or /usr/local/bin (Intel), which are absent from the GUI PATH.
//!   Every Command::new() call here therefore augments PATH explicitly.

use std::path::{Path, PathBuf};
use std::process::Command;

// ── PATH / tessdata helpers ───────────────────────────────────────────────────

/// Build a PATH string that includes common Homebrew, Anaconda, and Miniconda
/// directories so child processes (pdftoppm, tesseract) can be found when the
/// app is launched from the macOS GUI without inheriting the shell PATH.
fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let conda_bins = format!(
        "{home}/anaconda3/bin:{home}/miniconda3/bin:\
         {home}/opt/anaconda3/bin:{home}/opt/miniconda3/bin:\
         /opt/anaconda3/bin:/opt/miniconda3/bin"
    );
    let homebrew_bins = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    let current = std::env::var("PATH").unwrap_or_default();
    if current.is_empty() {
        format!("{conda_bins}:{homebrew_bins}")
    } else {
        format!("{conda_bins}:{homebrew_bins}:{current}")
    }
}

/// Locate the tessdata directory so subprocess tesseract finds its language data.
fn find_tessdata() -> Option<String> {
    if let Ok(v) = std::env::var("TESSDATA_PREFIX") {
        if Path::new(&v).exists() {
            return Some(v);
        }
    }
    for candidate in &[
        "/opt/homebrew/share/tessdata",
        "/usr/local/share/tessdata",
        "/usr/share/tessdata",
        "/opt/homebrew/share",
        "/usr/local/share",
    ] {
        if Path::new(candidate).join("eng.traineddata").exists() {
            return Some(candidate.to_string());
        }
    }
    None
}

// ── Top-level entry point ─────────────────────────────────────────────────────

/// Route by file extension; PDF → pdftoppm pipeline, everything else → tesseract.
pub fn run_ocr(path: &str) -> Result<String, String> {
    // Verify tesseract is present — give a clear, actionable error if not
    if which("tesseract").is_none() {
        return Err(
            "tesseract not found on PATH — install with: brew install tesseract".into(),
        );
    }

    if path.to_lowercase().ends_with(".pdf") {
        run_ocr_pdf(path)
    } else {
        run_ocr_image(path)
    }
}

/// Page count of a PDF via poppler's `pdfinfo` ("Pages: N" line).
/// Returns None when pdfinfo is unavailable or the output is unparsable —
/// callers must treat None as "unknown" and fail towards running OCR.
pub fn pdf_page_count(path: &str) -> Option<usize> {
    let out = Command::new("pdfinfo")
        .env("PATH", augmented_path())
        .arg(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("Pages:") {
            return rest.trim().parse::<usize>().ok();
        }
    }
    None
}

/// Return the absolute path of `bin` if found on the augmented PATH.
fn which(bin: &str) -> Option<PathBuf> {
    let path = augmented_path();
    for dir in path.split(':') {
        let candidate = Path::new(dir).join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ── PDF path: pdftoppm → per-page tesseract ───────────────────────────────────

fn run_ocr_pdf(path: &str) -> Result<String, String> {
    // Unique temp dir per call so concurrent OCR calls don't collide
    let tmp_dir: PathBuf = std::env::temp_dir().join(format!(
        "ml_ocr_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    let prefix = tmp_dir.join("p");

    // ── Step 1: rasterise every PDF page → PNG at 300 DPI ────────────────────
    let result = Command::new("pdftoppm")
        .env("PATH", augmented_path())
        .args(["-r", "300", "-png", path, prefix.to_str().unwrap_or("")])
        .output();

    match result {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(
                "pdftoppm not found — PDF OCR requires poppler: brew install poppler".into(),
            );
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("pdftoppm error: {e}"));
        }
        Ok(out) if !out.status.success() => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(format!("pdftoppm failed: {stderr}"));
        }
        Ok(_) => {}
    }

    // ── Step 2: collect page images, sorted so pages appear in order ──────────
    let mut pages: Vec<PathBuf> = std::fs::read_dir(&tmp_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "png").unwrap_or(false))
        .collect();
    pages.sort();

    if pages.is_empty() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err("pdftoppm produced no page images".into());
    }

    // ── Step 3: OCR each page image via subprocess tesseract ─────────────────
    let mut page_texts: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for page_path in &pages {
        let p = page_path.to_string_lossy();
        match run_ocr_image(&p) {
            Ok(t) => {
                let trimmed = t.trim().to_string();
                if !trimmed.is_empty() {
                    page_texts.push(trimmed);
                }
            }
            Err(e) => {
                eprintln!(
                    "[ocr] page {:?} failed: {}",
                    page_path.file_name().unwrap_or_default(),
                    e
                );
                last_err = Some(e);
            }
        }
    }

    // ── Step 4: clean up temp files ───────────────────────────────────────────
    let _ = std::fs::remove_dir_all(&tmp_dir);

    if page_texts.is_empty() {
        return Err(last_err.unwrap_or_else(|| "OCR produced no text".into()));
    }

    Ok(page_texts.join("\n\n"))
}

// ── Image path: subprocess tesseract ──────────────────────────────────────────

/// Run tesseract on a single image file.  Writes text to stdout ("-" output arg).
///
/// Invocation: `tesseract <image> - -l eng --psm 3`
///   -l eng   : English language data
///   --psm 3  : fully automatic page segmentation (default — robust for mixed layouts)
fn run_ocr_image(path: &str) -> Result<String, String> {
    let mut cmd = Command::new("tesseract");
    cmd.env("PATH", augmented_path());

    // Set TESSDATA_PREFIX explicitly so Tesseract can find eng.traineddata
    // when launched from the macOS GUI (which doesn't inherit the shell env).
    if let Some(tessdata) = find_tessdata() {
        cmd.env("TESSDATA_PREFIX", tessdata);
    }

    let out = cmd
        .args([path, "-", "-l", "eng", "--psm", "3"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "tesseract not found on PATH — install with: brew install tesseract".to_string()
            } else {
                format!("tesseract error: {e}")
            }
        })?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("tesseract failed (exit {}): {}",
            out.status.code().unwrap_or(-1),
            if stderr.is_empty() { "no stderr" } else { &stderr }));
    }

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(text)
}
