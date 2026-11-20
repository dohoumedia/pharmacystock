export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      staff_invitations: {
        Row: { id: string; organization_id: string; branch_id: string; email: string; display_name: string; role_id: string; invited_by: string; status: 'pending' | 'accepted' | 'cancelled'; expires_at: string; accepted_by: string | null; accepted_at: string | null; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
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
        Row: { id: string; organization_id: string; category_id: string | null; manufacturer_id: string | null; name: string; generic_name: string | null; brand_name: string | null; strength: string | null; dosage_form: string | null; stock_unit?: string; package_size: string | null; sku: string | null; status: string; archived_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; category_id?: string | null; manufacturer_id?: string | null; name: string; generic_name?: string | null; brand_name?: string | null; strength?: string | null; dosage_form?: string | null; stock_unit?: string; package_size?: string | null; sku?: string | null; status?: string; archived_at?: string | null; created_at?: string; updated_at?: string };
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
      inventory_movements: {
        Row: { id: string; organization_id: string; branch_id: string; batch_id: string; movement_type: string; quantity_delta: number; unit_cost: number | null; reference_type: string | null; reference_id: string | null; idempotency_key: string; reason: string | null; metadata: Json; occurred_at: string; created_at: string; created_by: string };
        Insert: { id?: string; organization_id: string; branch_id: string; batch_id: string; movement_type: string; quantity_delta: number; unit_cost?: number | null; reference_type?: string | null; reference_id?: string | null; idempotency_key: string; reason?: string | null; metadata?: Json; occurred_at?: string; created_at?: string; created_by?: string };
        Update: never;
        Relationships: [];
      };
      inventory_stock_counts: {
        Row: { id: string; organization_id: string; branch_id: string; status: string; notes: string | null; counted_at: string | null; created_by: string; completed_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; branch_id: string; status?: string; notes?: string | null; counted_at?: string | null; created_by?: string; completed_by?: string | null; created_at?: string; updated_at?: string };
        Update: { status?: string; notes?: string | null; counted_at?: string | null; completed_by?: string | null; updated_at?: string };
        Relationships: [];
      };
      inventory_stock_count_lines: {
        Row: { id: string; stock_count_id: string; organization_id: string; branch_id: string; batch_id: string; expected_quantity: number; counted_quantity: number; created_at: string; updated_at: string };
        Insert: { id?: string; stock_count_id: string; organization_id: string; branch_id: string; batch_id: string; expected_quantity?: number; counted_quantity: number; created_at?: string; updated_at?: string };
        Update: { counted_quantity?: number; expected_quantity?: number; updated_at?: string };
        Relationships: [];
      };
    };
    Views: {
      inventory_balances: {
        Row: { organization_id: string; branch_id: string; batch_id: string; product_id: string; on_hand_quantity: number; reserved_quantity: number; available_quantity: number; last_movement_at: string | null };
        Relationships: [];
      };
    };
    Functions: {
      read_operational_report: { Args: { p_organization_id: string; p_branch_id: string; p_report: string; p_start: string; p_end: string; p_search?: string; p_state?: string; p_supplier?: string; p_days?: number; p_page?: number; p_product_id?: string | null }; Returns: Json };
      my_membership_unavailable: { Args: Record<string, never>; Returns: boolean };
      staff_directory_details: { Args: { p_organization_id: string }; Returns: { user_id: string; email: string | null; access_changed_at: string }[] };
      maintain_staff_access: { Args: { p_membership_id: string; p_expected: Json; p_next: Json }; Returns: undefined };
      search_catalog_products: { Args: { p_organization_id: string; p_search?: string; p_status?: string | null }; Returns: Database['public']['Tables']['products']['Row'][] };
      search_catalog_batches: { Args: { p_organization_id: string; p_branch_id: string; p_search?: string }; Returns: Database['public']['Tables']['batches']['Row'][] };
      search_inventory_stock: { Args: { p_organization_id: string; p_branch_id: string; p_search?: string }; Returns: Database['public']['Views']['inventory_balances']['Row'][] };
      create_catalog_product: { Args: { p_organization_id: string; p_product: Json }; Returns: string };
      maintain_product_barcode: { Args: { p_organization_id: string; p_product_id: string; p_action: string; p_barcode?: string | null; p_barcode_id?: string | null }; Returns: Database['public']['Tables']['product_barcodes']['Row'][] };
      post_opening_stock: { Args: { p_organization_id: string; p_branch_id: string; p_product_id: string; p_lot_number: string; p_expiry_date: string; p_quantity: number; p_purchase_cost: number | null; p_selling_price: number; p_reason: string; p_idempotency_key: string }; Returns: string };

      create_branch_with_access: { Args: { p_branch_id: string; p_organization_id: string; p_name: string; p_code: string | null; p_city: string | null; p_phone: string | null }; Returns: string };
      complete_owner_setup: { Args: { p_name: string; p_branch_name: string; p_country_code: string | null; p_currency_code: string; p_timezone: string; p_locale: string }; Returns: Json };
      invite_staff: { Args: { p_organization_id: string; p_email: string; p_display_name: string; p_role_id: string; p_branch_id: string }; Returns: string };
      my_staff_invitations: { Args: Record<string, never>; Returns: { id: string; organization_name: string; branch_name: string; role_name_en: string; role_name_fr: string; expires_at: string }[] };
      accept_staff_invitation: { Args: { p_invitation_id: string }; Returns: string };
      cancel_staff_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      owner_setup_progress: { Args: { p_organization_id: string; p_branch_id: string }; Returns: Json };
      create_product_with_barcode: {
        Args: {
          p_organization_id: string; p_name: string; p_generic_name?: string | null; p_brand_name?: string | null;
          p_strength?: string | null; p_dosage_form?: string | null; p_package_size?: string | null; p_sku?: string | null;
          p_category_id?: string | null; p_manufacturer_id?: string | null; p_barcode?: string | null;
        };
        Returns: string;
      };
      post_inventory_movement: {
        Args: {
          p_organization_id: string; p_branch_id: string; p_batch_id: string; p_movement_type: string;
          p_quantity_delta: number; p_idempotency_key: string; p_reason?: string | null; p_reference_type?: string | null;
          p_reference_id?: string | null; p_unit_cost?: number | null; p_metadata?: Json; p_occurred_at?: string;
        };
        Returns: string;
      };
      complete_inventory_stock_count: {
        Args: { p_stock_count_id: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
