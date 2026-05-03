import { useState, useMemo } from "react";
import type {
  PIRSTableModel,
  ReasonEntry,
  PirsCategoryKey,
  CommonSubdomainEntry,
  SocialSubdomainEntry,
  TravelSubdomainEntry,
  SocialFunctioningData,
  ConcentrationSubdomainEntry,
  EmployabilitySubdomainEntry,
  RelationshipEntry,
  ChildrenEntry,
} from "../types/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSD<T>(table: PIRSTableModel | undefined, catIdx: number, key: string): T {
  const raw = (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.subdomainData;
  return ((raw?.[key] ?? {}) as T);
}

function updateSD<T extends object>(
  table: PIRSTableModel,
  catIdx: number,
  key: string,
  patch: Partial<T>,
  onUpdate: (t: PIRSTableModel) => void
) {
  const reasons = [...(table.reasons ?? Array(6).fill({}))];
  const reason = { ...(reasons[catIdx] ?? {}) } as ReasonEntry;
  const sd = { ...(reason.subdomainData ?? {}) };
  sd[key] = { ...(sd[key] as object ?? {}), ...patch };
  reasons[catIdx] = { ...reason, subdomainData: sd };
  onUpdate({ ...table, reasons });
}

function updateFindings(
  table: PIRSTableModel,
  catIdx: number,
  findings: string,
  manual: boolean,
  onUpdate: (t: PIRSTableModel) => void
) {
  const reasons = [...(table.reasons ?? Array(6).fill({}))];
  const reason = { ...(reasons[catIdx] ?? {}) } as ReasonEntry;
  reasons[catIdx] = { ...reason, findings, findingsManuallyEdited: manual };
  onUpdate({ ...table, reasons });
}

function getFinding(table: PIRSTableModel | undefined, catIdx: number) {
  return (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.findings ?? "";
}

function isFindingManual(table: PIRSTableModel | undefined, catIdx: number) {
  return (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.findingsManuallyEdited ?? false;
}

// ── Shared option sets ────────────────────────────────────────────────────────

const INDEPENDENCE_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "independent", label: "Independent" },
  { value: "independent_with_difficulty", label: "Independent with difficulty" },
  { value: "requires_prompting", label: "Requires prompting" },
  { value: "requires_assistance", label: "Requires assistance" },
  { value: "dependent", label: "Dependent" },
];

const PROMPTING_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "none", label: "None" },
  { value: "occasional", label: "Occasional" },
  { value: "regular", label: "Regular" },
  { value: "constant", label: "Constant" },
];

const SUPPORT_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "none", label: "None" },
  { value: "informal", label: "Informal (family/friend)" },
  { value: "formal", label: "Formal (paid support)" },
];

const PRE_INJURY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "same", label: "Same as current" },
  { value: "better", label: "Better than current" },
  { value: "worse", label: "Worse than current" },
];

const INITIATION_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "self_initiated", label: "Self-initiated" },
  { value: "prompted", label: "Prompted" },
  { value: "avoidant", label: "Avoidant" },
];

const INVOLVEMENT_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "active", label: "Active participation" },
  { value: "passive", label: "Passive attendance" },
  { value: "withdrawn", label: "Withdrawn" },
];

const ABILITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "alone", label: "Alone" },
  { value: "with_support", label: "With support" },
  { value: "unable", label: "Unable" },
];

const DIFFICULTY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

const RELATIONSHIP_QUALITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "good", label: "Good" },
  { value: "strained", label: "Strained" },
  { value: "conflict", label: "Conflict" },
  { value: "no_relationship", label: "No relationship" },
];

const DEPENDENCY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "independent", label: "Independent" },
  { value: "provides_care", label: "Provides care" },
  { value: "receives_care", label: "Receives care" },
];

const CONSISTENCY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "consistent", label: "Consistent" },
  { value: "reduced", label: "Reduced" },
  { value: "erratic", label: "Erratic" },
];

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "casual", label: "Casual" },
  { value: "unemployed", label: "Unemployed" },
  { value: "not_seeking", label: "Not seeking work" },
  { value: "retired", label: "Retired" },
  { value: "student", label: "Student" },
];

const LIVING_ARRANGEMENT_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "alone", label: "Lives alone" },
  { value: "with_partner", label: "Lives with partner" },
  { value: "with_children", label: "Lives with children" },
  { value: "with_parents", label: "Lives with parents" },
  { value: "with_others", label: "Lives with others" },
];

