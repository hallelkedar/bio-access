import { useCallback, useEffect, useState, type FormEvent } from "react";

import { createEvent, deleteEvent, listAllEvents, updateEvent, uploadCover, type EventInput } from "../../api/adminEvents";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { FormField } from "../../components/FormField";
import { Spinner } from "../../components/Spinner";
import { formatDateTime, formatPrice, fromLocalInput, parsePriceToCents, toLocalInput } from "../../format";

const STATUS_STYLE: Record<Event["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-500",
};

type Editing = { mode: "new" } | { mode: "edit"; event: Event } | null;

export function EventsAdminPage() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEvents(await listAllEvents());
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, []);

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
        <h1 className="text-2xl font-bold">Events</h1>
        <button type="button" onClick={() => setEditing({ mode: "new" })} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          New event
        </button>
      </div>
      {editing && (
        <EventForm
          key={editing.mode === "edit" ? editing.event.id : "new"}
          event={editing.mode === "edit" ? editing.event : null}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
      <ErrorBox message={error} />
      {!events && !error && <Spinner label="Loading events…" />}
      {events && events.length === 0 && <p className="text-slate-600">No events yet. Create the first one.</p>}
      {events && events.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Starts</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Capacity</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
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

  async function run(action: () => Promise<unknown>, errors: Record<number, string> = {}) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, errors));
    } finally {
      setBusy(false);
    }
  }

  const activate = () =>
    run(() => updateEvent(event.id, { status: "ACTIVE" }), {
      503: "The face service is unavailable, so the event can't be activated yet. Try again shortly.",
    });
  const close = () => run(() => updateEvent(event.id, { status: "CLOSED" }));
  const remove = () => {
    if (window.confirm(`Delete "${event.name}"? This can't be undone.`)) void run(() => deleteEvent(event.id));
  };

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{event.name}</div>
        <div className="text-slate-500">{event.location}</div>
        <ErrorBox message={error} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(event.starts_at)}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[event.status]}`}>{event.status}</span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{formatPrice(event.price_cents, event.currency)}</td>
      <td className="px-3 py-2">{event.capacity}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-2" aria-label={`Actions for ${event.name}`}>
          <button type="button" onClick={onEdit} disabled={busy} className="rounded border px-2 py-1">Edit</button>
          {event.status === "DRAFT" && (
            <button type="button" onClick={() => void activate()} disabled={busy} className="rounded border px-2 py-1">Activate</button>
          )}
          {event.status === "ACTIVE" && (
            <button type="button" onClick={() => void close()} disabled={busy} className="rounded border px-2 py-1">Close</button>
          )}
          {event.status === "DRAFT" && (
            <button type="button" onClick={remove} disabled={busy} className="rounded border border-red-200 px-2 py-1 text-red-700">Delete</button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EventForm({ event, onSaved, onCancel }: { event: Event | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: event?.name ?? "",
    location: event?.location ?? "",
    starts_at: event ? toLocalInput(event.starts_at) : "",
    ends_at: event ? toLocalInput(event.ends_at) : "",
    capacity: event ? String(event.capacity) : "",
    price: event ? (event.price_cents / 100).toFixed(2) : "",
    currency: event?.currency ?? "ILS",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const priceCents = parsePriceToCents(form.price);
    const capacity = Number(form.capacity);
    if (priceCents === null) return setError("Price must be a number like 50 or 49.90.");
    if (!Number.isInteger(capacity) || capacity < 1) return setError("Capacity must be a whole number above 0.");
    if (!form.starts_at || !form.ends_at) return setError("Start and end are required.");
    const input: EventInput = {
      name: form.name.trim(),
      location: form.location.trim(),
      starts_at: fromLocalInput(form.starts_at),
      ends_at: fromLocalInput(form.ends_at),
      capacity,
      price_cents: priceCents,
      currency: form.currency.trim().toUpperCase(),
    };
    setSaving(true);
    setError(null);
    try {
      if (event) await updateEvent(event.id, input);
      else await createEvent(input);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{event ? `Edit ${event.name}` : "New event"}</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField label="Name" name="name" required value={form.name} onChange={set("name")} />
        <FormField label="Location" name="location" required value={form.location} onChange={set("location")} />
        <FormField label="Starts" name="starts_at" type="datetime-local" required value={form.starts_at} onChange={set("starts_at")} />
        <FormField label="Ends" name="ends_at" type="datetime-local" required value={form.ends_at} onChange={set("ends_at")} />
        <FormField label="Capacity" name="capacity" type="number" min={1} required value={form.capacity} onChange={set("capacity")} />
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <FormField label="Price" name="price" inputMode="decimal" placeholder="50.00" required value={form.price} onChange={set("price")} />
          <FormField label="Currency" name="currency" maxLength={3} required value={form.currency} onChange={set("currency")} />
        </div>
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        <div className="flex gap-3 sm:col-span-2">
          <button type="submit" disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {saving ? "Saving…" : event ? "Save changes" : "Create event"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2">Cancel</button>
        </div>
      </form>
      {event && <CoverUpload event={event} onUploaded={onSaved} />}
    </div>
  );
}

function CoverUpload({ event, onUploaded }: { event: Event; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadCover(event.id, file);
      onUploaded();
    } catch (err) {
      setError(apiErrorMessage(err, {
        413: "The image is too large (max 2 MB).",
        415: "Use a real JPEG, PNG or WebP image.",
      }));
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h3 className="font-medium">Cover image</h3>
      {(preview ?? event.cover_image_url) && (
        <img src={preview ?? event.cover_image_url ?? undefined} alt="Cover preview" className="h-32 rounded object-cover" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Choose cover image</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose cover image"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" onClick={() => void upload()} disabled={!file || uploading}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">
          {uploading ? "Uploading…" : "Upload cover"}
        </button>
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
