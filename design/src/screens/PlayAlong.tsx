import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Headphones, Play } from "lucide-react";
import { useSong } from "./song-session";
import { useApp, type TKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { ChordDiagram } from "@/components/app/ChordDiagram";
import { displayOf } from "@/lib/display";
import { seeded } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Section } from "@/mock/types";

type Phase = "setup" | "live" | "result";

export function PlayAlong() {
  const { t, settings } = useApp();
  const s = useSong();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>(() => (params.get("live") === "1" ? "live" : params.get("result") === "1" ? "result" : "setup"));
  const [section, setSection] = useState<Section | "all">("all");
  const [headphones, setHeadphones] = useState(true);
  const [mode, setMode] = useState<"chords" | "notes">("chords");
  const [hits, setHits] = useState(() => (params.get("live") === "1" ? 18 : 0));
  const [misses, setMisses] = useState(() => (params.get("live") === "1" ? 4 : 0));
  const [streak, setStreak] = useState(() => (params.get("live") === "1" ? 6 : 0));
  const rnd = useMemo(() => seeded(99), []);

  const active = s.song.chords.find((c) => s.time >= c.start && s.time < c.end) ?? s.song.chords[0];
  const d = displayOf(active.label, s.transpose, s.capo, s.level, settings.notation);
  const beatIdx = Math.floor(s.time / (60 / s.song.bpm));
  const isHit = rnd() > 0.22 || beatIdx % 5 !== 0;
  void isHit;

  const history = useMemo(() => {
    const r = seeded(12);
    return s.song.chords.slice(0, 24).map((c, i) => ({
      i,
      label: c.label,
      ok: r() > 0.28 || i % 4 !== 3,
    }));
  }, [s.song.chords]);

  const accuracy = hits + misses === 0 ? 0 : Math.round((hits / (hits + misses)) * 100);

  if (phase === "setup") {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 pb-8">
        <div>
          <h2 className="text-xl font-semibold">{t("play.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("play.subtitle")}</p>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "chords", label: t("play.mode.chords") },
            { value: "notes", label: t("play.mode.notes") },
          ]}
        />
        <div>
          <p className="mb-2 text-sm font-medium">{t("play.pickSection")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSection("all")}
              className={cn("rounded-full border px-3 py-1 text-sm", section === "all" ? "border-primary bg-primary/15" : "border-border")}
            >
              {t("play.whole")}
            </button>
            {s.song.sections.map((sec, i) => (
              <button
                key={`${sec.label}-${i}`}
                type="button"
                onClick={() => setSection(sec)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  section !== "all" && section.start === sec.start ? "border-primary bg-primary/15" : "border-border",
                )}
              >
                {t(`song.sections.${sec.label}` as TKey)} {sec.index}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Headphones className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-medium">{t("play.headphones")}</p>
              <p className="text-sm text-muted-foreground">{t("play.headphonesBody")}</p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!headphones} onChange={(e) => setHeadphones(!e.target.checked)} />
                {t("play.noHeadphones")}
              </label>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="font-medium">{t("play.micCheck")}</p>
          <p className="text-sm text-muted-foreground">{t("play.micCheckBody")}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-2/3 bg-success" />
          </div>
          <p className="mt-1 text-xs text-success">{t("play.micOk")}</p>
          <p className="mt-3 text-xs text-muted-foreground">{t("play.calibrated", { ms: settings.latencyMs })}</p>
        </div>
        <Button
          variant="glow"
          size="lg"
          data-testid="play-along-start"
          onClick={() => {
            setPhase("live");
            setHits(18);
            setMisses(4);
            setStreak(6);
            const start = section === "all" ? 0 : section.start;
            s.seek(start);
            s.setLoop(section === "all" ? null : { start: section.start, end: section.end });
            if (!s.playing) s.toggle();
          }}
        >
          <Play className="size-4" data-testid="play-along-start" /> {t("play.start")}
        </Button>
      </div>
    );
  }

  if (phase === "result") {
    const weak = [
      { b: 16, c: "E7" },
      { b: 48, c: "Fmaj7" },
      { b: 52, c: "Gsus4" },
    ];
    return (
      <div className="mx-auto max-w-lg pb-8">
        <h2 className="text-2xl font-semibold">{t("play.resultTitle")}</h2>
        <p className="mt-1 text-muted-foreground">
          {t("play.resultBody", {
            p: 82,
            s: section === "all" ? t("play.whole") : t(`song.sections.${section.label}` as TKey),
          })}
        </p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label={t("play.score")} value="820" />
          <Stat label={t("play.accuracy")} value="82%" />
          <Stat label={t("play.streak")} value="11" />
        </div>
        <h3 className="mt-8 mb-2 text-sm font-semibold">{t("play.weakest")}</h3>
        <ul className="space-y-2">
          {weak.map((w) => (
            <li key={w.b} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
              {t("play.weakBar", { b: w.b, c: w.c })}
              <Button size="sm" variant="outline" onClick={() => { setPhase("live"); s.seek(s.song.bars[w.b]?.start ?? 0); }}>
                {t("play.practiceSlow")}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-2">
          <Button variant="glow" onClick={() => setPhase("setup")}>
            {t("play.again")}
          </Button>
          <Button variant="outline" onClick={() => setPhase("setup")}>
            {t("common.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex items-center justify-between">
        <Badge variant="success" className="gap-1">
          <span className="size-1.5 rounded-full bg-success" /> {t("play.listening")}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => { s.pause(); setPhase("result"); }}>
          {t("play.stop")}
        </Button>
      </div>
      <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-6">
        <ChordDiagram shape={d.shape} name={d.name} lefty={settings.lefty} size={180} />
        <p className="mt-2 text-5xl font-semibold">{d.name}</p>
        <p className={cn("mt-3 rounded-full px-3 py-1 text-sm font-medium", history[beatIdx % history.length]?.ok ? "bg-hit/20 text-hit" : "bg-miss/20 text-miss")}>
          {history[beatIdx % history.length]?.ok ? t("play.hit") : t("play.miss")}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {history.slice(0, 16).map((h) => (
          <div
            key={h.i}
            className={cn("grid h-10 place-items-center rounded-lg text-xs font-semibold", h.ok ? "bg-hit/20 text-hit" : "bg-miss/20 text-miss")}
          >
            {h.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("play.score")} value={String(hits * 40)} />
        <Stat label={t("play.accuracy")} value={`${accuracy || 82}%`} />
        <Stat label={t("play.streak")} value={String(streak)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular">{value}</p>
    </div>
  );
}
