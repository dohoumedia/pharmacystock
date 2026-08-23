export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; status: string; country_code: string | null; currency_code: string; timezone: string; default_locale: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; slug: string; status?: string; country_code?: string | null; currency_code?: string; timezone?: string; default_locale?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>;
        Relationships: [];
      };
      branches: {
        Row: { id: string; organization_id: string; name: string; code: string | null; status: string; address_line1: string | null; address_line2: string | null; city: string | null; country_code: string | null; phone: string | null; email: string | null; timezone: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; name: string; code?: string | null; status?: string; address_line1?: string | null; address_line2?: string | null; city?: string | null; country_code?: string | null; phone?: string | null; email?: string | null; timezone?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['branches']['Insert']>;
        Relationships: [];
      };
      profiles: {
        Row: { user_id: string; display_name: string | null; preferred_locale: string; phone: string | null; is_platform_admin: boolean; created_at: string; updated_at: string };
        Insert: { user_id: string; display_name?: string | null; preferred_locale?: string; phone?: string | null; is_platform_admin?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      roles: {
        Row: { id: string; organization_id: string | null; code: string; name_en: string; name_fr: string; is_system: boolean; created_at: string };
        Insert: { id?: string; organization_id?: string | null; code: string; name_en: string; name_fr: string; is_system?: boolean; created_at?: string };
        Update: Partial<Database['public']['Tables']['roles']['Insert']>;
        Relationships: [];
      };
      permissions: {
        Row: { code: string; description_en: string; description_fr: string; created_at: string };
        Insert: { code: string; description_en: string; description_fr: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['permissions']['Insert']>;
        Relationships: [];
      };
      role_permissions: {
        Row: { role_id: string; permission_code: string; created_at: string };
        Insert: { role_id: string; permission_code: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['role_permissions']['Insert']>;
        Relationships: [];
      };
      organization_memberships: {
        Row: { id: string; organization_id: string; user_id: string; role_id: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; user_id: string; role_id?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['organization_memberships']['Insert']>;
        Relationships: [];
      };
      branch_memberships: {
        Row: { branch_id: string; organization_membership_id: string; created_at: string };
        Insert: { branch_id: string; organization_membership_id: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['branch_memberships']['Insert']>;
        Relationships: [];
      };
      audit_logs: {
        Row: { id: number; organization_id: string | null; branch_id: string | null; actor_user_id: string | null; event_type: string; entity_type: string | null; entity_id: string | null; before_data: Json | null; after_data: Json | null; metadata: Json; created_at: string };
        Insert: { id?: never; organization_id?: string | null; branch_id?: string | null; actor_user_id?: string | null; event_type: string; entity_type?: string | null; entity_id?: string | null; before_data?: Json | null; after_data?: Json | null; metadata?: Json; created_at?: string };
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_org_member: { Args: { target_org: string }; Returns: boolean };
      has_branch_access: { Args: { target_branch: string }; Returns: boolean };
      has_permission: { Args: { target_org: string; permission: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
