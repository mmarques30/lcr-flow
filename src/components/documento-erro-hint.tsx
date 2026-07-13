import { AlertTriangle, Lock } from "lucide-react";
import { mensagemErroDocumento } from "@/lib/documento-erros";
import { cn } from "@/lib/utils";

export function DocumentoErroHint({
  classificacao_ia,
  compact = false,
  className,
}: {
  classificacao_ia?: unknown;
  compact?: boolean;
  className?: string;
}) {
  const info = mensagemErroDocumento(classificacao_ia);
  if (!info) return null;

  if (compact) {
    const isSenha = info.code === "PDF_SENHA";
    return (
      <p className={cn(isSenha ? "text-[11px] text-rose-800" : "text-[11px] text-amber-800", className)} title={info.tecnico}>
        {isSenha && <Lock className="mr-1 inline h-3 w-3" />}
        <span className="font-medium">{info.titulo}</span>
        <span className={isSenha ? "text-rose-700" : "text-amber-700"}> — {info.acao}</span>
      </p>
    );
  }

  const isSenha = info.code === "PDF_SENHA";
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2 text-sm",
      isSenha ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900",
      className,
    )}>
      <div className="flex items-start gap-2">
        {isSenha ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="space-y-1">
          <p className="font-medium">{info.titulo}</p>
          {info.detalhe && <p className="text-xs opacity-90">{info.detalhe}</p>}
          <p className={cn("text-xs", isSenha ? "text-rose-800" : "text-amber-800")}>{info.acao}</p>
          {info.tecnico && (
            <details className="text-[11px] text-amber-700">
              <summary className="cursor-pointer">Detalhe técnico</summary>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono">{info.tecnico}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
