// Edge Function: processar-documento (TO-BE 23/06)
// Pipeline: lê o PDF/imagem do storage → classifica com Claude Sonnet 4.6 →
// cria os lançamentos contábeis sugeridos no banco.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string) => json(200, { ok: false, error });

// Haiku 4.5: limite de tokens/min bem maior que o Sonnet no mesmo tier (evita o
// rate_limit_error de 10k tokens/min) + mais barato e rápido p/ classificar docs.
const MODEL = "claude-haiku-4-5";

// Subconjunto curado de contas/históricos enviado como contexto (em vez das 1187
// contas + 559 históricos) p/ caber no limite de 10k tokens input/min. Fonte:
// Mapa de Transações Típicas + bancos + impostos/despesas/receitas comuns
// (docs/contas-curadas-ia.json no repo da automação). Conta rara fora da lista →
// a IA marca confidence<0.7 e o item vai p/ revisão humana no front.
const CONTAS_IA = ["7","8","9","10","15","16","17","18","19","20","29","32","33","34","35","37","38","39","40","41","43","44","45","46","47","48","49","50","51","69","70","71","72","75","76","77","84","146","147","148","149","150","160","161","162","163","167","169","171","172","173","176","177","178","179","180","181","184","185","187","188","189","190","191","194","195","196","197","200","201","202","203","211","213","216","277","278","279","280","283","284","285","293","322","334","387","417","420","421","422","424","426","427","428","429","432","434","435","440","442","448","456","457","459","460","465","467","468","469","470","471","473","475","476","481","497","498","523","536","555","565","572","575","578","579","580","606","608","614","628","629","631","648","649","650","651","657","658","659","672","673","676","678","696","697","698","699","702","704","707","717","721","724","726","738","739","741","748","749","750","751","752","755","756","766","767","768","775","777","779","780","784","794","795","796","797","809","821","823","839","859","865","883","889","892","893","896","898","899","900","901","902","903","906","907","908","910","925","926","932","933","946","949","952","962","968","1010","1013","1025","1027","1030","1031","1042","1044","1060","1061","1062","1070","1073","1075","1076","1085","1095","1107","1121","1129","1130","1150","1151","1165","1175","1181","1185","1189","1194","1195","1243","1268","1290","1304","1341","1342","1347","1348","1349","1350","1357","1358"];
const HIST_IA = ["7","159","267","297","317","427","437","442","447","478","497","811","1001","1643","1767","1961","2003","2020","2054","2089","2178","2216","2283","2321","2330","2569","2623","2801","2844","2925","3671","3672","3673","3677","3678","3679","3682","3683","3685","3686","3687","3688","3689","3690","3692","3693","3694","3699","3700","3702","3707","3710","3719","3733","3746","9999"];

