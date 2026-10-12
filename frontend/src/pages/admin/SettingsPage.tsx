import { useEffect, useState } from "react";

import { getSettings, updateThreshold, type ThresholdSettings } from "../../api/admin";
import { apiErrorMessage } from "../../api/errors";
import { ErrorBox } from "../../components/ErrorBox";
import { Badge, Button, Card, ConfirmDialog, SkeletonText, useToast } from "../../components/ui";
import { useLanguage } from "../../i18n/LanguageProvider";

const MIN = 80;
const MAX = 100;

/** Where `value` sits on the MIN–MAX track, as a CSS percentage (clamped). */
export function trackPercent(value: number): string {
  const ratio = (Math.min(MAX, Math.max(MIN, value)) - MIN) / (MAX - MIN);
  return `${ratio * 100}%`;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<ThresholdSettings | null>(null);
  const [value, setValue] = useState(95);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { t, lang } = useLanguage();
  const toast = useToast();

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setValue(s.face_match_threshold);
      })
      .catch((err) => setError(apiErrorMessage(err, {}, lang)));
  }, []);

  const dirty = settings !== null && value !== settings.face_match_threshold;

  // Leaving the tab with an unsaved value asks first (the browser shows its own wording).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (error && !settings) return <ErrorBox message={error} />;
  if (!settings) return <SkeletonText lines={4} className="max-w-xl" />;

  const valid = value >= MIN && value <= MAX;
  const isDefault = settings.face_match_threshold === settings.default_face_match_threshold;

  async function save(next: number) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateThreshold(next);
      setSettings(updated);
      setValue(updated.face_match_threshold);
      toast.success(t("settings.saved"));
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("settings.thresholdTitle")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("settings.thresholdHelp")}</p>
          </div>
          <Badge tone={settings.source === "database" ? "brand" : "neutral"}>
            {settings.source === "database" ? t("settings.custom") : t("settings.usingDefault")}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <input type="range" min={MIN} max={MAX} step={0.5} value={value} aria-label={t("settings.slider")}
              onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-brand-600" />
            {/* A tick under the track marks the .env default. */}
            <span aria-hidden="true" className="pointer-events-none absolute top-full mt-0.5 -translate-x-1/2 rtl:translate-x-1/2 text-[10px] leading-none text-slate-500"
              style={{ insetInlineStart: trackPercent(settings.default_face_match_threshold) }}>
              ▲
            </span>
          </div>
          <input type="number" min={MIN} max={MAX} step={0.5} value={value} aria-label={t("settings.value")}
            onChange={(e) => setValue(Number(e.target.value))}
            className="min-h-11 w-24 rounded-md border border-slate-300 px-2 text-end tabular-nums focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 sm:min-h-9" />
          <span className="text-sm text-slate-600">%</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>{t("settings.looser")}</span>
          <span>{t("settings.defaultIs", { value: settings.default_face_match_threshold })}</span>
          <span>{t("settings.stricter")}</span>
        </div>
        {!valid && <p role="alert" className="text-sm text-red-700">{t("settings.range", { min: MIN, max: MAX })}</p>}
        <ErrorBox message={error} />
        <div className="border-t border-slate-100 pt-4">
          <Button variant="secondary" disabled={saving || isDefault} onClick={() => setConfirmReset(true)}>
            {t("settings.reset")}
          </Button>
        </div>
      </Card>
      {dirty && (
        <div role="region" aria-label={t("settings.unsaved")}
          className="sticky bottom-4 z-30 flex animate-pop-in flex-wrap items-center justify-between gap-3 rounded-card border border-warn-100 bg-warn-50 px-4 py-3 shadow-raised">
          <p className="flex items-center gap-2 text-sm font-medium text-warn-700">
            <span className="h-2 w-2 rounded-full bg-warn-500" aria-hidden="true" />
            {t("settings.unsaved")}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => { setValue(settings.face_match_threshold); setError(null); }}>
              {t("settings.discard")}
            </Button>
            <Button disabled={!valid} loading={saving} onClick={() => void save(value)}>
              {saving ? t("settings.saving") : t("settings.save")}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        title={t("settings.confirmReset.title", { value: settings.default_face_match_threshold })}
        message={t("settings.confirmReset.message")}
        confirmLabel={t("settings.confirmReset.yes")}
        onConfirm={() => { setConfirmReset(false); void save(settings.default_face_match_threshold); }}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
