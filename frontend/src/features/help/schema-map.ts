/**
 * Every table in backend/src/db/schema.ts, extracted from the Drizzle definitions with
 * getTableConfig (58 tables, 538 columns, 69 foreign keys). Each column reads
 * `name:type[:pk][:>target table][:nn]` (nn = NOT NULL). Re-extract when the schema changes.
 */

const RAW: Record<string, string> = {
  account: 'id:int:pk name:text:nn type:text:nn icon:text color:text sort_order:int:nn is_active:int:nn system_key:text description:text account_number:text credit_limit:int interest_rate:int billing_date:int provider:text parent_id:int:>account liquidity_class:text:nn',
  transaction: 'id:int:pk batch_id:int:>transaction_batch tax_treatment:text date:int:nn due_date:int description:text:nn reference:text notes:text place:text tx_type:text:nn status:text:nn period_id:int:>salary_period linked_tx_id:int reversal_of_tx_id:int:>transaction category_id:int:>category installment_months:int interest_rate_percent:int admin_fee_cents:int total_installments:int origin_lat:real origin_lng:real origin_name:text dest_lat:real dest_lng:real dest_name:text distance_km:real subscription_id:int:>subscription created_at:int:nn',
  transaction_line: 'id:int:pk transaction_id:int:>transaction:nn account_id:int:>account:nn debit:int:nn credit:int:nn description:text cash_flow_class:text',
  transaction_batch: 'id:int:pk name:text:nn source:text:nn status:text:nn note:text created_at:int:nn posted_at:int',
  transaction_reallocation: 'id:int:pk incoming_transaction_id:int:>transaction:nn outgoing_transaction_id:int:>transaction:nn amount:int:nn reason:text:nn created_at:int:nn',
  transaction_category_allocation: 'id:int:pk transaction_id:int:>transaction:nn category_id:int:>category:nn amount:int:nn',
  attachment: 'id:int:pk transaction_id:int:>transaction:nn filename:text:nn r2_key:text:nn mimetype:text:nn file_size:int:nn',

  category: 'id:int:pk name:text:nn icon:text color:text is_active:int:nn reporting_account_id:int:>account',
  tag_group: 'id:int:pk name:text:nn sort_order:int:nn created_at:int:nn',
  tag: 'id:int:pk name:text:nn color:text:nn group_id:int:>tag_group',
  transaction_tag: 'transaction_id:int:>transaction:nn tag_id:int:>tag:nn',
  transport_route_template: 'id:int:pk name:text:nn provider:text service:text origin_name:text origin_lat:real origin_lng:real dest_name:text dest_lat:real dest_lng:real category_id:int:>category default_account_id:int:>account notes:text tag_ids:text:nn created_at:int:nn updated_at:int:nn',

  salary_period: 'id:int:pk name:text:nn start_date:int:nn end_date:int:nn status:text:nn closed_at:int reopened_at:int is_active:int:nn archived_at:int coverage_status:text:nn coverage_reason:text budget_note:text savings_target_amount:int:nn savings_target_mode:text:nn savings_target_rate:real:nn',
  budget_plan: 'id:int:pk period_id:int:>salary_period:nn category_id:int:>category:nn planned_amount:int:nn note:text',
  budget_template: 'id:int:pk name:text:nn description:text is_active:int:nn created_at:int:nn',
  budget_template_item: 'id:int:pk template_id:int:>budget_template:nn category_id:int:>category:nn planned_amount:int:nn sort_order:int:nn',
  forecast_review: 'id:int:pk period_id:int:>salary_period:nn category_id:int:>category:nn evidence_revision:int:nn classification:text:nn weight:real:nn confidence:real:nn rationale:text:nn evidence_period_ids:text:nn model:text:nn prompt_version:text:nn status:text:nn user_weight:real created_at:int:nn updated_at:int:nn',
  forecast_purchase_review: 'id:int:pk transaction_id:int:>transaction:nn transaction_date:int:nn period_id:int:>salary_period:nn category_id:int:>category:nn amount:int:nn evidence_revision:int:nn classification:text:nn weight:real:nn confidence:real:nn rationale:text:nn model:text:nn prompt_version:text:nn status:text:nn user_weight:real created_at:int:nn updated_at:int:nn',
  salary_settings: 'id:int:pk gross_monthly:int:nn payroll_day:int:nn ptkp_code:text:nn deposit_account_id:int:>account ter_category:text:nn jkk_risk_grade:int:nn jkm_rate:int:nn bpjs_kesehatan_active:int:nn jp_wage_cap:int:nn bpjs_kes_wage_cap:int:nn jht_wage_cap:int:nn updated_at:int:nn',
  wishlist: 'id:int:pk name:text:nn description:text amount:int:nn category_id:int:>category period_id:int:>salary_period status:text:nn fulfilled_at:int fulfilled_transaction_id:int:>transaction image_url:text created_at:int:nn updated_at:int:nn',

  contact: 'id:int:pk name:text:nn kind:text:nn full_name:text email:text phone:text relationship_type:text notes:text is_active:int:nn created_at:int:nn updated_at:int:nn',
  loan: 'id:int:pk contact_id:int:>contact:nn direction:text:nn amount_cents:int:nn remaining_cents:int:nn start_date:int:nn due_date:int status:text:nn description:text source_type:text:nn source_transaction_id:int:>transaction wallet_account_id:int:>account lending_transaction_id:int:>transaction is_active:int:nn created_at:int:nn updated_at:int:nn',
  loan_payment: 'id:int:pk loan_id:int:>loan:nn amount_cents:int:nn principal_cents:int:nn payment_date:int:nn transaction_id:int:>transaction status:text:nn reversal_transaction_id:int:>transaction reversed_at:int reversal_reason:text notes:text created_at:int:nn',
  loan_payment_attachment: 'id:int:pk loan_payment_id:int:>loan_payment:nn filename:text:nn r2_key:text:nn mimetype:text:nn file_size:int:nn created_at:int:nn',
  paylater_installment: 'id:int:pk recognition_tx_id:int:>transaction:nn installment_number:int:nn total_installments:int:nn due_date:int:nn principal_cents:int:nn interest_cents:int:nn fee_cents:int:nn total_cents:int:nn paid_cents:int:nn status:text:nn paid_tx_id:int created_at:int:nn',
  paylater_settlement_allocation: 'id:int:pk settlement_tx_id:int:>transaction:nn installment_id:int:>paylater_installment:nn amount_cents:int:nn created_at:int:nn',
  splitbill_session: 'id:int:pk merchant_name:text receipt_date:int receipt_image_r2_key:text parsed_items_json:text subtotal_cents:int tax_cents:int service_fee_cents:int discount_cents:int total_cents:int:nn people_json:text assignments_json:text split_result_json:text loan_ids:text status:text:nn created_at:int:nn updated_at:int:nn',

  reimbursement_claim: 'id:int:pk contact_id:int:>contact:nn title:text:nn status:text:nn due_date:int notes:text submitted_at:int approved_at:int written_off_at:int writeoff_transaction_id:int:>transaction version:int:nn created_at:int:nn updated_at:int:nn',
  reimbursement_claim_source: 'id:int:pk claim_id:int:>reimbursement_claim:nn source_transaction_id:int:>transaction:nn expense_line_id:int:>transaction_line:nn category_id:int:>category amount:int:nn recognition_transaction_id:int:>transaction created_at:int:nn',
  reimbursement_receipt: 'id:int:pk transaction_id:int:>transaction:nn receipt_date:int:nn amount:int:nn status:text:nn reversal_transaction_id:int:>transaction reversal_reason:text notes:text created_at:int:nn',
  reimbursement_receipt_allocation: 'id:int:pk receipt_id:int:>reimbursement_receipt:nn claim_id:int:>reimbursement_claim:nn amount:int:nn',
  reimbursement_operation: 'id:int:pk idempotency_key:text:nn operation:text:nn request_hash:text:nn result_json:text:nn created_at:int:nn',

  subscription: 'id:int:pk name:text:nn linked_account_id:int:>account:nn category_id:int:>category amount:int:nn billing_cycle:text:nn next_renewal_at:int:nn billing_day:int status:text:nn icon_key:text:nn sort_order:int:nn created_at:int:nn updated_at:int:nn',
  recurring_occurrence: 'id:int:pk job_type:text:nn schedule_id:int:nn occurrence_date:int:nn status:text:nn transaction_id:int:>transaction last_error:text created_at:int:nn updated_at:int:nn',
  pending_transaction: 'id:int:pk raw_message:text:nn parsed_data:text:nn status:text:nn parse_attempts:int:nn last_error:text user_message_id:text source:text:nn created_at:int:nn updated_at:int:nn',
  gmail_connection: 'owner_email:text:pk google_email:text:nn refresh_token:text:nn last_synced_at:int created_at:int:nn updated_at:int:nn',
  reconciliation_session: 'id:int:pk as_of_date:int:nn status:text:nn lifecycle_status:text:nn voided_at:int void_reason:text kind:text:nn note:text created_at:int:nn',
  reconciliation_item: 'id:int:pk session_id:int:>reconciliation_session:nn account_id:int:>account:nn ledger_balance:int:nn actual_balance:int:nn difference:int:nn status:text:nn correction_transaction_id:int:>transaction',

  agent_conversation: 'id:int:pk owner_email:text:nn title:text:nn title_source:text:nn created_at:int:nn updated_at:int:nn is_pinned:int:nn archived_at:int summary:text summary_through_message_id:int:nn',
  agent_message: 'id:int:pk conversation_id:int:>agent_conversation:nn role:text:nn content:text:nn response_json:text prompt_tokens:int completion_tokens:int total_tokens:int estimated_cost_usd:real created_at:int:nn',
  agent_message_attachment: 'id:int:pk message_id:int:>agent_message:nn conversation_id:int:>agent_conversation:nn filename:text:nn mimetype:text:nn r2_key:text:nn file_size:int:nn created_at:int:nn',
  agent_conversation_insight: 'id:int:pk conversation_id:int:>agent_conversation:nn claim:text:nn evidence_ids:text:nn financial_revision:int:nn status:text:nn created_at:int:nn updated_at:int:nn',
  agent_pending_action: 'id:int:pk owner_email:text:nn conversation_id:int:>agent_conversation kind:text:nn normalized_input:text:nn assumptions:text missing_fields:text batch_id:text base_financial_revision:int:nn status:text:nn expires_at:int:nn created_at:int:nn updated_at:int:nn',
  agent_approval: 'id:int:pk pending_action_id:int:>agent_pending_action:nn owner_email:text:nn token_hash:text:nn idempotency_key:text:nn status:text:nn approved_at:int executed_at:int execution_receipt:text expires_at:int:nn created_at:int:nn',
  agent_memory: 'id:int:pk owner_email:text:nn label:text:nn content:text:nn created_at:int:nn updated_at:int:nn',
  agent_model: 'id:int:pk name:text:nn model:text:nn base_url:text:nn api_key_ciphertext:text api_key_updated_at:int is_default:int:nn created_at:int:nn updated_at:int:nn',
  agent_provider_settings: 'id:int:pk model:text:nn api_key_ciphertext:text api_key_updated_at:int',
  user_profile: 'owner_email:text:pk full_name:text preferred_name:text nickname:text pronouns:text date_of_birth:text country:text timezone:text:nn language:text:nn currency:text:nn income_pattern:text primary_goal:text agent_tone:text:nn agent_verbosity:text:nn agent_context_preferences:text:nn updated_at:int:nn',

  audit_log: 'id:int:pk entity_type:text:nn entity_id:int:nn action:text:nn before_snapshot:blob after_snapshot:blob created_at:int:nn',
  money_anomaly_review: 'id:int:pk fingerprint:text:nn kind:text:nn transaction_id:int:>transaction:nn related_transaction_id:int:>transaction detected_amount:int:nn reason:text:nn status:text:nn reviewed_at:int review_note:text created_at:int:nn',
  financial_state: 'id:int:pk revision:int:nn updated_at:int:nn',
  cache_invalidation_outbox: 'id:int:pk operation:text:nn account_id:int period_id:int revision:int:nn status:text:nn attempts:int:nn last_error:text created_at:int:nn processed_at:int',
  storage_deletion_outbox: 'id:int:pk r2_key:text:nn entity_type:text:nn entity_id:int:nn status:text:nn attempts:int:nn last_error:text created_at:int:nn processed_at:int',
  background_task: 'id:text:pk queue_name:text:nn job_name:text:nn dedupe_key:text:nn owner_email:text subject_type:text subject_id:text payload_json:text:nn result_json:text status:text:nn attempts:int:nn max_attempts:int:nn available_at:int:nn started_at:int completed_at:int last_error:text created_at:int:nn updated_at:int:nn',
  database_backup_settings: 'owner_email:text:pk enabled:int:nn frequency:text:nn last_backup_at:int updated_at:int:nn',
  recap_story: 'owner_email:text:nn month:text:nn payload_json:text:nn generated_at:int:nn',
  recap_period_story: 'owner_email:text:nn period_id:int:nn payload_json:text:nn generated_at:int:nn',
  recap_period_highlight_seen: 'owner_email:text:nn period_id:int:>salary_period:nn seen_at:int:nn',
};