const SYSTEM_PROMPT = `Você é o classificador de documentos contábeis da LCR Contadores.
Analise o documento enviado por um cliente e:
1. Identifique o TIPO entre: 'extrato_bancario', 'nfe_servico', 'nfe_produto', 'planilha_financeira', 'darf', 'guia_inss_fgts', 'recibo', 'fatura_cartao', 'fatura_fornecedor', 'comprovante', 'outro'.
   ('fatura_cartao' = extrato de cartão de crédito, GERA razão; 'fatura_fornecedor' = boleto/fatura de fornecedor ou serviço, é SUPORTE. NUNCA use só 'fatura' — escolha um dos dois.)

REGRA DECISIVA — como identificar EXTRATO BANCÁRIO:
Marque como 'extrato_bancario' SEMPRE que o documento contenha TODOS os 3 elementos:
   (a) Cabeçalho de conta bancária (banco, agência, conta corrente do titular)
   (b) SALDO ANTERIOR (ou "saldo inicial", "saldo do período anterior") no início
       E SALDO ATUAL (ou "saldo final", "saldo disponível") no fim
   (c) Tabela cronológica de movimentações do período com data + descrição +
       valor + saldo parcial (várias linhas mostrando entradas E saídas)

Formatos aceitos como extrato (GERAM lançamentos — razão):
- Extrato Itaú simplificado (uma coluna VALOR com sinal + coluna SALDO)
- Extrato Itaú completo (colunas DÉBITO/CRÉDITO separadas + SALDO)
- Extratos Bradesco, Santander, BB, Caixa, Nubank, Inter etc. no mesmo formato
- Posição consolidada de conta corrente (com saldo início/fim)
- Fatura/extrato de CARTÃO DE CRÉDITO ('fatura_cartao'): o documento traz a LISTA
  de compras do período. Extraia TODAS as compras individuais listadas — cada
  compra vira UM lançamento na razão. NÃO resuma, NÃO retorne só o total da fatura
  nem só a linha de pagamento. Se a fatura lista N compras, retorne N lançamentos.
- Extrato de MOVIMENTO de conta de investimento (aplicações, resgates, rendimentos
  do período, com datas) — cada movimento vira lançamento.

NÃO é extrato bancário (documento SUPORTE → lancamentos_sugeridos = []):
- Comprovante único de PIX/TED/DOC (mesmo que tenha "saldo disponível" no rodapé)
- Vários comprovantes agrupados num PDF (é 'comprovante', não extrato)
- Fatura/boleto de FORNECEDOR ou SERVIÇO (energia, água, telefone, internet,
  hospedagem, aluguel, mensalidade — 'fatura_fornecedor'): é conta a pagar,
  documento SUPORTE → lancamentos_sugeridos = []. NÃO confundir com fatura de
  cartão de crédito ('fatura_cartao'), que lista compras e GERA razão.
- POSIÇÃO de investimentos/CDB/renda fixa/poupança (foto dos papéis, SEM
  movimentação do período → é 'planilha_financeira')

REGRA ESPECÍFICA — POSIÇÃO CONSOLIDADA DE INVESTIMENTO (planilha_financeira):
Se o CSV/XLS contém QUALQUER uma destas colunas, é 'planilha_financeira' e
lancamentos_sugeridos DEVE ser [] (posição de investimento é documento suporte,
não gera lançamento contábil):
   SaldoBruto, SaldoLiquido, RendimentoTotal, IRPorcentagem, ValorPrincipal,
   Ativo (CDB, LCA, LCI, LC, LCF), Taxa (% do DI, CDI), Vencimento,
   Cotas, ValorDaCota, PU, Quantidade

DEFINIÇÕES ADICIONAIS:
* 'planilha_financeira' = POSIÇÃO consolidada de investimentos (CDB, renda fixa,
  poupança — foto dos papéis) e fluxos de caixa em planilha própria do cliente.
  (Atenção: o MOVIMENTO de uma conta de investimento — aplicações/resgates/
  rendimentos COM data no período — é 'extrato', gera lançamentos, NÃO planilha.)
* 'comprovante' = comprovantes avulsos de pagamento/transferência (1 PIX,
  1 TED, 1 DOC), ainda que agrupados num PDF — são só a prova, NÃO substituem
  o extrato bancário. Só use este tipo se NÃO houver saldo anterior/final +
  tabela contínua de movimentações do período.

2. Extraia os dados estruturados relevantes (resumo no campo dados_extraidos).
   Para extrato bancário, extraia SEMPRE (preencha os campos de TOPO 'agencia' e
   'conta', além do resumo em dados_extraidos):
     - banco
     - agencia (só o número) e conta (conta corrente COM o dígito verificador, com
       traço, como no cabeçalho — ex.: '33033-2'; não concatene o DV)
     - saldo_inicial e saldo_final (formato numérico)
     - periodo_inicio e periodo_fim (AAAA-MM-DD)
     - lista de movimentações
3. Sugira os LANÇAMENTOS contábeis correspondentes.

Regras:
- Use EXCLUSIVAMENTE códigos de conta e de histórico que existem no plano de contas e na lista de históricos passados no contexto (contas analíticas/folhas).
- Extrato bancário / fatura de cartão / movimento de conta de investimento: cada
  movimentação vira UM lançamento (fonte de razão).
- ANTI-DUPLICAÇÃO: o PAGAMENTO de fatura de cartão que aparece no extrato BANCÁRIO
  tem contrapartida "cartão a pagar" (ou transferência), NÃO uma despesa — a
  despesa já foi lançada nas compras da fatura; não conte em dobro.
- NF-e/Recibo/Planilha/Comprovante/Fluxo de caixa/POSIÇÃO de investimento: NÃO
  gere lançamentos (o sistema os usa como documento SUPORTE para enriquecer as
  linhas do extrato). Retorne lancamentos_sugeridos = [].
- Para documentos de SUPORTE (NF-e, recibo, DARF, fatura de fornecedor/serviço, comprovante), preencha
  o objeto dados_suporte com: valor_total (valor total do documento, positivo),
  data_documento (AAAA-MM-DD), participante (fornecedor/tomador/favorecido) e
  numero (nº do documento). Esses campos são usados para casar o documento de
  suporte com a linha correspondente do extrato bancário.
- valor sempre positivo. data_lancamento em AAAA-MM-DD. competencia em AAAA-MM.
- Se não tiver certeza da conta, use a conta do grupo correto mais próxima e marque confidence < 0.7.
- IMPORTANTE — tipo_movimento (perspectiva do BANCO no extrato): preencha SEMPRE
  com 'debito' (banco debitou = SAÍDA de dinheiro: pagamentos, transferências
  enviadas, tarifas, taxas, IOF) ou 'credito' (banco creditou = ENTRADA de
  dinheiro: recebimentos, depósitos, rendimentos, estorno). Esse campo
  determina a inversão D/C contábil — é crítico que esteja sempre preenchido.
  Regra prática: se o valor no extrato aparece com sinal negativo ou na coluna
  "Débito", tipo_movimento = 'debito'. Se aparece positivo ou na coluna
  "Crédito", tipo_movimento = 'credito'.`;

