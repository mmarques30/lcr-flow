## Objetivo

Substituir a paleta verde-oliva (IAplicada) por uma identidade visual derivada da logo LCR Contadores anexa — azul-marinho corporativo sobre fundo claro neutro, mantendo o tom sóbrio/contábil.

## Nova paleta (extraída da logo)

- **Azul primário** `#1e4d8b` (azul da silhueta predial) — botões, links, pills ativos, ícones
- **Azul escuro** `#13335c` (contorno/tipografia da logo) — hover, headings de destaque, painel lateral
- **Azul muito escuro** `#0b2240` — sidebar/painel escuro
- **Azul claro de apoio** `#e8eff7` — backgrounds de seleção, pills suaves, highlights
- **Off-white de fundo** `#f6f7f9` (neutro frio levemente azulado, em vez do `#f7f6f0` quente)
- **Cards brancos** `#ffffff` com border `#dfe3ea` (cinza-azulado neutro, em vez de `#e5e3d6`)
- **Foreground principal** `#0f1827`
- **Foreground secundário** `#5a6373`
- **Foreground terciário** `#3a4252`

Status/feedback permanecem semânticos (verde sucesso, âmbar atenção, vermelho erro) — sem verde-oliva.

## Tipografia

Mantida: Inter (corpo) + Playfair Display (headings de destaque) — combina bem com a sobriedade do azul-marinho. Sem mudança nesse eixo, salvo pedido.

## Arquivos afetados

- `src/styles.css` — reescrever todos os tokens `--background`, `--card`, `--primary`, `--primary-foreground`, `--secondary`, `--accent`, `--muted`, `--border`, `--sidebar-*`, `--ring`, etc., em `oklch`, refletindo a paleta acima (light + dark mode).
- Componentes que tenham hex hard-coded da paleta oliva (se houver) → trocar por tokens.
- `StatusPill` e variantes de botão — revisar para usar o novo `--primary`.

## Escopo

Apenas tokens de design e referências de cor. Sem mudanças em estrutura de rotas, schema do banco, lógica de auth, ou componentes funcionais.

## Logo

Subir a logo anexa como asset (`lovable-assets`) e exibi-la no header da sidebar e na tela `/auth`, substituindo o texto/placeholder atual de marca.
