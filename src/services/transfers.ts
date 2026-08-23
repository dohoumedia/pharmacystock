import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isTransferBatchEligible } from '@/domain/transferSafety';

export type StockTransfer = {
  id:string; organization_id:string; source_branch_id:string; destination_branch_id:string;
  transfer_number:string; status:'REQUESTED'|'APPROVED'|'DISPATCHED'|'RECEIVED'|'RECEIVED_WITH_DISCREPANCY'|'CANCELLED';
  notes:string|null; discrepancy_notes:string|null; requested_by:string; approved_by:string|null; dispatched_by:string|null; received_by:string|null;
  requested_at:string; approved_at:string|null; dispatched_at:string|null; received_at:string|null; created_at:string; updated_at:string;
};
export type StockTransferLine = {
  id:string; organization_id:string; transfer_id:string; source_batch_id:string; destination_batch_id:string|null; product_id:string;
  requested_quantity:number; dispatched_quantity:number; received_quantity:number; discrepancy_quantity:number; discrepancy_reason:string|null;
  transfer_out_movement_id:string|null; transfer_in_movement_id:string|null; created_at:string; updated_at:string;
};
export type TransferBatch = { id:string; organization_id:string; branch_id:string; product_id:string; lot_number:string; expiry_date:string; status:string; product?:{name:string}|null; balance?:number };

type TransferDb={public:{Tables:{
  stock_transfers:{Row:StockTransfer;Insert:never;Update:never;Relationships:[]};
  stock_transfer_lines:{Row:StockTransferLine;Insert:never;Update:never;Relationships:[]};
  batches:{Row:{id:string;organization_id:string;branch_id:string;product_id:string;lot_number:string;expiry_date:string;status:string};Insert:never;Update:never;Relationships:[]};
  products:{Row:{id:string;organization_id:string;name:string};Insert:never;Update:never;Relationships:[]};
};Views:{inventory_balances:{Row:{organization_id:string|null;branch_id:string|null;batch_id:string|null;product_id:string|null;available_quantity:number|null};Relationships:[]}};Functions:{
  create_stock_transfer:{Args:{p_organization_id:string;p_source_branch_id:string;p_destination_branch_id:string;p_transfer_number:string;p_lines:{source_batch_id:string;quantity:number}[];p_idempotency_key:string;p_notes?:string|null};Returns:string};
  approve_stock_transfer:{Args:{p_transfer_id:string};Returns:string};
  cancel_stock_transfer:{Args:{p_transfer_id:string;p_reason?:string|null};Returns:string};
  dispatch_stock_transfer:{Args:{p_transfer_id:string};Returns:string};
  receive_stock_transfer:{Args:{p_transfer_id:string;p_received_lines?:{line_id:string;quantity:number;reason?:string}[]|null;p_discrepancy_notes?:string|null};Returns:string};
};Enums:Record<string,never>;CompositeTypes:Record<string,never>}};

const db=supabase as unknown as SupabaseClient<TransferDb>;

export async function loadTransfers(organizationId:string):Promise<StockTransfer[]>{
  const{data,error}=await db.from('stock_transfers').select('*').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100);
  if(error)throw error; return data;
}
export async function loadTransferLines(organizationId:string,transferId:string):Promise<StockTransferLine[]>{
  const{data,error}=await db.from('stock_transfer_lines').select('*').eq('organization_id',organizationId).eq('transfer_id',transferId).order('created_at');
  if(error)throw error; return data;
}
export async function loadTransferableBatches(organizationId:string,branchId:string):Promise<TransferBatch[]>{
  const{data:batches,error}=await db.from('batches').select('id,organization_id,branch_id,product_id,lot_number,expiry_date,status').eq('organization_id',organizationId).eq('branch_id',branchId).eq('status','ACTIVE').gte('expiry_date',new Date().toISOString().slice(0,10)).order('expiry_date');
  if(error)throw error;
  const productIds=[...new Set((batches??[]).map(b=>b.product_id))]; const batchIds=(batches??[]).map(b=>b.id);
  const [{data:products,error:pe},{data:balances,error:be}]=await Promise.all([
    productIds.length?db.from('products').select('id,organization_id,name').eq('organization_id',organizationId).in('id',productIds):Promise.resolve({data:[],error:null}),
    batchIds.length?db.from('inventory_balances').select('batch_id,available_quantity').eq('organization_id',organizationId).eq('branch_id',branchId).in('batch_id',batchIds):Promise.resolve({data:[],error:null})
  ]);
  if(pe)throw pe;if(be)throw be;
  const names=new Map((products??[]).map(p=>[p.id,p.name])); const qty=new Map((balances??[]).map(b=>[b.batch_id??'',Number(b.available_quantity??0)]));
  const today=new Date().toISOString().slice(0,10);
  return (batches??[]).map(b=>({...b,product:{name:names.get(b.product_id)??b.product_id},balance:qty.get(b.id)??0})).filter(b=>isTransferBatchEligible(b,today));
}
export async function createStockTransfer(input:{organizationId:string;sourceBranchId:string;destinationBranchId:string;transferNumber:string;lines:{source_batch_id:string;quantity:number}[];idempotencyKey:string;notes?:string}):Promise<string>{
 const{data,error}=await db.rpc('create_stock_transfer',{p_organization_id:input.organizationId,p_source_branch_id:input.sourceBranchId,p_destination_branch_id:input.destinationBranchId,p_transfer_number:input.transferNumber,p_lines:input.lines,p_idempotency_key:input.idempotencyKey,p_notes:input.notes?.trim()||null}); if(error)throw error; return data;
}
export async function approveStockTransfer(id:string){const{error}=await db.rpc('approve_stock_transfer',{p_transfer_id:id});if(error)throw error;}
export async function cancelStockTransfer(id:string,reason?:string){const{error}=await db.rpc('cancel_stock_transfer',{p_transfer_id:id,p_reason:reason?.trim()||null});if(error)throw error;}
export async function dispatchStockTransfer(id:string){const{error}=await db.rpc('dispatch_stock_transfer',{p_transfer_id:id});if(error)throw error;}
export async function receiveStockTransfer(id:string,lines:{line_id:string;quantity:number;reason?:string}[],notes?:string){const{error}=await db.rpc('receive_stock_transfer',{p_transfer_id:id,p_received_lines:lines,p_discrepancy_notes:notes?.trim()||null});if(error)throw error;}
