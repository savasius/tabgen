import { Link, useNavigate } from "react-router-dom";
import { Heart, MoreHorizontal, Plus, Search, Upload, FileVideo, Mic } from "lucide-react";
import { useApp, relativeTime, type TKey } from "@/lib/store";
import { Cover } from "@/components/app/Cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { Segmented } from "@/components/ui/segmented";
import { formatTime } from "@/lib/utils";
import type { LibrarySong } from "@/mock/types";
import { useMemo, useState } from "react";

type Filter = "all" | "ready" | "processing" | "favorites";

export function Library() {
  const { t, library, setLibrary } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return library.filter((s) => {
      if (query && !`${s.title} ${s.artist}`.toLowerCase().includes(query)) return false;
      if (filter === "ready") return s.status === "done";
      if (filter === "processing") return s.status !== "done" && s.status !== "failed";
      if (filter === "favorites") return !!s.favorite;
      return true;
    });
  }, [library, q, filter]);

  const recent = library.filter((s) => s.lastPlayedAt && s.status === "done").sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""));
  const processing = library.filter((s) => s.status !== "done" && s.status !== "failed");

  if (!library.length) return <EmptyLibrary />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 md:px-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("library.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("library.subtitle")}</p>
        </div>
        <Button asChild variant="glow">
          <Link to="/add">
            <Plus /> {t("nav.add")}
          </Link>
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("library.filters.all") },
            { value: "ready", label: t("library.filters.ready") },
            { value: "processing", label: t("library.filters.processing") },
            { value: "favorites", label: t("library.filters.favorites") },
          ]}
        />
      </div>

      {!!recent.length && filter === "all" && !q && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("library.recent")}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {recent.map((s) => (
              <SongCard key={s.id} song={s} compact />
            ))}
          </div>
        </section>
      )}

      {!!processing.length && filter !== "ready" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("library.processing")}</h2>
          <div className="grid gap-3">
            {processing.map((s) => (
              <ProcessingRow key={s.id} song={s} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("library.all")}</h2>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <SongCard
                key={s.id}
                song={s}
                onFav={() => setLibrary((l) => l.map((x) => (x.id === s.id ? { ...x, favorite: !x.favorite } : x)))}
                onDelete={() => setLibrary((l) => l.filter((x) => x.id !== s.id))}
              />
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t("library.tip")}</p>
    </div>
  );
}

function EmptyLibrary() {
  const { t } = useApp();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary">
        <Plus className="size-8" />
      </div>
      <h1 className="text-2xl font-semibold">{t("library.empty.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("library.empty.body")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild variant="glow">
          <Link to="/add">{t("library.empty.cta")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/song/sahil-yolu">{t("library.empty.demo")}</Link>
        </Button>
      </div>
      <div className="mt-10 grid w-full grid-cols-3 gap-2 text-xs text-muted-foreground">
        <Link to="/add?tab=file" className="rounded-xl border border-border p-3 hover:bg-accent">
          <Upload className="mx-auto mb-1 size-4" /> {t("add.tabs.file")}
        </Link>
        <Link to="/add?tab=youtube" className="rounded-xl border border-border p-3 hover:bg-accent">
          <FileVideo className="mx-auto mb-1 size-4" /> {t("add.tabs.youtube")}
        </Link>
        <Link to="/add?tab=mic" className="rounded-xl border border-border p-3 hover:bg-accent">
          <Mic className="mx-auto mb-1 size-4" /> {t("add.tabs.mic")}
        </Link>
      </div>
    </div>
  );
}

function statusLabel(s: LibrarySong, t: (k: TKey, v?: Record<string, string | number>) => string) {
  if (s.status === "done") return t("library.status.done");
  if (s.status === "failed") return t("library.status.failed");
  if (s.status === "queued") return t("library.status.queued");
  return t("library.status.processing", { p: s.progress });
}

function SongCard({ song, compact, onFav, onDelete }: { song: LibrarySong; compact?: boolean; onFav?: () => void; onDelete?: () => void }) {
  const { t } = useApp();
  const nav = useNavigate();
  const href = song.status === "failed" ? `/states/${song.error ?? "server"}` : song.status === "done" ? `/song/${song.id}` : `/processing/${song.id}`;
  return (
    <article
      className={compact ? "w-56 shrink-0" : ""}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <button type="button" onClick={() => nav(href)} className="flex w-full gap-3 rounded-2xl border border-border bg-card p-3 text-left hover:bg-accent/40">
        <Cover hue={song.coverHue} title={song.title} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{song.title}</p>
              <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
            </div>
            {song.favorite && <Heart className="size-4 shrink-0 fill-primary text-primary" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={song.status === "failed" ? "danger" : song.status === "done" ? "success" : "primary"}>
              {statusLabel(song, t)}
            </Badge>
            {song.status === "done" && song.chordsPreview?.slice(0, 4).map((c) => (
              <span key={c} className="font-mono text-[11px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        </div>
      </button>
      {!compact && (
        <div className="-mt-10 mr-2 mb-2 flex justify-end">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="more">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => nav(href)}>{t("common.open")}</MenuItem>
              <MenuItem onSelect={onFav}>{t("library.filters.favorites")}</MenuItem>
              <MenuItem className="text-destructive" onSelect={onDelete}>
                {t("common.delete")}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
      {song.lastPlayedAt && song.status === "done" && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          {t("library.lastPlayed", { when: relativeTime(song.lastPlayedAt, t) })}
          {song.practice ? ` · ${t("library.practiceScore")} ${song.practice.score}` : ""}
          {` · ${formatTime(song.duration)}`}
        </p>
      )}
    </article>
  );
}

function ProcessingRow({ song }: { song: LibrarySong }) {
  const { t } = useApp();
  return (
    <Link to={`/processing/${song.id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:bg-accent/40">
      <Cover hue={song.coverHue} title={song.title} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{song.title}</p>
        <p className="text-xs text-muted-foreground">{t(`processing.stages.${song.status}` as TKey)}</p>
        <Progress value={song.progress} className="mt-2" />
      </div>
      <span className="font-mono text-sm tabular text-muted-foreground">{song.progress}%</span>
    </Link>
  );
}
