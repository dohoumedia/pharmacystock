import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { previewImport } from '../domain/importPreview';
import { csvByteLength, type CsvIssue } from '../domain/csv';
export { parseCsv } from '../domain/csv';

export type Customer = { id:string; organization_id:string; full_name:string; phone:string|null; email:string|null; preferred_locale:'fr'|'en'; marketing_consent:boolean; service_notification_consent:boolean; notes:string|null; status:'active'|'archived'; created_at:string; updated_at:string };
export type DailySalesReport = { organization_id:string|null; branch_id:string|null; sale_date:string|null; sale_count:number|null; gross_sales:number|null };
export type InventoryValueReport = { organization_id:string|null; branch_id:string|null; stocked_batches:number|null; inventory_cost_value:number|null; inventory_retail_value:number|null };
export type ExpiryStatusSummary = { organization_id:string|null; branch_id:string|null; expired_batches:number|null; expired_units:number|null; quarantined_batches:number|null; quarantined_units:number|null; recalled_batches:number|null; recalled_units:number|null; expiring_30d_batches:number|null; expiring_30d_units:number|null };
export type PurchasingSummary = { organization_id:string|null; branch_id:string|null; open_orders:number|null; partially_received_orders:number|null; received_orders:number|null; ordered_quantity:number|null; received_quantity:number|null; ordered_value:number|null; outstanding_value:number|null };
export type TransferSummary = { organization_id:string|null; branch_id:string|null; open_transfers:number|null; in_transit_transfers:number|null; received_transfers:number|null; requested_quantity:number|null; dispatched_quantity:number|null; received_quantity:number|null; discrepancy_quantity:number|null };
export type Notification = { id:string; organization_id:string; branch_id:string|null; recipient_user_id:string; type:string; title_key:string; body_key:string; payload:unknown; read_at:string|null; created_at:string };
export type NotificationPreferences = { organization_id:string; user_id:string; in_app:boolean; email:boolean; sms:boolean; whatsapp:boolean; push:boolean; updated_at:string };
export type OrganizationSettings = { organization_id:string; receipt_footer:string|null; default_payment_method:'CASH'|'CARD'|'MOBILE_MONEY'|'BANK_TRANSFER'|'OTHER'; allow_negative_stock:boolean; low_stock_default_threshold:number; notification_channels:unknown; updated_at:string };
export type SubscriptionPlan = { code:string; name:string; monthly_price:number; currency_code:string; included_branches:number; included_users:number; features:unknown; active:boolean };
export type Subscription = { id:string; organization_id:string; plan_code:string; status:'TRIAL'|'ACTIVE'|'PAST_DUE'|'GRACE'|'SUSPENDED'|'CANCELLED'; trial_ends_at:string|null; current_period_start:string|null; current_period_end:string|null; provider:string|null; provider_reference:string|null };
export type AuditLog = { id:number; organization_id:string|null; branch_id:string|null; actor_user_id:string|null; event_type:string; entity_type:string|null; entity_id:string|null; metadata:unknown; created_at:string };
export type ImportJob = { id:string; organization_id:string; branch_id:string|null; import_type:'PRODUCTS'|'SUPPLIERS'|'OPENING_STOCK'|'CUSTOMERS'; file_name:string|null; status:'DRAFT'|'VALIDATING'|'READY'|'COMMITTING'|'COMPLETED'|'FAILED'|'CANCELLED'; total_rows:number; valid_rows:number; invalid_rows:number; error_summary:unknown; created_by?:string; created_at:string; completed_at:string|null };
export type ImportRow = { id:number; import_job_id:string; organization_id:string; row_number:number; raw_data:unknown; normalized_data:unknown; status:string; errors:unknown; created_at:string };

