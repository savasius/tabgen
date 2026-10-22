import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { TUNINGS, type TuningId } from "@/lib/music";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const STRING_LABELS = ["E", "A", "D", "G", "B", "e"];

export function Tuner() {
  const { t, settings, set } = useApp();
  const tuning = TUNINGS[settings.tuning];
  const [auto, setAuto] = useState(true);
  const [string, setString] = useState(0);
  const [cents, setCents] = useState(-18);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setCents((c) => {
        const target = 0;
        return c + (target - c) * 0.12 + Math.sin(Date.now() / 400) * 1.4;
      });
    }, 80);
    return () => window.clearInterval(iv);
  }, []);

  const inTune = Math.abs(cents) < 5;
  const angle = Math.max(-50, Math.min(50, cents * 1.6));

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-3xl font-semibold">{t("tuner.title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("tuner.subtitle")}</p>

      <div className="mt-4 flex items-center justify-between">
        <Segmented
          size="sm"
          value={auto ? "auto" : "manual"}
          onChange={(v) => setAuto(v === "auto")}
          options={[
            { value: "auto", label: t("tuner.auto") },
            { value: "manual", label: t("tuner.manual") },
          ]}
        />
        <select
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          value={settings.tuning}
          onChange={(e) => set("tuning", e.target.value as TuningId)}
        >
          {(Object.keys(TUNINGS) as TuningId[]).map((id) => (
            <option key={id} value={id}>
              {t(`settings.tunings.${id}`)} · {TUNINGS[id].label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative mx-auto mt-8 h-52 w-full max-w-sm">
        <svg viewBox="0 0 200 110" className="w-full">
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-border" strokeWidth="10" />
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-success" strokeWidth="10" strokeDasharray="40 400" strokeDashoffset="-80" />
          <line
            x1="100"
            y1="100"
            x2={100 + 80 * Math.sin((angle * Math.PI) / 180)}
            y2={100 - 80 * Math.cos((angle * Math.PI) / 180)}
            className={inTune ? "stroke-success" : "stroke-primary"}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="6" className="fill-foreground" />
        </svg>
        <div className="absolute inset-x-0 top-24 text-center">
          <p className="text-5xl font-semibold">{STRING_LABELS[string]}</p>
          <p className="font-mono text-sm tabular text-muted-foreground">
            {cents > 0 ? "+" : ""}
            {cents.toFixed(0)} ¢ · {tuning.hz[string].toFixed(1)} Hz
          </p>
        </div>
      </div>

      <p className={cn("text-center text-sm font-medium", inTune ? "text-success" : "text-muted-foreground")}>
        {inTune ? t("tuner.inTune") : cents < 0 ? t("tuner.tighten") : t("tuner.loosen")}
      </p>

      <div className="mt-6 grid grid-cols-6 gap-2">
        {STRING_LABELS.map((lab, i) => (
          <button
            key={lab + i}
            type="button"
            onClick={() => setString(i)}
            className={cn(
              "rounded-xl border py-3 text-sm font-semibold",
              string === i ? "border-primary bg-primary/15" : "border-border",
            )}
          >
            {tuning.notes[i].replace(/\d/, "")}
          </button>
        ))}
      </div>
      <Button className="mt-6 w-full" variant="outline">
        {t("tuner.playTone")}
      </Button>
      <p className="mt-4 text-xs text-muted-foreground">{t("tuner.listening")}</p>
    </div>
  );
}
