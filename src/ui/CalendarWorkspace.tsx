import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dateKeyInZone,
  formatInstantInZone,
  resolveZonedWallTime,
  scheduleRulesSchema,
  type Render,
  type ScheduleDraftResult,
  type ScheduleEntry,
  type ScheduleRules,
  type ScheduleRuleSet,
  type ShortProject
} from "../shared/domain";
import { ApiClientError, api } from "./api";
import { errorMessage } from "./utils";

type Area = "rules" | "queue" | "schedule";
type ScheduleView = "list" | "month";

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function todayInSystemZone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return dateKeyInZone(new Date(), timezone);
}

export function defaultScheduleRules(): ScheduleRules {
  return {
    startDate: todayInSystemZone(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    allowedWeekdays: [1, 3, 5],
    times: ["09:00"],
    maxPerDay: 1,
    blackoutDates: [],
    minimumSameEpisodeSpacingHours: 48
  };
}

function editableRules(ruleSet: ScheduleRuleSet): ScheduleRules {
  return {
    startDate: ruleSet.startDate,
    timezone: ruleSet.timezone,
    allowedWeekdays: [...ruleSet.allowedWeekdays],
    times: [...ruleSet.times],
    maxPerDay: ruleSet.maxPerDay,
    blackoutDates: [...ruleSet.blackoutDates],
    minimumSameEpisodeSpacingHours: ruleSet.minimumSameEpisodeSpacingHours
  };
}

export function CalendarWorkspace({
  announce,
  onChanged
}: {
  announce: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [area, setArea] = useState<Area>("rules");
  const [rules, setRules] = useState<ScheduleRuleSet | null>(null);
  const [draftRules, setDraftRules] = useState<ScheduleRules>(defaultScheduleRules);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [shorts, setShorts] = useState<ShortProject[]>([]);
  const [renders, setRenders] = useState<Render[]>([]);
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<ScheduleDraftResult["warnings"]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scheduleView, setScheduleView] = useState<ScheduleView>("list");
  const [month, setMonth] = useState(() => todayInSystemZone().slice(0, 7));
  const [moveEntry, setMoveEntry] = useState<ScheduleEntry | null>(null);
  const [publishEntry, setPublishEntry] = useState<ScheduleEntry | null>(null);
  const operationPending = useRef(false);

  const refresh = useCallback(async (preserveDraft = false) => {
    setLoading(true);
    setFailure(null);
    try {
      const [entryRows, shortRows, renderRows] = await Promise.all([
        api.scheduleEntries(), api.shorts(), api.renders()
      ]);
      let currentRules: ScheduleRuleSet | null = null;
      try {
        currentRules = await api.scheduleRules();
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.code !== "NOT_FOUND") throw error;
      }
      setEntries(entryRows);
      setShorts(shortRows);
      setRenders(renderRows);
      setRules(currentRules);
      if (!preserveDraft) {
        setDraftRules(currentRules ? editableRules(currentRules) : defaultScheduleRules());
      }
      setPriorities((current) => Object.fromEntries(
        shortRows.map((project) => [project.id, current[project.id] ?? 0])
      ));
      setSelected((current) => new Set([...current].filter((id) =>
        shortRows.some((project) => project.id === id)
      )));
      announce("Calendar refreshed");
    } catch (error) {
      const message = errorMessage(error, "Calendar unavailable");
      setFailure(message);
      announce(message);
    } finally {
      setLoading(false);
    }
  }, [announce]);

  useEffect(() => { void refresh(); }, [refresh]);

  const eligible = useMemo(
    () => eligibleDraftRows(shorts, renders, entries),
    [entries, renders, shorts]
  );

  useEffect(() => {
    const eligibleIds = new Set(eligible.map(({ project }) => project.id));
    setSelected((current) => new Set([...current].filter((id) => eligibleIds.has(id))));
  }, [eligible]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (operationPending.current) return false;
    operationPending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await operation();
      setConflict(null);
      await refresh();
      await onChanged();
      announce(success);
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        const details = error.details as { expectedRevision?: number; actualRevision?: number } | null;
        setConflict(
          `${error.message}. Expected revision ${details?.expectedRevision ?? "none"}; ` +
          `current revision ${details?.actualRevision ?? "unknown"}.`
        );
      }
      const message = describeScheduleError(error);
      setFailure(message);
      announce(message);
      return false;
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  };

  const saveRules = async () => {
    const parsed = scheduleRulesSchema.safeParse(draftRules);
    if (!parsed.success) {
      setFailure(parsed.error.issues.map((issue) => issue.message).join("; "));
      return;
    }
    await mutate(
      () => api.updateScheduleRules(parsed.data, rules?.revision),
      rules ? "Schedule rules updated" : "Schedule rules created"
    );
  };

  const draftSelected = async () => {
    if (operationPending.current) return;
    if (!rules) {
      setFailure("Create schedule rules before drafting.");
      return;
    }
    const selectedRows = eligible.filter(({ project }) => selected.has(project.id));
    if (!selectedRows.length) {
      setFailure("Select at least one eligible Short.");
      return;
    }
    operationPending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.draftSchedule(selectedRows.map(({ project, render }) => ({
        shortId: project.id,
        renderId: render.id,
        episodeId: project.episodeId,
        priority: priorities[project.id] ?? 0,
        topic: project.title
      })), rules.revision);
      setWarnings(result.warnings);
      setSelected(new Set());
      await refresh();
      await onChanged();
      setArea("schedule");
      announce(`${result.entries.length} schedule entr${result.entries.length === 1 ? "y" : "ies"} drafted`);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
        setConflict(`${error.message}. Reload the current revision and try again.`);
      }
      const message = describeScheduleError(error);
      setFailure(message);
      announce(message);
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="panel calendar-workspace" aria-busy={loading || busy}>
      <div className="calendar-toolbar">
        <div className="tabs" role="tablist" aria-label="Calendar areas">
          {(["rules", "queue", "schedule"] as Area[]).map((item) => (
            <button key={item} role="tab" aria-selected={area === item}
              onClick={() => setArea(item)}>
              {item === "queue" ? `Draft Queue (${eligible.length})` :
                item[0]!.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <button className="secondary" onClick={() => void refresh()} disabled={busy}>
          ↻ Refresh
        </button>
      </div>
      <div className="calendar-disclaimer">
        Scheduling records plans only. It never uploads to YouTube.
      </div>
      {failure && <div className="error-box calendar-message" role="alert">{failure}</div>}
      {conflict && (
        <div className="conflict-box calendar-message" role="alert">
          <strong>Revision conflict</strong><span>{conflict} Unsaved edits are preserved.</span>
          <button className="secondary" onClick={() => void refresh(true)}>Reload revision</button>
        </div>
      )}
      {area === "rules" && (
        <RulesEditor value={draftRules} onChange={setDraftRules}
          revision={rules?.revision ?? null} busy={busy} onSave={() => void saveRules()} />
      )}
      {area === "queue" && (
        <DraftQueue rows={eligible} selected={selected} priorities={priorities} busy={busy}
          hasRules={rules !== null}
          onSelect={(id, checked) => setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id); else next.delete(id);
            return next;
          })}
          onPriority={(id, priority) => setPriorities((current) => ({ ...current, [id]: priority }))}
          onDraft={() => void draftSelected()} />
      )}
      {area === "schedule" && (
        <ScheduleInspector entries={entries} rules={rules} view={scheduleView} month={month}
          warnings={warnings} onView={setScheduleView} onMonth={setMonth}
          onMove={setMoveEntry} onPublish={setPublishEntry} />
      )}
      {moveEntry && rules && (
        <MoveDialog entry={moveEntry} rules={rules} entries={entries} busy={busy}
          onClose={() => setMoveEntry(null)}
          onMove={async (publishAt) => {
            const succeeded = await mutate(
              () => api.moveScheduleEntry(moveEntry.id, moveEntry.revision, publishAt),
              "Schedule entry moved"
            );
            if (succeeded) setMoveEntry(null);
          }} />
      )}
      {publishEntry && (
        <PublishDialog entry={publishEntry} busy={busy} onClose={() => setPublishEntry(null)}
          onPublish={async (youtubeUrl) => {
            const succeeded = await mutate(
              () => api.markSchedulePublished(
                publishEntry.id,
                publishEntry.revision,
                youtubeUrl || undefined
              ),
              "Publication recorded; entry permanently locked"
            );
            if (succeeded) setPublishEntry(null);
          }} />
      )}
    </section>
  );
}

