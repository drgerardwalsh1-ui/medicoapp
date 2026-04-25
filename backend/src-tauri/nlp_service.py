#!/usr/bin/env python3
"""
scispaCy NLP service for MedicoLegal Tool.

Pipeline (per request):
  1. NLP      — en_core_sci_md extracts raw entity spans
  2. Score    — each span is rated HIGH / MEDIUM / LOW
  3. Filter   — LOW spans dropped; symptom/emotional spans suppressed
  4. Route    — spans classified into 6 medico-legal categories
  5. Normalise— synonyms + OCR-fuzzy variants merged to canonical forms
  6. Cap      — each category capped at its maximum count
  7. Link     — roles matched to nearby people mentions in the raw text
  8. Conflict — affirmative vs. negative diagnosis mentions cross-referenced
  9. Respond  — JSON sent back to Rust

GET  /health  → { "status": "ok" }
POST /extract → body { "text": "..." }
             → {
                 "entities":      [{"text", "label", "score"}, ...],
                 "conditions":    [...],   max 8
                 "medications":   [...],   deduplicated
                 "procedures":    [...],   max 5
                 "organisations": [...],   max 5
                 "people":        [...],   max 10
                 "roles":         [...],   max 5
                 "people_roles":  {person: role, ...},
                 "conflicts":     [{condition, affirmed_by, disputed_by}, ...],
               }
"""

import difflib
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Model (loaded once, never reloaded per request) ───────────────────────────

try:
    import spacy  # noqa: F401
except ImportError:
    sys.stderr.write("spacy not installed — run: pip3 install spacy\n")
    sys.exit(1)

try:
    nlp = spacy.load("en_core_sci_md")
except OSError:
    sys.stderr.write(
        "en_core_sci_md not found.\n"
        "Install: pip3 install scispacy && "
        "pip3 install https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/"
        "releases/v0.5.4/en_core_sci_md-0.5.4.tar.gz\n"
    )
    sys.exit(1)

nlp.max_length = 3_000_000


# ═══════════════════════════════════════════════════════════════════════════════
# VOCABULARY
# ═══════════════════════════════════════════════════════════════════════════════

# ── Noise (drop immediately, exact lowercase match) ───────────────────────────

_NOISE: frozenset[str] = frozenset({
    "patient", "patients", "client", "clients", "claimant", "claimants",
    "subject", "subjects", "case", "cases", "individual", "individuals",
    "person", "persons",
    "prescribed", "administered", "given", "taken", "used", "received",
    "reported", "noted", "documented", "recorded", "identified",
    "diagnosed", "presented", "presenting", "reviewed",
    "treatment", "management", "care",
    "follow-up", "follow up", "followup",
    "condition", "diagnosis", "diagnoses",
    "symptom", "symptoms", "sign", "signs",
    "finding", "findings", "result", "results",
    "history", "complaint", "complaints",
    "medication", "drug", "drugs", "medicine",
    "therapy", "intervention",
    "outcome", "outcomes",
    "significant", "normal", "abnormal",
    "negative", "positive", "nil", "none",
    "acute", "chronic", "mild", "moderate", "severe",
    "right", "left", "bilateral", "unilateral",
    "upper", "lower", "anterior", "posterior", "lateral", "medial",
    "primary", "secondary", "initial", "subsequent", "ongoing",
    "year", "years", "month", "months", "week", "weeks", "day", "days",
    "the", "a", "an",
    "is", "was", "are", "were", "has", "have", "had", "be", "been",
    "of", "in", "at", "to", "and", "or", "for", "with", "without",
    "after", "before", "during", "due", "per", "via", "by", "as", "on",
    "this", "that", "these", "those",
    "no", "not", "none", "neither", "nor",
})

# ── Low-value single words (pass noise filter but score LOW) ─────────────────

_LOW_VALUE_SINGLES: frozenset[str] = frozenset({
    "report", "reports", "reporting",
    "progress", "progressing",
    "level", "levels",
    "area", "areas", "region", "regions",
    "type", "types",
    "form", "forms",
    "rate", "rates",
    "use", "usage",
    "time", "times", "period", "periods",
    "function", "functioning",
    "support", "supported",
    "control", "controlled",
    "activity", "activities",
    "ability",
    "involvement",
    "presentation",
    "basis",
    "manner",
    "effect", "effects",
    "factor", "factors",
    "aspect", "aspects",
    "cause", "causes",
    "response", "responses",
    "status",
    "service",
    "evidence",
    "number",
    "part", "parts",
    "point", "points",
    "process",
    "change", "changes",
    "increase", "increases", "decrease",
    "loss", "gain",
    "issue", "issues",
    "note", "notes",
    "discussion",
    "information",
    "detail", "details",
    "document", "documents",
    "section", "sections",
    "page", "pages",
    "entry", "entries",
    "item", "items",
})

# ── Symptom / emotional state filter ─────────────────────────────────────────
# These are NOT diagnoses. Matched exactly or by phrase containment.
# Must not include terms that are substrings of valid conditions
# (e.g. keep "depressed mood" but not "depression" which IS a condition).