type CoreDatabase = { public: { Tables: {
  customers:{ Row:Customer; Insert:Partial<Customer>&{organization_id:string;full_name:string}; Update:Partial<Customer>; Relationships:[] };
  notifications:{ Row:Notification; Insert:never; Update:{read_at?:string|null}; Relationships:[] };
  notification_preferences:{ Row:NotificationPreferences; Insert:Partial<NotificationPreferences>&{organization_id:string;user_id:string}; Update:Partial<NotificationPreferences>; Relationships:[] };
  organization_settings:{ Row:OrganizationSettings; Insert:Partial<OrganizationSettings>&{organization_id:string}; Update:Partial<OrganizationSettings>; Relationships:[] };
  subscription_plans:{ Row:SubscriptionPlan; Insert:never; Update:never; Relationships:[] };
  subscriptions:{ Row:Subscription; Insert:never; Update:never; Relationships:[] };
  audit_logs:{ Row:AuditLog; Insert:never; Update:never; Relationships:[] };
  import_jobs:{ Row:ImportJob; Insert:{organization_id:string;branch_id?:string|null;import_type:ImportJob['import_type'];file_name?:string|null;total_rows?:number;valid_rows?:number;invalid_rows?:number;status?:ImportJob['status']}; Update:Partial<ImportJob>; Relationships:[] };
  import_rows:{ Row:ImportRow; Insert:{import_job_id:string;organization_id:string;row_number:number;raw_data:unknown;normalized_data?:unknown;status?:string;errors?:unknown}; Update:never; Relationships:[] };
}; Views:{ report_daily_sales:{Row:DailySalesReport;Relationships:[]}; report_inventory_value:{Row:InventoryValueReport;Relationships:[]}; report_expiry_status_summary:{Row:ExpiryStatusSummary;Relationships:[]}; report_purchasing_summary:{Row:PurchasingSummary;Relationships:[]}; report_transfer_summary:{Row:TransferSummary;Relationships:[]} }; Functions:{ commit_import_job:{Args:{p_import_job_id:string};Returns:number}; stage_import_job:{Args:{p_job_id:string;p_organization_id:string;p_branch_id:string|null;p_type:string;p_file_name:string|null;p_rows:unknown};Returns:string}; preview_import_rows:{Args:{p_organization_id:string;p_branch_id:string|null;p_type:string;p_rows:unknown};Returns:unknown} }; Enums:Record<string,never>; CompositeTypes:Record<string,never> } };

const db=supabase as unknown as SupabaseClient<CoreDatabase>;

