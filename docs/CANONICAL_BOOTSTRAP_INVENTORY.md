# Canonical bootstrap migration inventory

Generated from all 53 current files. `manifest.json` pins exact byte hashes and order. The dependency list includes qualified relation/function references and replacement chains; PostgreSQL replay is the executable validation. Trigger/index names are listed alongside tables/functions/views. Column/constraint prerequisites and deferred PL/pgSQL references are explained in CANONICAL_BOOTSTRAP.md.

Order numbers refer to the canonical manifest, not timestamp order. Dependencies/dependents below are direct edges; transitive dependencies follow from the graph.

## 01. 20260823033000_sprint0_tenancy_foundation.sql
Version: `20260823033000`; module: tenancy_foundation; duplicated version: no.

Objects introduced/redefined: table `public.organizations`; table `public.branches`; table `public.profiles`; table `public.roles`; table `public.permissions`; table `public.role_permissions`; table `public.organization_memberships`; table `public.branch_memberships`; table `public.audit_logs`; function `public.set_updated_at`; trigger `organizations_set_updated_at`; trigger `branches_set_updated_at`; trigger `profiles_set_updated_at`; trigger `organization_memberships_set_updated_at`; function `public.handle_new_auth_user`; trigger `on_auth_user_created`; function `public.is_org_member`; function `public.has_branch_access`; function `public.has_permission`.

Prerequisite steps: platform Auth contract only.
Dependent later steps: 2, 3, 4, 5, 6, 7, 8, 9, 13, 15, 16, 19, 20, 24, 28, 29, 30, 34, 36, 37, 38, 39, 40, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53.

## 02. 20260823033100_sprint0_permissions_seed.sql
Version: `20260823033100`; module: permissions_seed; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 1.
Dependent later steps: none directly.

## 03. 20260823033200_sprint0_security_hardening.sql
Version: `20260823033200`; module: security_hardening; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 1.
Dependent later steps: none directly.

## 04. 20260823080000_sprint1_rbac_hardening.sql
Version: `20260823080000`; module: rbac_hardening; duplicated version: no.

Objects introduced/redefined: function `app_private.is_org_member`; function `app_private.has_branch_access`; function `app_private.has_permission`; function `app_private.current_role_code`; function `app_private.role_is_assignable`; unique index `roles_system_code_unique`; function `app_private.audit_security_change`; trigger `organizations_security_audit`; trigger `branches_security_audit`; trigger `memberships_security_audit`.

Prerequisite steps: 1.
Dependent later steps: 5, 6, 7, 8, 9, 13, 14, 15, 19, 20, 21, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 49, 50, 51, 52, 53.

## 05. 20260823081000_sprint1_staff_profile_visibility.sql
Version: `20260823081000`; module: staff_profile_visibility; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 1, 4.
Dependent later steps: none directly.

## 06. 20260823082000_sprint1_branch_scope_hardening.sql
Version: `20260823082000`; module: branch_scope_hardening; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 1, 4.
Dependent later steps: none directly.

## 07. 20260823083000_sprint1_performance_hardening.sql
Version: `20260823083000`; module: performance_hardening; duplicated version: no.

Objects introduced/redefined: index `audit_logs_actor_user_id_idx`; index `audit_logs_branch_id_idx`; index `audit_logs_organization_id_idx`; index `branch_memberships_organization_membership_id_idx`; index `organization_memberships_role_id_idx`; index `organization_memberships_user_id_idx`; index `role_permissions_permission_code_idx`.

Prerequisite steps: 1, 4.
Dependent later steps: none directly.

## 08. 20260823090000_sprint2_products_batches.sql
Version: `20260823090000`; module: products_batches; duplicated version: no.