_SYMPTOM_AND_EMOTIONAL_TERMS: frozenset[str] = frozenset({
    # Emotional / subjective states
    "tearful", "intermittently tearful", "tearfulness",
    "distressed", "emotional distress",
    "upset", "unsettled", "agitated",
    "irritable", "irritability",
    "low mood", "depressed mood", "depressive symptoms",
    "anxious mood", "anxious affect",
    "hopeless", "hopelessness", "helpless", "helplessness",
    "frustrated", "overwhelmed",
    "emotional lability", "emotional dysregulation",
    "crying", "weeping",
    # Non-specific symptoms — unambiguous single words only
    "headache", "headaches",
    "nausea", "vomiting",
    "dizziness",
    "fatigue", "tiredness", "lethargy",
    "insomnia", "poor sleep", "sleep disturbance",
    "sleep difficulties", "sleep problems",
    "stiffness", "weakness",
    "numbness", "tingling",
    "shortness of breath", "breathlessness",
    "palpitations",
    "poor concentration", "concentration difficulties",
    "memory difficulties", "memory problems", "poor memory",
    "reduced appetite", "appetite loss",
    "weight loss", "weight gain",
    "malaise",
    # Vague descriptors
    "generally unwell", "feeling unwell",
    "low energy", "reduced energy",
})

# ── Garbage words that invalidate a procedure match ──────────────────────────
# e.g. "assessment Island", "Conflicting Entities"

_PROCEDURE_GARBAGE_WORDS: frozenset[str] = frozenset({
    "conflicting", "entities", "island", "islands",
    "document", "documents", "paragraph", "paragraphs",
    "category", "categories",
    "data", "system", "systems",
})

# ── Medications ───────────────────────────────────────────────────────────────

_MEDICATION_TERMS: frozenset[str] = frozenset({
    # Opioids
    "morphine", "ms contin", "kapanol",
    "oxycodone", "oxycontin", "endone", "targin",
    "hydrocodone", "vicodin",
    "fentanyl", "duragesic",
    "tramadol", "tramal",
    "tapentadol", "palexia",
    "codeine",
    "pethidine", "meperidine",
    "buprenorphine", "norspan", "subutex",
    "methadone",
    "naloxone", "narcan", "naltrexone",
    # NSAIDs / analgesics
    "ibuprofen", "nurofen", "brufen",
    "naproxen", "naprosyn",
    "diclofenac", "voltaren",
    "celecoxib", "celebrex",
    "meloxicam", "mobic",
    "aspirin",
    "paracetamol", "acetaminophen", "panadol",
    # Antidepressants
    "amitriptyline", "endep",
    "nortriptyline", "allegron",
    "duloxetine", "cymbalta",
    "venlafaxine", "effexor",
    "sertraline", "zoloft",
    "paroxetine", "paxil", "aropax",
    "fluoxetine", "prozac",
    "citalopram", "cipramil",
    "escitalopram", "lexapro",
    "mirtazapine", "remeron", "avanza",
    # Anticonvulsants / neuropathic pain
    "gabapentin", "neurontin",
    "pregabalin", "lyrica",
    # Benzodiazepines / hypnotics
    "diazepam", "valium",
    "lorazepam", "ativan",
    "clonazepam", "rivotril",
    "alprazolam", "xanax",
    "temazepam", "normison",
    "zolpidem", "stilnox",
    # Muscle relaxants
    "baclofen", "cyclobenzaprine",
    # Corticosteroids
    "prednisone", "prednisolone",
    "dexamethasone",
    "methylprednisolone", "medrol",
    "cortisone", "hydrocortisone",
    "triamcinolone", "betamethasone",
    # Local anaesthetics
    "lidocaine", "lignocaine", "xylocaine",
    "bupivacaine", "marcaine",
    "ropivacaine", "ketamine",
    # Miscellaneous
    "amoxicillin", "augmentin",
    "methotrexate",
    "hydroxychloroquine", "plaquenil",
    # Drug class terms
    "opioid", "opioids", "opiate", "opiates",
    "nsaid", "nsaids",
    "ssri", "ssris", "snri", "snris",
    "benzodiazepine", "benzodiazepines",
    "corticosteroid", "corticosteroids",
    "analgesic", "analgesics",
    "antibiotic", "antibiotics",
    "antidepressant", "antidepressants",
    "anticonvulsant", "anticonvulsants",
    "anti-inflammatory", "anti-inflammatories",
})

# Sorted list used by difflib for OCR-variant fuzzy matching (single words only)
_MEDICATION_SINGLES: list[str] = sorted(
    t for t in _MEDICATION_TERMS if " " not in t
)

# ── Conditions ────────────────────────────────────────────────────────────────

