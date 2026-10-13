import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { createEvent, deleteEvent, listAllEvents, purgeBiometrics, updateEvent, uploadCover, type EventInput } from "../../api/adminEvents";
import { getEventStats, type EventStats } from "../../api/adminStats";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { CityCombobox } from "../../components/CityCombobox";
import { FormField } from "../../components/FormField";
import { Place } from "../../components/Place";
import { Badge, Button, ConfirmDialog, DateTimeField, EmptyState, Skeleton, SkeletonTable, useToast, type BadgeTone } from "../../components/ui";
import { formatDateTime, formatPrice, localeFor, parsePriceToCents } from "../../format";
import type { City } from "../../data/cities";
import { composeLocation, findCity, splitLocation } from "../../data/cityMatch";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { TranslationKey } from "../../i18n/en";
import type { Lang } from "../../i18n/translate";
import { CARD_CELL } from "./cardCells";

const STATUS_TONE: Record<Event["status"], BadgeTone> = {
  DRAFT: "neutral",
  ACTIVE: "ok",
  CLOSED: "neutral",
};

/** `cover`: the event was created but its cover upload failed; the editor offers a retry. */
type Editing = { mode: "new" } | { mode: "edit"; event: Event; cover?: { file: File; error: string } } | null;

/** A Close or Delete waiting for the admin's OK. */
type Pending = { kind: "close" | "delete" | "purge"; event: Event } | null;

const CONFIRM_TEXT = {
  close: { title: "aevents.confirmClose.title", message: "aevents.confirmClose.message", yes: "aevents.confirmClose.yes" },
  delete: { title: "aevents.confirmDelete.title", message: "aevents.confirmDelete.message", yes: "aevents.confirmDelete.yes" },
  purge: { title: "aevents.confirmPurge.title", message: "aevents.confirmPurge.message", yes: "aevents.confirmPurge.yes" },
} as const satisfies Record<NonNullable<Pending>["kind"], Record<string, TranslationKey>>;

/** Faces are only needed at the gate: once an event is closed or over, they can go. */
const canPurge = (event: Event) => event.status === "CLOSED" || new Date(event.ends_at).getTime() <= Date.now();

/** FSI…PDI isolate a (often Latin) name inside a Hebrew sentence, like <bdi> in a string. */
const isolate = (text: string) => `⁨${text}⁩`;