const CARE_RESPONSIBILITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "full", label: "Full care" },
  { value: "shared", label: "Shared care" },
  { value: "others", label: "Others care for children" },
];

// ── Primitive field helpers ───────────────────────────────────────────────────

function SF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Sel({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Txt({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Snippets({
  snippets, onChange,
}: {
  snippets: string[];
  onChange: (s: string[]) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label mb-0">Evidence Snippets</label>
        <button type="button" className="text-xs text-violet-600 hover:text-violet-800"
          onClick={() => onChange([...snippets, ""])}>+ Add</button>
      </div>
      {snippets.length === 0 && (
        <p className="text-[11px] text-slate-400 italic">One clinical fact per entry.</p>
      )}
      {snippets.map((s, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input
            className="input flex-1 text-xs"
            value={s}
            placeholder="One clinical fact"
            onChange={(e) => { const n = [...snippets]; n[i] = e.target.value; onChange(n); }}
          />
          <button type="button" className="text-slate-400 hover:text-red-500 px-1"
            onClick={() => onChange(snippets.filter((_, idx) => idx !== i))}>×</button>
        </div>
      ))}
    </div>
  );
}

function FlagRow({
  checked, label, onChange,
}: {
  checked: boolean; label: string; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" className="w-3.5 h-3.5 accent-violet-600"
        checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ── Common subdomain fields ───────────────────────────────────────────────────

function CommonFields({
  data,
  onPatch,
  showFrequency = true,
  extraTop,
  extraBottom,
}: {
  data: CommonSubdomainEntry;
  onPatch: (p: Partial<CommonSubdomainEntry>) => void;
  showFrequency?: boolean;
  extraTop?: React.ReactNode;
  extraBottom?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <FlagRow checked={!!data.doesNotPerform} label="Does not perform this activity"
          onChange={(v) => onPatch({ doesNotPerform: v })} />
        <FlagRow checked={!!data.noIssues} label="No issues in this area"
          onChange={(v) => onPatch({ noIssues: v })} />
      </div>
      {extraTop}
      {showFrequency && (
        <SF label="Frequency">
          <Txt value={data.frequency ?? ""} onChange={(v) => onPatch({ frequency: v })}
            placeholder="e.g. daily, 3×/week" />
        </SF>
      )}
      <SF label="Independence Level">
        <Sel value={data.independenceLevel ?? ""} options={INDEPENDENCE_OPTIONS}
          onChange={(v) => onPatch({ independenceLevel: v as CommonSubdomainEntry["independenceLevel"] })} />
      </SF>
      <div className="grid grid-cols-2 gap-3">
        <SF label="Prompting">
          <Sel value={data.prompting ?? ""} options={PROMPTING_OPTIONS}
            onChange={(v) => onPatch({ prompting: v as CommonSubdomainEntry["prompting"] })} />
        </SF>
        <SF label="Who prompts">
          <Txt value={data.promptingWho ?? ""} onChange={(v) => onPatch({ promptingWho: v })}
            placeholder="e.g. spouse, community nurse" />
        </SF>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SF label="Support Requirement">
          <Sel value={data.supportType ?? ""} options={SUPPORT_OPTIONS}
            onChange={(v) => onPatch({ supportType: v as CommonSubdomainEntry["supportType"] })} />
        </SF>
        <SF label="Hours per week">
          <Txt value={data.supportHoursPerWeek ?? ""} onChange={(v) => onPatch({ supportHoursPerWeek: v })}
            placeholder="e.g. 4 hrs" />
        </SF>
      </div>
      <SF label="Recency (last performed independently)">
        <Txt value={data.recency ?? ""} onChange={(v) => onPatch({ recency: v })}
          placeholder="e.g. 6 months ago" />
      </SF>
      <div className="grid grid-cols-2 gap-3">
        <SF label="Pre-injury Comparison">
          <Sel value={data.preInjuryComparison ?? ""} options={PRE_INJURY_OPTIONS}
            onChange={(v) => onPatch({ preInjuryComparison: v as CommonSubdomainEntry["preInjuryComparison"] })} />
        </SF>
        <SF label="Pre-injury Notes">
          <Txt value={data.preInjuryComparisonNotes ?? ""} onChange={(v) => onPatch({ preInjuryComparisonNotes: v })}
            placeholder="optional detail" />
        </SF>
      </div>
      {extraBottom}
      <Snippets
        snippets={data.evidenceSnippets ?? []}
        onChange={(s) => onPatch({ evidenceSnippets: s })}
      />
    </div>
  );
}

// ── Accordion section ─────────────────────────────────────────────────────────

function AccordionSection({
  id: _id, title, isOpen, onToggle, badge, children,
}: {
  id: string; title: string; isOpen: boolean;
  onToggle: () => void; badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 transition text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {badge && (
            <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-semibold">{badge}</span>
          )}
        </div>
        <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && <div className="px-3 py-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Self-care Panel ───────────────────────────────────────────────────────────

const SELF_CARE_SUBDOMAINS = [
  { key: "bathing", label: "Bathing" },
  { key: "grooming", label: "Grooming" },
  { key: "cooking", label: "Cooking" },
  { key: "householdChores", label: "Household Chores" },
  { key: "shopping", label: "Shopping" },
  { key: "other", label: "Other" },
];

function SelfCarePanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  return (
    <div className="space-y-2">
      {SELF_CARE_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<CommonSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<CommonSubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields data={data} onPatch={patch} />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Social & Recreational Panel ───────────────────────────────────────────────

const SOCIAL_SUBDOMAINS = [
  { key: "socialOutings", label: "Social Outings" },
  { key: "hobbies", label: "Hobbies" },
  { key: "exercise", label: "Exercise" },
  { key: "culturalActivities", label: "Cultural Activities" },
  { key: "socialParticipation", label: "Social Participation Level" },
];

function SocialRecreationalPanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  const topData = getSD<{ doesNotGoOut?: boolean; noHobbies?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: Partial<{ doesNotGoOut?: boolean; noHobbies?: boolean }>) =>
    updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!topData.doesNotGoOut} label="Does not go out"
          onChange={(v) => patchFlags({ doesNotGoOut: v })} />
        <FlagRow checked={!!topData.noHobbies} label="No hobbies or activities"
          onChange={(v) => patchFlags({ noHobbies: v })} />
      </div>
      {SOCIAL_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<SocialSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<SocialSubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields
              data={data}
              onPatch={patch}
              extraTop={
                <div className="grid grid-cols-2 gap-3">
                  <SF label="Initiation">
                    <Sel value={data.initiation ?? ""} options={INITIATION_OPTIONS}
                      onChange={(v) => patch({ initiation: v as SocialSubdomainEntry["initiation"] })} />
                  </SF>
                  <SF label="Involvement Level">
                    <Sel value={data.involvementLevel ?? ""} options={INVOLVEMENT_OPTIONS}
                      onChange={(v) => patch({ involvementLevel: v as SocialSubdomainEntry["involvementLevel"] })} />
                  </SF>
                </div>
              }
              extraBottom={
                <div>
                  <FlagRow
                    checked={!!data.supportPersonRequired}
                    label="Support person required"
                    onChange={(v) => patch({ supportPersonRequired: v })}
                  />
                  {data.supportPersonRequired && (
                    <div className="mt-2">
                      <SF label="Support person details">
                        <Txt value={data.supportPersonDetails ?? ""}
                          onChange={(v) => patch({ supportPersonDetails: v })} />
                      </SF>
                    </div>
                  )}
                </div>
              }
            />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Travel Panel ──────────────────────────────────────────────────────────────

const TRAVEL_SUBDOMAINS = [
  { key: "localTravel", label: "Local Travel" },
  { key: "longDistance", label: "Long-distance Travel" },
  { key: "driving", label: "Driving" },
  { key: "publicTransport", label: "Public Transport" },
];

function TravelPanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  const flags = getSD<{ doesNotTravel?: boolean; cannotLeaveResidence?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.doesNotTravel} label="Does not travel"
          onChange={(v) => patchFlags({ doesNotTravel: v })} />
        <FlagRow checked={!!flags.cannotLeaveResidence} label="Cannot leave residence"
          onChange={(v) => patchFlags({ cannotLeaveResidence: v })} />
      </div>
      {TRAVEL_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<TravelSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<TravelSubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <div className="space-y-3">
              <SF label="Independence Level">
                <Sel value={data.independenceLevel ?? ""} options={INDEPENDENCE_OPTIONS}
                  onChange={(v) => patch({ independenceLevel: v as TravelSubdomainEntry["independenceLevel"] })} />
              </SF>
              <div className="grid grid-cols-2 gap-3">
                <SF label="Support Requirement">
                  <Sel value={data.supportType ?? ""} options={SUPPORT_OPTIONS}
                    onChange={(v) => patch({ supportType: v as TravelSubdomainEntry["supportType"] })} />
                </SF>
                <SF label="Hours per week">
                  <Txt value={data.supportHoursPerWeek ?? ""} onChange={(v) => patch({ supportHoursPerWeek: v })} />
                </SF>
              </div>
              <SF label="Ability Context">
                <Sel value={data.abilityContext ?? ""} options={ABILITY_OPTIONS}
                  onChange={(v) => patch({ abilityContext: v as TravelSubdomainEntry["abilityContext"] })} />
              </SF>
              <SF label="Distance Capacity">
                <Txt value={data.distanceCapacity ?? ""} onChange={(v) => patch({ distanceCapacity: v })}
                  placeholder="e.g. within 2km, unable beyond suburb" />
              </SF>
              <SF label="Recency (last travel event)">
                <Txt value={data.recency ?? ""} onChange={(v) => patch({ recency: v })}
                  placeholder="e.g. 3 months ago" />
              </SF>
              <div className="grid grid-cols-2 gap-3">
                <SF label="Pre-injury Comparison">
                  <Sel value={data.preInjuryComparison ?? ""} options={PRE_INJURY_OPTIONS}
                    onChange={(v) => patch({ preInjuryComparison: v as TravelSubdomainEntry["preInjuryComparison"] })} />
                </SF>
                <SF label="Notes">
                  <Txt value={data.preInjuryComparisonNotes ?? ""} onChange={(v) => patch({ preInjuryComparisonNotes: v })} />
                </SF>
              </div>
              <Snippets
                snippets={data.evidenceSnippets ?? []}
                onChange={(s) => patch({ evidenceSnippets: s })}
              />
            </div>
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Social Functioning Panel (entity-based) ───────────────────────────────────

function RelationshipEntitySection({
  label: _label, data, onChange, children,
}: {
  label: string;
  data: RelationshipEntry;
  onChange: (p: Partial<RelationshipEntry>) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <SF label="Relationship Status">
        <Txt value={data.status ?? ""} onChange={(v) => onChange({ status: v })}
          placeholder="e.g. together, separated, no contact" />
      </SF>
      <div className="grid grid-cols-2 gap-3">
        <SF label="Quality">
          <Sel value={data.quality ?? ""} options={RELATIONSHIP_QUALITY_OPTIONS}
            onChange={(v) => onChange({ quality: v as RelationshipEntry["quality"] })} />
        </SF>
        <SF label="Contact Frequency">
          <Txt value={data.contactFrequency ?? ""} onChange={(v) => onChange({ contactFrequency: v })}
            placeholder="e.g. daily, weekly" />
        </SF>
      </div>
      <SF label="Dependency">
        <Sel value={data.dependency ?? ""} options={DEPENDENCY_OPTIONS}
          onChange={(v) => onChange({ dependency: v as RelationshipEntry["dependency"] })} />
      </SF>
      {children}
      <Snippets
        snippets={data.evidenceSnippets ?? []}
        onChange={(s) => onChange({ evidenceSnippets: s })}
      />
    </div>
  );
}

function SocialFunctioningPanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  const sf = getSD<SocialFunctioningData>(table, catIdx, "_sf");
  const patchSf = (p: Partial<SocialFunctioningData>) =>
    updateSD(table!, catIdx, "_sf", p, onUpdate);

  const patchEntity = <K extends keyof SocialFunctioningData>(
    entity: K,
    patch: Partial<SocialFunctioningData[K] & object>
  ) => {
    const existing = (sf[entity] ?? {}) as object;
    patchSf({ [entity]: { ...existing, ...patch } } as Partial<SocialFunctioningData>);
  };

  const entities: Array<{
    key: "partner" | "parents" | "siblings" | "friends";
    label: string;
    negateKey: keyof SocialFunctioningData;
    negateLabel: string;
  }> = [
    { key: "partner", label: "Partner", negateKey: "noPartner", negateLabel: "No partner" },
    { key: "parents", label: "Parents", negateKey: "parentsDeceased", negateLabel: "Parents deceased" },
    { key: "siblings", label: "Siblings", negateKey: "noSiblings", negateLabel: "No siblings" },
    { key: "friends", label: "Friends (close)", negateKey: "noCloseFriends", negateLabel: "No close friends" },
  ];

  const children = (sf.children ?? {}) as ChildrenEntry;
  const patchChildren = (p: Partial<ChildrenEntry>) =>
    patchSf({ children: { ...children, ...p } });

  return (
    <div className="space-y-2">
      {/* Global flags */}
      <div className="card bg-slate-50 space-y-2 p-3">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Global Flags</p>
        <div className="grid grid-cols-2 gap-1.5">
          <FlagRow checked={!!sf.noPartner} label="No partner"
            onChange={(v) => patchSf({ noPartner: v })} />
          <FlagRow checked={!!sf.noChildren} label="No children"
            onChange={(v) => patchSf({ noChildren: v })} />
          <FlagRow checked={!!sf.parentsDeceased} label="Parents deceased"
            onChange={(v) => patchSf({ parentsDeceased: v })} />
          <FlagRow checked={!!sf.noSiblings} label="No siblings"
            onChange={(v) => patchSf({ noSiblings: v })} />
          <FlagRow checked={!!sf.noCloseFriends} label="No close friends"
            onChange={(v) => patchSf({ noCloseFriends: v })} />
        </div>
      </div>

      {/* Living arrangement */}
      <AccordionSection id="living" title="Living Arrangement"
        isOpen={open.has("living")} onToggle={() => onToggle("living")}>
        <div className="space-y-3">
          <SF label="Living Situation">
            <Sel value={sf.livingArrangement ?? ""} options={LIVING_ARRANGEMENT_OPTIONS}
              onChange={(v) => patchSf({ livingArrangement: v as SocialFunctioningData["livingArrangement"] })} />
          </SF>
          <SF label="Details">
            <Txt value={sf.livingArrangementDetails ?? ""} onChange={(v) => patchSf({ livingArrangementDetails: v })}
              placeholder='e.g. "Lives with 2 children aged 8 and 10"' />
          </SF>
        </div>
      </AccordionSection>

      {/* Children entity */}
      {!sf.noChildren && (
        <AccordionSection id="children" title="Children"
          isOpen={open.has("children")} onToggle={() => onToggle("children")}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SF label="Number of children">
                <input type="number" className="input" min={0}
                  value={children.numberOfChildren ?? ""}
                  onChange={(e) => patchChildren({ numberOfChildren: Number(e.target.value) })} />
              </SF>
              <SF label="Ages">
                <Txt value={children.ages ?? ""} onChange={(v) => patchChildren({ ages: v })}
                  placeholder="e.g. 8, 10, 15" />
              </SF>
            </div>
            <SF label="Care Responsibility">
              <Sel value={children.careResponsibility ?? ""} options={CARE_RESPONSIBILITY_OPTIONS}
                onChange={(v) => patchChildren({ careResponsibility: v as ChildrenEntry["careResponsibility"] })} />
            </SF>
            <RelationshipEntitySection
              label="Children"
              data={children}
              onChange={(p) => patchChildren(p)}
            />
          </div>
        </AccordionSection>
      )}

      {/* Other relationship entities */}
      {entities.map(({ key, label, negateKey, negateLabel: _negateLabel }) => {
        if (sf[negateKey]) return null;
        const data = (sf[key] ?? {}) as RelationshipEntry;
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <RelationshipEntitySection
              label={label}
              data={data}
              onChange={(p) => patchEntity(key, p)}
            />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Concentration Panel ───────────────────────────────────────────────────────

const CONCENTRATION_SUBDOMAINS = [
  { key: "reading", label: "Reading" },
  { key: "taskCompletion", label: "Task Completion" },
  { key: "followingInstructions", label: "Following Instructions" },
  { key: "conversationFocus", label: "Conversation Focus" },
];

function ConcentrationPanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  const flags = getSD<{ cannotSustain?: boolean; severeImpairment?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.cannotSustain} label="Cannot sustain attention"
          onChange={(v) => patchFlags({ cannotSustain: v })} />
        <FlagRow checked={!!flags.severeImpairment} label="Severe concentration impairment"
          onChange={(v) => patchFlags({ severeImpairment: v })} />
      </div>
      {CONCENTRATION_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<ConcentrationSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<ConcentrationSubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <SF label="Duration Capacity">
                  <Txt value={data.durationCapacity ?? ""} onChange={(v) => patch({ durationCapacity: v })}
                    placeholder="e.g. 10 minutes" />
                </SF>
                <SF label="Fatigue Onset">
                  <Txt value={data.fatigueOnset ?? ""} onChange={(v) => patch({ fatigueOnset: v })}
                    placeholder="e.g. after 5 minutes" />
                </SF>
              </div>
              <SF label="Difficulty Level">
                <Sel value={data.difficultyLevel ?? ""} options={DIFFICULTY_OPTIONS}
                  onChange={(v) => patch({ difficultyLevel: v as ConcentrationSubdomainEntry["difficultyLevel"] })} />
              </SF>
              <SF label="Support Required">
                <Txt value={data.supportRequired ?? ""} onChange={(v) => patch({ supportRequired: v })}
                  placeholder="e.g. verbal prompting" />
              </SF>
              <SF label="Recency">
                <Txt value={data.recency ?? ""} onChange={(v) => patch({ recency: v })}
                  placeholder="e.g. last able to read a book 2 years ago" />
              </SF>
              <div className="grid grid-cols-2 gap-3">
                <SF label="Pre-injury Comparison">
                  <Sel value={data.preInjuryComparison ?? ""} options={PRE_INJURY_OPTIONS}
                    onChange={(v) => patch({ preInjuryComparison: v as ConcentrationSubdomainEntry["preInjuryComparison"] })} />
                </SF>
                <SF label="Notes">
                  <Txt value={data.preInjuryComparisonNotes ?? ""} onChange={(v) => patch({ preInjuryComparisonNotes: v })} />
                </SF>
              </div>
              <Snippets
                snippets={data.evidenceSnippets ?? []}
                onChange={(s) => patch({ evidenceSnippets: s })}
              />
            </div>
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Employability Panel ───────────────────────────────────────────────────────

const EMPLOYABILITY_SUBDOMAINS = [
  { key: "currentWork", label: "Current Work" },
  { key: "workCapacity", label: "Work Capacity" },
  { key: "volunteering", label: "Volunteering" },
  { key: "jobSeeking", label: "Job-seeking" },
];

function EmployabilityPanel({
  table, catIdx, onUpdate, open, onToggle,
}: PanelProps) {
  const flags = getSD<{ notWorking?: boolean; notSeekingWork?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.notWorking} label="Not working"
          onChange={(v) => patchFlags({ notWorking: v })} />
        <FlagRow checked={!!flags.notSeekingWork} label="Not seeking work"
          onChange={(v) => patchFlags({ notSeekingWork: v })} />
      </div>
      {EMPLOYABILITY_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<EmployabilitySubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<EmployabilitySubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <SF label="Employment Status">
                  <Sel value={data.employmentStatus ?? ""} options={EMPLOYMENT_STATUS_OPTIONS}
                    onChange={(v) => patch({ employmentStatus: v as EmployabilitySubdomainEntry["employmentStatus"] })} />
                </SF>
                <SF label="Hours per week">
                  <Txt value={data.hoursPerWeek ?? ""} onChange={(v) => patch({ hoursPerWeek: v })}
                    placeholder="e.g. 20 hrs" />
                </SF>
              </div>
              <SF label="Consistency">
                <Sel value={data.consistency ?? ""} options={CONSISTENCY_OPTIONS}
                  onChange={(v) => patch({ consistency: v as EmployabilitySubdomainEntry["consistency"] })} />
              </SF>
              <SF label="Barriers to Work">
                <Txt value={data.barriers ?? ""} onChange={(v) => patch({ barriers: v })}
                  placeholder="e.g. pain on prolonged sitting, anxiety" />
              </SF>
              <SF label="Last Employment (recency)">
                <Txt value={data.lastEmployment ?? ""} onChange={(v) => patch({ lastEmployment: v })}
                  placeholder="e.g. 2 years ago, Jan 2022" />
              </SF>
              <div className="grid grid-cols-2 gap-3">
                <SF label="Pre-injury Comparison">
                  <Sel value={data.preInjuryComparison ?? ""} options={PRE_INJURY_OPTIONS}
                    onChange={(v) => patch({ preInjuryComparison: v as EmployabilitySubdomainEntry["preInjuryComparison"] })} />
                </SF>
                <SF label="Notes">
                  <Txt value={data.preInjuryComparisonNotes ?? ""} onChange={(v) => patch({ preInjuryComparisonNotes: v })} />
                </SF>
              </div>
              <Snippets
                snippets={data.evidenceSnippets ?? []}
                onChange={(s) => patch({ evidenceSnippets: s })}
              />
            </div>
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Panel props type ──────────────────────────────────────────────────────────

type PanelProps = {
  table: PIRSTableModel;
  catIdx: number;
  onUpdate: (t: PIRSTableModel) => void;
  open: Set<string>;
  onToggle: (key: string) => void;
};

// ── Auto-sentence generation ──────────────────────────────────────────────────

function generateAutoFindings(
  table: PIRSTableModel | undefined,
  catIdx: number,
  categoryKey: PirsCategoryKey,
  _clientName: string
): string {
  if (!table) return "";

  if (categoryKey === "selfCare") {
    const parts: string[] = [];
    for (const { key, label } of SELF_CARE_SUBDOMAINS) {
      const d = getSD<CommonSubdomainEntry>(table, catIdx, key);
      if (d.doesNotPerform) { parts.push(`${label}: does not perform.`); continue; }
      if (d.noIssues) continue;
      const bits: string[] = [];
      if (d.independenceLevel) bits.push(d.independenceLevel.replace(/_/g, " "));
      if (d.frequency) bits.push(d.frequency);
      if (d.supportType && d.supportType !== "none") bits.push(`${d.supportType} support`);
      if (bits.length) parts.push(`${label}: ${bits.join(", ")}.`);
    }
    return parts.join(" ");
  }

  if (categoryKey === "socialRecreational") {
    const parts: string[] = [];
    for (const { key, label } of SOCIAL_SUBDOMAINS) {
      const d = getSD<SocialSubdomainEntry>(table, catIdx, key);
      if (d.doesNotPerform) { parts.push(`${label}: does not participate.`); continue; }
      if (d.noIssues) continue;
      const bits: string[] = [];
      if (d.initiation) bits.push(d.initiation.replace(/_/g, " "));
      if (d.involvementLevel) bits.push(d.involvementLevel.replace(/_/g, " "));
      if (d.frequency) bits.push(d.frequency);
      if (bits.length) parts.push(`${label}: ${bits.join(", ")}.`);
    }
    return parts.join(" ");
  }

  if (categoryKey === "travel") {
    const parts: string[] = [];
    for (const { key, label } of TRAVEL_SUBDOMAINS) {
      const d = getSD<TravelSubdomainEntry>(table, catIdx, key);
      if (d.doesNotTravel) { parts.push(`${label}: does not travel.`); continue; }
      const bits: string[] = [];
      if (d.abilityContext) bits.push(d.abilityContext.replace(/_/g, " "));
      if (d.distanceCapacity) bits.push(`capacity: ${d.distanceCapacity}`);
      if (bits.length) parts.push(`${label}: ${bits.join(", ")}.`);
    }
    return parts.join(" ");
  }

  if (categoryKey === "socialFunction") {
    const sf = getSD<SocialFunctioningData>(table, catIdx, "_sf");
    const bits: string[] = [];
    if (sf.livingArrangement) bits.push(`Lives ${sf.livingArrangement.replace(/_/g, " ")}${sf.livingArrangementDetails ? ` (${sf.livingArrangementDetails})` : ""}`);
    if (sf.noPartner) bits.push("no partner");
    if (sf.noChildren) bits.push("no children");
    if (sf.partner?.quality && sf.partner.quality !== "good") bits.push(`partner relationship: ${sf.partner.quality.replace(/_/g, " ")}`);
    return bits.join(". ");
  }

  if (categoryKey === "concentration") {
    const parts: string[] = [];
    for (const { key, label } of CONCENTRATION_SUBDOMAINS) {
      const d = getSD<ConcentrationSubdomainEntry>(table, catIdx, key);
      if (d.difficultyLevel && d.difficultyLevel !== "none") {
        const bits: string[] = [`${d.difficultyLevel} difficulty`];
        if (d.durationCapacity) bits.push(`duration ${d.durationCapacity}`);
        parts.push(`${label}: ${bits.join(", ")}.`);
      }
    }
    return parts.join(" ");
  }

  if (categoryKey === "adaptation") {
    const cw = getSD<EmployabilitySubdomainEntry>(table, catIdx, "currentWork");
    const bits: string[] = [];
    if (cw.employmentStatus) bits.push(cw.employmentStatus.replace(/_/g, " "));
    if (cw.hoursPerWeek) bits.push(`${cw.hoursPerWeek} hrs/week`);
    if (cw.consistency) bits.push(cw.consistency);
    if (cw.barriers) bits.push(`barriers: ${cw.barriers}`);
    return bits.join(", ");
  }

  return "";
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PIRSCategoryEntry({
  categoryKey,
  categoryIndex,
  table,
  onUpdateTable,
  clientName,
}: {
  categoryKey: PirsCategoryKey;
  categoryIndex: number;
  table: PIRSTableModel | undefined;
  onUpdateTable: (t: PIRSTableModel) => void;
  clientName: string;
}) {
  const [openSubdomains, setOpenSubdomains] = useState<Set<string>>(new Set());
  const [focusMode, setFocusMode] = useState(false);

  function toggleSubdomain(key: string) {
    setOpenSubdomains((prev) => {
      const next = new Set(focusMode ? [] : prev);
      if (prev.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function collapseAll() {
    setOpenSubdomains(new Set());
  }

  const findings = getFinding(table, categoryIndex);
  const isManual = isFindingManual(table, categoryIndex);

  const autoFindings = useMemo(
    () => generateAutoFindings(table, categoryIndex, categoryKey, clientName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, categoryIndex, categoryKey, clientName]
  );

  function handleFindingsChange(val: string) {
    if (!table) return;
    updateFindings(table, categoryIndex, val, true, onUpdateTable);
  }

  function regenerateFindings() {
    if (!table) return;
    updateFindings(table, categoryIndex, autoFindings, false, onUpdateTable);
  }

  // Class selector helper
  const classValue = table?.classes[categoryIndex] ?? 1;
  function setClass(v: number) {
    if (!table) return;
    const classes = [...table.classes];
    classes[categoryIndex] = v;
    onUpdateTable({ ...table, classes });
  }

  if (!table) {
    return (
      <div className="card p-4 text-sm text-slate-400 italic">
        Add a Current PIRS table to enter structured data.
      </div>
    );
  }

  const panelProps: PanelProps = {
    table,
    catIdx: categoryIndex,
    onUpdate: onUpdateTable,
    open: openSubdomains,
    onToggle: toggleSubdomain,
  };

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500">Class</label>
          <select
            className="input py-0.5 w-16 text-sm"
            value={classValue}
            onChange={(e) => setClass(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              className="w-3 h-3 accent-violet-600"
              checked={focusMode}
              onChange={(e) => setFocusMode(e.target.checked)}
            />
            Focus Mode
          </label>
          <button type="button"
            className="text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100"
            onClick={collapseAll}>
            Collapse All
          </button>
        </div>
      </div>

      {/* Category panel */}
      {categoryKey === "selfCare" && <SelfCarePanel {...panelProps} />}
      {categoryKey === "socialRecreational" && <SocialRecreationalPanel {...panelProps} />}
      {categoryKey === "travel" && <TravelPanel {...panelProps} />}
      {categoryKey === "socialFunction" && <SocialFunctioningPanel {...panelProps} />}
      {categoryKey === "concentration" && <ConcentrationPanel {...panelProps} />}
      {categoryKey === "adaptation" && <EmployabilityPanel {...panelProps} />}

      {/* Central Findings Panel */}
      <div className="border-t pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Findings</label>
          <div className="flex items-center gap-2">
            {isManual && (
              <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                manually edited
              </span>
            )}
            {autoFindings && (
              <button type="button"
                className="text-[11px] text-violet-600 hover:text-violet-800"
                onClick={regenerateFindings}>
                {isManual ? "Reset to generated" : "Regenerate"}
              </button>
            )}
          </div>
        </div>
        <textarea
          className="input w-full"
          rows={5}
          value={findings}
          onChange={(e) => handleFindingsChange(e.target.value)}
        />
        {!isManual && autoFindings && !findings && (
          <p className="text-[11px] text-slate-400 italic">
            Fill subdomains above to generate findings automatically.
          </p>
        )}
      </div>
    </div>
  );
}