_CONDITION_TERMS: frozenset[str] = frozenset({
    # Spinal
    "degenerative disc disease", "disc disease",
    "disc herniation", "herniated disc",
    "disc bulge", "bulging disc", "disc protrusion",
    "ankylosing spondylitis",
    "lumbar radiculopathy", "cervical radiculopathy",
    "lumbar spondylosis", "cervical spondylosis",
    "cervical myelopathy", "spinal stenosis",
    "spondylolisthesis", "spondylitis", "spondylosis",
    "radiculopathy", "myelopathy",
    "herniation", "herniated", "stenosis",
    # Soft tissue / musculoskeletal
    "whiplash associated disorder", "whiplash injury", "whiplash",
    "rotator cuff tear", "acl tear", "meniscus tear", "labral tear",
    "stress fracture", "compression fracture", "fracture",
    "muscle strain", "ligament strain", "strain", "sprain",
    "tear", "rupture",
    "subacromial bursitis", "bursitis",
    "tendinitis", "tendinopathy", "tendinosis", "tenosynovitis",
    "synovitis", "contusion",
    "haematoma", "hematoma",
    # Joint
    "rheumatoid arthritis", "osteoarthritis", "arthritis", "gout",
    # Neurological
    "post-concussion syndrome", "concussion",
    "traumatic brain injury", "tbi",
    "complex regional pain syndrome", "crps",
    "reflex sympathetic dystrophy", "rsd",
    "peripheral neuropathy", "neuropathic pain", "neuropathy",
    "fibromyalgia", "sciatica",
    # Psychological — must be recognised diagnoses, not descriptions
    "post-traumatic stress disorder",
    "post traumatic stress disorder",
    "posttraumatic stress disorder",
    "major depressive disorder", "major depression",
    "generalised anxiety disorder", "generalized anxiety disorder",
    "anxiety disorder", "panic disorder",
    "adjustment disorder", "acute stress disorder",
    "ptsd", "depression", "anxiety",
    # Pain syndromes
    "chronic pain syndrome", "chronic pain", "pain syndrome",
    # Vascular / systemic
    "deep vein thrombosis", "dvt", "pulmonary embolism",
    "inflammation", "chronic inflammation",
    # Impairment
    "permanent impairment", "disability", "impairment",
    "laceration", "scar", "scarring",
    "injury", "trauma",
    # Anatomical sites (injury context)
    "lumbar spine", "lumbar region",
    "cervical spine", "cervical region",
    "thoracic spine", "thoracic region",
    "rotator cuff", "carpal tunnel", "achilles",
    "meniscus", "acl", "mcl", "pcl",
    "shoulder", "knee", "hip", "ankle", "wrist", "elbow",
    "damage", "degeneration",
})

# Sorted list of single-word condition terms for OCR fuzzy normalisation
_CONDITION_SINGLES: list[str] = sorted(
    t for t in _CONDITION_TERMS if " " not in t and len(t) > 4
)

# ── Procedures ────────────────────────────────────────────────────────────────

_PROCEDURE_TERMS: frozenset[str] = frozenset({
    # Imaging
    "magnetic resonance imaging", "mri",
    "computed tomography", "ct scan", "cat scan", "ct",
    "pet-ct", "pet scan",
    "x-ray", "xray", "x ray",
    "ultrasound", "ultrasonography", "sonogram",
    "echocardiogram", "echocardiography",
    "eeg", "electroencephalogram",
    "emg", "electromyography",
    "ecg", "ekg", "electrocardiogram",
    "radiograph", "radiography",
    "fluoroscopy", "arthrogram", "myelogram", "discogram",
    "nerve conduction study", "nerve conduction",
    "bone scan", "dexa scan", "mri arthrogram",
    # Surgical
    "total knee replacement", "tkr",
    "total hip replacement", "thr",
    "knee replacement", "hip replacement", "shoulder replacement",
    "acl reconstruction",
    "rotator cuff repair",
    "spinal fusion", "cervical fusion", "lumbar fusion", "fusion",
    "spinal decompression", "decompression",
    "microdiscectomy", "discectomy",
    "laminectomy", "laminotomy", "foraminotomy",
    "arthroscopic surgery", "arthroscopy", "arthroplasty",
    "corpectomy", "excision", "resection", "debridement",
    "surgery", "operation", "surgical procedure",
    # Injections
    "epidural steroid injection", "epidural injection", "epidural",
    "facet joint injection", "facet injection", "facet block",
    "trigger point injection", "trigger point",
    "cortisone injection", "steroid injection",
    "nerve block",
    "platelet-rich plasma", "prp",
    "prolotherapy", "hyaluronic acid injection",
    "injection",
    # Psychological / specialist therapies
    "emdr", "eye movement desensitisation",
    "cognitive behavioural therapy", "cbt",
    "cognitive behavioral therapy",
    "dialectical behaviour therapy", "dbt",
    "acceptance and commitment therapy", "act",
    "exposure therapy", "trauma-focused therapy",
    # Rehabilitation
    "occupational therapy",
    "physical therapy", "physiotherapy",
    "rehabilitation", "rehab",
    "hydrotherapy", "manual therapy",
    "dry needling", "acupuncture",
    "tens", "transcutaneous electrical nerve stimulation",
    "exercise program", "exercise programme",
    "home exercise program", "home exercise programme",
    "massage therapy", "massage",
    # Assessment / consultation
    "independent medical examination", "ime",
    "functional capacity evaluation", "fce",
    "functional capacity assessment", "fca",
    "neuropsychological assessment", "neuropsychological testing",
    "psychological assessment",
    "medical assessment",
    "examination", "evaluation", "consultation",
    "review",
    # Other
    "biopsy", "aspiration", "joint aspiration", "drainage",
    "procedure",
})

