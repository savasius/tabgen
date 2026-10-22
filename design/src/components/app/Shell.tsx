import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Library, Plus, Mic2, Timer, Settings, LayoutGrid } from "lucide-react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";

const ITEMS = [
  { to: "/", key: "nav.library" as const, icon: Library, end: true },
  { to: "/add", key: "nav.add" as const, icon: Plus },
  { to: "/tuner", key: "nav.tuner" as const, icon: Mic2 },
  { to: "/metronome", key: "nav.metronome" as const, icon: Timer },
  { to: "/settings", key: "nav.settings" as const, icon: Settings },
];

export function Shell() {
  const { t, settings, set, resolvedTheme } = useApp();
  const loc = useLocation();
  const hideChrome = loc.pathname.startsWith("/song/");

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-border bg-card/60 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Logo />
          <div>
            <p className="font-semibold leading-none">{t("app.name")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("app.tagline")}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {ITEMS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                  isActive && "bg-accent font-medium text-foreground",
                )
              }
            >
              <it.icon className="size-4" />
              {t(it.key)}
            </NavLink>
          ))}
          <NavLink
            to="/states"
            className={({ isActive }) =>
              cn(
                "mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent",
                isActive && "bg-accent text-foreground",
              )
            }
          >
            <LayoutGrid className="size-3.5" />
            {t("nav.states")}
          </NavLink>
        </nav>
        <div className="mt-3 flex flex-col gap-2">
          <Segmented
            size="sm"
            value={settings.lang}
            onChange={(v) => set("lang", v)}
            options={[
              { value: "tr", label: "TR" },
              { value: "en", label: "EN" },
            ]}
          />
          <Segmented
            size="sm"
            value={resolvedTheme}
            onChange={(v) => set("theme", v)}
            options={[
              { value: "dark", label: t("settings.themes.dark") },
              { value: "light", label: t("settings.themes.light") },
            ]}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="font-semibold">{t("app.name")}</span>
          </div>
          <div className="flex gap-1">
            <Segmented
              size="sm"
              value={settings.lang}
              onChange={(v) => set("lang", v)}
              options={[
                { value: "tr", label: "TR" },
                { value: "en", label: "EN" },
              ]}
            />
          </div>
        </header>
        <main className={cn("flex-1", hideChrome ? "pb-0" : "pb-20 md:pb-6")}>
          <Outlet />
        </main>
        {!hideChrome && (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card/95 pb-safe backdrop-blur md:hidden">
          {ITEMS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground",
                  isActive && "text-primary",
                )
              }
            >
              <it.icon className="size-5" />
              {t(it.key)}
            </NavLink>
          ))}
        </nav>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.8" fill="none">
          <path d="M7 5v14M11 5v14M15 5v14M19 5v14" opacity=".55" />
          <circle cx="11" cy="10" r="1.8" fill="currentColor" />
          <circle cx="15" cy="14" r="1.8" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