function RulesEditor({
  value, onChange, revision, busy, onSave
}: {
  value: ScheduleRules;
  onChange: (value: ScheduleRules) => void;
  revision: number | null;
  busy: boolean;
  onSave: () => void;
}) {
  const replace = <K extends keyof ScheduleRules>(key: K, next: ScheduleRules[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <form className="rules-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="section-heading">
        <div><h2>Schedule rules</h2><small>{revision ? `Revision ${revision}` : "First-run defaults"}</small></div>
        <button className="primary" disabled={busy}>{revision ? "Save exact revision" : "Create rules"}</button>
      </div>
      <div className="rule-grid">
        <label>Start date<input type="date" value={value.startDate}
          onChange={(event) => replace("startDate", event.target.value)} /></label>
        <label>IANA timezone<input value={value.timezone}
          onChange={(event) => replace("timezone", event.target.value)} /></label>
        <label>Daily cap<input type="number" min={1} max={value.times.length}
          value={value.maxPerDay}
          onChange={(event) => replace("maxPerDay", Number(event.target.value))} /></label>
        <label>Same-Episode spacing (hours)<input type="number" min={0}
          value={value.minimumSameEpisodeSpacingHours}
          onChange={(event) => replace("minimumSameEpisodeSpacingHours", Number(event.target.value))} /></label>
      </div>
      <fieldset><legend>Allowed weekdays</legend><div className="weekday-grid">
        {weekdayNames.map((name, index) => (
          <label className="check" key={name}><input type="checkbox"
            checked={value.allowedWeekdays.includes(index)}
            onChange={(event) => replace("allowedWeekdays", event.target.checked
              ? [...value.allowedWeekdays, index]
              : value.allowedWeekdays.filter((day) => day !== index))}
          />{name}</label>
        ))}
      </div></fieldset>
      <RepeatableValues label="Wall times" type="time" values={value.times}
        onChange={(values) => onChange({
          ...value,
          times: values,
          maxPerDay: Math.min(value.maxPerDay, Math.max(values.length, 1))
        })} />
      <RepeatableValues label="Blackout dates" type="date" values={value.blackoutDates}
        allowEmpty onChange={(values) => replace("blackoutDates", values)} />
    </form>
  );
}

function RepeatableValues({
  label, type, values, onChange, allowEmpty = false
}: {
  label: string;
  type: "time" | "date";
  values: string[];
  onChange: (values: string[]) => void;
  allowEmpty?: boolean;
}) {
  return (
    <fieldset><legend>{label}</legend><div className="repeatable-list">
      {values.map((value, index) => (
        <div key={`${index}-${value}`}>
          <input aria-label={`${label} ${index + 1}`} type={type} value={value}
            onChange={(event) => onChange(values.map((item, itemIndex) =>
              itemIndex === index ? event.target.value : item))} />
          <button type="button" className="secondary" aria-label={`Remove ${label} ${index + 1}`}
            disabled={!allowEmpty && values.length === 1}
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() =>
        onChange([...values, type === "time" ? "09:00" : todayInSystemZone()])
      }>＋ Add {type === "time" ? "time" : "blackout"}</button>
    </div></fieldset>
  );
}

export function eligibleDraftRows(
  shorts: ShortProject[],
  renders: Render[],
  entries: ScheduleEntry[]
) {
  const scheduled = new Set(entries.map((entry) => entry.shortId));
  return shorts
    .filter((project) => project.approved && !scheduled.has(project.id))
    .map((project) => {
      const render = renders
        .filter((item) =>
          item.shortId === project.id &&
          item.projectRevision === project.revision &&
          item.state === "succeeded" &&
          item.validation?.valid === true &&
          (item.determinism?.comparison === "baseline" ||
            item.determinism?.comparison === "matched")
        )
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
        )[0];
      return render ? { project, render } : null;
    })
    .filter((row): row is { project: ShortProject; render: Render } => row !== null)
    .sort((left, right) =>
      left.project.title.localeCompare(right.project.title) ||
      left.project.id.localeCompare(right.project.id)
    );
}

function DraftQueue({
  rows, selected, priorities, busy, hasRules, onSelect, onPriority, onDraft
}: {
  rows: ReturnType<typeof eligibleDraftRows>;
  selected: Set<string>;
  priorities: Record<string, number>;
  busy: boolean;
  hasRules: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onPriority: (id: string, priority: number) => void;
  onDraft: () => void;
}) {
  return <div className="draft-queue">
    <div className="section-heading"><div><h2>Eligible Render queue</h2>
      <small>Newest eligible current-revision Render selected per approved Short</small></div>
      <button className="primary" disabled={busy || !hasRules || selected.size === 0}
        onClick={onDraft}>Draft selected atomically</button></div>
    {!hasRules && <div className="notice">Create schedule rules before drafting.</div>}
    {!rows.length ? <div className="calendar-empty">No approved, unscheduled Shorts have a current validated deterministic Render.</div> :
      <div className="table-wrap"><table><thead><tr><th>Select</th><th>Short</th>
        <th>Render</th><th>Priority</th></tr></thead><tbody>
        {rows.map(({ project, render }) => <tr key={project.id}>
          <td><input aria-label={`Select ${project.title}`} type="checkbox"
            checked={selected.has(project.id)}
            onChange={(event) => onSelect(project.id, event.target.checked)} /></td>
          <td><strong>{project.title}</strong><small>{project.id}</small></td>
          <td><strong>{render.determinism?.comparison}</strong>
            <small>{render.id} · {new Date(render.updatedAt).toLocaleString()}</small></td>
          <td><input className="priority-input" aria-label={`Priority for ${project.title}`}
            type="number" step={1} value={priorities[project.id] ?? 0}
            onChange={(event) => onPriority(project.id, Number(event.target.value))} /></td>
        </tr>)}
      </tbody></table></div>}
  </div>;
}

function ScheduleInspector({
  entries, rules, view, month, warnings, onView, onMonth, onMove, onPublish
}: {
  entries: ScheduleEntry[];
  rules: ScheduleRuleSet | null;
  view: ScheduleView;
  month: string;
  warnings: ScheduleDraftResult["warnings"];
  onView: (view: ScheduleView) => void;
  onMonth: (month: string) => void;
  onMove: (entry: ScheduleEntry) => void;
  onPublish: (entry: ScheduleEntry) => void;
}) {
  const displayZone = rules?.timezone ?? "UTC";
  return <div className="schedule-inspector">
    <div className="section-heading"><div><h2>Schedule</h2>
      <small>Displayed in {displayZone}; recorded timezone and UTC instant remain visible.</small></div>
      <div className="segmented"><button aria-pressed={view === "list"} onClick={() => onView("list")}>List</button>
        <button aria-pressed={view === "month"} onClick={() => onView("month")}>Month</button></div>
    </div>
    {warnings.length > 0 && <DstWarnings warnings={warnings} />}
    {!entries.length ? <div className="calendar-empty">No schedule entries yet.</div> :
      view === "list" ? <ScheduleList entries={entries} displayZone={displayZone}
        onMove={onMove} onPublish={onPublish} /> :
        <MonthGrid entries={entries} timezone={displayZone} month={month} onMonth={onMonth}
          onMove={onMove} />}
  </div>;
}

function DstWarnings({ warnings }: { warnings: ScheduleDraftResult["warnings"] }) {
  return <div className="dst-warnings" role="status"><strong>DST resolution warnings</strong>
    {warnings.map((warning, index) => <div key={`${warning.selectedUtcInstant}-${index}`}>
      <b>{warning.kind === "nonexistent_local_time" ? "Spring gap" : "Fall overlap"}</b>
      <span>Requested {warning.localDate} {warning.localTime} {warning.timezone}</span>
      <span>Selected {warning.selectedUtcInstant}</span>
      {warning.alternativeUtcInstant && <span>Alternative {warning.alternativeUtcInstant}</span>}
      <span>Adjustment {warning.adjustmentMinutes} minutes</span>
    </div>)}
  </div>;
}

function EntryIndicators({ entry }: { entry: ScheduleEntry }) {
  return <span className="entry-indicators">
    <span>{entry.status}</span>
    {entry.needsRerender && <span>rerender required</span>}
    {entry.locked && <span>locked</span>}
  </span>;
}

function ScheduleList({
  entries, displayZone, onMove, onPublish
}: {
  entries: ScheduleEntry[];
  displayZone: string;
  onMove: (entry: ScheduleEntry) => void;
  onPublish: (entry: ScheduleEntry) => void;
}) {
  return <div className="table-wrap"><table><thead><tr><th>When</th><th>Short / Render</th>
    <th>State</th><th>Actions</th></tr></thead><tbody>
    {entries.map((entry) => <tr key={entry.id}>
      <td><strong>{formatInstantInZone(entry.publishAt, displayZone)}</strong>
        <small>Recorded: {entry.timezone} · UTC {entry.publishAt}</small></td>
      <td><strong>{entry.shortId}</strong><small>Render {entry.renderId}</small></td>
      <td><EntryIndicators entry={entry} /></td>
      <td><div className="actions"><button className="secondary" disabled={entry.locked}
        onClick={() => onMove(entry)}>Move</button>
        <button className="secondary" disabled={entry.locked || entry.needsRerender}
          title={entry.needsRerender ? "Rerender required before publication" : undefined}
          onClick={() => onPublish(entry)}>Record publication</button></div>
        {entry.youtubeUrl && <a href={entry.youtubeUrl}>YouTube record</a>}</td>
    </tr>)}
  </tbody></table></div>;
}

function MonthGrid({
  entries, timezone, month, onMonth, onMove
}: {
  entries: ScheduleEntry[];
  timezone: string;
  month: string;
  onMonth: (month: string) => void;
  onMove: (entry: ScheduleEntry) => void;
}) {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1)
  ];
  const shiftMonth = (amount: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
    onMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return <div className="month-view">
    <div className="month-nav"><button className="secondary" onClick={() => shiftMonth(-1)}
      aria-label="Previous month">←</button><strong>{new Intl.DateTimeFormat(undefined, {
        month: "long", year: "numeric", timeZone: "UTC"
      }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))}</strong>
      <button className="secondary" onClick={() => shiftMonth(1)} aria-label="Next month">→</button></div>
    <div className="month-grid">
      {weekdayNames.map((day) => <div className="month-weekday" key={day}>{day.slice(0, 3)}</div>)}
      {cells.map((day, index) => {
        const dateKey = day === null ? null :
          `${month}-${String(day).padStart(2, "0")}`;
        const dayEntries = dateKey ? entries.filter((entry) =>
          dateKeyInZone(entry.publishAt, timezone) === dateKey) : [];
        return <div className={`month-cell${day === null ? " outside" : ""}`} key={index}>
          {day !== null && <span>{day}</span>}
          {dayEntries.map((entry) => <button key={entry.id} className="month-entry"
            disabled={entry.locked} onClick={() => onMove(entry)}>
            {new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeStyle: "short" })
              .format(new Date(entry.publishAt))}
            <EntryIndicators entry={entry} />
          </button>)}
        </div>;
      })}
    </div>
  </div>;
}

