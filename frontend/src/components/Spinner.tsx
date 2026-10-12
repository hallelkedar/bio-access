import { useLanguage } from "../i18n/LanguageProvider";

export function Spinner({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div role="status" className="flex items-center gap-3 py-8 text-slate-600">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label ?? t("common.loading")}
    </div>
  );
}