export type SchemaColumn = { name: string; type: string; pk: boolean; notNull: boolean; references: string | null };
export type SchemaTable = { name: string; area: SchemaArea; note: string; columns: SchemaColumn[] };
export type SchemaArea = 'Ledger' | 'Labels' | 'Periods and planning' | 'Debts and pay later' | 'Reimbursements' | 'Recurring and imports' | 'Agent' | 'Records and system';

export const SCHEMA_AREAS: SchemaArea[] = ['Ledger', 'Labels', 'Periods and planning', 'Debts and pay later', 'Reimbursements', 'Recurring and imports', 'Agent', 'Records and system'];

const AREA_OF: Record<string, SchemaArea> = {
  account: 'Ledger', transaction: 'Ledger', transaction_line: 'Ledger', transaction_batch: 'Ledger', transaction_reallocation: 'Ledger', transaction_category_allocation: 'Ledger', attachment: 'Ledger',
  category: 'Labels', tag_group: 'Labels', tag: 'Labels', transaction_tag: 'Labels', transport_route_template: 'Labels',
  salary_period: 'Periods and planning', budget_plan: 'Periods and planning', budget_template: 'Periods and planning', budget_template_item: 'Periods and planning', forecast_review: 'Periods and planning', forecast_purchase_review: 'Periods and planning', salary_settings: 'Periods and planning', wishlist: 'Periods and planning',
  contact: 'Debts and pay later', loan: 'Debts and pay later', loan_payment: 'Debts and pay later', loan_payment_attachment: 'Debts and pay later', paylater_installment: 'Debts and pay later', paylater_settlement_allocation: 'Debts and pay later', splitbill_session: 'Debts and pay later',
  reimbursement_claim: 'Reimbursements', reimbursement_claim_source: 'Reimbursements', reimbursement_receipt: 'Reimbursements', reimbursement_receipt_allocation: 'Reimbursements', reimbursement_operation: 'Reimbursements',
  subscription: 'Recurring and imports', recurring_occurrence: 'Recurring and imports', pending_transaction: 'Recurring and imports', gmail_connection: 'Recurring and imports', reconciliation_session: 'Recurring and imports', reconciliation_item: 'Recurring and imports',
  agent_conversation: 'Agent', agent_message: 'Agent', agent_message_attachment: 'Agent', agent_conversation_insight: 'Agent', agent_pending_action: 'Agent', agent_approval: 'Agent', agent_memory: 'Agent', agent_model: 'Agent', agent_provider_settings: 'Agent', user_profile: 'Agent',
  audit_log: 'Records and system', money_anomaly_review: 'Records and system', financial_state: 'Records and system', cache_invalidation_outbox: 'Records and system', storage_deletion_outbox: 'Records and system', background_task: 'Records and system', database_backup_settings: 'Records and system', recap_story: 'Records and system', recap_period_story: 'Records and system', recap_period_highlight_seen: 'Records and system',
};