export function EventsAdminPage() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const { t, lang } = useLanguage();
  const toast = useToast();

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

  const markBusy = (id: number, on: boolean) =>
    setBusy((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * Optimistic UI: the list shows the result at once; a failed call puts the event back
   * where it was and explains why in its row.
   */
  async function mutate(event: Event, optimistic: Event | null, call: () => Promise<Event | void>, done: string, errors: Record<number, string> = {}) {
    const index = events?.findIndex((e) => e.id === event.id) ?? -1;
    setRowErrors(({ [event.id]: _, ...rest }) => rest);
    markBusy(event.id, true);
    setEvents((list) => list && (optimistic ? list.map((e) => (e.id === event.id ? optimistic : e)) : list.filter((e) => e.id !== event.id)));
    try {
      const result = await call();
      if (result) setEvents((list) => list && list.map((e) => (e.id === result.id ? result : e)));
      toast.success(done);
    } catch (err) {
      setEvents((list) => {
        if (!list) return list;
        if (optimistic) return list.map((e) => (e.id === event.id ? event : e));
        const restored = [...list];
        restored.splice(Math.min(index, restored.length), 0, event);
        return restored;
      });
      setRowErrors((all) => ({ ...all, [event.id]: apiErrorMessage(err, errors, lang) }));
    } finally {
      markBusy(event.id, false);
    }
  }

  const name = (event: Event) => isolate(event.name);
  const activate = (event: Event) =>
    mutate(event, { ...event, status: "ACTIVE" }, () => updateEvent(event.id, { status: "ACTIVE" }),
      t("aevents.toast.activated", { name: name(event) }), { 503: t("aevents.activateFaceDown") });

  /** Not optimistic: the event itself doesn't change, only its faces go. The toast says how many. */
  async function purge(event: Event) {
    setRowErrors(({ [event.id]: _, ...rest }) => rest);
    markBusy(event.id, true);
    try {
      const { deleted_profiles: count } = await purgeBiometrics(event.id);
      toast.success(count === 0 ? t("aevents.toast.purgedNone", { name: name(event) })
        : t(count === 1 ? "aevents.toast.purged.one" : "aevents.toast.purged.other", { name: name(event), count: new Intl.NumberFormat(localeFor(lang)).format(count) }));
    } catch (err) {
      setRowErrors((all) => ({ ...all, [event.id]: apiErrorMessage(err, { 409: t("aevents.purgeStillOpen"), 503: t("aevents.purgeFaceDown") }, lang) }));
    } finally {
      markBusy(event.id, false);
    }
  }

  function confirmPending() {
    if (!confirming) return;
    const { kind, event } = confirming;
    setConfirming(null);
    if (kind === "purge") {
      void purge(event);
    } else if (kind === "close") {
      void mutate(event, { ...event, status: "CLOSED" }, () => updateEvent(event.id, { status: "CLOSED" }), t("aevents.toast.closed", { name: name(event) }));
    } else {
      void mutate(event, null, () => deleteEvent(event.id), t("aevents.toast.deleted", { name: name(event) }));
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("aevents.title")}</h1>
        <Button onClick={() => setEditing({ mode: "new" })}>{t("aevents.new")}</Button>
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
      {!events && !error && <SkeletonTable rows={4} columns={5} />}
      {events && events.length === 0 && (
        <EmptyState title={t("aevents.empty")} action={<Button variant="secondary" onClick={() => setEditing({ mode: "new" })}>{t("aevents.new")}</Button>} />
      )}
      {events && events.length > 0 && (
        // Under `sm` the same rows lay out as stacked cards (CSS only), so nothing scrolls sideways.
        <div className="rounded-lg border border-slate-200 bg-white max-sm:border-0 max-sm:bg-transparent">
          <table className="w-full text-start text-sm max-sm:block">
            <thead className="bg-slate-50 text-slate-600 max-sm:hidden">
              <tr>
                <th className="w-10 px-2 py-2"><span className="sr-only">{t("aevents.col.details")}</span></th>
                <th className="px-3 py-2 text-start">{t("aevents.col.name")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.starts")}</th>
                <th className="px-3 py-2 text-start">{t("aevents.col.status")}</th>
                <th className="px-3 py-2 text-end">{t("aevents.col.price")}</th>
                <th className="px-3 py-2 text-end">{t("aevents.col.capacity")}</th>
                <th className="px-3 py-2"><span className="sr-only">{t("aevents.col.actions")}</span></th>
              </tr>
            </thead>
            <tbody className="max-sm:block max-sm:space-y-3">
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  busy={busy.has(event.id)}
                  error={rowErrors[event.id] ?? null}
                  onEdit={() => setEditing({ mode: "edit", event })}
                  onActivate={() => void activate(event)}
                  onClose={() => setConfirming({ kind: "close", event })}
                  onDelete={() => setConfirming({ kind: "delete", event })}
                  onPurge={() => setConfirming({ kind: "purge", event })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirming !== null}
        tone={confirming?.kind === "close" ? "default" : "danger"}
        title={confirming ? t(CONFIRM_TEXT[confirming.kind].title, { name: name(confirming.event) }) : ""}
        message={confirming && t(CONFIRM_TEXT[confirming.kind].message)}
        confirmLabel={confirming ? t(CONFIRM_TEXT[confirming.kind].yes) : ""}
        cancelLabel={t("aevents.confirm.keep")}
        onConfirm={confirmPending}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

interface EventRowProps {
  event: Event;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onActivate: () => void;
  onClose: () => void;
  onDelete: () => void;
  onPurge: () => void;
}

function EventRow({ event, busy, error, onEdit, onActivate, onClose, onDelete, onPurge }: EventRowProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { t, lang } = useLanguage();
  const free = event.price_cents === 0;

  return (
    <>
      <tr className={`border-t border-slate-100 align-top transition-colors hover:bg-slate-50/70 max-sm:relative max-sm:block max-sm:rounded-card max-sm:border max-sm:border-slate-200 max-sm:bg-white max-sm:p-2 max-sm:shadow-card ${open ? "bg-slate-50/70" : ""}`}>
        <td className="px-2 py-2 max-sm:absolute max-sm:end-2 max-sm:top-2 max-sm:p-0">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={detailsId}
            aria-label={t("aevents.details", { name: event.name })}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-brand-500 max-sm:h-11 max-sm:w-11">
            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform rtl:-scale-x-100 ${open ? "rotate-90 rtl:-rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </td>
        <td className="px-3 py-2 max-sm:block max-sm:pe-12">
          <div className="font-medium"><bdi>{event.name}</bdi></div>
          <Place location={event.location} className="text-slate-500" />
          <ErrorBox message={error} />
        </td>
        <td className={`${CARD_CELL} whitespace-nowrap`} data-label={t("aevents.col.starts")}>{formatDateTime(event.starts_at, lang)}</td>
        <td className={CARD_CELL} data-label={t("aevents.col.status")}>
          <Badge tone={STATUS_TONE[event.status]} className={event.status === "CLOSED" ? "opacity-70" : ""}>
            {event.status === "ACTIVE" && <span className="h-1.5 w-1.5 rounded-full bg-ok-500" aria-hidden="true" />}
            {t(`aevents.badge.${event.status}`)}
          </Badge>
        </td>
        <td className={`${CARD_CELL} whitespace-nowrap text-end tabular-nums`} data-label={t("aevents.col.price")}>
          {free ? <span className="font-medium text-ok-700">{t("aevents.free")}</span> : formatPrice(event.price_cents, event.currency, lang)}
        </td>
        <td className={`${CARD_CELL} text-end tabular-nums`} data-label={t("aevents.col.capacity")}>{new Intl.NumberFormat(localeFor(lang)).format(event.capacity)}</td>
        <td className="px-3 py-2 max-sm:block max-sm:pt-2">
          <div className="flex flex-nowrap justify-end gap-2 max-sm:justify-start" aria-label={t("aevents.actionsFor", { name: event.name })}>
            <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy} className="max-sm:min-h-11">{t("aevents.edit")}</Button>
            {event.status === "DRAFT" && (
              <Button variant="secondary" size="sm" onClick={onActivate} disabled={busy} className="max-sm:min-h-11">{t("aevents.activate")}</Button>
            )}
            {event.status === "ACTIVE" && (
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy} className="max-sm:min-h-11">{t("aevents.close")}</Button>
            )}
            {event.status === "DRAFT" && (
              <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy} className="text-deny-700! hover:bg-deny-50 max-sm:min-h-11">{t("aevents.delete")}</Button>
            )}
            {canPurge(event) && (
              <Button variant="ghost" size="sm" onClick={onPurge} disabled={busy} className="text-deny-700! hover:bg-deny-50 max-sm:min-h-11">{t("aevents.purge")}</Button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr id={detailsId} className="max-sm:-mt-3 max-sm:block">
          <td colSpan={7} className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 max-sm:block max-sm:rounded-b-card max-sm:border max-sm:border-t-0 max-sm:border-slate-200">
            <EventDetails event={event} />
          </td>
        </tr>
      )}
    </>
  );
}

type StatsState = { kind: "loading" } | { kind: "ok"; stats: EventStats } | { kind: "error" };

/** The expanded row: cover, full dates, place, and how many tickets are sold (fetched on open). */
function EventDetails({ event }: { event: Event }) {
  const [state, setState] = useState<StatsState>({ kind: "loading" });
  const { t, lang } = useLanguage();
  const number = new Intl.NumberFormat(localeFor(lang));

  useEffect(() => {
    let live = true;
    getEventStats(event.id).then(
      (stats) => live && setState({ kind: "ok", stats }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [event.id]);

  const occupancy = state.kind === "ok" ? state.stats.occupancy : null;
  const pct = (n: number) => (event.capacity > 0 ? `${Math.min(100, (n / event.capacity) * 100)}%` : "0%");
  return (
    <div className="grid animate-fade-in gap-4 sm:grid-cols-[12rem_1fr]">
      {event.cover_image_url ? (
        <img src={event.cover_image_url} alt={t("aevents.coverPreview")} className="aspect-[2/1] w-full rounded-lg object-cover" />
      ) : (
        <div className="grid aspect-[2/1] w-full place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">{t("aevents.detail.noCover")}</div>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">{t("aevents.detail.when")}</dt>
          <dd className="tabular-nums">{formatDateTime(event.starts_at, lang)} – {formatDateTime(event.ends_at, lang)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("aevents.detail.where")}</dt>
          <dd><Place location={event.location} /></dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">{t("aevents.detail.tickets")}</dt>
          <dd aria-live="polite">
            {state.kind === "loading" && <Skeleton className="mt-1 h-4 w-48" />}
            {state.kind === "error" && <span className="text-deny-700">{t("aevents.detail.statsFailed")}</span>}
            {occupancy && (
              <div className="max-w-md">
                <div className="flex items-baseline justify-between tabular-nums">
                  <span className="font-medium">{t("aevents.detail.sold", { sold: number.format(occupancy.sold), capacity: number.format(event.capacity) })}</span>
                  <span className="text-xs text-slate-500">{t("aevents.detail.entered", { entered: number.format(occupancy.entered) })}</span>
                </div>
                <div role="meter" aria-label={t("aevents.detail.tickets")} aria-valuemin={0} aria-valuemax={event.capacity} aria-valuenow={occupancy.sold}
                  className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="absolute inset-y-0 start-0 rounded-full bg-brand-300 transition-[width] duration-500" style={{ width: pct(occupancy.sold) }} />
                  <div className="absolute inset-y-0 start-0 rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: pct(occupancy.entered) }} />
                </div>
              </div>
            )}
          </dd>
        </div>
      </dl>
    </div>
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
