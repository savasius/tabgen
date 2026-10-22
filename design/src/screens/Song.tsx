import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Download, Info, Volume2, VolumeX } from "lucide-react";
import { useApp, type TKey } from "@/lib/store";
import { SongSessionProvider, useSong } from "./song-session";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { HelpTip } from "@/components/app/HelpTip";
import { SectionStrip } from "@/components/app/SectionStrip";
import { Waveform } from "@/components/app/Waveform";
import { NowNext } from "@/components/app/NowNext";
import { ChordGrid } from "@/components/app/ChordGrid";
import { Transport } from "@/components/app/Transport";
import { ChordDiagram } from "@/components/app/ChordDiagram";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { displayOf, uniqueLabels, COMMON_CHORDS } from "@/lib/display";
import { chordName, parseChord } from "@/lib/music";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Bar } from "@/mock/types";

export function SongLayout() {
  const { id = "" } = useParams();
  const { library, t } = useApp();
  const meta = library.find((s) => s.id === id);
  if (!meta) {
    return (
      <div className="p-10 text-center">
        <p>{t("states.notFound.title")}</p>
        <Button asChild className="mt-4">
          <Link to="/">{t("nav.library")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <SongSessionProvider meta={meta}>
      <SongChrome />
    </SongSessionProvider>
  );
}

function SongChrome() {
  const { t, settings } = useApp();
  const s = useSong();
  const [coach, setCoach] = useState(() => sessionStorage.getItem("tabgen.coach") !== "1");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 pb-4 md:px-8">
      <header className="flex flex-wrap items-center gap-3 pt-4">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t("common.back")}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="truncate text-xl font-semibold">{s.song.title}</h1>
          <p className="truncate text-sm text-muted-foreground">{s.song.artist}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 text-xs md:w-auto">
          <span className="inline-flex items-center gap-1">
            <Badge>
              {t("song.key")} {s.song.key.tonic}
              {s.song.key.mode === "minor" ? "m" : ""}
            </Badge>
            <HelpTip content={t("help.key")} />
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge>
              {s.song.bpm} {t("common.bpm")}
            </Badge>
            <HelpTip content={t("help.bpm")} />
          </span>
          <Badge variant="outline">
            {t("song.tuning")} {s.song.tuning.guess} · {s.song.tuning.cents}¢
          </Badge>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" /> {t("song.export")}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem>{t("song.exportItems.pdf")}</MenuItem>
            <MenuItem>{t("song.exportItems.gp5")}</MenuItem>
            <MenuItem>{t("song.exportItems.musicxml")}</MenuItem>
            <MenuItem>{t("song.exportItems.midi")}</MenuItem>
          </MenuContent>
        </Menu>
      </header>

      <nav className="flex gap-1 rounded-xl bg-secondary p-1">
        {[
          { to: ".", end: true, k: "song.tabs.chords" as const },
          { to: "tab", k: "song.tabs.tab" as const },
          { to: "play", k: "song.tabs.play" as const },
        ].map((it) => (
          <NavLink
            key={it.k}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex-1 rounded-lg py-2 text-center text-sm font-medium text-muted-foreground",
                isActive && "bg-card text-foreground shadow-sm",
              )
            }
          >
            {t(it.k)}
          </NavLink>
        ))}
      </nav>

      <Outlet />

      {coach && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
          <div data-coach className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-primary">
              <Info className="size-5" />
              <h2 className="font-semibold">{t("song.howToRead")}</h2>
            </div>
            <ol className="space-y-2 text-sm">
              <li>{t("help.coach.sections")}</li>
              <li>{t("help.coach.now")}</li>
              <li>{t("help.coach.grid")}</li>
              <li>{t("help.coach.controls")}</li>
            </ol>
            <Button
              className="mt-5 w-full"
              variant="glow"
              data-testid="coach-dismiss"
              onClick={() => {
                sessionStorage.setItem("tabgen.coach", "1");
                setCoach(false);
              }}
            >
              {t("common.gotIt")}
            </Button>
          </div>
        </div>
      )}
      <p className="sr-only">{settings.lang}</p>
    </div>
  );
}

