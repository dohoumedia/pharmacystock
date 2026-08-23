-- The public complete_sale_with_customer RPC is SECURITY INVOKER and delegates to this
-- SECURITY DEFINER worker in the non-exposed app_private schema. Authenticated callers
-- need EXECUTE on the worker for the wrapper to invoke it. app_private is not exposed
-- through the Data API, so this does not create a public REST RPC.
grant execute on function app_private.complete_sale_with_customer_impl(uuid,uuid,text,jsonb,jsonb,text,text,uuid) to authenticated;
