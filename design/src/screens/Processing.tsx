import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApp, type TKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Cover } from "@/components/app/Cover";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { JobStage } from "@/mock/types";
import { cn } from "@/lib/utils";

const ORDER: JobStage[] = ["queued", "decoding", "separating", "beats", "sections", "chords", "key", "tab", "finalizing", "done"];

export function Processing() {
  const { id = "" } = useParams();
  const { t, library, setLibrary } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const freeze = params.get("pause") === "1" || params.get("pause") === "true";
  const song = library.find((s) => s.id === id);
  const simulate = Boolean((loc.state as { simulate?: boolean } | null)?.simulate) && !freeze;

  const [stage, setStage] = useState<JobStage>(song?.status ?? "queued");
  const [progress, setProgress] = useState(song?.progress ?? 0);

  useEffect(() => {
    if (freeze || !simulate) return;
    const iv = window.setInterval(() => {
      setStage((cur) => {
        const i = ORDER.indexOf(cur);
        const next = ORDER[Math.min(i + 1, ORDER.length - 1)];
        const p = Math.round(((ORDER.indexOf(next) + 1) / ORDER.length) * 100);
        setProgress(p);
        if (next === "done") {
          window.clearInterval(iv);
          setLibrary((l) => l.map((s) => (s.id === id ? { ...s, status: "done", progress: 100, hasTab: true, key: "Am", bpm: 96 } : s)));
        }
        return next;
      });
    }, 900);
    return () => window.clearInterval(iv);
  }, [simulate, freeze, id, setLibrary]);

  if (!song) {
    return (
      <div className="p-10 text-center">
        <p>{t("states.notFound.title")}</p>
        <Button asChild className="mt-4">
          <Link to="/">{t("nav.library")}</Link>
        </Button>
      </div>
    );
  }

  const current = freeze ? song.status : stage;
  const pct = freeze ? song.progress : progress;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center gap-4">
        <Cover hue={song.coverHue} title={song.title} className="size-16" />
        <div>
          <p className="text-sm text-muted-foreground">{t("processing.title")}</p>
          <h1 className="text-2xl font-semibold">{song.title}</h1>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("processing.body")}</p>
      <Progress value={pct} className="mt-6 h-2" />
      <p className="mt-2 text-sm tabular text-muted-foreground">
        {pct}% · {t("processing.eta", { t: `${Math.max(1, Math.round((100 - pct) / 25))} ${t("common.min")}` })}
      </p>

      <ol className="mt-8 space-y-3">
        {ORDER.filter((s) => s !== "done" && s !== "failed").map((s) => {
          const i = ORDER.indexOf(s);
          const ci = ORDER.indexOf(current);
          const done = i < ci || current === "done";
          const active = s === current;
          return (
            <li key={s} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-6 place-items-center rounded-full border",
                  done && "border-success bg-success text-white",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <div>
                <p className={cn("text-sm font-medium", active && "text-primary")}>{t(`processing.stages.${s}` as TKey)}</p>
                {active && (s === "separating" || s === "chords" || s === "tab") && (
                  <p className="text-xs text-muted-foreground">{t(`processing.stageHint.${s}` as TKey)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(current === "beats" || current === "sections" || current === "chords" || current === "key" || current === "tab" || current === "finalizing") && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("processing.preview")}</p>
          <div className="mt-2 flex gap-6 text-sm">
            <div>
              <p className="text-muted-foreground">{t("processing.tempo")}</p>
              <p className="font-semibold">96 {t("common.bpm")}</p>
            </div>
            {ORDER.indexOf(current) >= ORDER.indexOf("key") && (
              <div>
                <p className="text-muted-foreground">{t("processing.key")}</p>
                <p className="font-semibold">A minor</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {(current === "done" || (!simulate && song.status === "done")) && (
          <Button variant="glow" onClick={() => nav(`/song/${id === "yeni-yukleme" || id === "mic-yeni" ? "sahil-yolu" : id}`)}>
            {t("processing.done")}
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link to="/">{t("processing.background")}</Link>
        </Button>
        <Button variant="ghost">{t("processing.cancel")}</Button>
      </div>
    </div>
  );
}
