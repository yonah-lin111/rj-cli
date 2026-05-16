import { cn } from "@/lib/utils";

/** 页面导航项 */
export interface WebNavItem {
  label: string;
  href: string;
  match: (pathname: string) => boolean;
}

const navItems: WebNavItem[] = [
  {
    label: "Rankings",
    href: "/rank",
    match: (pathname) => pathname === "/" || pathname === "/rank",
  },
  {
    label: "Circles",
    href: "/circle",
    match: (pathname) => pathname === "/circle",
  },
  {
    label: "Works",
    href: "/works",
    match: (pathname) => pathname === "/works",
  },
  {
    label: "Work Ops",
    href: "/work-ops",
    match: (pathname) => pathname === "/work-ops",
  },
];

/** 页面顶部导航 */
export const PageHeaderNav = (): React.ReactElement => {
  const pathname = window.location.pathname;

  return (
    <header className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">RJ Web UI</p>
        <h1 className="text-2xl font-bold text-foreground">Local Data Dashboard</h1>
      </div>
      <nav className="flex flex-wrap gap-2">
        {navItems.map((item) => {
          const active = item.match(pathname);
          return (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
};
