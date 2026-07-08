import { Card } from "@/components/ui/card";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

export function AuthShell({ eyebrow, title, description, children }: AuthShellProps) {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden className="auth-pattern absolute inset-0" />
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(27,122,69,0.07),transparent_65%)]"
      />

      <div className="relative w-full max-w-sm animate-in duration-500 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="bg-green shadow-soft flex size-12 items-center justify-center rounded-[0.875rem] text-xl font-bold text-white select-none">
            S
          </div>
          <div className="space-y-1.5">
            <h1 className="text-ink text-2xl font-bold tracking-tight">Sportem</h1>
            <div className="eyebrow">{eyebrow}</div>
          </div>
        </div>

        <Card className="shadow-lift gap-0 overflow-hidden rounded-xl py-0">
          <div aria-hidden className="from-green to-green-bright h-0.5 w-full bg-gradient-to-r" />
          <div className="space-y-6 px-7 py-7">
            <div className="space-y-1.5">
              <h2 className="text-ink text-lg leading-none font-semibold">{title}</h2>
              <p className="text-ink-soft text-sm">{description}</p>
            </div>
            {children}
          </div>
        </Card>

        <p className="text-ink-faint mt-6 text-center text-xs">
          © Sportem · interni operativni sistem
        </p>
      </div>
    </main>
  );
}