Objects introduced/redefined: table `public.categories`; table `public.manufacturers`; table `public.products`; unique index `products_org_sku_unique`; table `public.product_barcodes`; unique index `product_barcodes_one_primary_per_product`; table `public.batches`; trigger `categories_set_updated_at`; trigger `manufacturers_set_updated_at`; trigger `products_set_updated_at`; trigger `batches_set_updated_at`; index `products_org_name_idx`; index `products_org_generic_name_idx`; index `products_org_brand_name_idx`; index `products_category_id_idx`; index `products_manufacturer_id_idx`; index `product_barcodes_product_id_idx`; index `batches_branch_id_idx`; index `batches_product_id_idx`; index `batches_expiry_date_idx`; index `batches_org_branch_expiry_idx`; function `app_private.audit_catalog_change`; trigger `categories_catalog_audit`; trigger `manufacturers_catalog_audit`; trigger `products_catalog_audit`; trigger `batches_catalog_audit`.

Prerequisite steps: 1, 4.
Dependent later steps: 9, 11, 12, 13, 15, 16, 20, 21, 24, 25, 26, 27, 28, 29, 30, 34, 36, 37, 39, 41, 43, 44, 45, 47, 49, 50, 51, 52, 53.

## 09. 20260823083100_sprint3_inventory_ledger.sql
Version: `20260823083100`; module: inventory_ledger; duplicated version: no.

Objects introduced/redefined: table `public.inventory_movements`; index `inventory_movements_org_branch_batch_idx`; index `inventory_movements_batch_idx`; index `inventory_movements_created_by_idx`; table `public.inventory_stock_counts`; table `public.inventory_stock_count_lines`; index `inventory_stock_counts_org_branch_idx`; index `inventory_stock_count_lines_count_idx`; index `inventory_stock_count_lines_batch_idx`; function `app_private.inventory_lock_key`; function `app_private.assert_inventory_movement_safe`; trigger `inventory_movements_safety`; function `app_private.prevent_inventory_movement_mutation`; trigger `inventory_movements_immutable`; view `public.inventory_balances`; function `public.post_inventory_movement`; function `public.complete_inventory_stock_count`.

Prerequisite steps: 1, 4, 8.
Dependent later steps: 10, 13, 15, 18, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 36, 37, 38, 39, 40, 43, 45, 46, 47, 50, 52, 53.

## 10. 20260823083900_sprint3_inventory_hardening.sql
Version: `20260823083900`; module: inventory_hardening; duplicated version: no.

Objects introduced/redefined: function `app_private.inventory_lock_key`; index `inventory_movements_org_batch_idx`; index `inventory_stock_count_lines_org_batch_idx`; index `inventory_stock_count_lines_org_branch_idx`; index `inventory_stock_count_lines_org_idx`.

Prerequisite steps: 9.
Dependent later steps: 40, 46.

## 11. 20260823091000_sprint2_catalog_performance_indexes.sql
Version: `20260823091000`; module: catalog_performance_indexes; duplicated version: no.

Objects introduced/redefined: index `products_org_category_idx`; index `products_org_manufacturer_idx`; index `batches_org_product_idx`.

Prerequisite steps: 8.
Dependent later steps: none directly.

## 12. 20260823092000_sprint2_product_create_rpc.sql
Version: `20260823092000`; module: product_create_rpc; duplicated version: no.

Objects introduced/redefined: function `public.create_product_with_barcode`.

Prerequisite steps: 8.
Dependent later steps: none directly.

## 13. 20260823110000_sprint4_purchasing_receiving.sql
Version: `20260823110000`; module: purchasing_receiving; duplicated version: no.

Objects introduced/redefined: table `public.suppliers`; table `public.purchase_orders`; table `public.purchase_order_lines`; table `public.purchase_receipts`; table `public.purchase_receipt_lines`; index `suppliers_org_idx`; index `purchase_orders_org_branch_idx`; index `purchase_orders_supplier_idx`; index `purchase_order_lines_po_idx`; index `purchase_receipts_po_idx`; index `purchase_receipt_lines_receipt_idx`; function `public.receive_purchase_order`.