export async function loadDailySales(organizationId:string,branchId:string):Promise<DailySalesReport[]>{const{data,error}=await db.from('report_daily_sales').select('*').eq('organization_id',organizationId).eq('branch_id',branchId).order('sale_date',{ascending:false}).limit(31);if(error)throw error;return data;}
export async function loadInventoryValue(organizationId:string,branchId:string):Promise<InventoryValueReport|null>{const{data,error}=await db.from('report_inventory_value').select('*').eq('organization_id',organizationId).eq('branch_id',branchId).maybeSingle();if(error)throw error;return data;}
export async function loadExpiryStatusSummary(organizationId:string,branchId:string):Promise<ExpiryStatusSummary|null>{const{data,error}=await db.from('report_expiry_status_summary').select('*').eq('organization_id',organizationId).eq('branch_id',branchId).maybeSingle();if(error)throw error;return data;}
export async function loadPurchasingSummary(organizationId:string,branchId:string):Promise<PurchasingSummary|null>{const{data,error}=await db.from('report_purchasing_summary').select('*').eq('organization_id',organizationId).eq('branch_id',branchId).maybeSingle();if(error)throw error;return data;}
export async function loadTransferSummary(organizationId:string,branchId:string):Promise<TransferSummary|null>{const{data,error}=await db.from('report_transfer_summary').select('*').eq('organization_id',organizationId).eq('branch_id',branchId).maybeSingle();if(error)throw error;return data;}
export async function loadNotifications(organizationId:string,userId:string):Promise<Notification[]>{const{data,error}=await db.from('notifications').select('*').eq('organization_id',organizationId).eq('recipient_user_id',userId).order('created_at',{ascending:false}).limit(50);if(error)throw error;return data;}
export async function markNotificationRead(id:string):Promise<void>{const{error}=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(error)throw error;}
export async function loadNotificationPreferences(organizationId:string,userId:string):Promise<NotificationPreferences|null>{const{data,error}=await db.from('notification_preferences').select('*').eq('organization_id',organizationId).eq('user_id',userId).maybeSingle();if(error)throw error;return data;}
export async function saveNotificationPreferences(input:Omit<NotificationPreferences,'updated_at'>):Promise<NotificationPreferences>{const{data,error}=await db.from('notification_preferences').upsert(input,{onConflict:'organization_id,user_id'}).select('*').single();if(error)throw error;return data;}
export async function loadOrganizationSettings(organizationId:string):Promise<OrganizationSettings|null>{const{data,error}=await db.from('organization_settings').select('*').eq('organization_id',organizationId).maybeSingle();if(error)throw error;return data;}
export async function saveOrganizationSettings(input:{organization_id:string;receipt_footer?:string|null;default_payment_method:OrganizationSettings['default_payment_method'];low_stock_default_threshold:number}):Promise<OrganizationSettings>{const{data,error}=await db.from('organization_settings').upsert(input,{onConflict:'organization_id'}).select('*').single();if(error)throw error;return data;}
export async function loadSubscription(organizationId:string):Promise<{subscription:Subscription|null;plan:SubscriptionPlan|null}>{const{subData,subError}=await (async()=>{const{data,error}=await db.from('subscriptions').select('*').eq('organization_id',organizationId).maybeSingle();return{subData:data,subError:error};})();if(subError)throw subError;const planCode=subData?.plan_code??'CORE_35000';const{data:plan,error:planError}=await db.from('subscription_plans').select('*').eq('code',planCode).maybeSingle();if(planError)throw planError;return{subscription:subData,plan};}
export async function loadAuditLogs(organizationId:string,branchId?:string):Promise<AuditLog[]>{let query=db.from('audit_logs').select('id,organization_id,branch_id,actor_user_id,event_type,entity_type,entity_id,metadata,created_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100);if(branchId)query=query.eq('branch_id',branchId);const{data,error}=await query;if(error)throw error;return data as AuditLog[];}
export async function loadImportJobs(organizationId:string):Promise<ImportJob[]>{const{data,error}=await db.from('import_jobs').select('*').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(50);if(error)throw error;return data;}
export async function loadImportRows(organizationId:string,importJobId:string,page=0):Promise<ImportRow[]>{if(!Number.isInteger(page)||page<0)throw new Error('IMPORT_PAGE_INVALID');const{data,error}=await db.from('import_rows').select('*').eq('organization_id',organizationId).eq('import_job_id',importJobId).order('row_number').range(page*25,page*25+24);if(error)throw error;return data;}
export type ImportAttempt = { attemptId: string; organizationId: string; branchId?: string|null; type: ImportJob['import_type']; fileName?: string; rows: Record<string,string>[]; rowNumbers?: number[]; originalRows?: Record<string,string>[] };
export function importPayload(input: ImportAttempt) {
 const headers=Array.from(new Set(input.rows.flatMap(row=>Object.keys(row))));
 const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
 const source=[headers.map(quote).join(','),...input.rows.map(row=>headers.map(header=>quote(row[header]??'')).join(','))].join('\n');
 const preview=previewImport(source,input.type);
 if(!input.attemptId||!preview.valid||input.rows.length!==preview.rows.length||(input.type==='OPENING_STOCK'&&!input.branchId))throw new Error('IMPORT_PREVIEW_INVALID');
 if(input.rowNumbers&&(input.rowNumbers.length!==input.rows.length||new Set(input.rowNumbers).size!==input.rowNumbers.length||input.rowNumbers.some(row=>!Number.isInteger(row)||row<2)))throw new Error('IMPORT_PREVIEW_INVALID');
 if(input.originalRows && input.originalRows.length!==input.rows.length)throw new Error('IMPORT_PREVIEW_INVALID');
 const rows=preview.rows.map((row,index)=>({row_number:input.rowNumbers?.[index]??index+2,raw_data:input.originalRows?.[index]??input.rows[index],normalized_data:row.data}));
 if(csvByteLength(JSON.stringify(rows))>2_000_000)throw new Error('IMPORT_LIMIT');
 return rows;
}
export async function inspectImport(input: ImportAttempt): Promise<{rowNumber:number;issues:(CsvIssue & {severity?:string})[]}[]> {
 const {data,error}=await db.rpc('preview_import_rows',{p_organization_id:input.organizationId,p_branch_id:input.branchId??null,p_type:input.type,p_rows:importPayload(input)});
 if(error)throw error;
 return data as {rowNumber:number;issues:(CsvIssue & {severity?:string})[]}[];
}
/** One atomic request; UUID and immutable payload survive an uncertain response. */
export async function stageImport(input: ImportAttempt):Promise<string>{
 const rows=importPayload(input);
 const{data,error}=await db.rpc('stage_import_job',{p_job_id:input.attemptId,p_organization_id:input.organizationId,p_branch_id:input.branchId??null,p_type:input.type,p_file_name:input.fileName??null,p_rows:rows});
 if(error)throw error;
 return data;
}
export async function commitImportJob(importJobId:string):Promise<number>{const{data,error}=await db.rpc('commit_import_job',{p_import_job_id:importJobId});if(error)throw error;return data;}
