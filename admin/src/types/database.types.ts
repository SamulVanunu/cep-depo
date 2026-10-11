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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      app_screenshots: {
        Row: {
          alt_text: string
          app_id: string
          created_at: string
          id: string
          path: string
          position: number
        }
        Insert: {
          alt_text: string
          app_id: string
          created_at?: string
          id?: string
          path: string
          position?: number
        }
        Update: {
          alt_text?: string
          app_id?: string
          created_at?: string
          id?: string
          path?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_screenshots_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_screenshots_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
        ]
      }
      app_versions: {
        Row: {
          apk_path: string
          apk_size_bytes: number
          app_id: string
          changelog: string
          created_at: string
          created_by: string | null
          id: string
          published_at: string | null
          sha256: string
          status: Database["public"]["Enums"]["version_status"]
          version_code: number
          version_name: string
        }
        Insert: {
          apk_path: string
          apk_size_bytes: number
          app_id: string
          changelog?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          sha256: string
          status?: Database["public"]["Enums"]["version_status"]
          version_code: number
          version_name: string
        }
        Update: {
          apk_path?: string
          apk_size_bytes?: number
          app_id?: string
          changelog?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string | null
          sha256?: string
          status?: Database["public"]["Enums"]["version_status"]
          version_code?: number
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_versions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_versions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
        ]
      }
      apps: {
        Row: {
          category_id: string
          created_at: string
          description: string
          download_count: number
          featured: boolean
          icon_path: string | null
          id: string
          short_description: string
          slug: string
          status: Database["public"]["Enums"]["app_status"]
          title: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description: string
          download_count?: number
          featured?: boolean
          icon_path?: string | null
          id?: string
          short_description: string
          slug: string
          status?: Database["public"]["Enums"]["app_status"]
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string
          download_count?: number
          featured?: boolean
          icon_path?: string | null
          id?: string
          short_description?: string
          slug?: string
          status?: Database["public"]["Enums"]["app_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apps_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "apps_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      download_events: {
        Row: {
          app_id: string
          downloaded_at: string
          id: number
          installation_id: string
          version_id: string
        }
        Insert: {
          app_id: string
          downloaded_at?: string
          id?: never
          installation_id: string
          version_id: string
        }
        Update: {
          app_id?: string
          downloaded_at?: string
          id?: never
          installation_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
          {
            foreignKeyName: "download_events_version_app_fkey"
            columns: ["version_id", "app_id"]
            isOneToOne: false
            referencedRelation: "app_versions"
            referencedColumns: ["id", "app_id"]
          },
        ]
      }
      legacy_admins: {
        Row: {
          user_id: string
        }
        Insert: {
          user_id: string
        }
        Update: {
          user_id?: string
        }
        Relationships: []
      }
      legacy_apps: {
        Row: {
          account_url: string | null
          apk_path: string | null
          category: string
          created_at: string
          description: string
          download_url: string | null
          icon_url: string | null
          id: string
          requires_external_account: boolean
          title: string
          version: string
        }
        Insert: {
          account_url?: string | null
          apk_path?: string | null
          category: string
          created_at?: string
          description: string
          download_url?: string | null
          icon_url?: string | null
          id?: string
          requires_external_account?: boolean
          title: string
          version: string
        }
        Update: {
          account_url?: string | null
          apk_path?: string | null
          category?: string
          created_at?: string
          description?: string
          download_url?: string | null
          icon_url?: string | null
          id?: string
          requires_external_account?: boolean
          title?: string
          version?: string
        }
        Relationships: []
      }
      legacy_release_events: {
        Row: {
          app_id: string
          created_at: string
          id: number
          kind: string
          title: string
          version: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: never
          kind: string
          title: string
          version: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: never
          kind?: string
          title?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "legacy_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_reviews: {
        Row: {
          app_id: string
          author_id: string
          body: string
          created_at: string
          id: string
          rating: number
        }
        Insert: {
          app_id: string
          author_id?: string
          body: string
          created_at?: string
          id?: string
          rating: number
        }
        Update: {
          app_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "legacy_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          admin_note: string | null
          app_id: string
          created_at: string
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          version_id: string | null
        }
        Insert: {
          admin_note?: string | null
          app_id: string
          created_at?: string
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          version_id?: string | null
        }
        Update: {
          admin_note?: string | null
          app_id?: string
          created_at?: string
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_version_app_fkey"
            columns: ["version_id", "app_id"]
            isOneToOne: false
            referencedRelation: "app_versions"
            referencedColumns: ["id", "app_id"]
          },
        ]
      }
      reviews: {
        Row: {
          app_id: string
          body: string | null
          created_at: string
          id: string
          moderation_status: Database["public"]["Enums"]["review_moderation_status"]
          rating: number
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          body?: string | null
          created_at?: string
          id?: string
          moderation_status?: Database["public"]["Enums"]["review_moderation_status"]
          rating: number
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          body?: string | null
          created_at?: string
          id?: string
          moderation_status?: Database["public"]["Enums"]["review_moderation_status"]
          rating?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_app_id_fkey1"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_app_id_fkey1"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      catalog_app_cards: {
        Row: {
          apk_path: string | null
          apk_size_bytes: number | null
          app_id: string | null
          category_id: string | null
          category_name: string | null
          category_slug: string | null
          download_count: number | null
          featured: boolean | null
          icon_path: string | null
          published_at: string | null
          sha256: string | null
          short_description: string | null
          slug: string | null
          title: string | null
          version_changelog: string | null
          version_code: number | null
          version_id: string | null
          version_name: string | null
        }
        Relationships: []
      }
      review_rating_summaries: {
        Row: {
          app_id: string | null
          average_rating: number | null
          review_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_app_id_fkey1"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_app_id_fkey1"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "catalog_app_cards"
            referencedColumns: ["app_id"]
          },
        ]
      }
    }
    Functions: {
      admin_close_report: {
        Args: {
          p_actor_id: string
          p_admin_note: string
          p_report_id: string
          p_status: Database["public"]["Enums"]["report_status"]
        }
        Returns: undefined
      }
      admin_delete_hidden_review: {
        Args: { p_actor_id: string; p_review_id: string }
        Returns: undefined
      }
      admin_publish_version: {
        Args: { p_actor_id: string; p_version_id: string }
        Returns: undefined
      }
      admin_record_external_action: {
        Args: {
          p_action: string
          p_actor_id: string
          p_metadata?: Json
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      admin_set_profile_status: {
        Args: {
          p_actor_id: string
          p_status: Database["public"]["Enums"]["profile_status"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_review_status: {
        Args: {
          p_actor_id: string
          p_review_id: string
          p_status: Database["public"]["Enums"]["review_moderation_status"]
        }
        Returns: undefined
      }
      admin_withdraw_version: {
        Args: { p_actor_id: string; p_version_id: string }
        Returns: undefined
      }
      legacy_is_admin: { Args: never; Returns: boolean }
      record_download: {
        Args: { p_installation_id: string; p_version_id: string }
        Returns: boolean
      }
      search_catalog: {
        Args: { p_category_slug: string; p_query: string; p_sort: string }
        Returns: {
          apk_path: string | null
          apk_size_bytes: number | null
          app_id: string | null
          category_id: string | null
          category_name: string | null
          category_slug: string | null
          download_count: number | null
          featured: boolean | null
          icon_path: string | null
          published_at: string | null
          sha256: string | null
          short_description: string | null
          slug: string | null
          title: string | null
          version_changelog: string | null
          version_code: number | null
          version_id: string | null
          version_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_app_cards"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      app_role: "admin"
      app_status: "active" | "archived"
      profile_status: "active" | "suspended"
      report_reason: "acilmiyor" | "link_bozuk" | "sahte_uygulama" | "diger"
      report_status: "open" | "resolved" | "dismissed"
      review_moderation_status: "visible" | "hidden"
      version_status: "draft" | "published" | "withdrawn"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin"],
      app_status: ["active", "archived"],
      profile_status: ["active", "suspended"],
      report_reason: ["acilmiyor", "link_bozuk", "sahte_uygulama", "diger"],
      report_status: ["open", "resolved", "dismissed"],
      review_moderation_status: ["visible", "hidden"],
      version_status: ["draft", "published", "withdrawn"],
    },
  },
} as const