export function ChordsView() {
  const { t, settings, set } = useApp();
  const s = useSong();
  const [edit, setEdit] = useState<{ bar: Bar; beat: number; label: string } | null>(null);
  const unique = uniqueLabels(s.song.chords.map((c) => c.label));

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-8">
      {Math.abs(s.song.tuning.cents) >= 5 && (
        <div className="hidden rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm sm:block">
          {t("song.tuningOff", { c: s.song.tuning.cents })}
          <button type="button" className="ml-2 underline">
            {t("song.tuningFix")}
          </button>
        </div>
      )}

      <SectionStrip
        sections={s.song.sections}
        duration={s.song.duration}
        time={s.time}
        onJump={(sec) => s.seek(sec.start)}
        onLoop={(sec) => s.setLoop({ start: sec.start, end: sec.end, label: t(`song.sections.${sec.label}` as TKey) })}
        loopLabel={undefined}
      />
      <Waveform duration={s.song.duration} time={s.time} sections={s.song.sections} onSeek={s.seek} />

      <NowNext
        song={s.song}
        time={s.time}
        transpose={s.transpose}
        capo={s.capo}
        level={s.level}
        notation={settings.notation}
        lefty={settings.lefty}
      />

      <div className="order-3 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 md:order-2 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("song.capo")}</span>
            <HelpTip content={t("help.capo")} />
            <select
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
              value={s.capo}
              onChange={(e) => s.setCapo(Number(e.target.value))}
            >
              <option value={0}>{t("song.capoOff")}</option>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t("song.capoN", { n })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("song.transpose")}</span>
            <HelpTip content={t("help.transpose")} />
            <Button variant="outline" size="icon-sm" onClick={() => s.setTranspose(s.transpose - 1)}>
              −
            </Button>
            <span className="w-8 text-center font-mono text-sm tabular">
              {s.transpose > 0 ? `+${s.transpose}` : s.transpose}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => s.setTranspose(s.transpose + 1)}>
              +
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("song.level")}</span>
            <Segmented
              size="sm"
              value={s.level}
              onChange={s.setLevel}
              options={[
                { value: "basic", label: t("song.levels.basic"), hint: t("song.levelHint.basic") },
                { value: "normal", label: t("song.levels.normal"), hint: t("song.levelHint.normal") },
                { value: "full", label: t("song.levels.full"), hint: t("song.levelHint.full") },
              ]}
            />
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={settings.lefty} onCheckedChange={(v) => set("lefty", v)} />
            {t("song.lefty")}
          </label>
        </div>
        {s.suggestion.capo > 0 && s.capo === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm">
            <span>{t("song.capoSuggest", { n: s.suggestion.capo })}</span>
            <Button size="sm" onClick={() => s.setCapo(s.suggestion.capo)}>
              {t("song.capoApply")}
            </Button>
          </div>
        )}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <span className="text-xs text-muted-foreground">{t("song.mixer")}</span>
          {s.song.stems.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => s.toggleStem(id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs",
                s.stems[id] ? "border-border" : "border-destructive/40 text-muted-foreground line-through",
              )}
            >
              {s.stems[id] ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
              {t(`song.stems.${id}` as TKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="order-2 max-md:sticky max-md:bottom-3 max-md:z-20 md:order-3">
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

      <div className="order-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("song.chordsInSong")}</span>
        {unique.map((label) => {
          const d = displayOf(label, s.transpose, s.capo, s.level, settings.notation);
          return (
            <span key={label} className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs font-semibold">
              {d.name}
            </span>
          );
        })}
      </div>
      <p className="order-4 -mt-2 text-[11px] text-muted-foreground">{t("song.uncertainHint")}</p>

      <div className="order-4">
        <ChordGrid
          song={s.song}
          time={s.time}
          transpose={s.transpose}
          capo={s.capo}
          level={s.level}
          notation={settings.notation}
          sectionTitle={(lab) => t(`song.sections.${lab}` as TKey)}
          onBeat={(bar, beat) => {
            const label = bar.beats[beat] || bar.beats.find(Boolean) || "Am";
            setEdit({ bar, beat, label });
          }}
        />
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogTitle>{t("song.editTitle")}</DialogTitle>
          <DialogDescription>{t("song.edit")}</DialogDescription>
          {edit && (
            <ChordEditor
              label={edit.label}
              onPick={(lab) => {
                edit.bar.beats[edit.beat] = lab;
                setEdit(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChordEditor({ label, onPick }: { label: string; onPick: (l: string) => void }) {
  const { t, settings } = useApp();
  const s = useSong();
  const current = displayOf(label, s.transpose, s.capo, s.level, settings.notation);
  return (
    <div className="mt-4">
      <div className="flex items-center gap-4">
        <ChordDiagram shape={current.shape} name={current.name} lefty={settings.lefty} size={120} />
        <p className="text-3xl font-semibold">{current.name}</p>
      </div>
      <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-muted-foreground">{t("song.editSuggestions")}</p>
      <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
        {COMMON_CHORDS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className="rounded-lg border border-border py-2 text-sm font-medium hover:bg-accent"
          >
            {chordName(parseChord(c), settings.notation)}
          </button>
        ))}
      </div>
    </div>
  );
}
