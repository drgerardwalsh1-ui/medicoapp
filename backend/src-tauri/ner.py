#!/usr/bin/env python3
"""
Minimal spaCy NER extractor for the MedicoLegal Tool.

Contract:
  - Reads plain text from stdin
  - Extracts DATE, ORG, PERSON entities only
  - Outputs a single JSON object to stdout
  - No interpretation, no inference, no merging with other data

Output schema:
  { "PERSON": [str, ...], "ORG": [str, ...], "DATE": [str, ...] }

Error schema (written to stderr, exit code 1):
  Any Python traceback or descriptive message
"""
import sys
import json


def main() -> None:
    text: str = sys.stdin.read()

    empty = {"PERSON": [], "ORG": [], "DATE": []}

    if not text.strip():
        print(json.dumps(empty))
        return

    # ── Import guards with actionable error messages ──────────────────────────
    try:
        import spacy  # noqa: F401
    except ImportError:
        sys.stderr.write(
            "spacy not installed — run: pip install spacy\n"
        )
        sys.exit(1)

    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        sys.stderr.write(
            "spaCy model not found — run: python3 -m spacy download en_core_web_sm\n"
        )
        sys.exit(1)

    # Raise the default 1 M char limit for large OCR'd documents
    nlp.max_length = 3_000_000

    # ── Run NER ───────────────────────────────────────────────────────────────
    doc = nlp(text)

    keep = {"PERSON", "ORG", "DATE"}
    entities: dict[str, list[str]] = {"PERSON": [], "ORG": [], "DATE": []}
    seen:     dict[str, set[str]]  = {"PERSON": set(), "ORG": set(), "DATE": set()}

    for ent in doc.ents:
        label = ent.label_
        if label not in keep:
            continue
        value = ent.text.strip()
        if value and value not in seen[label]:
            entities[label].append(value)
            seen[label].add(value)

    print(json.dumps(entities))


if __name__ == "__main__":
    main()
