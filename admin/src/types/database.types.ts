
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "admin_asset_cleanup_events": {
                  Row: {
                    "attempt": number,"bucket": string,"created_at": string,"error_code": string | null,"error_detail": string | null,"id": number,"job_id": string,"outcome": string,"path": string,"worker_id": string | null
                  }
                  Insert: {
                    "attempt"?: number,"bucket": string,"created_at"?: string,"error_code"?: string | null,"error_detail"?: string | null,"id"?: never,"job_id": string,"outcome": string,"path": string,"worker_id"?: string | null
                  }
                  Update: {
                    "attempt"?: number,"bucket"?: string,"created_at"?: string,"error_code"?: string | null,"error_detail"?: string | null,"id"?: never,"job_id"?: string,"outcome"?: string,"path"?: string,"worker_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_asset_cleanup_events_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "admin_asset_cleanup_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_asset_cleanup_jobs": {
                  Row: {
                    "attempts": number,"bucket": string,"catalog_release_id": string | null,"completed_at": string | null,"created_at": string,"id": string,"last_attempt_at": string | null,"last_error": string | null,"last_error_at": string | null,"lease_expires_at": string | null,"lease_token": string | null,"next_attempt_at": string,"operation_id": string | null,"path": string,"quarantine_reason": string | null,"quarantined_at": string | null,"skip_reason": string | null,"skipped_at": string | null,"started_at": string | null,"storage_version": string | null,"target_type": string,"updated_at": string,"worker_id": string | null
                  }
                  Insert: {
                    "attempts"?: number,"bucket": string,"catalog_release_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"id"?: string,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_error_at"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"operation_id"?: string | null,"path": string,"quarantine_reason"?: string | null,"quarantined_at"?: string | null,"skip_reason"?: string | null,"skipped_at"?: string | null,"started_at"?: string | null,"storage_version"?: string | null,"target_type": string,"updated_at"?: string,"worker_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"bucket"?: string,"catalog_release_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"id"?: string,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_error_at"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"operation_id"?: string | null,"path"?: string,"quarantine_reason"?: string | null,"quarantined_at"?: string | null,"skip_reason"?: string | null,"skipped_at"?: string | null,"started_at"?: string | null,"storage_version"?: string | null,"target_type"?: string,"updated_at"?: string,"worker_id"?: string | null
                  }
                  Relationships: [

                  ]
                },"admin_asset_cleanup_sweep_state": {
                  Row: {
                    "bucket": string,"id": number,"last_folder": string | null,"last_run_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "bucket"?: string,"id"?: number,"last_folder"?: string | null,"last_run_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "bucket"?: string,"id"?: number,"last_folder"?: string | null,"last_run_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"admin_audit_logs": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"id": string,"metadata": NonNullable<Json>,"target_id": string,"target_type": string
                  }
                  Insert: {
                    "action": string,"actor_id": string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [

                  ]
                },"app_screenshots": {
                  Row: {
                    "alt_text": string,"app_id": string,"created_at": string,"id": string,"path": string,"position": number
                  }
                  Insert: {
                    "alt_text": string,"app_id": string,"created_at"?: string,"id"?: string,"path": string,"position"?: number
                  }
                  Update: {
                    "alt_text"?: string,"app_id"?: string,"created_at"?: string,"id"?: string,"path"?: string,"position"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_screenshots_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "app_screenshots_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    }
                  ]
                },"app_versions": {
                  Row: {
                    "account_requirement": Database["public"]['Enums']["account_requirement"],"apk_path": string | null,"apk_size_bytes": number,"apk_url": string | null,"app_id": string,"changelog": string,"created_at": string,"created_by": string | null,"download_source": Database["public"]['Enums']["apk_download_source"],"id": string,"package_name": string | null,"published_at": string | null,"sha256": string,"status": Database["public"]['Enums']["version_status"],"supports_mobile": boolean,"supports_tv": boolean,"version_code": number,"version_name": string
                  }
                  Insert: {
                    "account_requirement"?: Database["public"]['Enums']["account_requirement"],"apk_path"?: string | null,"apk_size_bytes": number,"apk_url"?: string | null,"app_id": string,"changelog"?: string,"created_at"?: string,"created_by"?: string | null,"download_source"?: Database["public"]['Enums']["apk_download_source"],"id"?: string,"package_name"?: string | null,"published_at"?: string | null,"sha256": string,"status"?: Database["public"]['Enums']["version_status"],"supports_mobile"?: boolean,"supports_tv"?: boolean,"version_code": number,"version_name": string
                  }
                  Update: {
                    "account_requirement"?: Database["public"]['Enums']["account_requirement"],"apk_path"?: string | null,"apk_size_bytes"?: number,"apk_url"?: string | null,"app_id"?: string,"changelog"?: string,"created_at"?: string,"created_by"?: string | null,"download_source"?: Database["public"]['Enums']["apk_download_source"],"id"?: string,"package_name"?: string | null,"published_at"?: string | null,"sha256"?: string,"status"?: Database["public"]['Enums']["version_status"],"supports_mobile"?: boolean,"supports_tv"?: boolean,"version_code"?: number,"version_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_versions_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "app_versions_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    }
                  ]
                },"apps": {
                  Row: {
                    "category_id": string,"created_at": string,"description": string,"download_count": number,"featured": boolean,"icon_path": string | null,"id": string,"package_name": string | null,"short_description": string,"slug": string,"status": Database["public"]['Enums']["app_status"],"title": string,"updated_at": string
                  }
                  Insert: {
                    "category_id": string,"created_at"?: string,"description": string,"download_count"?: number,"featured"?: boolean,"icon_path"?: string | null,"id"?: string,"package_name"?: string | null,"short_description": string,"slug": string,"status"?: Database["public"]['Enums']["app_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"description"?: string,"download_count"?: number,"featured"?: boolean,"icon_path"?: string | null,"id"?: string,"package_name"?: string | null,"short_description"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["app_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "apps_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["category_id"]
    },{
      foreignKeyName: "apps_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"catalog_publish_history": {
                  Row: {
                    "actor_id": string,"app_count": number,"category_count": number,"committed_at": string,"generated_at": string,"generation": number,"id": number,"kind": string,"operation_id": string,"release_id": string
                  }
                  Insert: {
                    "actor_id": string,"app_count": number,"category_count": number,"committed_at"?: string,"generated_at": string,"generation": number,"id"?: never,"kind": string,"operation_id": string,"release_id": string
                  }
                  Update: {
                    "actor_id"?: string,"app_count"?: number,"category_count"?: number,"committed_at"?: string,"generated_at"?: string,"generation"?: number,"id"?: never,"kind"?: string,"operation_id"?: string,"release_id"?: string
                  }
                  Relationships: [

                  ]
                },"catalog_publish_intent_payloads": {
                  Row: {
                    "created_at": string,"operation_id": string,"payload": string,"payload_digest": string
                  }
                  Insert: {
                    "created_at"?: string,"operation_id": string,"payload": string,"payload_digest": string
                  }
                  Update: {
                    "created_at"?: string,"operation_id"?: string,"payload"?: string,"payload_digest"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "catalog_publish_intent_payloads_intent_fkey"
      columns: ["operation_id","payload_digest"]
isOneToOne: false
      referencedRelation: "catalog_publish_intents"
      referencedColumns: ["operation_id","payload_digest"]
    }
                  ]
                },"catalog_publish_intents": {
                  Row: {
                    "attempt_id": string | null,"created_at": string,"expected_generation": number,"failed_actor_id": string | null,"failed_app_count": number | null,"failed_category_count": number | null,"failed_generated_at": string | null,"failure_code": string | null,"failure_reason": string | null,"operation_id": string,"payload_digest": string | null,"release_id": string,"sealed_at": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "attempt_id"?: string | null,"created_at"?: string,"expected_generation": number,"failed_actor_id"?: string | null,"failed_app_count"?: number | null,"failed_category_count"?: number | null,"failed_generated_at"?: string | null,"failure_code"?: string | null,"failure_reason"?: string | null,"operation_id": string,"payload_digest"?: string | null,"release_id": string,"sealed_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempt_id"?: string | null,"created_at"?: string,"expected_generation"?: number,"failed_actor_id"?: string | null,"failed_app_count"?: number | null,"failed_category_count"?: number | null,"failed_generated_at"?: string | null,"failure_code"?: string | null,"failure_reason"?: string | null,"operation_id"?: string,"payload_digest"?: string | null,"release_id"?: string,"sealed_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"catalog_publish_state": {
                  Row: {
                    "app_count": number | null,"category_count": number | null,"current_release_id": string | null,"generated_at": string | null,"generation": number,"id": number,"legacy_manifest_generation": number | null,"legacy_manifest_release_id": string | null,"legacy_manifest_synced_at": string | null,"maintenance_lock_expires_at": string | null,"maintenance_lock_token": string | null,"maintenance_operation_id": string | null,"manifest_attempt_id": string | null,"manifest_claim_expires_at": string | null,"manifest_claim_token": string | null,"manifest_generation": number | null,"manifest_operation_id": string | null,"publish_attempt_id": string | null,"publish_lock_expires_at": string | null,"publish_lock_token": string | null,"publish_operation_id": string | null,"reconciliation_note": string | null,"reconciliation_required": boolean,"reconciliation_started_at": string | null,"reconciliation_started_by": string | null,"restore_epoch": number
                  }
                  Insert: {
                    "app_count"?: number | null,"category_count"?: number | null,"current_release_id"?: string | null,"generated_at"?: string | null,"generation"?: number,"id"?: number,"legacy_manifest_generation"?: number | null,"legacy_manifest_release_id"?: string | null,"legacy_manifest_synced_at"?: string | null,"maintenance_lock_expires_at"?: string | null,"maintenance_lock_token"?: string | null,"maintenance_operation_id"?: string | null,"manifest_attempt_id"?: string | null,"manifest_claim_expires_at"?: string | null,"manifest_claim_token"?: string | null,"manifest_generation"?: number | null,"manifest_operation_id"?: string | null,"publish_attempt_id"?: string | null,"publish_lock_expires_at"?: string | null,"publish_lock_token"?: string | null,"publish_operation_id"?: string | null,"reconciliation_note"?: string | null,"reconciliation_required"?: boolean,"reconciliation_started_at"?: string | null,"reconciliation_started_by"?: string | null,"restore_epoch"?: number
                  }
                  Update: {
                    "app_count"?: number | null,"category_count"?: number | null,"current_release_id"?: string | null,"generated_at"?: string | null,"generation"?: number,"id"?: number,"legacy_manifest_generation"?: number | null,"legacy_manifest_release_id"?: string | null,"legacy_manifest_synced_at"?: string | null,"maintenance_lock_expires_at"?: string | null,"maintenance_lock_token"?: string | null,"maintenance_operation_id"?: string | null,"manifest_attempt_id"?: string | null,"manifest_claim_expires_at"?: string | null,"manifest_claim_token"?: string | null,"manifest_generation"?: number | null,"manifest_operation_id"?: string | null,"publish_attempt_id"?: string | null,"publish_lock_expires_at"?: string | null,"publish_lock_token"?: string | null,"publish_operation_id"?: string | null,"reconciliation_note"?: string | null,"reconciliation_required"?: boolean,"reconciliation_started_at"?: string | null,"reconciliation_started_by"?: string | null,"restore_epoch"?: number
                  }
                  Relationships: [

                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"is_default": boolean,"name": string,"position": number,"slug": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"name": string,"position"?: number,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"name"?: string,"position"?: number,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"download_events": {
                  Row: {
                    "app_id": string,"downloaded_at": string,"id": number,"installation_id": string,"version_id": string
                  }
                  Insert: {
                    "app_id": string,"downloaded_at"?: string,"id"?: never,"installation_id": string,"version_id": string
                  }
                  Update: {
                    "app_id"?: string,"downloaded_at"?: string,"id"?: never,"installation_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "download_events_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "download_events_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    },{
      foreignKeyName: "download_events_version_app_fkey"
      columns: ["version_id","app_id"]
isOneToOne: false
      referencedRelation: "app_versions"
      referencedColumns: ["id","app_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"status": Database["public"]['Enums']["profile_status"],"updated_at": string,"user_id": string,"username": string
                  }
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"status"?: Database["public"]['Enums']["profile_status"],"updated_at"?: string,"user_id": string,"username": string
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"status"?: Database["public"]['Enums']["profile_status"],"updated_at"?: string,"user_id"?: string,"username"?: string
                  }
                  Relationships: [

                  ]
                },"reports": {
                  Row: {
                    "admin_note": string | null,"app_id": string,"created_at": string,"description": string | null,"id": string,"reason": Database["public"]['Enums']["report_reason"],"reporter_id": string,"resolved_at": string | null,"status": Database["public"]['Enums']["report_status"],"version_id": string | null
                  }
                  Insert: {
                    "admin_note"?: string | null,"app_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"reason": Database["public"]['Enums']["report_reason"],"reporter_id": string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"version_id"?: string | null
                  }
                  Update: {
                    "admin_note"?: string | null,"app_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"reason"?: Database["public"]['Enums']["report_reason"],"reporter_id"?: string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"version_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reports_version_app_fkey"
      columns: ["version_id","app_id"]
isOneToOne: false
      referencedRelation: "app_versions"
      referencedColumns: ["id","app_id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "app_id": string,"body": string | null,"created_at": string,"id": string,"moderation_status": Database["public"]['Enums']["review_moderation_status"],"rating": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "app_id": string,"body"?: string | null,"created_at"?: string,"id"?: string,"moderation_status"?: Database["public"]['Enums']["review_moderation_status"],"rating": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "app_id"?: string,"body"?: string | null,"created_at"?: string,"id"?: string,"moderation_status"?: Database["public"]['Enums']["review_moderation_status"],"rating"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    },{
      foreignKeyName: "reviews_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"user_roles": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            "admin_asset_cleanup_queue_stats": {
                  Row: {
                    "completed": number | null,"due": number | null,"failed_last_24h": number | null,"leased": number | null,"oldest_pending_age_seconds": number | null,"pending": number | null,"quarantined": number | null,"races_last_24h": number | null,"skipped": number | null,"skipped_last_24h": number | null,"stranded": number | null
                  }
                  Relationships: [

                  ]
                },"catalog_app_cards": {
                  Row: {
                    "account_requirement": Database["public"]['Enums']["account_requirement"] | null,"apk_path": string | null,"apk_size_bytes": number | null,"apk_url": string | null,"app_id": string | null,"category_id": string | null,"category_name": string | null,"category_slug": string | null,"download_count": number | null,"download_source": Database["public"]['Enums']["apk_download_source"] | null,"featured": boolean | null,"icon_path": string | null,"published_at": string | null,"sha256": string | null,"short_description": string | null,"slug": string | null,"supports_mobile": boolean | null,"supports_tv": boolean | null,"title": string | null,"version_changelog": string | null,"version_code": number | null,"version_id": string | null,"version_name": string | null
                  }
                  Relationships: [

                  ]
                },"review_rating_summaries": {
                  Row: {
                    "app_id": string | null,"average_rating": number | null,"review_count": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "apps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "catalog_app_cards"
      referencedColumns: ["app_id"]
    }
                  ]
                }
          }
          Functions: {
            "acquire_catalog_maintenance_lease":
{ Args: { "p_lease_seconds": number,"p_operation_id": string }; Returns: {
              "idempotent": boolean,"lease_expires_at": string,"lease_token": string,"state_generation": number
            }[]
                           },
"acquire_catalog_publish_lease":
{ Args: { "p_attempt_id"?: string,"p_lease_seconds": number,"p_operation_id": string }; Returns: {
              "idempotent": boolean,"lease_expires_at": string,"lease_token": string,"state_generation": number
            }[]
                           },
"admin_close_report":
{ Args: { "p_actor_id": string,"p_admin_note": string,"p_report_id": string,"p_status": Database["public"]['Enums']["report_status"] }; Returns: undefined
                           },
"admin_delete_app_permanently":
{ Args: { "p_actor_id": string,"p_app_id": string,"p_confirmation_title": string }; Returns: Json
                           },
"admin_delete_hidden_review":
{ Args: { "p_actor_id": string,"p_review_id": string }; Returns: undefined
                           },
"admin_ensure_cleanup_audit":
{ Args: { "p_action": string,"p_actor_id": string,"p_metadata"?: Json,"p_target_id": string,"p_target_type": string }; Returns: {
              "created": boolean,"id": string
            }[]
                           },
"admin_publish_version_replacing_previous":
{ Args: { "p_actor_id": string,"p_version_id": string }; Returns: (string)[]
                           },
"admin_quarantine_cleanup_job":
{ Args: { "p_actor_id": string,"p_expected_started_at": string,"p_job_id": string,"p_reason": string }; Returns: undefined
                           },
"admin_record_external_action":
{ Args: { "p_action": string,"p_actor_id": string,"p_metadata"?: Json,"p_target_id": string,"p_target_type": string }; Returns: string
                           },
"admin_requeue_cleanup_job":
{ Args: { "p_actor_id": string,"p_expected_quarantined_at": string,"p_job_id": string,"p_note": string }; Returns: undefined
                           },
"admin_set_app_publication_status":
{ Args: { "p_actor_id": string,"p_app_id": string,"p_status": Database["public"]['Enums']["app_status"] }; Returns: undefined
                           },
"admin_set_profile_status":
{ Args: { "p_actor_id": string,"p_status": Database["public"]['Enums']["profile_status"],"p_user_id": string }; Returns: undefined
                           },
"admin_set_review_status":
{ Args: { "p_actor_id": string,"p_review_id": string,"p_status": Database["public"]['Enums']["review_moderation_status"] }; Returns: undefined
                           },
"admin_withdraw_version":
{ Args: { "p_actor_id": string,"p_version_id": string }; Returns: undefined
                           },
"assert_catalog_maintenance_lease":
{ Args: { "p_lease_token": string,"p_operation_id": string }; Returns: boolean
                           },
"assert_catalog_manifest_claim":
{ Args: { "p_actor_id": string,"p_attempt_id": string,"p_claim_token": string,"p_operation_id": string }; Returns: boolean
                           },
"assert_catalog_publish_lease":
{ Args: { "p_attempt_id"?: string,"p_lease_token": string,"p_operation_id": string }; Returns: boolean
                           },
"begin_catalog_publish_intent":
{ Args: { "p_expected_generation": number,"p_operation_id": string,"p_release_id": string }; Returns: {
              "attempt_id": string,"created_at": string,"expected_generation": number,"idempotent": boolean,"operation_id": string,"payload_digest": string,"release_id": string,"sealed_at": string,"status": string
            }[]
                           },
"begin_catalog_reconciliation":
{ Args: { "p_actor_id": string,"p_note": string }; Returns: {
              "generation": number,"restore_epoch": number,"started_at": string
            }[]
                           },
"claim_catalog_manifest":
{ Args: { "p_actor_id": string,"p_attempt_id": string,"p_claim_seconds"?: number,"p_operation_id": string,"p_release_id": string }; Returns: {
              "app_count": number,"category_count": number,"claim_expires_at": string,"claim_token": string,"generated_at": string,"generation": number,"idempotent": boolean,"release_id": string
            }[]
                           },
"cleanup_asset_is_referenced":
{ Args: { "p_bucket": string,"p_path": string }; Returns: boolean
                           },
"cleanup_claim_jobs":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number,"p_worker_id": string }; Returns: {
              "attempts": number,"bucket": string,"job_id": string,"lease_expires_at": string,"lease_token": string,"operation_id": string,"path": string,"storage_version": string,"target_type": string
            }[]
                           },
"cleanup_complete_job":
{ Args: { "p_job_id": string,"p_worker_id": string }; Returns: undefined
                           },
"cleanup_enqueue_catalog_release":
{ Args: { "p_actor_id": string,"p_expected_generation": number,"p_expected_restore_epoch": number,"p_files": string[],"p_release_id": string }; Returns: {
              "blocked_code": string | null,"job_id": string | null,"outcome": string,"path": string,"release_id": string
            }[]
                           },
"cleanup_enqueue_orphan":
{ Args: { "p_bucket": string,"p_path": string,"p_target_type": string }; Returns: string
                           },
"cleanup_fail_job":
{ Args: { "p_error": string,"p_job_id": string,"p_worker_id": string }; Returns: {
              "attempts": number,"next_attempt_at": string,"quarantined": boolean
            }[]
                           },
"cleanup_release_job":
{ Args: { "p_job_id": string,"p_lease_token": string,"p_worker_id": string }; Returns: boolean
                           },
"cleanup_requeue_job":
{ Args: { "p_job_id": string,"p_reason"?: string }; Returns: undefined
                           },
"cleanup_skip_job":
{ Args: { "p_job_id": string,"p_reason": string,"p_worker_id": string }; Returns: string
                           },
"cleanup_start_job":
{ Args: { "p_job_id": string,"p_lease_token": string,"p_worker_id": string }; Returns: number
                           },
"commit_catalog_publish":
{ Args: { "p_actor_id": string,"p_app_count": number,"p_attempt_id": string,"p_category_count": number,"p_expected_generation": number,"p_generated_at": string,"p_lease_token": string,"p_operation_id": string,"p_release_id": string }; Returns: {
              "committed_at": string,"failure_code": string,"generation": number,"idempotent": boolean,"outcome": string,"release_id": string
            }[]
                           },
"commit_catalog_rollback":
{ Args: { "p_actor_id": string,"p_expected_generation": number,"p_operation_id": string,"p_target_payload_digest": string,"p_target_release_id": string }; Returns: {
              "committed_at": string,"failure_code": string,"generation": number,"idempotent": boolean,"outcome": string,"release_id": string
            }[]
                           },
"finish_catalog_reconciliation":
{ Args: { "p_actor_id": string,"p_drain_proof": Json,"p_expected_generation": number,"p_expected_restore_epoch": number }; Returns: {
              "finished_at": string,"generation": number,"restore_epoch": number
            }[]
                           },
"get_catalog_pointer":
{ Args: Record<PropertyKey, never>; Returns: {
              "app_count": number,"category_count": number,"generated_at": string,"generation": number,"reconciliation_required": boolean,"release_id": string,"restore_epoch": number,"retained_from_generation": number
            }[]
                           },
"get_catalog_publish_intent":
{ Args: { "p_operation_id": string }; Returns: {
              "attempt_id": string,"created_at": string,"expected_generation": number,"failure_code": string,"failure_reason": string,"operation_id": string,"payload_digest": string,"release_id": string,"sealed_at": string,"status": string,"updated_at": string
            }[]
                           },
"get_catalog_publish_intent_payload":
{ Args: { "p_attempt_id": string,"p_operation_id": string }; Returns: {
              "payload": string,"payload_digest": string
            }[]
                           },
"get_catalog_publish_result":
{ Args: { "p_actor_id": string,"p_attempt_id": string,"p_operation_id": string,"p_release_id"?: string }; Returns: {
              "actor_id": string,"app_count": number,"category_count": number,"committed_at": string,"current_generation": number,"generated_at": string,"generation": number,"is_current": boolean,"operation_id": string,"release_id": string
            }[]
                           },
"get_latest_app_release":
{ Args: { "p_package_name": string }; Returns: {
              "apk_path": string,"apk_size_bytes": number,"apk_url": string,"app_id": string,"changelog": string,"download_source": Database["public"]['Enums']["apk_download_source"],"package_name": string,"sha256": string,"version_code": number,"version_id": string,"version_name": string
            }[]
                           },
"record_download":
{ Args: { "p_installation_id": string,"p_version_id": string }; Returns: boolean
                           },
"release_catalog_maintenance_lease":
{ Args: { "p_lease_token": string,"p_operation_id": string }; Returns: boolean
                           },
"release_catalog_manifest_claim":
{ Args: { "p_actor_id": string,"p_attempt_id": string,"p_claim_token": string,"p_operation_id": string }; Returns: boolean
                           },
"release_catalog_publish_lease":
{ Args: { "p_attempt_id"?: string,"p_lease_token": string,"p_operation_id": string }; Returns: boolean
                           },
"renew_catalog_maintenance_lease":
{ Args: { "p_lease_seconds": number,"p_lease_token": string,"p_operation_id": string }; Returns: {
              "lease_expires_at": string
            }[]
                           },
"renew_catalog_publish_lease":
{ Args: { "p_attempt_id"?: string,"p_lease_seconds": number,"p_lease_token": string,"p_operation_id": string }; Returns: {
              "lease_expires_at": string
            }[]
                           },
"seal_catalog_publish_intent":
{ Args: { "p_attempt_id": string,"p_operation_id": string,"p_payload": string,"p_payload_digest": string }; Returns: {
              "attempt_id": string,"idempotent": boolean,"operation_id": string,"payload_digest": string,"sealed_at": string,"status": string
            }[]
                           },
"search_catalog":
{ Args: { "p_category_slug": string,"p_platform"?: string,"p_query": string,"p_sort": string }; Returns: {
              "account_requirement": Database["public"]['Enums']["account_requirement"] | null,
"apk_path": string | null,
"apk_size_bytes": number | null,
"apk_url": string | null,
"app_id": string | null,
"category_id": string | null,
"category_name": string | null,
"category_slug": string | null,
"download_count": number | null,
"download_source": Database["public"]['Enums']["apk_download_source"] | null,
"featured": boolean | null,
"icon_path": string | null,
"published_at": string | null,
"sha256": string | null,
"short_description": string | null,
"slug": string | null,
"supports_mobile": boolean | null,
"supports_tv": boolean | null,
"title": string | null,
"version_changelog": string | null,
"version_code": number | null,
"version_id": string | null,
"version_name": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "catalog_app_cards"
        isOneToOne: false
        isSetofReturn: true
      } }
          }
          Enums: {
            "account_requirement": "none"|"optional"|"required","apk_download_source": "storage"|"external","app_role": "admin","app_status": "active"|"archived","profile_status": "active"|"suspended","report_reason": "acilmiyor"|"link_bozuk"|"sahte_uygulama"|"diger","report_status": "open"|"resolved"|"dismissed","review_moderation_status": "visible"|"hidden","version_status": "draft"|"published"|"withdrawn"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {

          }
        },"public": {
          Enums: {
            "account_requirement": ["none", "optional", "required"],"apk_download_source": ["storage", "external"],"app_role": ["admin"],"app_status": ["active", "archived"],"profile_status": ["active", "suspended"],"report_reason": ["acilmiyor", "link_bozuk", "sahte_uygulama", "diger"],"report_status": ["open", "resolved", "dismissed"],"review_moderation_status": ["visible", "hidden"],"version_status": ["draft", "published", "withdrawn"]
          }
        }
} as const
