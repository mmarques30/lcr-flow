import { type ReactNode } from "react";

// Renderizador de Markdown leve (sem dependências, sem HTML perigoso).
// Cobre o que as personas do Cérebro produzem: #/##/### títulos, **negrito**,
// listas (-, •, 1.), > citação e --- separador.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}-${i}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={`${keyBase}-${i}`}>{m[2]}</em>);
    else if (m[3] !== undefined) out.push(<code key={`${keyBase}-${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[3]}</code>);
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const lines = (children ?? "").split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let ordered: { n: string; t: string }[] = [];
  let k = 0;

  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${k++}`} className="my-2 ml-5 list-disc space-y-1">
        {items.map((b, i) => <li key={i}>{inline(b, `ulb-${k}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  const flushOrdered = () => {
    if (!ordered.length) return;
    const items = ordered;
    blocks.push(
      <ol key={`ol-${k++}`} className="my-2 ml-5 list-decimal space-y-1">
        {items.map((b, i) => <li key={i}>{inline(b.t, `olb-${k}-${i}`)}</li>)}
      </ol>,
    );
    ordered = [];
  };
  const flush = () => { flushBullets(); flushOrdered(); };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#{3,}\s+(.*)$/))) { flush(); blocks.push(<h4 key={`h-${k++}`} className="mt-4 mb-1 font-display text-base font-semibold">{inline(m[1], `h4-${k}`)}</h4>); return; }
    if ((m = line.match(/^##\s+(.*)$/))) { flush(); blocks.push(<h3 key={`h-${k++}`} className="mt-5 mb-1.5 font-display text-lg font-semibold">{inline(m[1], `h3-${k}`)}</h3>); return; }
    if ((m = line.match(/^#\s+(.*)$/))) { flush(); blocks.push(<h2 key={`h-${k++}`} className="mt-2 mb-2 font-display text-xl">{inline(m[1], `h2-${k}`)}</h2>); return; }
    if (/^([-–—*_]\s*){3,}$/.test(line) || /^---+$/.test(line)) { flush(); blocks.push(<hr key={`hr-${k++}`} className="my-3 border-border" />); return; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { flushBullets(); ordered.push({ n: "", t: m[1] }); return; }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) { flushOrdered(); bullets.push(m[1]); return; }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); blocks.push(<p key={`q-${k++}`} className="border-l-2 border-primary/40 pl-3 text-soft-foreground">{inline(m[1], `q-${k}`)}</p>); return; }
    flush();
    blocks.push(<p key={`p-${k++}`} className="my-1.5 leading-relaxed">{inline(line, `p-${k}`)}</p>);
  });
  flush();

  return <div className={className}>{blocks}</div>;
}