Prerequisite steps: 1, 4, 9, 8.
Dependent later steps: 14, 15, 17, 29, 36, 37, 43, 44, 45, 50, 51, 52, 53.

## 14. 20260823111000_sprint4_receiving_security_hardening.sql
Version: `20260823111000`; module: receiving_security_hardening; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 4, 13.
Dependent later steps: none directly.

## 15. 20260823154306_sprint4_transaction_integrity.sql
Version: `20260823154306`; module: transaction_integrity; duplicated version: no.

Objects introduced/redefined: unique index `purchase_orders_org_idempotency_uidx`; unique index `purchase_receipts_org_idempotency_uidx`; trigger `suppliers_set_updated_at`; trigger `purchase_orders_set_updated_at`; trigger `purchase_order_lines_set_updated_at`; function `app_private.create_purchase_order_impl`; function `public.create_purchase_order`; function `app_private.receive_purchase_order_impl`; function `public.receive_purchase_order`.

Prerequisite steps: 1, 4, 9, 8, 13.
Dependent later steps: 36.

## 16. 20260823155000_sprint4_catalog_audit_trigger_fix.sql
Version: `20260823155000`; module: catalog_audit_trigger_fix; duplicated version: no.

Objects introduced/redefined: function `app_private.audit_catalog_change`.

Prerequisite steps: 1, 8.
Dependent later steps: 29, 45.

## 17. 20260823155500_sprint4_purchasing_grants.sql
Version: `20260823155500`; module: purchasing_grants; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 13.
Dependent later steps: none directly.

## 18. 20260823155700_sprint4_inventory_read_grants_fix.sql
Version: `20260823155700`; module: inventory_read_grants_fix; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 9.
Dependent later steps: none directly.

## 19. 20260823160000_sprint4_permission_helper_fix.sql
Version: `20260823160000`; module: permission_helper_fix; duplicated version: no.

Objects introduced/redefined: function `app_private.has_permission`.

Prerequisite steps: 1, 4.
Dependent later steps: 20, 21, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 52, 53.

## 20. 20260823161000_sprint5_expiry_fefo_foundation.sql
Version: `20260823161000`; module: expiry_fefo_foundation; duplicated version: no.

Objects introduced/redefined: table `public.expiry_policies`; table `public.expiry_alerts`; table `public.expiry_actions`; trigger `expiry_policies_set_updated_at`; index `expiry_alerts_org_branch_status_idx`; index `expiry_alerts_batch_idx`; index `expiry_actions_batch_idx`; view `public.expiry_risk`; function `public.get_fefo_batches`; function `app_private.refresh_expiry_alerts_impl`; function `public.refresh_expiry_alerts`.

Prerequisite steps: 1, 4, 9, 8, 19.
Dependent later steps: 21, 24, 25, 26, 27, 29, 36, 41, 52.

## 21. 20260823161500_sprint5_expiry_actions.sql
Version: `20260823161500`; module: expiry_actions; duplicated version: no.

Objects introduced/redefined: function `public.refresh_expiry_alerts`; function `app_private.acknowledge_expiry_alert_impl`; function `public.acknowledge_expiry_alert`; function `app_private.record_expiry_action_impl`; function `public.record_expiry_action`; function `app_private.dispose_batch_impl`; function `public.dispose_batch`; function `app_private.return_batch_to_supplier_impl`; function `public.return_batch_to_supplier`.

Prerequisite steps: 4, 9, 8, 19, 20.
Dependent later steps: 41.

## 22. 20260823162000_sprint5_inventory_write_grants_fix.sql
Version: `20260823162000`; module: inventory_write_grants_fix; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 9.
Dependent later steps: none directly.

## 23. 20260823162500_sprint5_inventory_movement_types.sql
Version: `20260823162500`; module: inventory_movement_types; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 9.
Dependent later steps: none directly.

