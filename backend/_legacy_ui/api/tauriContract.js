/**
 * TAURI COMMAND CONTRACT
 *
 * Single source of truth for every backend command this frontend may call.
 *
 * A command MUST appear here AND be registered in:
 *   src-tauri/src/lib.rs → .invoke_handler(tauri::generate_handler![...])
 *
 * ┌─────────────────────────┬──────────────┬────────────────────────────────┐
 * │ Command                 │ Mode         │ Notes                          │
 * ├─────────────────────────┼──────────────┼────────────────────────────────┤
 * │ greet                   │ core + ocr   │ Health-check                   │
 * │ read_file               │ core + ocr   │ Raw UTF-8 file read            │
 * │ extract_text_hybrid     │ core + ocr   │ Text extraction stub           │
 * │ run_ocr_command         │ ocr only     │ Requires --features ocr build  │
 * └─────────────────────────┴──────────────┴────────────────────────────────┘
 *
 * ADDING A NEW COMMAND — all four steps are required:
 *   1. Write the Rust fn with  #[tauri::command]
 *   2. Add it to generate_handler! in lib.rs
 *   3. Add the name string to TAURI_CONTRACT below
 *   4. Add the wrapper function in tauriCommands.js
 */

export const TAURI_CONTRACT = [
  "greet",
  "read_file",
  "extract_text_hybrid",
  "extract_structured_data",
  "aggregate_case",
  // OCR — only available in builds compiled with `--features ocr`
  "run_ocr_command",
];
