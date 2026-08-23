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
      categories: {
        Row: { id: string; organization_id: string; name: string; description: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; name: string; description?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['categories']['Insert']>;
        Relationships: [];
      };
      manufacturers: {
        Row: { id: string; organization_id: string; name: string; country_code: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; name: string; country_code?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['manufacturers']['Insert']>;
        Relationships: [];
      };
      products: {
        Row: { id: string; organization_id: string; category_id: string | null; manufacturer_id: string | null; name: string; generic_name: string | null; brand_name: string | null; strength: string | null; dosage_form: string | null; package_size: string | null; sku: string | null; status: string; archived_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; category_id?: string | null; manufacturer_id?: string | null; name: string; generic_name?: string | null; brand_name?: string | null; strength?: string | null; dosage_form?: string | null; package_size?: string | null; sku?: string | null; status?: string; archived_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };
      product_barcodes: {
        Row: { id: string; organization_id: string; product_id: string; barcode: string; is_primary: boolean; created_at: string };
        Insert: { id?: string; organization_id: string; product_id: string; barcode: string; is_primary?: boolean; created_at?: string };
        Update: Partial<Database['public']['Tables']['product_barcodes']['Insert']>;
        Relationships: [];
      };
      batches: {
        Row: { id: string; organization_id: string; branch_id: string; product_id: string; lot_number: string; expiry_date: string; purchase_cost: number | null; selling_price: number | null; status: string; notes: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; branch_id: string; product_id: string; lot_number: string; expiry_date: string; purchase_cost?: number | null; selling_price?: number | null; status?: string; notes?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['batches']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_product_with_barcode: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_generic_name?: string | null;
          p_brand_name?: string | null;
          p_strength?: string | null;
          p_dosage_form?: string | null;
          p_package_size?: string | null;
          p_sku?: string | null;
          p_category_id?: string | null;
          p_manufacturer_id?: string | null;
          p_barcode?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