export function moveChoice(
  entry: ScheduleEntry,
  rules: ScheduleRules,
  entries: ScheduleEntry[],
  date: string,
  time: string
): { publishAt?: string; reason?: string; warning?: ScheduleDraftResult["warnings"][number] } {
  if (!date || date < rules.startDate) return { reason: "Date is before the schedule start date." };
  const dateObject = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dateObject.getTime())) return { reason: "Choose a valid date." };
  if (!rules.allowedWeekdays.includes(dateObject.getUTCDay())) {
    return { reason: `${weekdayNames[dateObject.getUTCDay()]} is not an allowed weekday.` };
  }
  if (rules.blackoutDates.includes(date)) return { reason: "That date is blacked out." };
  if (!rules.times.slice(0, rules.maxPerDay).includes(time)) {
    return { reason: "That wall time is outside the active daily slots." };
  }
  try {
    const resolved = resolveZonedWallTime(date, time, rules.timezone);
    const publishAt = resolved.instant.toISOString();
    if (entries.some((other) => other.id !== entry.id && other.publishAt === publishAt)) {
      return { reason: "Another schedule entry already occupies that instant." };
    }
    const spacingMs = rules.minimumSameEpisodeSpacingHours * 3_600_000;
    if (entries.some((other) => other.id !== entry.id &&
      other.episodeId === entry.episodeId &&
      Math.abs(new Date(other.publishAt).getTime() - resolved.instant.getTime()) < spacingMs)) {
      return { reason: `This choice violates the ${rules.minimumSameEpisodeSpacingHours}-hour same-Episode spacing rule.` };
    }
    return { publishAt, warning: resolved.warning };
  } catch (error) {
    return { reason: errorMessage(error, "That wall time cannot be resolved.") };
  }
}