# ── Organisations ─────────────────────────────────────────────────────────────

_ORGANISATION_TERMS: frozenset[str] = frozenset({
    "health service", "health services",
    "medical centre", "medical center",
    "health centre", "health center",
    "medical clinic", "medical practice",
    "rehabilitation centre", "rehabilitation center",
    "physiotherapy clinic",
    "workers compensation",
    "university of",
    "hospital", "clinic", "commission", "comcare",
    "university", "institute", "institution",
    "department", "authority", "council",
    "trust", "foundation", "group", "associates",
    "practice", "nhs",
})

# ── Roles ─────────────────────────────────────────────────────────────────────

_ROLE_TERMS: frozenset[str] = frozenset({
    "general practitioner", "treating specialist",
    "treating physician", "neurosurgeon",
    "orthopaedic surgeon", "orthopedic surgeon",
    "clinical psychologist", "neuropsychologist",
    "pain specialist", "pain physician",
    "speech pathologist", "speech therapist",
    "occupational therapist",
    "physical therapist", "physiotherapist",
    "registered nurse", "clinical nurse",
    "ambulance officer", "first responder",
    "independent examiner", "safety inspector",
    "gp", "specialist", "consultant",
    "surgeon", "physician", "registrar", "resident",
    "doctor", "nurse", "paramedic",
    "psychologist", "psychiatrist",
    "neurologist", "cardiologist", "oncologist", "radiologist",
    "orthopaedic", "orthopedic",
    "inspector", "investigator", "assessor", "examiner",
    "solicitor", "barrister", "lawyer", "counsel", "attorney",
    "judge", "magistrate", "commissioner", "mediator",
    "employer", "manager", "supervisor", "foreman",
})

# ── Person title prefixes ─────────────────────────────────────────────────────

_PERSON_TITLE_PREFIXES: tuple[str, ...] = (
    "dr ", "dr. ", "mr ", "mr. ", "mrs ", "mrs. ",
    "ms ", "ms. ", "miss ", "prof ", "prof. ", "professor ",
)

# ── Synonym normalisation map ─────────────────────────────────────────────────
# verbose / brand / OCR-variant → canonical clinical term.
# Applied AFTER routing so the canonical form appears in the output.