## 24. 20260823170000_sprint6_pos_sales_foundation.sql
Version: `20260823170000`; module: pos_sales_foundation; duplicated version: yes.

Objects introduced/redefined: table `public.sales`; table `public.sale_items`; table `public.payments`; table `public.sale_refunds`; table `public.sale_refund_items`; index `sales_org_branch_date_idx`; index `sale_items_sale_idx`; index `payments_sale_idx`; index `sale_refunds_sale_idx`; function `public.complete_sale`.

Prerequisite steps: 1, 4, 9, 8, 19, 20.
Dependent later steps: 25, 26, 28, 29, 36, 38, 42, 49, 50, 51.

## 25. 20260823162813_sprint6_pos_security_boundary.sql
Version: `20260823162813`; module: pos_security_boundary; duplicated version: no.

Objects introduced/redefined: function `app_private.complete_sale_impl`; function `public.complete_sale`.

Prerequisite steps: 4, 9, 8, 19, 20, 24.
Dependent later steps: 26, 36.

## 26. 20260823163500_sprint6_refunds_and_pricing.sql
Version: `20260823163500`; module: refunds_and_pricing; duplicated version: no.

Objects introduced/redefined: function `app_private.refund_sale_impl`; function `public.refund_sale`; index `sale_refund_items_refund_idx`; index `sale_refund_items_sale_item_idx`; function `app_private.complete_sale_impl`.

Prerequisite steps: 4, 9, 8, 19, 20, 25, 24.
Dependent later steps: 29, 36, 38.

## 27. 20260823164500_sprint6_sale_quote.sql
Version: `20260823164500`; module: sale_quote; duplicated version: no.

Objects introduced/redefined: function `public.quote_sale`.

Prerequisite steps: 4, 8, 19, 20.
Dependent later steps: 36.

## 28. 20260823170000_sprint7_core_completion_foundation.sql
Version: `20260823170000`; module: core_completion_foundation; duplicated version: yes.

Objects introduced/redefined: table `public.customers`; unique index `customers_org_phone_unique`; unique index `customers_org_email_unique`; index `customers_org_name_idx`; trigger `customers_set_updated_at`; index `sales_org_customer_idx`; table `public.organization_settings`; trigger `organization_settings_set_updated_at`; table `public.notification_preferences`; table `public.notifications`; index `notifications_recipient_idx`; table `public.import_jobs`; table `public.import_rows`; index `import_jobs_org_created_idx`; index `import_rows_job_idx`; table `public.subscription_plans`; table `public.subscriptions`; trigger `subscriptions_set_updated_at`; view `public.report_daily_sales`; view `public.report_inventory_value`; function `app_private.prevent_audit_mutation`; trigger `audit_logs_immutable`; index `audit_logs_org_created_idx`; index `sales_created_by_idx`; index `payments_created_by_idx`; index `sale_refunds_created_by_idx`.

Prerequisite steps: 1, 4, 9, 8, 19, 24.
Dependent later steps: 29, 32, 45, 50, 51, 52, 53.

## 29. 20260823171000_sprint7_import_notifications_customer_sales.sql
Version: `20260823171000`; module: import_notifications_customer_sales; duplicated version: yes.

Objects introduced/redefined: function `public.commit_import_job`; function `app_private.notify_expiry_alert`; trigger `expiry_alert_notify`; function `app_private.complete_sale_with_customer_impl`; function `public.complete_sale_with_customer`; trigger `customers_audit`; trigger `organization_settings_audit`; trigger `import_jobs_audit`.

Prerequisite steps: 1, 4, 9, 8, 13, 16, 19, 20, 26, 24, 28.
Dependent later steps: 31, 45, 49, 51.

## 30. 20260823171000_sprint8_branch_transfers.sql
Version: `20260823171000`; module: branch_transfers; duplicated version: yes.

