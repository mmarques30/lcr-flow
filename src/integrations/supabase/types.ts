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
          id: string
          planilha_conciliacao_url: string | null
          razao_csv_url: string | null
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
          id?: string
          planilha_conciliacao_url?: string | null
          razao_csv_url?: string | null
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
          id?: string
          planilha_conciliacao_url?: string | null
          razao_csv_url?: string | null
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
      documentos: {
        Row: {
          arquivo_nome: string | null
          arquivo_tamanho_bytes: number | null
          arquivo_url: string | null
          competencia: string
          competencia_id: string | null
          created_at: string
          dados_extraidos: Json
          documento_id: string | null
          empresa_id: string
          gestta_ref: string | null
          id: string
          origem: Database["public"]["Enums"]["documento_origem"]
          processado_em: string | null
          recebido_em: string
          responsavel_id: string | null
          status: Database["public"]["Enums"]["documento_status"]
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_tamanho_bytes?: number | null
          arquivo_url?: string | null
          competencia: string
          competencia_id?: string | null
          created_at?: string
          dados_extraidos?: Json
          documento_id?: string | null
          empresa_id: string
          gestta_ref?: string | null
          id?: string
          origem?: Database["public"]["Enums"]["documento_origem"]
          processado_em?: string | null
          recebido_em?: string
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["documento_status"]
          tipo: Database["public"]["Enums"]["documento_tipo"]
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_tamanho_bytes?: number | null
          arquivo_url?: string | null
          competencia?: string
          competencia_id?: string | null
          created_at?: string
          dados_extraidos?: Json
          documento_id?: string | null
          empresa_id?: string
          gestta_ref?: string | null
          id?: string
          origem?: Database["public"]["Enums"]["documento_origem"]
          processado_em?: string | null
          recebido_em?: string
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["documento_status"]
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
          cnpj: string
          consultor_id: string | null
          created_at: string
          id: string
          is_demo: boolean
          nome_fantasia: string | null
          razao_social: string
          regime: Database["public"]["Enums"]["regime_tributario"]
          segmento: string | null
          status: Database["public"]["Enums"]["empresa_status"]
          tags: string[]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cnpj: string
          consultor_id?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          nome_fantasia?: string | null
          razao_social: string
          regime?: Database["public"]["Enums"]["regime_tributario"]
          segmento?: string | null
          status?: Database["public"]["Enums"]["empresa_status"]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cnpj?: string
          consultor_id?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          nome_fantasia?: string | null
          razao_social?: string
          regime?: Database["public"]["Enums"]["regime_tributario"]
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
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          descricao: string
          empresa_id?: string | null
          id?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          descricao?: string
          empresa_id?: string | null
          id?: string
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
      lancamentos: {
        Row: {
          competencia: string
          competencia_id: string | null
          created_at: string
          documento_id: string | null
          empresa_id: string
          id: string
          importado_em: string | null
          linhas_count: number | null
          planilha_url: string | null
          status: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos: number
          updated_at: string
        }
        Insert: {
          competencia: string
          competencia_id?: string | null
          created_at?: string
          documento_id?: string | null
          empresa_id: string
          id?: string
          importado_em?: string | null
          linhas_count?: number | null
          planilha_url?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos?: number
          updated_at?: string
        }
        Update: {
          competencia?: string
          competencia_id?: string | null
          created_at?: string
          documento_id?: string | null
          empresa_id?: string
          id?: string
          importado_em?: string | null
          linhas_count?: number | null
          planilha_url?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          total_lancamentos?: number
          updated_at?: string
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
        ]
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
          created_at: string
          email: string | null
          id: string
          nome: string
          perfil: Database["public"]["Enums"]["perfil_usuario"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          perfil?: Database["public"]["Enums"]["perfil_usuario"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          perfil?: Database["public"]["Enums"]["perfil_usuario"]
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
      is_admin: { Args: never; Returns: boolean }
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
