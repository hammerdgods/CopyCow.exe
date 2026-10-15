export function PageHeader({ title, kicker, children }: { title: string; kicker?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {kicker && <p className="text-[11px] uppercase tracking-[0.25em] text-win">{kicker}</p>}
        <h1 className="font-pixel text-4xl leading-none text-foreground sm:text-5xl">{title}</h1>
      </div>
      {children}
    </header>
  );
}