Objects introduced/redefined: table `public.stock_transfers`; table `public.stock_transfer_lines`; index `stock_transfers_org_source_status_idx`; index `stock_transfers_org_destination_status_idx`; index `stock_transfer_lines_transfer_idx`; index `stock_transfer_lines_source_batch_idx`; index `stock_transfer_lines_destination_batch_idx`; trigger `stock_transfers_set_updated_at`; trigger `stock_transfer_lines_set_updated_at`; function `app_private.create_stock_transfer_impl`; function `public.create_stock_transfer`; function `app_private.approve_stock_transfer_impl`; function `public.approve_stock_transfer`; function `app_private.dispatch_stock_transfer_impl`; function `public.dispatch_stock_transfer`; function `app_private.receive_stock_transfer_impl`; function `public.receive_stock_transfer`; function `app_private.cancel_stock_transfer_impl`; function `public.cancel_stock_transfer`.

Prerequisite steps: 1, 4, 9, 8, 19.
Dependent later steps: 33, 34, 35, 39, 43, 47, 50, 52.

## 31. 20260823171100_sprint7_customer_sale_worker_grant.sql
Version: `20260823171100`; module: customer_sale_worker_grant; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 29.
Dependent later steps: none directly.

## 32. 20260823171200_sprint7_performance_hardening.sql
Version: `20260823171200`; module: performance_hardening; duplicated version: no.

Objects introduced/redefined: index `customers_created_by_idx`; index `import_jobs_created_by_idx`; index `import_jobs_org_branch_idx`; index `import_rows_org_idx`; index `notification_preferences_user_idx`; index `notifications_org_branch_idx`; index `notifications_org_idx`; index `organization_settings_updated_by_idx`; index `subscriptions_plan_code_idx`.

Prerequisite steps: 4, 19, 28.
Dependent later steps: none directly.

## 33. 20260823174000_sprint8_transfer_rls_hardening.sql
Version: `20260823174000`; module: transfer_rls_hardening; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 4, 19, 30.
Dependent later steps: none directly.

## 34. 20260823175000_sprint8_transfer_workflow_hardening.sql
Version: `20260823175000`; module: transfer_workflow_hardening; duplicated version: no.

Objects introduced/redefined: function `app_private.approve_stock_transfer_impl`; function `app_private.cancel_stock_transfer_impl`; function `app_private.create_stock_transfer_impl`.

Prerequisite steps: 1, 4, 8, 19, 30.
Dependent later steps: 39.

## 35. 20260823181000_sprint8_transfer_performance_hardening.sql
Version: `20260823181000`; module: transfer_performance_hardening; duplicated version: no.

Objects introduced/redefined: index `stock_transfer_lines_org_transfer_idx`; index `stock_transfer_lines_org_source_batch_idx`; index `stock_transfer_lines_org_destination_batch_idx`; index `stock_transfer_lines_org_product_idx`; index `stock_transfer_lines_transfer_out_movement_idx`; index `stock_transfer_lines_transfer_in_movement_idx`; index `stock_transfers_requested_by_idx`; index `stock_transfers_approved_by_idx`; index `stock_transfers_dispatched_by_idx`; index `stock_transfers_received_by_idx`.

Prerequisite steps: 30.
Dependent later steps: none directly.

## 36. 20260913234137_batch_selling_price_foundation.sql
Version: `20260913234137`; module: batch_selling_price_foundation; duplicated version: no.

Objects introduced/redefined: function `app_private.require_positive_selling_price`; function `app_private.receive_purchase_order_impl`; function `public.receive_purchase_order`; function `public.quote_sale`; function `app_private.complete_sale_impl`; function `public.complete_sale`.

Prerequisite steps: 1, 4, 9, 8, 13, 15, 19, 20, 25, 26, 27, 24.
Dependent later steps: 37.

## 37. 20260920023555_reject_duplicate_purchase_receipt_lines.sql
Version: `20260920023555`; module: reject_duplicate_purchase_receipt_lines; duplicated version: no.