const NOTES: Record<string, string> = {
  account: 'Where money lives or is counted: asset, liability, equity, revenue or expense. system_key marks built-ins like Expense (Auto).',
  transaction: 'A journal entry. status is posted, draft or reversed; reversal_of_tx_id points at the entry a correction cancels.',
  transaction_line: 'One debit or credit on one account. An entry has two or more, and they balance.',
  transaction_batch: 'A group of draft entries, as built in Backfill, posted together.',
  transaction_reallocation: 'Links money that came in and went out again, so the matched amount counts as neither.',
  transaction_category_allocation: 'How an entry’s spending splits across categories.',
  attachment: 'A receipt or file on an entry, stored in R2 under r2_key.',
  category: 'A spending label. reporting_account_id is the expense account it rolls up to.',
  tag: 'A free label on entries, optionally in a tag group.',
  transaction_tag: 'Entries and tags, many to many.',
  salary_period: 'A payday-to-payday period: open or closed, its coverage, and the budget note and savings target.',
  budget_plan: 'The planned amount for one category in one period.',
  forecast_purchase_review: 'Agent’s review of one past purchase (one-off or unusual) used by the budget forecast.',
  loan: 'Money lent to or borrowed from a contact, with the entries that moved it.',
  paylater_installment: 'One installment of a pay-later purchase (recognition_tx_id).',
  reimbursement_claim: 'A claim to a payer, with its status from draft to settled.',
  subscription: 'A recurring charge; each confirmed renewal becomes an entry pointing back via transaction.subscription_id.',
  pending_transaction: 'An imported item (for example a bank email) waiting for approval.',
  reconciliation_item: 'One account’s checked balance in a reconcile, and its correcting entry if any.',
  agent_pending_action: 'A draft Agent prepared, tied to the revision it was based on.',
  agent_approval: 'The one-time token that lets a draft be executed.',
  audit_log: 'Before and after snapshots of every change, by entity.',
  financial_state: 'A single revision number that goes up with every financial change.',
  background_task: 'Durable record of queued work, so jobs survive a Redis outage.',
};

export const SCHEMA_TABLES: SchemaTable[] = Object.entries(RAW).map(([name, spec]) => ({
  name,
  area: AREA_OF[name] ?? 'Records and system',
  note: NOTES[name] ?? '',
  columns: spec.split(' ').map((part) => {
    const [columnName = '', type = '', ...flags] = part.split(':');
    const reference = flags.find((flag) => flag.startsWith('>'));
    return { name: columnName, type, pk: flags.includes('pk'), notNull: flags.includes('nn') || flags.includes('pk'), references: reference ? reference.slice(1) : null };
  }),
}));