_SYNONYM_MAP: dict[str, str] = {
    # ── Psychological conditions ──────────────────────────────────────────────
    "post-traumatic stress disorder":     "PTSD",
    "post traumatic stress disorder":     "PTSD",
    "posttraumatic stress disorder":      "PTSD",
    "major depressive disorder":          "depression",
    "major depression":                   "depression",
    "depressive disorder":                "depression",
    "generalised anxiety disorder":       "anxiety disorder",
    "generalized anxiety disorder":       "anxiety disorder",
    "gad":                                "anxiety disorder",
    "panic attack":                       "panic disorder",
    "panic attacks":                      "panic disorder",
    # ── Neurological / physical conditions ───────────────────────────────────
    "complex regional pain syndrome":     "CRPS",
    "reflex sympathetic dystrophy":       "CRPS",
    "rsd":                                "CRPS",
    "traumatic brain injury":             "TBI",
    "deep vein thrombosis":               "DVT",
    "degenerative disc disease":          "disc degeneration",
    "post-concussion syndrome":           "concussion syndrome",
    "whiplash injury":                    "whiplash",
    "whiplash associated disorder":       "whiplash",
    "disc herniation lumbar":             "lumbar disc herniation",
    "disc herniation cervical":           "cervical disc herniation",
    # ── Medications — brand → generic ────────────────────────────────────────
    "acetaminophen":    "paracetamol",
    "panadol":          "paracetamol",
    "nurofen":          "ibuprofen",
    "brufen":           "ibuprofen",
    "voltaren":         "diclofenac",
    "endone":           "oxycodone",
    "oxycontin":        "oxycodone",
    "targin":           "oxycodone",
    "kapanol":          "morphine",
    "ms contin":        "morphine",
    "tramal":           "tramadol",
    "palexia":          "tapentadol",
    "norspan":          "buprenorphine",
    "subutex":          "buprenorphine",
    "narcan":           "naloxone",
    "lyrica":           "pregabalin",
    "neurontin":        "gabapentin",
    "cymbalta":         "duloxetine",
    "effexor":          "venlafaxine",
    "zoloft":           "sertraline",
    "aropax":           "paroxetine",
    "paxil":            "paroxetine",
    "prozac":           "fluoxetine",
    "lexapro":          "escitalopram",
    "cipramil":         "citalopram",
    "avanza":           "mirtazapine",
    "remeron":          "mirtazapine",
    "valium":           "diazepam",
    "ativan":           "lorazepam",
    "rivotril":         "clonazepam",
    "xanax":            "alprazolam",
    "normison":         "temazepam",
    "stilnox":          "zolpidem",
    "endep":            "amitriptyline",
    "allegron":         "nortriptyline",
    "celebrex":         "celecoxib",
    "naprosyn":         "naproxen",
    "mobic":            "meloxicam",
    "lignocaine":       "lidocaine",
    "xylocaine":        "lidocaine",
    "marcaine":         "bupivacaine",
    "plaquenil":        "hydroxychloroquine",
    "augmentin":        "amoxicillin",
    "medrol":           "methylprednisolone",
    # Explicit OCR variants (beyond fuzzy threshold)
    "paracetmol":       "paracetamol",
    "paracetamoll":     "paracetamol",
    "ibuprofin":        "ibuprofen",
    "diclofenac sodium":    "diclofenac",
    "diclofenac potassium": "diclofenac",
    "oxycodone hydrochloride": "oxycodone",
    "morphine sulfate":     "morphine",
    "morphine sulphate":    "morphine",
    "tramadol hydrochloride": "tramadol",
    # ── Procedures ───────────────────────────────────────────────────────────
    "magnetic resonance imaging":         "MRI",
    "computed tomography":                "CT scan",
    "cat scan":                           "CT scan",
    "physical therapy":                   "physiotherapy",
    "eye movement desensitisation":       "EMDR",
    "cognitive behavioural therapy":      "CBT",
    "cognitive behavioral therapy":       "CBT",
    "dialectical behaviour therapy":      "DBT",
    "acceptance and commitment therapy":  "ACT",
    "independent medical examination":    "IME",
    "functional capacity evaluation":     "FCE",
    "functional capacity assessment":     "FCA",
    "neuropsychological assessment":      "neuropsychological testing",
}

# Pre-build a lookup with lowercased keys
_SYNONYM_MAP_LOWER: dict[str, str] = {k.lower(): v for k, v in _SYNONYM_MAP.items()}

# ── Category caps ─────────────────────────────────────────────────────────────

_CAPS: dict[str, int] = {
    "conditions":    8,    # reduced from 10 — high-confidence only
    "medications":   5,
    "procedures":    5,
    "organisations": 5,
    "people":       10,
    "roles":         5,
}

# ── Conflict detection patterns ───────────────────────────────────────────────

_AFFIRM_PATTERNS: list[str] = [
    r"diagnosed\s+(?:with|as)\s+",
    r"diagnosis\s+of\s+",
    r"suffers?\s+from\s+",
    r"presents?\s+with\s+",
    r"history\s+of\s+",
    r"meets?\s+criteria\s+(?:for\s+)?",
    r"confirmed\s+(?:diagnosis\s+of\s+)?",
    r"evidence\s+of\s+",
    r"consistent\s+with\s+",
    r"established\s+(?:diagnosis\s+of\s+)?",
]

_NEGATE_PATTERNS: list[str] = [
    r"no\s+diagnosis\s+of\s+",
    r"not\s+diagnosed\s+(?:with\s+)?",
    r"does\s+not\s+have\s+",
    r"ruled?\s+out\s+",
    r"no\s+evidence\s+of\s+",
    r"denies?\s+(?:any\s+)?",
    r"does\s+not\s+meet\s+criteria\s+(?:for\s+)?",
    r"inconsistent\s+with\s+",
    r"no\s+history\s+of\s+",
    r"without\s+(?:a\s+)?(?:diagnosis\s+of\s+)?",
    r"(?:does\s+)?not\s+(?:currently\s+)?(?:suffer|have|demonstrate)\s+",
]


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _contains_any(text_lower: str, terms: frozenset[str]) -> bool:
    return any(term in text_lower for term in terms)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — SCORING
# ═══════════════════════════════════════════════════════════════════════════════

