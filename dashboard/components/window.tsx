import { cn } from "@/lib/utils";

/** A Windows-95 style window frame, but dark inside (Bloomberg energy). */
export function Window({
  title,
  icon = "▣",
  right,
  className,
  bodyClassName,
  children,
  inactive,
}: {
  title: string;
  icon?: string;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  inactive?: boolean;
}) {
  return (
    <section className={cn("bevel-out flex min-w-0 flex-col bg-w95-gray p-[3px]", className)}>
      <div className={cn("flex items-center justify-between gap-2 px-1.5 py-0.5", inactive ? "titlebar-inactive" : "titlebar")}>
        <h2 className="flex min-w-0 items-center gap-1.5 truncate font-pixel text-lg leading-none text-white">
          <span aria-hidden>{icon}</span>
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <div className="flex gap-[2px]" aria-hidden>
            {["_", "□", "×"].map((c) => (
              <span key={c} className="bevel-out flex h-4 w-4 items-center justify-center bg-w95-gray text-[10px] font-bold leading-none text-black">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={cn("mt-[3px] flex-1 bevel-in bg-card text-foreground", bodyClassName)}>{children}</div>
    </section>
  );
}