function MoveDialog({
  entry, rules, entries, busy, onClose, onMove
}: {
  entry: ScheduleEntry;
  rules: ScheduleRuleSet;
  entries: ScheduleEntry[];
  busy: boolean;
  onClose: () => void;
  onMove: (publishAt: string) => Promise<void>;
}) {
  const initialDate = dateKeyInZone(entry.publishAt, rules.timezone);
  const [date, setDate] = useState(initialDate < rules.startDate ? rules.startDate : initialDate);
  const [time, setTime] = useState(rules.times.slice(0, rules.maxPerDay)[0] ?? "");
  const choice = moveChoice(entry, rules, entries, date, time);
  return <div className="dialog-backdrop" role="presentation">
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="move-title">
      <h2 id="move-title">Move schedule entry</h2>
      <p>Choose a legal wall time in {rules.timezone}. The server validates the move again.</p>
      <div className="rule-grid"><label>Date<input type="date" min={rules.startDate}
        value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Allowed time<select value={time} onChange={(event) => setTime(event.target.value)}>
          {rules.times.slice(0, rules.maxPerDay).map((item) =>
            <option key={item}>{item}</option>)}</select></label></div>
      {choice.reason ? <div className="error-box" role="alert">{choice.reason}</div> :
        <div className="notice">UTC preview: {choice.publishAt}
          {choice.warning && <> · {choice.warning.kind} · adjustment {
            choice.warning.adjustmentMinutes} minutes
            {choice.warning.alternativeUtcInstant &&
              ` · alternative ${choice.warning.alternativeUtcInstant}`}</>}</div>}
      <div className="dialog-actions"><button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !choice.publishAt}
          onClick={() => choice.publishAt && void onMove(choice.publishAt)}>Move entry</button></div>
    </div>
  </div>;
}