def _score(text: str) -> str:
    """
    Return "HIGH", "MEDIUM", or "LOW" confidence for an extracted entity.

    HIGH   — exact substring match in a known vocabulary set.
             Person with a title prefix. Named organisation.
             Single-word OCR variant that fuzzy-matches a medication (≥ 0.85).
    MEDIUM — multi-word phrase with at least one non-generic word.
             All-caps medical abbreviation (MRI, PTSD, DVT, …).
    LOW    — very short (≤ 2 chars), known low-value single word,
             or any other single word not matching any vocabulary.
    """
    lower = text.lower().strip()

    if len(lower) <= 2:
        return "LOW"

    # Symptom / emotional states are always LOW regardless of vocabulary substrings
    # (e.g. "tearful" contains "tear" from _CONDITION_TERMS — must not score HIGH)
    if _is_symptom_or_emotional(lower):
        return "LOW"

    # HIGH: exact vocabulary match
    if (
        _contains_any(lower, _MEDICATION_TERMS)
        or _contains_any(lower, _CONDITION_TERMS)
        or _contains_any(lower, _PROCEDURE_TERMS)
        or _contains_any(lower, _ROLE_TERMS)
        or _contains_any(lower, _ORGANISATION_TERMS)
    ):
        return "HIGH"

    # HIGH: titled person
    if any(lower.startswith(p) for p in _PERSON_TITLE_PREFIXES):
        return "HIGH"

    # HIGH: OCR variant of a known medication (fuzzy, single word, ≥ 5 chars)
    if " " not in lower and len(lower) >= 5:
        if difflib.get_close_matches(lower, _MEDICATION_SINGLES, n=1, cutoff=0.85):
            return "HIGH"

    # MEDIUM: all-caps abbreviation (2–6 chars)
    if re.fullmatch(r"[A-Z]{2,6}", text):
        return "MEDIUM"

    # MEDIUM: multi-word phrase with at least one non-generic word
    if " " in lower:
        words = lower.split()
        has_content = any(
            w not in _NOISE and w not in _LOW_VALUE_SINGLES for w in words
        )
        return "MEDIUM" if has_content else "LOW"

    if lower in _LOW_VALUE_SINGLES:
        return "LOW"

    if len(lower) <= 5:
        return "LOW"

    return "LOW"


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — ROUTING (per-entity predicates)
# ═══════════════════════════════════════════════════════════════════════════════

def _is_person(text: str) -> bool:
    lower = text.lower()
    if any(lower.startswith(p) for p in _PERSON_TITLE_PREFIXES):
        return True
    words = text.split()
    if len(words) >= 2:
        all_capped = all(w[0].isupper() for w in words if w and w[0].isalpha())
        if all_capped and not (
            _contains_any(lower, _CONDITION_TERMS)
            or _contains_any(lower, _MEDICATION_TERMS)
            or _contains_any(lower, _PROCEDURE_TERMS)
            or _contains_any(lower, _ORGANISATION_TERMS)
        ):
            return True
    return False


def _is_organisation(text: str) -> bool:
    return _contains_any(text.lower(), _ORGANISATION_TERMS)


def _fuzzy_medication(lower: str) -> bool:
    """True if `lower` fuzzy-matches a known single-word medication (handles OCR errors)."""
    if " " in lower or len(lower) < 5:
        return False
    return bool(difflib.get_close_matches(lower, _MEDICATION_SINGLES, n=1, cutoff=0.85))


def _is_medication(text: str) -> bool:
    lower = text.lower()
    return _contains_any(lower, _MEDICATION_TERMS) or _fuzzy_medication(lower)


def _is_plausible_procedure(text: str) -> bool:
    """
    Guard against garbage matches like "assessment Island" or "Conflicting Entities".
    A procedure is implausible if it contains known non-clinical words.
    """
    words = text.lower().split()
    if any(w in _PROCEDURE_GARBAGE_WORDS for w in words):
        return False
    # Very long phrases (> 7 words) must contain a known multi-word procedure term
    if len(words) > 7:
        lower = text.lower()
        has_known = any(
            term in lower
            for term in _PROCEDURE_TERMS
            if len(term.split()) >= 3
        )
        if not has_known:
            return False
    return True


def _is_procedure(text: str) -> bool:
    return _contains_any(text.lower(), _PROCEDURE_TERMS)


def _is_condition(text: str) -> bool:
    return _contains_any(text.lower(), _CONDITION_TERMS)


def _is_role(text: str) -> bool:
    return _contains_any(text.lower(), _ROLE_TERMS)


def _is_symptom_or_emotional(lower: str) -> bool:
    """
    Return True if the entity is a symptom or emotional state rather than a diagnosis.
    Exact match OR phrase containment for multi-word symptom terms.
    """
    if lower in _SYMPTOM_AND_EMOTIONAL_TERMS:
        return True
    return any(
        term in lower
        for term in _SYMPTOM_AND_EMOTIONAL_TERMS
        if " " in term
    )


def _classify_entity(text: str) -> str | None:
    """
    Assign one category, or None if the entity is noise, low-value, or a symptom.

    Priority: people > organisations > procedures > medications > conditions > roles
    Procedures before medications: "cortisone injection" → procedure not medication.
    No fallback to conditions — unrecognised entities are dropped for precision.
    """
    lower = text.strip().lower()
    if not lower or lower in _NOISE or lower in _LOW_VALUE_SINGLES:
        return None
    if _is_person(text):
        return "people"
    if _is_organisation(text):
        return "organisations"
    # Symptom / emotional state check — suppress before condition routing
    if _is_symptom_or_emotional(lower):
        return None
    if _is_procedure(text):
        return "procedures" if _is_plausible_procedure(text) else None
    if _is_medication(text):
        return "medications"
    if _is_condition(text):
        return "conditions"
    if _is_role(text):
        return "roles"
    # No fallback — unrecognised entities are not routed
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — SYNONYM NORMALISATION
# ═══════════════════════════════════════════════════════════════════════════════

