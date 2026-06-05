import { cn } from "@/lib/utils";

type Variant = "now" | "doing" | "next" | "back" | "neutral";

const VARIANT_CLASS: Record<Variant, string> = {
  now: "bg-status-now text-status-now-foreground border-transparent",
  doing: "bg-status-doing text-status-doing-foreground border-transparent",
  next: "bg-status-next text-status-next-foreground border-border",
  back: "bg-status-back text-status-back-foreground border-transparent",
  neutral: "bg-muted text-soft-foreground border-border",
};

export function StatusPill({
  variant = "neutral",
  children,
  className,
}: {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function variantFor(status: string): Variant {
  switch (status) {
    case "em_dia":
    case "entregue":
    case "concluida":
    case "importada_sci":
    case "done":
    case "now":
      return "now";
    case "em_andamento":
    case "lancamento":
    case "conciliacao":
    case "doing":
    case "classificado":
    case "processado":
      return "doing";
    case "nao_iniciada":
    case "next":
    case "recebido":
    case "gerada":
      return "next";
    case "atrasado":
    case "divergencias":
    case "back":
    case "cobranca":
      return "back";
    default:
      return "neutral";
  }
}
