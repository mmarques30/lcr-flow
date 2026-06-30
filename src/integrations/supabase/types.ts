export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          acao: string
          criado_em: string
          dados_antes: Json | null
          dados_depois: Json | null
          id: string
          registro_id: string | null
          tabela: string
          user_id: string | null
        }
        Insert: {
          acao: string
          criado_em?: string
          dados_antes?: Json | null
          dados_depois?: Json | null
          id?: string
          registro_id?: string | null
          tabela: string
          user_id?: string | null
        }
        Update: {
          acao?: string
          criado_em?: string
          dados_antes?: Json | null
          dados_depois?: Json | null
          id?: string
          registro_id?: string | null
          tabela?: string
          user_id?: string | null
        }
        Relationships: []
      }
      cerebro_interactions: {
        Row: {
          created_at: string | null
          duracao_ms: number | null
          empresa_id: string | null
          fontes_consultadas: Json | null
          id: number
          modelo: string | null
          pergunta: string
          persona: string
          resposta: string | null
          tokens_usados: number | null
          usuario_id: string | null
          util: boolean | null
        }
        Insert: {
          created_at?: string | null
          duracao_ms?: number | null
          empresa_id?: string | null
          fontes_consultadas?: Json | null
          id?: number
          modelo?: string | null
          pergunta: string
          persona: string
          resposta?: string | null
          tokens_usados?: number | null
          usuario_id?: string | null
          util?: boolean | null
        }
        Update: {
          created_at?: string | null
          duracao_ms?: number | null
          empresa_id?: string | null
          fontes_consultadas?: Json | null
          id?: number
          modelo?: string | null
          pergunta?: string
          persona?: string
          resposta?: string | null
          tokens_usados?: number | null
          usuario_id?: string | null
          util?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cerebro_interactions_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      competencias: {
        Row: {
          atualizado_em: string
          criado_em: string
          empresa_id: string
          fechado_em: string | null
          id: string
          iniciado_em: string | null
          observacoes: string | null
          periodo: string
          status: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          empresa_id: string
          fechado_em?: string | null
          id?: string
          iniciado_em?: string | null
          observacoes?: string | null
          periodo: string
          status?: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          empresa_id?: string
          fechado_em?: string | null
          id?: string
          iniciado_em?: string | null
          observacoes?: string | null
          periodo?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "competencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacoes: {
        Row: {
          competencia: string
          competencia_id: string | null
          concluido_em: string | null
          created_at: string
          divergencias_count: number
          empresa_id: string
          extrato_csv_url: string | null
          id: string
          planilha_conciliacao_url: string | null
          razao_csv_url: string | null
          resultado: Json | null
          status: Database["public"]["Enums"]["conciliacao_status"]
          updated_at: string
        }
        Insert: {
          competencia: string
          competencia_id?: string | null
          concluido_em?: string | null
          created_at?: string
          divergencias_count?: number
          empresa_id: string
          extrato_csv_url?: string | null
          id?: string
          planilha_conciliacao_url?: string | null
          razao_csv_url?: string | null
          resultado?: Json | null
          status?: Database["public"]["Enums"]["conciliacao_status"]
          updated_at?: string
        }
        Update: {
          competencia?: string
          competencia_id?: string | null
          concluido_em?: string | null
          created_at?: string
          divergencias_count?: number
          empresa_id?: string
          extrato_csv_url?: string | null
          id?: string
          planilha_conciliacao_url?: string | null
          razao_csv_url?: string | null
          resultado?: Json | null
          status?: Database["public"]["Enums"]["conciliacao_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conciliacoes_competencia_id_fkey"
            columns: ["competencia_id"]
            isOneToOne: false
            referencedRelation: "competencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      consultive_benchmarks: {
        Row: {
          atualizado_em: string | null
          cnae: string
          fonte: string | null
          id: number
          indicador: string
          percentil_25: number | null
          percentil_75: number | null
          valor_mediano: number | null
        }
        Insert: {
          atualizado_em?: string | null
          cnae: string
          fonte?: string | null
          id?: number
          indicador: string
          percentil_25?: number | null
          percentil_75?: number | null
          valor_mediano?: number | null
        }
        Update: {
          atualizado_em?: string | null
          cnae?: string
          fonte?: string | null
          id?: number
          indicador?: string
          percentil_25?: number | null
          percentil_75?: number | null
          valor_mediano?: number | null
        }
        Relationships: []
      }
      consultive_insights: {
        Row: {
          contexto_fonte: Json | null
          created_at: string | null
          criado_por_ia: boolean | null
          descricao: string
          empresa_id: string
          id: number
          prazo: string | null
          severidade: string
          status: string | null
          sugestao_acao: string | null
          tipo: string
          titulo: string
          updated_at: string | null
          valor_estimado: number | null
        }
        Insert: {
          contexto_fonte?: Json | null
          created_at?: string | null
          criado_por_ia?: boolean | null
          descricao: string
          empresa_id: string
          id?: number
          prazo?: string | null
          severidade: string
          status?: string | null
          sugestao_acao?: string | null
          tipo: string
          titulo: string
          updated_at?: string | null
          valor_estimado?: number | null
        }
        Update: {
          contexto_fonte?: Json | null
          created_at?: string | null
          criado_por_ia?: boolean | null
          descricao?: string
          empresa_id?: string
          id?: number
          prazo?: string | null
          severidade?: string
          status?: string | null
          sugestao_acao?: string | null
          tipo?: string
          titulo?: string
          updated_at?: string | null
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultive_insights_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      consultive_snapshots: {
        Row: {
          calculado_em: string | null
          despesa_total: number | null
          empresa_id: string
          endividamento: number | null
          id: number
          liquidez_corrente: number | null
          margem_bruta: number | null
          metadados: Json | null
          periodo: string
          receita_total: number | null
          variacao_mes_anterior: number | null
        }
        Insert: {
          calculado_em?: string | null
          despesa_total?: number | null
          empresa_id: string
          endividamento?: number | null
          id?: number
          liquidez_corrente?: number | null
          margem_bruta?: number | null
          metadados?: Json | null
          periodo: string
          receita_total?: number | null
          variacao_mes_anterior?: number | null
        }
        Update: {
          calculado_em?: string | null
          despesa_total?: number | null
          empresa_id?: string
          endividamento?: number | null
          id?: number
          liquidez_corrente?: number | null
          margem_bruta?: number | null
          metadados?: Json | null
          periodo?: string
          receita_total?: number | null
          variacao_mes_anterior?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultive_snapshots_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_bancarias: {
        Row: {
          agencia: string
          banco: string
          conta: string
          created_at: string
          empresa_id: string
          id: string
          tipo: Database["public"]["Enums"]["conta_tipo"]
          updated_at: string
        }
        Insert: {
          agencia: string
          banco: string
          conta: string
          created_at?: string
          empresa_id: string
          id?: string
          tipo?: Database["public"]["Enums"]["conta_tipo"]
          updated_at?: string
        }
        Update: {
          agencia?: string
          banco?: string
          conta?: string
          created_at?: string
          empresa_id?: string
          id?: string
          tipo?: Database["public"]["Enums"]["conta_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_bancarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cx_engagement_events: {
        Row: {
          created_at: string | null
          empresa_id: string
          evento: string
          id: number
          payload: Json | null
          peso: number | null
        }
        Insert: {
          created_at?: string | null
          empresa_id: string
          evento: string
          id?: number
          payload?: Json | null
          peso?: number | null
        }
        Update: {
          created_at?: string | null
          empresa_id?: string
          evento?: string
          id?: number
          payload?: Json | null
          peso?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cx_engagement_events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cx_health_score: {
        Row: {
          calculado_em: string | null
          classificacao: string | null
          empresa_id: string
          fatores: Json | null
          id: number
          score: number | null
          tendencia: string | null
        }
        Insert: {
          calculado_em?: string | null
          classificacao?: string | null
          empresa_id: string
          fatores?: Json | null
          id?: number
          score?: number | null
          tendencia?: string | null
        }
        Update: {
          calculado_em?: string | null
          classificacao?: string | null
          empresa_id?: string
          fatores?: Json | null
          id?: number
          score?: number | null
          tendencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cx_health_score_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cx_nps_responses: {
        Row: {
          categoria: string | null
          comentario: string | null
          created_at: string | null
          empresa_id: string
          id: number
          periodo: string
          respondido_por: string | null
          score: number
        }
        Insert: {
          categoria?: string | null
          comentario?: string | null
          created_at?: string | null
          empresa_id: string
          id?: number
          periodo: string
          respondido_por?: string | null
          score: number
        }
        Update: {
          categoria?: string | null
          comentario?: string | null
          created_at?: string | null
          empresa_id?: string
          id?: number
          periodo?: string
          respondido_por?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "cx_nps_responses_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cx_touchpoints: {
        Row: {
          canal: string | null
          created_at: string | null
          descricao: string | null
          empresa_id: string
          id: number
          payload: Json | null
          tipo: string
          usuario_lcr_id: string | null
        }
        Insert: {
          canal?: string | null
          created_at?: string | null
          descricao?: string | null
          empresa_id: string
          id?: number
          payload?: Json | null
          tipo: string
          usuario_lcr_id?: string | null
        }
        Update: {
          canal?: string | null
          created_at?: string | null
          descricao?: string | null
          empresa_id?: string
          id?: number
          payload?: Json | null
          tipo?: string
          usuario_lcr_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cx_touchpoints_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos: {
        Row: {
          arquivo_nome: string | null
          arquivo_tamanho_bytes: number | null
          arquivo_url: string | null
          classificacao_ia: Json | null
          competencia: string
          competencia_id: string | null
          created_at: string
          dados_extraidos: Json
          documento_id: string | null
          empresa_id: string
          gestta_ref: string | null
          hash_sha256: string | null
          id: string
          lancamentos_gerados: number | null
          mime_type: string | null
          origem: Database["public"]["Enums"]["documento_origem"]
          processado_em: string | null
          recebido_em: string
          responsavel_id: string | null
          status: Database["public"]["Enums"]["documento_status"]
          status_processamento: string | null
          storage_path: string | null
          tamanho_bytes: number | null
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_tamanho_bytes?: number | null
          arquivo_url?: string | null
          classificacao_ia?: Json | null
          competencia: string
          competencia_id?: string | null
          created_at?: string
          dados_extraidos?: Json
          documento_id?: string | null
          empresa_id: string
          gestta_ref?: string | null
          hash_sha256?: string | null
          id?: string
          lancamentos_gerados?: number | null
          mime_type?: string | null
          origem?: Database["public"]["Enums"]["documento_origem"]
          processado_em?: string | null
          recebido_em?: string
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["documento_status"]
          status_processamento?: string | null
          storage_path?: string | null
          tamanho_bytes?: number | null
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_tamanho_bytes?: number | null
          arquivo_url?: string | null
          classificacao_ia?: Json | null
          competencia?: string
          competencia_id?: string | null
          created_at?: string
          dados_extraidos?: Json
          documento_id?: string | null
          empresa_id?: string
          gestta_ref?: string | null
          hash_sha256?: string | null
          id?: string
          lancamentos_gerados?: number | null
          mime_type?: string | null
          origem?: Database["public"]["Enums"]["documento_origem"]
          processado_em?: string | null
          recebido_em?: string
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["documento_status"]
          status_processamento?: string | null
          storage_path?: string | null
          tamanho_bytes?: number | null
          tipo?: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_competencia_id_fkey"
            columns: ["competencia_id"]
            isOneToOne: false
            referencedRelation: "competencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios_perfil"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_esperados: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          obrigatorio: boolean
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          obrigatorio?: boolean
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          obrigatorio?: boolean
          tipo?: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_esperados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativo: boolean
          cnpj: string | null
          codigo_gestta: string | null
          consultor_id: string | null
          created_at: string
          dia_fechamento: number | null
          id: string
          importado_em: string | null
          is_demo: boolean
          mensalidade: number | null
          nome_fantasia: string | null
          nome_normalizado: string | null
          observacoes: string | null
          qtd_tarefas_mes: number | null
          razao_social: string
          regime: Database["public"]["Enums"]["regime_tributario"] | null
          regime_origem: string | null
          segmento: string | null
          status: Database["public"]["Enums"]["empresa_status"]
          tags: string[]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cnpj?: string | null
          codigo_gestta?: string | null
          consultor_id?: string | null
          created_at?: string
          dia_fechamento?: number | null
          id?: string
          importado_em?: string | null
          is_demo?: boolean
          mensalidade?: number | null
          nome_fantasia?: string | null
          nome_normalizado?: string | null
          observacoes?: string | null
          qtd_tarefas_mes?: number | null
          razao_social: string
          regime?: Database["public"]["Enums"]["regime_tributario"] | null
          regime_origem?: string | null
          segmento?: string | null
          status?: Database["public"]["Enums"]["empresa_status"]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cnpj?: string | null
          codigo_gestta?: string | null
          consultor_id?: string | null
          created_at?: string
          dia_fechamento?: number | null
          id?: string
          importado_em?: string | null
          is_demo?: boolean
          mensalidade?: number | null
          nome_fantasia?: string | null
          nome_normalizado?: string | null
          observacoes?: string | null
          qtd_tarefas_mes?: number | null
          razao_social?: string
          regime?: Database["public"]["Enums"]["regime_tributario"] | null
          regime_origem?: string | null
          segmento?: string | null
          status?: Database["public"]["Enums"]["empresa_status"]
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_consultor_id_fkey"
            columns: ["consultor_id"]
            isOneToOne: false
            referencedRelation: "usuarios_perfil"
            referencedColumns: ["id"]
          },
        ]
      }
      historicos_contabeis: {
        Row: {
          ativo: boolean
          codigo: string
          criado_em: string
          descricao: string
          empresa_id: string | null
          id: string
          sci_apelido: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          descricao: string
          empresa_id?: string | null
          id?: string
          sci_apelido?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          descricao?: string
          empresa_id?: string | null
          id?: string
          sci_apelido?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historicos_contabeis_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      integracoes: {
        Row: {
          atualizado_em: string
          config: Json
          id: string
          status: string
          tipo: string
          ultima_sync: string | null
          updated_at: string
        }
        Insert: {
          atualizado_em?: string
          config?: Json
          id?: string
          status?: string
          tipo: string
          ultima_sync?: string | null
          updated_at?: string
        }
        Update: {
          atualizado_em?: string
          config?: Json
          id?: string
          status?: string
          tipo?: string
          ultima_sync?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kb_articles: {
        Row: {
          ativo: boolean | null
          autor_id: string | null
          categoria: string | null
          conteudo_markdown: string
          created_at: string | null
          embedding: string | null
          id: number
          processo_id: number | null
          tags: string[] | null
          titulo: string
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          autor_id?: string | null
          categoria?: string | null
          conteudo_markdown: string
          created_at?: string | null
          embedding?: string | null
          id?: number
          processo_id?: number | null
          tags?: string[] | null
          titulo: string
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          autor_id?: string | null
          categoria?: string | null
          conteudo_markdown?: string
          created_at?: string | null
          embedding?: string | null
          id?: number
          processo_id?: number | null
          tags?: string[] | null
          titulo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "kb_processos"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_processo_passos: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: number
          ordem: number
          processo_id: number | null
          titulo: string
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: number
          ordem: number
          processo_id?: number | null
          titulo: string
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: number
          ordem?: number
          processo_id?: number | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_processo_passos_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "kb_processos"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_processos: {
        Row: {
          area: string
          ativo: boolean | null
          codigo: string
          created_at: string | null
          descricao: string | null
          id: number
          link_execucao: string | null
          nome: string
          ordem: number | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          area: string
          ativo?: boolean | null
          codigo: string
          created_at?: string | null
          descricao?: string | null
          id?: number
          link_execucao?: string | null
          nome: string
          ordem?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          area?: string
          ativo?: boolean | null
          codigo?: string
          created_at?: string | null
          descricao?: string | null
          id?: number
          link_execucao?: string | null
          nome?: string
          ordem?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      kb_videos: {
        Row: {
          categoria: string | null
          created_at: string | null
          duracao_segundos: number | null
          id: number
          processo_id: number | null
          thumbnail_url: string | null
          titulo: string
          url: string
        }
        Insert: {
          categoria?: string | null
          created_at?: string | null
          duracao_segundos?: number | null
          id?: number
          processo_id?: number | null
          thumbnail_url?: string | null
          titulo: string
          url: string
        }
        Update: {
          categoria?: string | null
          created_at?: string | null
          duracao_segundos?: number | null
          id?: number
          processo_id?: number | null
          thumbnail_url?: string | null
          titulo?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_videos_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "kb_processos"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos: {
        Row: {
          competencia: string
          competencia_id: string | null
          conciliado: boolean
          confidence: number | null
          conta_id: string | null
          created_at: string
          data_lancamento: string | null
          descricao: string | null
          documento_id: string | null
          documento_numero: string | null
          empresa_id: string
          historico_id: string | null
          id: string
          importado_em: string | null
          linhas_count: number | null
          natureza_movimento: string | null
          part_cred: string | null
          part_deb: string | null
          planilha_url: string | null
          status: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos: number
          updated_at: string
          valor: number | null
        }
        Insert: {
          competencia: string
          competencia_id?: string | null
          conciliado?: boolean
          confidence?: number | null
          conta_id?: string | null
          created_at?: string
          data_lancamento?: string | null
          descricao?: string | null
          documento_id?: string | null
          documento_numero?: string | null
          empresa_id: string
          historico_id?: string | null
          id?: string
          importado_em?: string | null
          linhas_count?: number | null
          natureza_movimento?: string | null
          part_cred?: string | null
          part_deb?: string | null
          planilha_url?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos?: number
          updated_at?: string
          valor?: number | null
        }
        Update: {
          competencia?: string
          competencia_id?: string | null
          conciliado?: boolean
          confidence?: number | null
          conta_id?: string | null
          created_at?: string
          data_lancamento?: string | null
          descricao?: string | null
          documento_id?: string | null
          documento_numero?: string | null
          empresa_id?: string
          historico_id?: string | null
          id?: string
          importado_em?: string | null
          linhas_count?: number | null
          natureza_movimento?: string | null
          part_cred?: string | null
          part_deb?: string | null
          planilha_url?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos?: number
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_competencia_id_fkey"
            columns: ["competencia_id"]
            isOneToOne: false
            referencedRelation: "competencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "plano_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_historico_id_fkey"
            columns: ["historico_id"]
            isOneToOne: false
            referencedRelation: "historicos_contabeis"
            referencedColumns: ["id"]
          },
        ]
      }
      permissoes_perfil: {
        Row: {
          atualizado_em: string
          chaves: string[]
          perfil: string
        }
        Insert: {
          atualizado_em?: string
          chaves?: string[]
          perfil: string
        }
        Update: {
          atualizado_em?: string
          chaves?: string[]
          perfil?: string
        }
        Relationships: []
      }
      plano_contas: {
        Row: {
          ativo: boolean
          atualizado_em: string
          codigo: string
          conta_pai_id: string | null
          criado_em: string
          descricao: string
          empresa_id: string | null
          id: string
          sci_apelido: string | null
          sci_historico_padrao: string | null
          tipo: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          codigo: string
          conta_pai_id?: string | null
          criado_em?: string
          descricao: string
          empresa_id?: string | null
          id?: string
          sci_apelido?: string | null
          sci_historico_padrao?: string | null
          tipo?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          codigo?: string
          conta_pai_id?: string | null
          criado_em?: string
          descricao?: string
          empresa_id?: string | null
          id?: string
          sci_apelido?: string | null
          sci_historico_padrao?: string | null
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_conta_pai_id_fkey"
            columns: ["conta_pai_id"]
            isOneToOne: false
            referencedRelation: "plano_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          competencia: string | null
          competencia_id: string | null
          concluido_em: string | null
          consultor_id: string | null
          created_at: string
          empresa_id: string
          gestta_task_id: string | null
          id: string
          ordem: number
          prazo: string | null
          status: Database["public"]["Enums"]["tarefa_status"]
          tipo: Database["public"]["Enums"]["tarefa_tipo"]
          titulo: string
          updated_at: string
        }
        Insert: {
          competencia?: string | null
          competencia_id?: string | null
          concluido_em?: string | null
          consultor_id?: string | null
          created_at?: string
          empresa_id: string
          gestta_task_id?: string | null
          id?: string
          ordem?: number
          prazo?: string | null
          status?: Database["public"]["Enums"]["tarefa_status"]
          tipo: Database["public"]["Enums"]["tarefa_tipo"]
          titulo: string
          updated_at?: string
        }
        Update: {
          competencia?: string | null
          competencia_id?: string | null
          concluido_em?: string | null
          consultor_id?: string | null
          created_at?: string
          empresa_id?: string
          gestta_task_id?: string | null
          id?: string
          ordem?: number
          prazo?: string | null
          status?: Database["public"]["Enums"]["tarefa_status"]
          tipo?: Database["public"]["Enums"]["tarefa_tipo"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_competencia_id_fkey"
            columns: ["competencia_id"]
            isOneToOne: false
            referencedRelation: "competencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_consultor_id_fkey"
            columns: ["consultor_id"]
            isOneToOne: false
            referencedRelation: "usuarios_perfil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios_perfil: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          perfil: Database["public"]["Enums"]["perfil_usuario"]
          permissoes_custom: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          perfil?: Database["public"]["Enums"]["perfil_usuario"]
          permissoes_custom?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          perfil?: Database["public"]["Enums"]["perfil_usuario"]
          permissoes_custom?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agregar_lancamentos_sci: {
        Args: { p_competencia: string; p_empresa_id: string }
        Returns: {
          conta_codigo: string
          conta_descricao: string
          conta_tipo: string
          qtd_lancamentos: number
          total: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      sci_planilha: {
        Args: { p_competencia: string; p_empresa_id: string }
        Returns: {
          codigo: string
          descricao: string
          tipo: string
          total: number
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_meu_perfil: {
        Args: { p_avatar: string; p_nome: string }
        Returns: undefined
      }
    }
    Enums: {
      conciliacao_status:
        | "nao_iniciada"
        | "em_andamento"
        | "divergencias"
        | "concluida"
      conta_tipo: "corrente" | "aplicacao" | "poupanca"
      documento_origem: "gestta" | "manual" | "upload_manual" | "email"
      documento_status:
        | "recebido"
        | "classificado"
        | "processado"
        | "conciliado"
        | "erro"
      documento_tipo:
        | "extrato"
        | "nf_entrada"
        | "nf_saida"
        | "fatura_cartao"
        | "recibo"
        | "darf"
        | "planilha_financeira"
        | "movimento_contabil"
        | "outros"
      empresa_status:
        | "em_dia"
        | "cobranca"
        | "lancamento"
        | "conciliacao"
        | "entregue"
        | "atrasado"
      lancamento_status:
        | "gerada"
        | "upload_leveldrive"
        | "importada_sci"
        | "pendente"
        | "planilha_gerada"
        | "enviado_leveldrive"
        | "importado_sci"
        | "validado"
      perfil_usuario: "admin" | "consultor" | "assistente"
      regime_tributario: "simples" | "presumido" | "real" | "mei"
      tarefa_status:
        | "now"
        | "doing"
        | "next"
        | "back"
        | "done"
        | "aberta"
        | "em_andamento"
        | "concluida"
        | "bloqueada"
      tarefa_tipo:
        | "cobranca"
        | "lancamentos"
        | "conciliacao"
        | "cobranca_movimento"
        | "lancamentos_contabeis"
        | "conciliacao_balancete"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      conciliacao_status: [
        "nao_iniciada",
        "em_andamento",
        "divergencias",
        "concluida",
      ],
      conta_tipo: ["corrente", "aplicacao", "poupanca"],
      documento_origem: ["gestta", "manual", "upload_manual", "email"],
      documento_status: [
        "recebido",
        "classificado",
        "processado",
        "conciliado",
        "erro",
      ],
      documento_tipo: [
        "extrato",
        "nf_entrada",
        "nf_saida",
        "fatura_cartao",
        "recibo",
        "darf",
        "planilha_financeira",
        "movimento_contabil",
        "outros",
      ],
      empresa_status: [
        "em_dia",
        "cobranca",
        "lancamento",
        "conciliacao",
        "entregue",
        "atrasado",
      ],
      lancamento_status: [
        "gerada",
        "upload_leveldrive",
        "importada_sci",
        "pendente",
        "planilha_gerada",
        "enviado_leveldrive",
        "importado_sci",
        "validado",
      ],
      perfil_usuario: ["admin", "consultor", "assistente"],
      regime_tributario: ["simples", "presumido", "real", "mei"],
      tarefa_status: [
        "now",
        "doing",
        "next",
        "back",
        "done",
        "aberta",
        "em_andamento",
        "concluida",
        "bloqueada",
      ],
      tarefa_tipo: [
        "cobranca",
        "lancamentos",
        "conciliacao",
        "cobranca_movimento",
        "lancamentos_contabeis",
        "conciliacao_balancete",
      ],
    },
  },
} as const