def _normalise(text: str) -> str:
    """
    Map verbose / brand / OCR-variant forms to their canonical term.

    Order:
      1. Exact synonym lookup (lowercased key)
      2. OCR fuzzy correction for single-word medications (cutoff 0.88)
      3. OCR fuzzy correction for single-word conditions (cutoff 0.88)
      4. Return original text unchanged
    """
    lower = text.lower()

    # 1. Exact synonym
    if lower in _SYNONYM_MAP_LOWER:
        return _SYNONYM_MAP_LOWER[lower]

    # 2. Fuzzy OCR correction for single words
    if " " not in lower and len(lower) >= 5:
        med_m = difflib.get_close_matches(lower, _MEDICATION_SINGLES, n=1, cutoff=0.88)
        if med_m:
            canonical = med_m[0]
            # Apply synonym map to the corrected form (e.g. "nurofen" → "ibuprofen")
            return _SYNONYM_MAP_LOWER.get(canonical, canonical)

        cond_m = difflib.get_close_matches(lower, _CONDITION_SINGLES, n=1, cutoff=0.88)
        if cond_m:
            canonical = cond_m[0]
            return _SYNONYM_MAP_LOWER.get(canonical, canonical)

    return text


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — ROUTING ORCHESTRATION
# ═══════════════════════════════════════════════════════════════════════════════

def _sort_key(entry: tuple[str, str]) -> tuple[int, int, int]:
    """Sort by confidence (HIGH first), then multi-word, then length."""
    text, score = entry
    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    return (order[score], -text.count(" "), -len(text))


def _route(scored_entities: list[tuple[str, str]]) -> dict[str, list[str]]:
    """
    Route a list of (text, score) tuples into the six medico-legal categories.

    Each entity:
      1. Normalised to canonical form
      2. Classified (None → dropped)
      3. Deduplicated case-insensitively (first-seen canonical form wins)
      4. Sorted HIGH-first, multi-word-first within its category
      5. Capped at the per-category limit
    """
    buckets: dict[str, list[tuple[str, str]]] = {
        cat: [] for cat in _CAPS
    }
    seen: set[str] = set()

    for text, score in scored_entities:
        canonical = _normalise(text)
        key = canonical.lower()

        if key in seen:
            continue
        seen.add(key)

        category = _classify_entity(canonical)
        if category is None:
            continue

        buckets[category].append((canonical, score))

    result: dict[str, list[str]] = {}
    for cat, entries in buckets.items():
        entries.sort(key=_sort_key)
        result[cat] = [t for t, _ in entries[: _CAPS[cat]]]

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6 — ROLE-PERSON LINKING
# ═══════════════════════════════════════════════════════════════════════════════

def _link_roles_to_people(raw_text: str, people: list[str]) -> dict[str, str]:
    """
    For each extracted person name, scan a ±120-character window around their
    first occurrence in the raw text and return the nearest role term found.

    Uses longest-match priority (longer role terms are checked first) so
    "clinical psychologist" is preferred over "psychologist".

    Returns {person_name: role_term}.
    """
    if not people:
        return {}

    text_lower = raw_text.lower()
    # Sort role terms longest-first to prefer specificity (include short terms like "gp")
    role_terms_sorted = sorted(
        (t for t in _ROLE_TERMS if len(t) >= 2),
        key=len,
        reverse=True,
    )

    links: dict[str, str] = {}

    for person in people:
        person_lower = person.lower()
        idx = text_lower.find(person_lower)
        if idx == -1:
            continue

        start = max(0, idx - 120)
        end = min(len(text_lower), idx + len(person_lower) + 120)
        window = text_lower[start:end]

        for term in role_terms_sorted:
            # Whole-word boundary check to avoid "gp" matching "gap"
            pattern = rf"\b{re.escape(term)}\b"
            if re.search(pattern, window) and term != person_lower:
                links[person] = term
                break

    return links


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7 — CONFLICT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_conflicts(raw_text: str, conditions: list[str]) -> list[dict]:
    """
    For each confirmed condition, check whether the text contains both an
    affirmative attribution (diagnosed with X) and a negative one (ruled out X).

    Also searches for all synonym/variant forms of each condition.

    Returns a list of conflict dicts:
      { "condition": str, "affirmed_by": str, "disputed_by": str }
    """
    if not conditions:
        return []

    # Build reverse map: canonical → all source forms
    reverse: dict[str, set[str]] = {}
    for src, tgt in _SYNONYM_MAP.items():
        reverse.setdefault(tgt, set()).add(src)

    word_gap = r"(?:\w+\s+){0,4}"
    conflicts: list[dict] = []

    for condition in conditions:
        # Collect all text forms to search (canonical + known synonyms/variants)
        forms: set[str] = {condition.lower()}
        for src in reverse.get(condition, set()):
            forms.add(src.lower())

        pos_snippets: list[str] = []
        neg_snippets: list[str] = []

        for form in forms:
            cond_pat = re.escape(form)
            for pat in _AFFIRM_PATTERNS:
                for m in re.finditer(
                    pat + word_gap + cond_pat,
                    raw_text, re.IGNORECASE
                ):
                    snippet = m.group(0).strip()[:120]
                    if snippet not in pos_snippets:
                        pos_snippets.append(snippet)
                    break  # one match per (form, pattern) pair is sufficient

            for pat in _NEGATE_PATTERNS:
                for m in re.finditer(
                    pat + word_gap + cond_pat,
                    raw_text, re.IGNORECASE
                ):
                    snippet = m.group(0).strip()[:120]
                    if snippet not in neg_snippets:
                        neg_snippets.append(snippet)
                    break

        if pos_snippets and neg_snippets:
            conflicts.append({
                "condition":   condition,
                "affirmed_by": pos_snippets[0],
                "disputed_by": neg_snippets[0],
            })

    return conflicts