Objects introduced/redefined: function `app_private.receive_purchase_order_impl`.

Prerequisite steps: 1, 4, 9, 8, 13, 19, 36.
Dependent later steps: none directly.

## 38. 20260920035830_add_refund_audit_log.sql
Version: `20260920035830`; module: add_refund_audit_log; duplicated version: no.

Objects introduced/redefined: function `app_private.refund_sale_impl`.

Prerequisite steps: 1, 4, 9, 19, 26, 24.
Dependent later steps: none directly.

## 39. 20260920041952_add_transfer_audit_log.sql
Version: `20260920041952`; module: add_transfer_audit_log; duplicated version: no.

Objects introduced/redefined: function `app_private.create_stock_transfer_impl`; function `app_private.approve_stock_transfer_impl`; function `app_private.dispatch_stock_transfer_impl`; function `app_private.receive_stock_transfer_impl`.

Prerequisite steps: 1, 4, 9, 8, 19, 30, 34.
Dependent later steps: none directly.

## 40. 20260920043646_add_stock_count_audit_log.sql
Version: `20260920043646`; module: add_stock_count_audit_log; duplicated version: no.

Objects introduced/redefined: function `public.complete_inventory_stock_count`.

Prerequisite steps: 1, 4, 9, 10, 19.
Dependent later steps: 46.

## 41. 20260920045243_add_batch_recall_action.sql
Version: `20260920045243`; module: add_batch_recall_action; duplicated version: no.

Objects introduced/redefined: function `app_private.record_expiry_action_impl`.

Prerequisite steps: 4, 8, 19, 20, 21.
Dependent later steps: none directly.

## 42. 20260920052736_harden_sales_history_branch_rls.sql
Version: `20260920052736`; module: harden_sales_history_branch_rls; duplicated version: no.

Objects introduced/redefined: none (grants, policies, constraints or data changes).

Prerequisite steps: 4, 19, 24.
Dependent later steps: none directly.

## 43. 20260920055154_add_operational_report_summaries.sql
Version: `20260920055154`; module: add_operational_report_summaries; duplicated version: no.

Objects introduced/redefined: view `public.report_expiry_status_summary`; view `public.report_purchasing_summary`; view `public.report_transfer_summary`.

Prerequisite steps: 9, 8, 13, 30.
Dependent later steps: none directly.

## 44. 20261118025513_owner_first_use_and_invitations.sql
Version: `20261118025513`; module: owner_first_use_and_invitations; duplicated version: no.

Objects introduced/redefined: table `public.staff_invitations`; unique index `staff_invitations_pending_email`; index `staff_invitations_inbox`; function `app_private.complete_owner_setup`; function `app_private.invite_staff`; function `app_private.my_staff_invitations`; function `app_private.accept_staff_invitation`; function `app_private.cancel_staff_invitation`; function `app_private.owner_setup_progress`; function `app_private.create_branch_with_access`; function `public.create_branch_with_access`; function `public.complete_owner_setup`; function `public.invite_staff`; function `public.my_staff_invitations`; function `public.accept_staff_invitation`; function `public.cancel_staff_invitation`; function `public.owner_setup_progress`.

Prerequisite steps: 1, 4, 8, 13, 19.
Dependent later steps: 52.

## 45. 20261118035150_catalog_opening_stock.sql
Version: `20261118035150`; module: catalog_opening_stock; duplicated version: no.

Objects introduced/redefined: function `app_private.guard_product_stock_unit`; trigger `products_stock_unit_guard`; function `app_private.lock_movement_stock_unit`; trigger `inventory_movements_stock_unit_lock`; function `public.create_catalog_product`; function `public.maintain_product_barcode`; trigger `product_barcodes_catalog_audit`; function `public.search_catalog_products`; function `public.search_catalog_batches`; function `public.search_inventory_stock`; function `public.post_opening_stock`; function `public.commit_import_job`.

