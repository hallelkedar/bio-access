import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { createEvent, deleteEvent, listAllEvents, updateEvent, uploadCover, type EventInput } from "../../api/adminEvents";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { CityCombobox } from "../../components/CityCombobox";
import { FormField } from "../../components/FormField";
import { Spinner } from "../../components/Spinner";
import { Button, DateTimeField } from "../../components/ui";
import { formatDateTime, formatPrice, localeFor, parsePriceToCents } from "../../format";
import type { City } from "../../data/cities";
import { composeLocation, findCity, splitLocation } from "../../data/cityMatch";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { TranslationKey } from "../../i18n/en";
import type { Lang } from "../../i18n/translate";

const STATUS_STYLE: Record<Event["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-500",
};

/** `cover`: the event was created but its cover upload failed; the editor offers a retry. */
type Editing = { mode: "new" } | { mode: "edit"; event: Event; cover?: { file: File; error: string } } | null;

export function EventsAdminPage() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const { t, lang } = useLanguage();

  const load = useCallback(async () => {
    setError(null);
    try {
      setEvents(await listAllEvents());
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  function saved() {
    setEditing(null);
    void load();
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("aevents.title")}</h1>
        <button type="button" onClick={() => setEditing({ mode: "new" })} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          {t("aevents.new")}
        </button>
      </div>
      {editing && (
        <EventForm
          key={editing.mode === "edit" ? editing.event.id : "new"}
          event={editing.mode === "edit" ? editing.event : null}
          pendingCover={editing.mode === "edit" ? editing.cover : undefined}
          onSaved={saved}
          onCoverChanged={() => void load()}
          onCreatedCoverFailed={(created, file, message) => {
            setEditing({ mode: "edit", event: created, cover: { file, error: message } });
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <ErrorBox message={error} />
      {!events && !error && <Spinner label={t("aevents.loading")} />}
      {events && events.length === 0 && <p className="text-slate-600">{t("aevents.empty")}</p>}
      {events && events.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-start text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start">{t("aevents.col.name")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.starts")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.status")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.price")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.capacity")}</th>
                <th className="px-3 py-2"><span className="sr-only">{t("aevents.col.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <EventRow key={event.id} event={event} onEdit={() => setEditing({ mode: "edit", event })} onChanged={() => void load()} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EventRow({ event, onEdit, onChanged }: { event: Event; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  async function run(action: () => Promise<unknown>, errors: Record<number, string> = {}) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, errors, lang));
    } finally {
      setBusy(false);
    }
  }

  const activate = () =>
    run(() => updateEvent(event.id, { status: "ACTIVE" }), {
      503: t("aevents.activateFaceDown"),
    });
  const close = () => run(() => updateEvent(event.id, { status: "CLOSED" }));
  const remove = () => {
    if (window.confirm(t("aevents.confirmDelete", { name: event.name }))) void run(() => deleteEvent(event.id));
  };

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{event.name}</div>
        <div className="text-slate-500">{event.location}</div>
        <ErrorBox message={error} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(event.starts_at, lang)}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[event.status]}`}>{t(`aevents.badge.${event.status}`)}</span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{formatPrice(event.price_cents, event.currency, lang)}</td>
      <td className="px-3 py-2">{event.capacity}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-2" aria-label={t("aevents.actionsFor", { name: event.name })}>
          <button type="button" onClick={onEdit} disabled={busy} className="rounded border px-2 py-1">{t("aevents.edit")}</button>
          {event.status === "DRAFT" && (
            <button type="button" onClick={() => void activate()} disabled={busy} className="rounded border px-2 py-1">{t("aevents.activate")}</button>
          )}
          {event.status === "ACTIVE" && (
            <button type="button" onClick={() => void close()} disabled={busy} className="rounded border px-2 py-1">{t("aevents.close")}</button>
          )}
          {event.status === "DRAFT" && (
            <button type="button" onClick={remove} disabled={busy} className="rounded border border-red-200 px-2 py-1 text-red-700">{t("aevents.delete")}</button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** How far in the past a new event may start: "starting now" must work for the live demo. */
export const START_GRACE_MS = 5 * 60_000;

/**
 * Date rules for the event form (translation keys, or nothing). A new event can't start in
 * the past (with the grace window); an edited one keeps its dates. The end must be after
 * the start, like the database check ck_events_ends_after_starts.
 */
export function eventDateProblems(startsAt: string | null, endsAt: string | null, creating: boolean, now: Date) {
  const problems: { starts?: TranslationKey; ends?: TranslationKey } = {};
  if (creating && startsAt && new Date(startsAt).getTime() < now.getTime() - START_GRACE_MS) problems.starts = "aevents.startInPast";
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) problems.ends = "aevents.endBeforeStart";
  return problems;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfToday(): Date {
  return startOfDay(new Date());
}

const DURATIONS: { key: TranslationKey; end: (start: Date) => Date }[] = [
  { key: "aevents.duration.1h", end: (start) => new Date(start.getTime() + 60 * 60_000) },
  { key: "aevents.duration.2h", end: (start) => new Date(start.getTime() + 2 * 60 * 60_000) },
  { key: "aevents.duration.3h", end: (start) => new Date(start.getTime() + 3 * 60 * 60_000) },
  { key: "aevents.duration.allDay", end: (start) => new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59) },
];

/** "Asia/Jerusalem (GMT+2)": where the typed times live. */
function timeZoneName(lang: Lang): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Intl.DateTimeFormat(localeFor(lang), { timeZoneName: "shortOffset" })
    .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
  return offset ? `${zone} (${offset})` : zone;
}

interface EventFormProps {
  event: Event | null;
  pendingCover?: { file: File; error: string };
  onSaved: () => void;
  onCoverChanged: () => void;
  /** Create succeeded but the cover didn't: switch to editing the new event (no duplicate on retry). */
  onCreatedCoverFailed: (created: Event, file: File, message: string) => void;
  onCancel: () => void;
}

/** An event's stored location as the form's two fields; an unlisted city leaves City empty. */
function initialPlace(location: string | undefined): { venue: string; city: City | null; unmatched: string } {
  if (!location) return { venue: "", city: null, unmatched: "" };
  const { venue, cityText } = splitLocation(location);
  if (!cityText) {
    const whole = findCity(venue); // an old "Tel Aviv" is just a city
    return whole ? { venue: "", city: whole, unmatched: "" } : { venue, city: null, unmatched: venue };
  }
  const city = findCity(cityText);
  return { venue, city, unmatched: city ? "" : cityText };
}

function EventForm({ event, pendingCover, onSaved, onCoverChanged, onCreatedCoverFailed, onCancel }: EventFormProps) {
  const [initial] = useState(() => initialPlace(event?.location));
  const [venue, setVenue] = useState(initial.venue);
  const [city, setCity] = useState<City | null>(initial.city);
  const [placeErrors, setPlaceErrors] = useState<{ venue?: string; city?: string }>({});
  // An old location the picker can't read is kept as it was until venue or city changes,
  // so the API never sees it as a change (it only checks changed locations).
  const placeTouched = venue !== initial.venue || city !== initial.city;
  const [form, setForm] = useState({
    name: event?.name ?? "",
    starts_at: event?.starts_at ?? null,
    ends_at: event?.ends_at ?? null,
    capacity: event ? String(event.capacity) : "",
    price: event ? (event.price_cents / 100).toFixed(2) : "",
    currency: event?.currency ?? "ILS",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCover, setNewCover] = useState<File | null>(null); // New event: uploaded right after create
  const { t, lang } = useLanguage();

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });
  const setDate = (field: "starts_at" | "ends_at") => (value: string | null) => setForm((f) => ({ ...f, [field]: value }));
  // Checked on every render against the current clock, so the inline messages stay honest.
  const dateProblems = eventDateProblems(form.starts_at, form.ends_at, event === null, new Date());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const priceCents = parsePriceToCents(form.price);
    const capacity = Number(form.capacity);
    if (priceCents === null) return setError(t("aevents.badPrice"));
    if (!Number.isInteger(capacity) || capacity < 1) return setError(t("aevents.badCapacity"));
    const startsAt = form.starts_at;
    const endsAt = form.ends_at;
    if (!startsAt || !endsAt) return setError(t("aevents.missingDates"));
    const problems = eventDateProblems(startsAt, endsAt, event === null, new Date()); // the clock at submit
    if (problems.starts || problems.ends) return setError(t(problems.starts ?? problems.ends!));
    const keepLocation = event !== null && !placeTouched;
    if (!keepLocation) {
      const missing = { venue: venue.trim() ? undefined : t("aevents.venueRequired"), city: city ? undefined : t("aevents.cityRequired") };
      setPlaceErrors(missing);
      if (missing.venue || missing.city) return setError(missing.venue ?? missing.city!);
    }
    const input: EventInput = {
      name: form.name.trim(),
      location: keepLocation ? event!.location : composeLocation(venue, city!),
      starts_at: startsAt,
      ends_at: endsAt,
      capacity,
      price_cents: priceCents,
      currency: form.currency.trim().toUpperCase(),
    };
    setSaving(true);
    setError(null);
    try {
      if (event) {
        const { location, ...rest } = input;
        await updateEvent(event.id, keepLocation ? rest : { ...rest, location });
      } else {
        const created = await createEvent(input);
        if (newCover) {
          try {
            await uploadCover(created.id, newCover);
          } catch (err) {
            const reason = apiErrorMessage(err, { 413: t("aevents.coverTooLarge"), 415: t("aevents.coverBadType") }, lang);
            return onCreatedCoverFailed(created, newCover, t("aevents.coverAfterCreateFailed", { reason }));
          }
        }
      }
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{event ? t("aevents.editTitle", { name: event.name }) : t("aevents.newTitle")}</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField label={t("aevents.field.name")} name="name" required value={form.name} onChange={set("name")} />
        <FormField label={t("aevents.field.venue")} name="venue" required maxLength={100} value={venue}
          onChange={(e) => { setVenue(e.target.value); setPlaceErrors((p) => ({ ...p, venue: undefined })); }}
          hint={placeErrors.venue} />
        <CityCombobox label={t("aevents.field.city")} id="city" required value={city}
          onChange={(next) => { setCity(next); setPlaceErrors((p) => ({ ...p, city: undefined })); }}
          error={placeErrors.city}
          hint={!city && initial.unmatched && !placeTouched ? t("aevents.cityLegacy", { city: initial.unmatched }) : null} />
        <DateTimeField label={t("aevents.field.starts")} name="starts_at" id="starts_at" required defaultTime="19:00"
          value={form.starts_at} onChange={setDate("starts_at")}
          min={event === null ? startOfToday().toISOString() : null}
          error={dateProblems.starts ? t(dateProblems.starts) : null} />
        <div>
          <DateTimeField label={t("aevents.field.ends")} name="ends_at" id="ends_at" required defaultTime="22:00"
            value={form.ends_at} onChange={setDate("ends_at")}
            min={form.starts_at ? startOfDay(new Date(form.starts_at)).toISOString() : null}
            error={dateProblems.ends ? t(dateProblems.ends) : null} />
          {form.starts_at && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("aevents.duration")}>
              {DURATIONS.map(({ key, end }) => (
                <button key={key} type="button" onClick={() => setDate("ends_at")(end(new Date(form.starts_at!)).toISOString())}
                  className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50">
                  {t(key)}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="-mt-2 text-xs text-slate-500 sm:col-span-2">
          {t("aevents.timeZone")} <bdi dir="ltr">{timeZoneName(lang)}</bdi>
        </p>
        <FormField label={t("aevents.field.capacity")} name="capacity" type="number" min={1} required value={form.capacity} onChange={set("capacity")} />
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <FormField label={t("aevents.field.price")} name="price" inputMode="decimal" placeholder="50.00" required value={form.price} onChange={set("price")} />
          <FormField label={t("aevents.field.currency")} name="currency" maxLength={3} required value={form.currency} onChange={set("currency")} />
        </div>
        <div className="sm:col-span-2">
          {/* Above Save/Create, so a new event's picture is chosen before it is created */}
          {event ? (
            <CoverUpload event={event} onUploaded={onCoverChanged} initialFile={pendingCover?.file} initialError={pendingCover?.error} />
          ) : (
            <CoverUpload event={null} onPendingChange={setNewCover} />
          )}
        </div>
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        <div className="flex gap-3 sm:col-span-2">
          <button type="submit" disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {saving ? t("aevents.saving") : event ? t("aevents.save") : t("aevents.create")}
          </button>
          <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2">{t("aevents.cancel")}</button>
        </div>
      </form>
    </div>
  );
}

const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_MAX_BYTES = 2 * 1024 * 1024; // the backend's limit, checked here first to save a round trip

function formatFileSize(bytes: number, lang: Lang): string {
  const mb = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(localeFor(lang), {
    style: "unit",
    unit: mb ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(mb ? bytes / (1024 * 1024) : bytes / 1024);
}

/**
 * Drop zone for the event cover. The big label next to the hidden file input (not around
 * it) is the click target, so one click opens the picker exactly once. The zone is also the
 * keyboard target (Enter or Space), since browsers differ on opening a focused file input.
 * Files can be dragged onto it too.
 */
type CoverUploadProps =
  | { event: Event; onUploaded: () => void; initialFile?: File; initialError?: string }
  /** New event: no id yet, so the parent holds the file and uploads it after creating. */
  | { event: null; onPendingChange: (file: File | null) => void };

function CoverUpload(props: CoverUploadProps) {
  const { event } = props;
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFileState] = useState<File | null>(event ? props.initialFile ?? null : null);
  const [preview, setPreview] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(event ? props.initialError ?? null : null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { t, lang } = useLanguage();

  function setFile(next: File | null) {
    setFileState(next);
    if (!props.event) props.onPendingChange(next);
  }

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(picked: File | undefined) {
    setError(null);
    setSavedUrl((url) => (picked ? null : url));
    if (!picked) return;
    if (!COVER_TYPES.includes(picked.type)) return setError(t("aevents.coverBadType"));
    if (picked.size > COVER_MAX_BYTES) return setError(t("aevents.coverTooLarge"));
    setFile(picked);
  }

  async function upload() {
    if (!file || !props.event) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadCover(props.event.id, file);
      setSavedUrl(updated.cover_image_url ?? preview);
      setFile(null);
      props.onUploaded();
    } catch (err) {
      setError(apiErrorMessage(err, { 413: t("aevents.coverTooLarge"), 415: t("aevents.coverBadType") }, lang));
    } finally {
      setUploading(false);
    }
  }

  const shown = preview ?? savedUrl ?? event?.cover_image_url;
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h3 className="font-medium">{t("aevents.coverTitle")}</h3>
      <input ref={input} id={inputId} type="file" accept={COVER_TYPES.join(",")} aria-label={t("aevents.chooseCover")} tabIndex={-1} className="sr-only"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = ""; // picking the same file again must still fire onChange
        }} />
      <label
        htmlFor={inputId}
        tabIndex={0}
        role="button"
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          input.current?.click();
        }}
        data-dragging={dragging || undefined}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-card border-2 border-dashed px-6 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
          shown ? "aspect-[2/1] w-full max-w-md" : "min-h-40" /* same shape as the visitor's event card */
        } ${
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/60"
        }`}
      >
        {shown ? (
          <>
            <img src={shown} alt={t("aevents.coverPreview")} className="absolute inset-0 h-full w-full object-cover" />
            <span className="relative rounded-full bg-slate-900/75 px-3 py-1.5 text-sm font-medium text-white opacity-90 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              {t("aevents.coverReplace")}
            </span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-9 w-9 text-brand-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <circle cx="9" cy="10" r="1.8" />
              <path d="M21 16l-5-5-8 8" />
            </svg>
            <span className="text-sm font-medium text-slate-800">{t("aevents.coverDrop")}</span>
            <span className="text-xs text-slate-500">{t("aevents.coverHint")}</span>
          </>
        )}
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {file && (
          <>
            <span className="min-w-0 truncate text-slate-700"><bdi className="font-medium">{file.name}</bdi> · {formatFileSize(file.size, lang)}</span>
            <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={uploading}>{t("aevents.coverClear")}</Button>
          </>
        )}
        {savedUrl && !file && <span role="status" className="font-medium text-emerald-700">{t("aevents.coverSaved")}</span>}
        {event ? (
          <Button variant="secondary" size="sm" className="ms-auto" onClick={() => void upload()} disabled={!file} loading={uploading}>
            {uploading ? t("aevents.uploading") : t("aevents.upload")}
          </Button>
        ) : (
          <span className="ms-auto text-xs text-slate-500">{t("aevents.coverOnCreate")}</span>
        )}
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