# ═══════════════════════════════════════════════════════════════════════════════
# TOP-LEVEL EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def _extract(text: str) -> dict:
    """
    Full pipeline: NLP → score → filter → route → normalise → cap → link → conflict.

    Returns:
        {
            "entities":      [{"text", "label", "score"}, ...],
            "conditions":    [...],
            "medications":   [...],
            "procedures":    [...],
            "organisations": [...],
            "people":        [...],
            "roles":         [...],
            "people_roles":  {person: role, ...},
            "conflicts":     [{condition, affirmed_by, disputed_by}, ...],
        }
    """
    doc = nlp(text)

    # Step 1: collect unique raw spans
    seen_raw: set[str] = set()
    raw: list[dict] = []
    for ent in doc.ents:
        value = ent.text.strip()
        if not value or value.lower() in seen_raw:
            continue
        seen_raw.add(value.lower())
        raw.append({"text": value, "label": ent.label_})

    # Step 2: score
    scored: list[tuple[str, str]] = []
    for ent in raw:
        s = _score(ent["text"])
        ent["score"] = s
        scored.append((ent["text"], s))

    # Step 3: filter — drop LOW
    filtered = [(t, s) for t, s in scored if s != "LOW"]

    # Step 4–5: route + normalise + cap
    structured = _route(filtered)

    # Step 6: role-person linking
    people_roles = _link_roles_to_people(text, structured.get("people", []))

    # Step 7: conflict detection (only over high-quality conditions)
    conflicts = _detect_conflicts(text, structured.get("conditions", []))

    # Debug (stderr only)
    n_low    = sum(1 for _, s in scored if s == "LOW")
    n_medium = sum(1 for _, s in scored if s == "MEDIUM")
    n_high   = sum(1 for _, s in scored if s == "HIGH")
    total_routed = sum(len(v) for v in structured.values())
    sys.stderr.write(
        f"[nlp_service] raw={len(raw)}  "
        f"HIGH={n_high} MEDIUM={n_medium} LOW={n_low}(dropped)  "
        f"routed={total_routed}  links={len(people_roles)}  "
        f"conflicts={len(conflicts)}\n"
    )
    for ent in raw[:5]:
        sys.stderr.write(f"  [{ent['score']:6s}] {ent['text']!r}\n")
    if len(raw) > 5:
        sys.stderr.write(f"  … and {len(raw) - 5} more\n")
    cats = ", ".join(f"{k}:{len(v)}" for k, v in structured.items() if v)
    sys.stderr.write(f"[nlp_service] → {cats or 'nothing routed'}\n")
    sys.stderr.flush()

    return {
        "entities": raw,
        **structured,
        "people_roles": people_roles,
        "conflicts":    conflicts,
    }


# ── Empty sentinel ─────────────────────────────────────────────────────────────

_EMPTY: dict = {
    "entities":      [],
    "conditions":    [],
    "medications":   [],
    "procedures":    [],
    "organisations": [],
    "people":        [],
    "roles":         [],
    "people_roles":  {},
    "conflicts":     [],
}


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP SERVER
# ═══════════════════════════════════════════════════════════════════════════════

class _Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # silence Apache-style request logs

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/extract":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length  = int(self.headers.get("Content-Length", 0))
            body    = self.rfile.read(length)
            payload = json.loads(body)
            text    = payload.get("text", "")

            if not text.strip():
                sys.stderr.write("[nlp_service] /extract — empty text\n")
                sys.stderr.flush()
                self._send_json(200, _EMPTY)
                return

            self._send_json(200, _extract(text))

        except Exception as exc:
            sys.stderr.write(f"[nlp_service] /extract error: {exc}\n")
            sys.stderr.flush()
            self._send_json(500, {"error": str(exc)})

    def _send_json(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    port   = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    print(f"NLP_SERVICE_READY:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