Prerequisite steps: 1, 4, 9, 8, 13, 16, 19, 28, 29.
Dependent later steps: 53.

## 46. 20261118132215_inventory_count_completion_audit_boundary.sql
Version: `20261118132215`; module: inventory_count_completion_audit_boundary; duplicated version: no.

Objects introduced/redefined: function `app_private.audit_completed_inventory_count`; trigger `inventory_stock_counts_completion_audit`; function `public.complete_inventory_stock_count`.

Prerequisite steps: 1, 4, 9, 10, 19, 40.
Dependent later steps: none directly.

## 47. 20261118143500_transfer_operational_context.sql
Version: `20261118143500`; module: transfer_operational_context; duplicated version: no.

Objects introduced/redefined: function `public.read_stock_transfer_context`; function `public.list_stock_transfer_destinations`.

Prerequisite steps: 1, 4, 9, 8, 19, 30.
Dependent later steps: none directly.

## 48. 20261118160000_staff_access_completion.sql
Version: `20261118160000`; module: staff_access_completion; duplicated version: no.

Objects introduced/redefined: function `app_private.my_membership_unavailable`; function `public.my_membership_unavailable`; function `app_private.staff_directory_details`; function `app_private.maintain_staff_access`; function `public.staff_directory_details`; function `public.maintain_staff_access`.

Prerequisite steps: 1, 19.
Dependent later steps: none directly.

## 49. 20261118163907_pos_sales_refunds_completion.sql
Version: `20261118163907`; module: pos_sales_refunds_completion; duplicated version: no.

Objects introduced/redefined: function `app_private.complete_sale_reviewed_impl`; function `public.complete_sale_with_customer`.

Prerequisite steps: 1, 4, 8, 19, 24, 29.
Dependent later steps: none directly.

## 50. 20261118175946_operational_reports_exports.sql
Version: `20261118175946`; module: operational_reports_exports; duplicated version: no.

Objects introduced/redefined: function `public.read_operational_report`; index `reports_sales_period_idx`; index `reports_refunds_period_idx`; index `reports_payments_period_idx`; index `reports_movements_period_idx`; view `public.report_daily_sales`.

Prerequisite steps: 1, 4, 9, 8, 13, 19, 24, 28, 30.
Dependent later steps: none directly.

## 51. 20261118191935_operational_settings_configuration.sql
Version: `20261118191935`; module: operational_settings_configuration; duplicated version: no.

Objects introduced/redefined: function `app_private.validate_business_configuration`; trigger `organizations_validate_configuration`; trigger `branches_validate_configuration`; function `app_private.lock_business_currency`; trigger `batches_lock_currency`; trigger `purchase_orders_lock_currency`; trigger `sales_lock_currency`; function `app_private.notify_expiry_alert`; function `app_private.audit_security_change`.

Prerequisite steps: 1, 4, 8, 13, 24, 28, 29.
Dependent later steps: none directly.

## 52. 20261118213000_notifications_operational_followup.sql
Version: `20261118213000`; module: notifications_operational_followup; duplicated version: no.

Objects introduced/redefined: unique index `notifications_open_condition`; index `notifications_inbox_page`; function `app_private.notification_visible`; function `app_private.refresh_operational_notifications_impl`; function `public.refresh_operational_notifications`.

Prerequisite steps: 1, 4, 9, 8, 13, 19, 20, 28, 30, 44.
Dependent later steps: none directly.

## 53. 20261118215803_controlled_imports_onboarding.sql
Version: `20261118215803`; module: controlled_imports_onboarding; duplicated version: no.

Objects introduced/redefined: function `public.check_import_row`; function `public.preview_import_rows`; function `public.stage_import_job`; function `public.commit_import_job`.

Prerequisite steps: 1, 4, 9, 8, 13, 19, 28, 45.
Dependent later steps: none directly.