function PublishDialog({
  entry, busy, onClose, onPublish
}: {
  entry: ScheduleEntry;
  busy: boolean;
  onClose: () => void;
  onPublish: (youtubeUrl: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const valid = !url || isYoutubeUrl(url);
  return <div className="dialog-backdrop" role="presentation">
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="publish-title">
      <h2 id="publish-title">Permanently record publication?</h2>
      <p>This irreversible action locks the schedule entry. It neither uploads the video nor verifies remote publication.</p>
      <label>Optional HTTPS YouTube URL<input value={url}
        placeholder="https://youtu.be/…" onChange={(event) => setUrl(event.target.value)} /></label>
      {!valid && <div className="error-box" role="alert">
        Use an HTTPS youtube.com or youtu.be URL.</div>}
      {entry.needsRerender && <div className="error-box">Rerender is required before publication.</div>}
      <div className="dialog-actions"><button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !valid || entry.needsRerender}
          onClick={() => void onPublish(url)}>Confirm permanent lock</button></div>
    </div>
  </div>;
}

function isYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]
        .includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function describeScheduleError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "SCHEDULE_COLLISION") return `Schedule collision: ${error.message}`;
    if (error.code === "REVISION_CONFLICT") return `Stale revision: ${error.message}`;
    if (error.code === "INVALID_STATE") return `Invalid schedule state: ${error.message}`;
  }
  return errorMessage(error, "Schedule operation failed");
}
