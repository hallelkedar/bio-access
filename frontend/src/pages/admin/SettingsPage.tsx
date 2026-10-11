import { useEffect, useState } from "react";

import { getSettings, updateThreshold, type ThresholdSettings } from "../../api/admin";
import { apiErrorMessage } from "../../api/errors";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { useLanguage } from "../../i18n/LanguageProvider";

const MIN = 80;
const MAX = 100;

export function SettingsPage() {
  const [settings, setSettings] = useState<ThresholdSettings | null>(null);
  const [value, setValue] = useState(95);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { t, lang } = useLanguage();

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setValue(s.face_match_threshold);
      })
      .catch((err) => setError(apiErrorMessage(err, {}, lang)));
  }, []);

  if (error && !settings) return <ErrorBox message={error} />;
  if (!settings) return <Spinner label={t("settings.loading")} />;

  const valid = value >= MIN && value <= MAX;
  const changed = value !== settings.face_match_threshold;

  function change(next: number) {
    setValue(next);
    setSaved(false);
  }

  async function save(next: number) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateThreshold(next);
      setSettings(updated);
      setValue(updated.face_match_threshold);
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-semibold">{t("settings.thresholdTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("settings.thresholdHelp")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <input type="range" min={MIN} max={MAX} step={0.5} value={value} aria-label={t("settings.slider")}
            onChange={(e) => change(Number(e.target.value))} className="flex-1" />
          <input type="number" min={MIN} max={MAX} step={0.5} value={value} aria-label={t("settings.value")}
            onChange={(e) => change(Number(e.target.value))}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-end tabular-nums" />
          <span className="text-sm text-slate-600">%</span>
        </div>
        <p className="text-sm text-slate-600">
          {settings.source === "database" ? t("settings.custom") : t("settings.usingDefault")} · {t("settings.defaultIs", { value: settings.default_face_match_threshold })}
        </p>
        {!valid && <p role="alert" className="text-sm text-red-700">{t("settings.range", { min: MIN, max: MAX })}</p>}
        <ErrorBox message={error} />
        {saved && <p role="status" className="text-sm text-emerald-700">{t("settings.saved")}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={!changed || !valid || saving} onClick={() => void save(value)}
            className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
          <button type="button" disabled={saving || settings.face_match_threshold === settings.default_face_match_threshold}
            onClick={() => void save(settings.default_face_match_threshold)} className="rounded-md border px-4 py-2 disabled:opacity-50">
            {t("settings.reset")}
          </button>
        </div>
      </div>
    </section>
  );
}