// Mapeia o tipo_documento que a IA retorna (texto livre) para o ENUM
// documento_tipo do banco. Reconhece sinônimos comuns.
// Mapeamento conservador: só promove para 'extrato' quando a IA diz
// explicitamente extrato bancário/movimento bancário. Comprovantes,
// transferências avulsas e posição consolidada de investimentos NÃO viram
// extrato — são tipos distintos (outros/planilha_financeira).
const TIPO_ALIAS: Record<string, string | null> = {
  extrato: "extrato",
  extrato_bancario: "extrato",
  extrato_consolidado: "extrato",
  movimento_bancario: "extrato",
  // posição/aplicações financeiras → planilha
  posicao_consolidada: "planilha_financeira",
  posicao_investimentos: "planilha_financeira",
  planilha_financeira: "planilha_financeira",
  planilha: "planilha_financeira",
  fluxo_caixa: "planilha_financeira",
  // comprovantes avulsos → outros (não há enum 'comprovante')
  comprovante: "outros",
  comprovantes: "outros",
  comprovante_bancario: "outros",
  transferencia: "outros",
  transferencias: "outros",
  darf: "darf",
  guia_inss_fgts: "darf",
  gps: "darf",
  guia: "darf",
  recibo: "recibo",
  recibo_pagamento: "recibo",
  fatura_cartao: "fatura_cartao",
  fatura_credito: "fatura_cartao",
  cartao_credito: "fatura_cartao",
  cartao: "fatura_cartao",
  // fatura de fornecedor/serviço = conta a pagar = SUPORTE (não razão)
  fatura_fornecedor: "outros",
  fatura_servico: "outros",
  boleto: "outros",
  fatura: "outros",  // 'fatura' genérica = fornecedor/serviço; cartão usa fatura_cartao
  movimento_contabil: "movimento_contabil",
  // NFs: deixa como null = preserva o tipo cadastrado no upload (nf_entrada
  // vs nf_saida depende do papel do cliente, a IA não tem como decidir).
  nfe_servico: null,
  nfe_produto: null,
  nf_entrada: "nf_entrada",
  nf_saida: "nf_saida",
  outro: "outros",
  outros: "outros",
};

function mapearTipoIa(tipo: string | undefined | null): string | null {
  if (!tipo) return null;
  const k = tipo.toLowerCase().replace(/[\s-]+/g, "_");
  if (k in TIPO_ALIAS) return TIPO_ALIAS[k];
  // Heurística de fallback por substring (mais conservadora: comprovante
  // vira "outros", não "extrato").
  if (k.includes("extrato") || k.includes("movimento_banc")) return "extrato";
  if (k.includes("posicao") || k.includes("aplicacao") || k.includes("investimento")) return "planilha_financeira";
  if (k.includes("planilha") || k.includes("fluxo")) return "planilha_financeira";
  if (k.includes("comprovante") || k.includes("transferencia")) return "outros";
  if (k.includes("darf") || k.includes("gps") || k.includes("guia")) return "darf";
  if (k.includes("recibo")) return "recibo";
  if (k.includes("cartao") || k.includes("cartão")) return "fatura_cartao";
  if (k.includes("fatura") || k.includes("boleto")) return "outros";  // fatura genérica/fornecedor = suporte
  return null;
}

// Dedup por identidade: chave 'agencia|conta|AAAA-MM'. MESMA normalização do motor
// local (src/parsers/extrato_bancario.py). O banco não entra na chave (o nº da conta
// já o identifica dentro do cliente). null se agência/conta faltarem → não deduplica.
function _digitosSemZeros(s: unknown): string | null {
  const d = String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}
// Conta canônica: dígitos, sem zeros à esquerda e SEM dígito verificador (grupo de
// 1-2 dígitos após separador -./espaço no fim). Espelha _norm_conta do Python — sem
// isto '33033-2' (local) vira '330332' e '33033' (IA soltou o DV) não casa.
function _normConta(raw: unknown): string | null {
  const s = String(raw ?? "");
  const m = s.match(/[-./ ](\d{1,2})\s*$/);
  let dig = s.replace(/\D/g, "");
  if (m && dig.length > m[1].length) dig = dig.slice(0, -m[1].length);
  return dig.replace(/^0+/, "") || null;
}
// Lê agência/conta dos campos estruturados de topo (agencia/conta no schema) com
// fallback ao resumo free-form dados_extraidos (compat com docs antigos).
function chaveExtrato(classificacao: Record<string, unknown>, competencia: string): string | null {
  const de = classificacao?.dados_extraidos;
  const obj = typeof de === "string"
    ? (() => { try { return JSON.parse(de); } catch { return {}; } })()
    : ((de ?? {}) as Record<string, unknown>);
  const ag = _digitosSemZeros(classificacao?.agencia ?? obj.agencia);
  const ct = _normConta(classificacao?.conta ?? classificacao?.conta_corrente ?? obj.conta ?? obj.conta_corrente);
  const comp = (competencia ?? "").slice(0, 7);
  if (!ag || !ct || comp.length !== 7) return null;
  return `${ag}|${ct}|${comp}`;
}

