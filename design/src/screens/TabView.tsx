import { useMemo, useState } from "react";
import { useSong } from "./song-session";
import { useApp, type TKey } from "@/lib/store";
import { TabStaff } from "@/components/app/TabStaff";
import { Transport } from "@/components/app/Transport";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TabNote } from "@/mock/types";

export function TabView() {
  const { t } = useApp();
  const s = useSong();
  const [sel, setSel] = useState<TabNote | null>(null);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"tab" | "both" | "fretboard">("tab");
  const notes = s.song.tab.notes;
  const uncertain = notes.filter((n) => n.confidence < 0.7);
  const beat = 60 / s.song.bpm;
  const elapsed = s.time - s.song.bars[0].start;
  const totalBeats = elapsed / beat;
  const currentBar = Math.max(0, Math.floor(totalBeats / 4));
  const currentPos = Math.floor((totalBeats % 4) * 4);

  const nextUncertain = useMemo(() => uncertain[0], [uncertain]);

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("tab.how")}</p>
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "tab", label: t("tab.view.tab") },
            { value: "both", label: t("tab.view.both") },
            { value: "fretboard", label: t("tab.view.fretboard") },
          ]}
        />
      </div>
      <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        {t("tab.onlySections")}
      </div>
      {uncertain.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <span>{t("tab.uncertainCount", { n: uncertain.length })}</span>
          {nextUncertain && (
            <Button size="sm" variant="outline" onClick={() => setSel(nextUncertain)}>
              {t("tab.nextUncertain")}
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <span>{t("tab.zoom")}</span>
        <input type="range" min={0.8} max={1.6} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </div>
      <TabStaff
        bars={s.song.tab.bars}
        notes={notes}
        currentBar={currentBar}
        currentPos={currentPos}
        selectedId={sel?.id}
        onSelect={setSel}
        lefty={false}
        zoom={zoom}
        groups={[
          { title: t("song.sections.intro"), bars: s.song.tab.bars.filter((b) => b < 8) },
          { title: t("song.sections.solo"), bars: s.song.tab.bars.filter((b) => b >= 8) },
        ]}
      />
      {view !== "tab" && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {view === "both" ? t("tab.view.both") : t("tab.view.fretboard")} · {t("common.soon")}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("tab.attribution")}</p>
      <div className="sticky bottom-3 z-20">
        <Transport
          time={s.time}
          duration={s.song.duration}
          playing={s.playing}
          speed={s.speed}
          loop={s.loop}
          countIn={s.countIn}
          counting={s.counting}
          onToggle={s.toggle}
          onSeek={s.seek}
          onSpeed={s.setSpeed}
          onLoopClear={() => s.setLoop(null)}
          onCountIn={s.setCountIn}
          onSkip={(dt) => s.seek(s.time + dt)}
        />
      </div>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          <DialogTitle>{t("tab.editNote")}</DialogTitle>
          {sel && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                {t("tab.string")}
                <Input type="number" min={1} max={6} defaultValue={sel.string} />
              </label>
              <label className="text-sm">
                {t("tab.fret")}
                <Input type="number" min={0} max={24} defaultValue={sel.fret} />
              </label>
              <label className="col-span-2 text-sm">
                {t("tab.technique")}
                <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {(["none", "h", "p", "b", "s", "v"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`tab.techniques.${k}` as TKey)}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="glow" onClick={() => setSel(null)}>
                {t("tab.confirm")}
              </Button>
              <Button variant="outline">{t("tab.listen")}</Button>
              <Button variant="ghost" className="col-span-2 text-destructive">
                {t("tab.removeNote")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