// #4: investimento fica FORA do dedup por identidade. A chave é agência|conta|mês
// SEM banco, então um CDB (mesmo se a IA o tipar como extrato_bancario) colidiria
// com a CC do mesmo mês; com overlap>=60% seria marcado duplicata e perderia razão.
// Movimento de investimento gera razão própria — não deve ser deduplicado contra a CC.
// Mesma lista de termos que o roteamento usa (detectar_tipo no motor local).
const INVESTIMENTO_KW = ["posic", "posiç", "investiment", "aplicac", "aplicaç",
                         "renda fixa", "renda-fixa", "cdb"];
function _ehInvestimentoNome(nome: unknown): boolean {
  const n = String(nome ?? "").toLowerCase();
  return INVESTIMENTO_KW.some((k) => n.includes(k));
}

// Confirma dedup por identidade: a chave (agência|conta|mês) NÃO inclui o banco, então
// dois bancos com mesma ag/conta/mês colidiriam. Antes de marcar duplicata, exigimos
// sobreposição real das transações (mesmo extrato ~100%; colisão de chave ~0%).
const OVERLAP_MIN_DEDUP = 0.6;
function _assinLanc(rows: { data_lancamento?: string | null; valor?: number | null }[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows ?? []) {
    const v = Number(r?.valor);
    if (!Number.isFinite(v)) continue;
    const d = String(r?.data_lancamento ?? "").slice(0, 10);
    s.add(`${d}|${(Math.round(Math.abs(v) * 100) / 100).toFixed(2)}`);
  }
  return s;
}
function _sobreposicao(aRows: { data_lancamento?: string | null; valor?: number | null }[],
                      bRows: { data_lancamento?: string | null; valor?: number | null }[]): number {
  const a = _assinLanc(aRows), b = _assinLanc(bRows);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo_documento: { type: "string" },
    cliente_identificado: { type: "string" },
    competencia: { type: "string", description: "AAAA-MM" },
    confidence_geral: { type: "number" },
    dados_extraidos: { type: "string", description: "Resumo/JSON dos dados extraídos" },
    agencia: { type: "string", description: "Só p/ extrato bancário: número da agência (ex.: '4465')." },
    conta: { type: "string", description: "Só p/ extrato bancário: conta corrente COM o dígito verificador, como impressa no cabeçalho (ex.: '33033-2'). Use o traço; não concatene o DV." },
    dados_suporte: {
      type: "object",
      additionalProperties: false,
      description: "Só p/ documentos de SUPORTE (NF, recibo, DARF, fatura, comprovante): dados p/ casar com a linha do extrato por valor+data. Deixe vazio p/ extrato bancário.",
      properties: {
        valor_total: { type: "number", description: "Valor total do documento (positivo)" },
        data_documento: { type: "string", description: "Data do documento em AAAA-MM-DD (emissão ou pagamento)" },
        participante: { type: "string", description: "Fornecedor/tomador/favorecido (nome ou CNPJ)" },
        numero: { type: "string", description: "Número da NF/recibo/documento" },
      },
    },
    lancamentos_sugeridos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          data_lancamento: { type: "string" },
          valor: { type: "number" },
          tipo_movimento: { type: "string", description: "'debito' = saída de dinheiro do banco (pagamento, transferência enviada); 'credito' = entrada (recebimento, depósito). SEMPRE preencher." },
          conta_codigo: { type: "string" },
          historico_codigo: { type: "string" },
          descricao: { type: "string" },
          confidence: { type: "number" },
          participante: { type: "string", description: "Nome/CNPJ do participante quando a conta exige (marcada com PARTICIPANTE no contexto). Vazio se não conseguir extrair." },
        },
        required: ["data_lancamento", "valor", "conta_codigo", "descricao"],
      },
    },
    observacoes: { type: "string" },
  },
  required: ["tipo_documento", "lancamentos_sugeridos"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const IMG: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const TEXTUAL = new Set(["xml", "csv", "txt", "json", "ofx"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("Secret ANTHROPIC_API_KEY não configurado.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json(401, { error: "Sem token" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "Token inválido" });

  let body: { documento_id?: string };
  try { body = await req.json(); } catch { return fail("JSON inválido"); }
  const documento_id = body.documento_id;
  if (!documento_id) return fail("documento_id obrigatório");

  const { data: doc, error: docErr } = await admin
    .from("documentos")
    .select("id, empresa_id, tipo, competencia, arquivo_url, arquivo_nome, storage_path, nao_duplicata, empresa:empresas(razao_social, cnpj)")
    .eq("id", documento_id)
    .maybeSingle();
  if (docErr) return fail(docErr.message);
  if (!doc) return fail("Documento não encontrado");

  const empresa = doc.empresa as { razao_social?: string; cnpj?: string } | null;
  await admin.from("documentos").update({ status_processamento: "processando" }).eq("id", documento_id);

  const markErro = async (msg: string) => {
    await admin.from("documentos").update({ status_processamento: "erro", classificacao_ia: { error: msg } }).eq("id", documento_id);
    return fail(msg);
  };

  // baixa o arquivo: prefere storage_path (bucket documentos-clientes), senão arquivo_url (bucket documentos)
  const bucket = doc.storage_path ? "documentos-clientes" : "documentos";
  const path = doc.storage_path ?? doc.arquivo_url;
  if (!path) return markErro("Documento sem arquivo para processar.");
  const { data: file, error: dlErr } = await admin.storage.from(bucket).download(path);
  if (dlErr || !file) return markErro(dlErr?.message ?? "Falha ao baixar o arquivo.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (doc.arquivo_nome ?? path).split(".").pop()?.toLowerCase() ?? "";

  // Sobe o arquivo pro bucket de conciliações e vincula como extrato_csv_url.
  // Chamado quando confirmado (pelo upload OU pela IA) que o documento é
  // EXTRATO BANCÁRIO. Não cria lançamentos aqui — isso acontece no pós-IA.
  async function uploadExtratoBucket(competenciaExtrato: string): Promise<string | null> {
    const safeName = (doc.arquivo_nome ?? "extrato").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const concPath = `${doc.empresa_id}/${competenciaExtrato}/extrato-${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await admin.storage.from("conciliacoes").upload(concPath, bytes, { upsert: false, cacheControl: "3600", contentType: file.type || "text/csv" });
    if (upErr) { await markErro(`Falha ao vincular extrato à conciliação: ${upErr.message}`); return null; }

    const { data: existente } = await admin.from("conciliacoes").select("id").eq("empresa_id", doc.empresa_id).eq("competencia", competenciaExtrato).maybeSingle();
    if (existente) {
      await admin.from("conciliacoes").update({ extrato_csv_url: concPath, status: "em_andamento" }).eq("id", existente.id);
    } else {
      await admin.from("conciliacoes").insert({ empresa_id: doc.empresa_id, competencia: competenciaExtrato, extrato_csv_url: concPath, status: "em_andamento" });
    }
    return concPath;
  }

  let contentBlock: Record<string, unknown>;
  if (ext === "pdf") contentBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } };
  else if (IMG[ext]) contentBlock = { type: "image", source: { type: "base64", media_type: IMG[ext], data: toBase64(bytes) } };
  else if (TEXTUAL.has(ext)) contentBlock = { type: "text", text: `Conteúdo do arquivo (${ext}):\n\n${new TextDecoder().decode(bytes).slice(0, 100_000)}` };
  else return markErro(`Tipo .${ext} não suportado (use PDF, imagem ou XML/CSV).`);

  // Contexto autoritativo: Plano de Contas oficial LCR + Plano de Históricos SCI
  // (Anexos 1 e 2). CONTAS_IA/HIST_IA continuam curando o subconjunto para
  // caber no limite de 10k tokens/min do Haiku, mas o conteúdo dos códigos
  // agora vem das tabelas oficiais — inclui apelido SCI, grupo, histórico
  // padrão sugerido e flag de participante.
  const contasIaInt = CONTAS_IA.map((c) => Number(c)).filter((n) => !Number.isNaN(n));
  const histIaInt = HIST_IA.map((c) => Number(c)).filter((n) => !Number.isNaN(n));
  const [{ data: contasLcr }, { data: histLcr }] = await Promise.all([
    admin.from("plano_de_contas_lcr").select("codigo, nome, grupo, apelido, historico_padrao, requer_participante").in("codigo", contasIaInt).order("codigo"),
    admin.from("historicos_sci_lcr").select("codigo, nome, apelido").in("codigo", histIaInt).order("codigo"),
  ]);
  const contasFmt = (contasLcr ?? []).map((c) => {
    const parts = [String(c.codigo), c.nome, c.grupo ?? ""].filter(Boolean);
    if (c.apelido) parts.push(`apelido ${c.apelido}`);
    if (c.historico_padrao) parts.push(`hist.padrão ${c.historico_padrao}`);
    if (c.requer_participante) parts.push("PARTICIPANTE");
    return parts.join(" | ");
  }).join("\n");
  const histFmt = (histLcr ?? []).map((h) => {
    const parts = [String(h.codigo), h.nome];
    if (h.apelido) parts.push(`apelido ${h.apelido}`);
    return parts.join(" | ");
  }).join("\n");
  const ctx =
    `Plano de Contas oficial LCR (${(contasLcr ?? []).length} contas — use SEMPRE o código \`codigo\` da coluna 1):\n${contasFmt}\n\n` +
    `Plano de Históricos SCI (${(histLcr ?? []).length} códigos):\n${histFmt}\n\n` +
    `REGRA: cada conta pode ter "hist.padrão" — quando existir, use ele como historico_codigo padrão (a menos que a movimentação claramente peça outro). Contas marcadas com "PARTICIPANTE" exigem identificação do participante (cliente/fornecedor) — se conseguir extrair do extrato, coloque no campo participante do lançamento.`;

  let classificacao: {
    tipo_documento: string; competencia?: string; confidence_geral?: number;
    dados_extraidos?: string; agencia?: string; conta?: string; conta_corrente?: string; observacoes?: string;
    lancamentos_sugeridos: { data_lancamento: string; valor: number; tipo_movimento?: string; conta_codigo: string; historico_codigo?: string; descricao: string; confidence?: number; participante?: string }[];
  };
  try {
    const reqBody = JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          // Plano de contas + históricos: idêntico em toda chamada → primeiro bloco,
          // com cache_control, p/ cortar ~90% dos tokens de input nas chamadas
          // subsequentes e aliviar o rate limit (10k tokens/min). Precede o documento
          // (volátil) para que o prefixo cacheado (system + ctx) seja reaproveitável.
          { type: "text", text: ctx, cache_control: { type: "ephemeral" } },
          contentBlock,
          { type: "text", text: `Empresa atual: ${empresa?.razao_social ?? "?"} (CNPJ ${empresa?.cnpj ?? "?"}). Classifique este documento e sugira os lançamentos.` },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    // Retry no 529 (overloaded) — sobrecarga transiente da Anthropic, backoff curto (10/20/30s).
    // O 429 (rate_limit) NÃO é retentado aqui: a espera de ~1min estouraria o timeout da edge;
    // quem chama (bridge_front.processar_documento_edge) reinvoca a edge após 65s.
    let apiResp: Response | undefined;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "content-type": "application/json",
        },
        body: reqBody,
      });
      if (apiResp.ok || apiResp.status !== 529) break;
      await new Promise((r) => setTimeout(r, 10000 * (tentativa + 1)));
    }
    if (!apiResp || !apiResp.ok) {
      return markErro(`Claude API ${apiResp?.status ?? "?"}: ${apiResp ? (await apiResp.text()).slice(0, 400) : "sem resposta"}`);
    }
    const dataApi = await apiResp.json();
    if (dataApi.stop_reason === "refusal") return markErro("A IA recusou processar este documento.");
    const tb = (dataApi.content ?? []).find((b: { type: string }) => b.type === "text");
    classificacao = JSON.parse(tb?.text ?? "{}");
  } catch (e) {
    return markErro(`Falha na Claude API: ${e instanceof Error ? e.message : String(e)}`);
  }

  const tipoMapeado = mapearTipoIa(classificacao.tipo_documento);
  // A IA (conteúdo) decide, mas mantemos doc.tipo==="extrato" como REDE DE SEGURANÇA
  // (ex.: fallback parser-local→edge, onde o doc já chega tipado como extrato).
  // Três conceitos distintos:
  //  - isExtratoBancario: é o extrato do BANCO → fonte da conciliação (extrato_csv_url).
  //  - isExtrato: gera razão (extrato bancário OU fatura/cartão OU movimento de invest.).
  //  - tipoFinal: identidade persistida — NÃO força cartão a virar "extrato".
  const isExtratoBancario = tipoMapeado === "extrato" || doc.tipo === "extrato";
  const isExtrato = isExtratoBancario || tipoMapeado === "fatura_cartao";
  const tipoFinal = isExtratoBancario ? "extrato" : (tipoMapeado ?? doc.tipo);
  if (tipoFinal !== doc.tipo) {
    await admin.from("documentos").update({ tipo: tipoFinal }).eq("id", documento_id);
  }

  // Competência = a da TAREFA/documento (o fechamento é no ciclo da cobrança —
  // ex.: extrato de abril enviado na cobrança de maio fecha em MAIO; não dá pra
  // fechar abril em abril, o mês não fechou). NÃO usar o mês extraído do conteúdo
  // pela IA (classificacao.competencia). Só cai no fallback se o doc não tiver.
  const competencia = doc.competencia
    ?? (classificacao.competencia && /^\d{4}-\d{2}$/.test(classificacao.competencia)
        ? classificacao.competencia
        : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

  // ─────────────── DOC SUPORTE (NF/recibo/planilha/comprovante) ───────────────
  // Não gera lançamentos. Os dados extraídos serão usados para enriquecer as
  // linhas do extrato quando ele chegar.
  if (!isExtrato) {
    await admin.from("documentos").update({
      status: "processado",
      status_processamento: "classificado",
      classificacao_ia: classificacao,
      dados_extraidos: classificacao,
      processado_em: new Date().toISOString(),
      lancamentos_gerados: 0,
    }).eq("id", documento_id);

    admin.functions.invoke("enriquecer-extrato", { body: { empresa_id: doc.empresa_id, competencia } })
      .catch(() => { /* não-fatal */ });

    return json(200, { ok: true, documento_suporte: true, lancamentos_gerados: 0, classificacao });
  }

  // ─────────── RAZÃO (extrato bancário / fatura de cartão / invest.) ───────────
  // A fonte da conciliação (extrato_csv_url) é SÓ o extrato do banco — cartão gera
  // razão mas NÃO sobrescreve o extrato bancário na conciliação daquela competência.
  // Dedup por IDENTIDADE (banco/agência/conta/mês = mesmo extrato). Se já existe um
  // original com esta chave nesta empresa → marca ESTE como duplicata e NÃO gera
  // razão (regra Rafa+Cleiton). Escapa por 'Não é duplicata / processar mesmo assim':
  // esse botão seta nao_duplicata=true, que ESTE guard respeita — senão o reprocesso
  // reencontraria o original e re-marcaria o doc como duplicata (escape hatch no-op).
  const chaveDedup = (isExtratoBancario && !_ehInvestimentoNome(doc.arquivo_nome))
    ? chaveExtrato(classificacao, competencia) : null;
  if (chaveDedup && !doc.nao_duplicata) {
    const { data: orig } = await admin.from("documentos").select("id, arquivo_nome")
      .eq("empresa_id", doc.empresa_id).eq("extrato_chave", chaveDedup)
      .is("duplicata_de", null).neq("id", documento_id).limit(1).maybeSingle();
    if (orig) {
      // Só marca duplicata se as transações realmente se sobrepõem (senão é colisão
      // de chave entre bancos distintos — segue e gera razão normal).
      const { data: origLancs } = await admin.from("lancamentos")
        .select("data_lancamento, valor").eq("documento_id", orig.id).eq("fonte_extrato", true);
      const ov = _sobreposicao(classificacao.lancamentos_sugeridos ?? [], origLancs ?? []);
      if ((origLancs?.length ?? 0) > 0 && ov >= OVERLAP_MIN_DEDUP) {
        await admin.from("lancamentos").delete().eq("documento_id", documento_id);
        await admin.from("documentos").update({
          status: "recebido", status_processamento: "duplicata", duplicata_de: orig.id,
          extrato_chave: chaveDedup, lancamentos_gerados: 0, tipo: tipoFinal,
          classificacao_ia: classificacao, dados_extraidos: classificacao,
          processado_em: new Date().toISOString(),
        }).eq("id", documento_id);
        return json(200, { ok: true, duplicata: true, duplicata_de: orig.id, lancamentos_gerados: 0 });
      }
      console.log(`dedup: chave ${chaveDedup} coincide com '${orig.arquivo_nome}' mas sobreposição ${Math.round(ov * 100)}% (orig ${origLancs?.length ?? 0} lanç.) — tratando como extrato próprio`);
    }
  }

  let concPath: string | null = null;
  if (isExtratoBancario) {
    concPath = await uploadExtratoBucket(competencia);
    if (!concPath) return fail("Falha ao vincular extrato.");
  }
  await admin.from("lancamentos").delete().eq("documento_id", documento_id);

  // Auto-sync banco/agência/conta → SÓ p/ extrato bancário (cartão não tem conta
  // corrente). Quando a IA extraiu, reflete no cadastro contas_bancarias.
  if (isExtratoBancario) try {
    const dadosStr = classificacao.dados_extraidos ?? "";
    const dadosObj: Record<string, unknown> = typeof dadosStr === "string"
      ? (() => { try { return JSON.parse(dadosStr); } catch { return {}; } })()
      : (dadosStr as Record<string, unknown>);
    const banco = String(dadosObj.banco ?? "").trim();
    const agencia = String(classificacao.agencia ?? dadosObj.agencia ?? "").trim();
    const conta = String(classificacao.conta ?? classificacao.conta_corrente ?? dadosObj.conta ?? dadosObj.conta_corrente ?? "").trim();
    if (banco && agencia && conta) {
      const { data: existente } = await admin
        .from("contas_bancarias")
        .select("id")
        .eq("empresa_id", doc.empresa_id)
        .eq("banco", banco)
        .eq("agencia", agencia)
        .eq("conta", conta)
        .maybeSingle();
      if (!existente) {
        await admin.from("contas_bancarias").insert({
          empresa_id: doc.empresa_id, banco, agencia, conta, tipo: "corrente",
        });
      }
    }
  } catch {
    // não-fatal: se der ruim, o extrato já foi processado normal.
  }

  // Fase 3: aplica defaults autoritativos ANTES de resolver ids per-empresa.
  // Para cada lançamento sugerido, se a IA não informou histórico, usamos
  // o historico_padrao da conta no plano oficial LCR. Também marcamos
  // requer_participante para o front sinalizar edição manual.
  const contaCodsInt = [...new Set((classificacao.lancamentos_sugeridos ?? [])
    .map((s) => Number(s.conta_codigo)).filter((n) => !Number.isNaN(n)))];
  const { data: pdcRows } = contaCodsInt.length
    ? await admin.from("plano_de_contas_lcr").select("codigo, historico_padrao, requer_participante").in("codigo", contaCodsInt)
    : { data: [] as { codigo: number; historico_padrao: number | null; requer_participante: boolean }[] };
  const pdcByCod = new Map((pdcRows ?? []).map((r) => [String(r.codigo), r]));
  for (const s of classificacao.lancamentos_sugeridos ?? []) {
    const pdc = pdcByCod.get(String(s.conta_codigo));
    if (pdc?.historico_padrao && !s.historico_codigo) {
      s.historico_codigo = String(pdc.historico_padrao);
    }
  }

  const contaCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.conta_codigo).filter(Boolean))];
  const histCods = [...new Set((classificacao.lancamentos_sugeridos ?? []).map((s) => s.historico_codigo).filter(Boolean) as string[])];
  const [{ data: contaRows }, { data: histRows }] = await Promise.all([
    contaCods.length ? admin.from("plano_contas").select("id, codigo").in("codigo", contaCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
    histCods.length ? admin.from("historicos_contabeis").select("id, codigo").in("codigo", histCods) : Promise.resolve({ data: [] as { id: string; codigo: string }[] }),
  ]);
  const contaId = new Map((contaRows ?? []).map((c) => [c.codigo, c.id]));
  const histId = new Map((histRows ?? []).map((h) => [h.codigo, h.id]));

  function normMov(s?: string | null): string | null {
    if (!s) return null;
    const v = String(s).toLowerCase().trim();
    if (v.startsWith("d")) return "debito";
    if (v.startsWith("c")) return "credito";
    return null;
  }

  const rows = (classificacao.lancamentos_sugeridos ?? []).map((s) => {
    const pdc = pdcByCod.get(String(s.conta_codigo));
    const pdcCodigo = pdc ? Number(s.conta_codigo) : null;
    const histSciCodigo = s.historico_codigo && !Number.isNaN(Number(s.historico_codigo)) ? Number(s.historico_codigo) : null;
    return {
      empresa_id: doc.empresa_id,
      conta_id: contaId.get(s.conta_codigo) ?? null,
      historico_id: s.historico_codigo ? (histId.get(s.historico_codigo) ?? null) : null,
      pdc_codigo: pdcCodigo,
      hist_sci_codigo: histSciCodigo,
      requer_participante: pdc?.requer_participante ?? false,
      participante: s.participante ? s.participante.slice(0, 120) : null,
      data_lancamento: /^\d{4}-\d{2}-\d{2}$/.test(s.data_lancamento) ? s.data_lancamento : null,
      valor: Math.abs(Number(s.valor) || 0),
      descricao: (s.descricao ?? "").slice(0, 200),
      natureza_movimento: normMov(s.tipo_movimento),
      competencia,
      status: "gerada" as const,
      confidence: typeof s.confidence === "number" ? s.confidence : null,
      documento_id,
      fonte_extrato: true,
      enriquecido: false,
    };
  });

  // Filtro de janela de competência (±1 mês) — espelha o parser local, evita
  // sangramento de datas de meses alheios (ex.: compras antigas na fatura, extrato
  // multi-mês). Linha sem data válida passa (não dá p/ janelar).
  const [cy, cm] = competencia.split("-").map(Number);
  const compIdx = cy * 12 + (cm - 1);
  const rowsJanela = rows.filter((r) => {
    if (!r.data_lancamento) return true;
    const [y, m] = r.data_lancamento.split("-").map(Number);
    return Math.abs((y * 12 + (m - 1)) - compIdx) <= 1;
  });
  const foraJanela = rows.length - rowsJanela.length;

  // Reprocesso idempotente: remove a razão anterior DESTE documento antes de
  // reinserir (senão reprocessar o mesmo doc duplica a razão).
  await admin.from("lancamentos").delete().eq("documento_id", documento_id).eq("fonte_extrato", true);

  let lancCriados = 0;
  if (rowsJanela.length) {
    const { error: insErr, count } = await admin.from("lancamentos").insert(rowsJanela, { count: "exact" });
    if (insErr) return markErro(`Falha ao inserir lançamentos do extrato: ${insErr.message}`);
    lancCriados = count ?? rowsJanela.length;
  }
  if (foraJanela) console.log(`janela competência: ${foraJanela} lançamento(s) fora de ±1 mês descartado(s)`);

  await admin.from("documentos").update({
    tipo: tipoFinal,
    status: "processado",
    status_processamento: "classificado",
    classificacao_ia: classificacao,
    dados_extraidos: classificacao,
    processado_em: new Date().toISOString(),
    lancamentos_gerados: lancCriados,
    extrato_chave: chaveDedup,  // identidade p/ dedup dos próximos extratos
  }).eq("id", documento_id);

  admin.functions.invoke("enriquecer-extrato", { body: { empresa_id: doc.empresa_id, competencia } })
    .catch(() => { /* não-fatal */ });

  return json(200, {
    ok: true,
    extrato: true,
    extrato_csv_url: concPath,
    lancamentos_gerados: lancCriados,
    classificacao,
  });
});
