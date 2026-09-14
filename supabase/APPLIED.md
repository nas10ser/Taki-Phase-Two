# سجلّ الهجرات — ما طُبِّق على خادم جدة

> **كيف وُلِّد هذا الملف:** ليس مكتوباً باليد. `supabase/ops/build-applied-log.sh`
> يقرأ كل ملف `.sql` في المستودع، يستخرج ما يُنشئه من دوال وجداول، ثم يسأل
> الخادم الحيّ عن كلٍّ منها. العمود الأخير قياسٌ لا ادّعاء.
>
> **آخر توليد:** ٢٠٢٦-٠٩-١٤ · خادم جدة `api.takisa.net` · ٤٩٣ كائناً في `public`.

## لماذا لا يوجد جدول هجرات في القاعدة

هجرات تاكي تُشغَّل يدوياً عبر SSH (لا `supabase db push`)، ولا يوجد جدول
`schema_migrations` يقول ما طُبِّق. لذلك «مُطبَّقة» هنا تعني: **كائناتها موجودة
على الخادم الآن** — وهو ما يهمّ فعلاً.

🪤 الفخّ المكلف (٢٢ أغسطس ٢٠٢٦): هجرات أسابيع ذهبت إلى مختبر طوكيو لا إلى
جدة. لذلك كل ملف هجرة يبدأ بحارس يرفض التنفيذ على المختبر وينتهي بجدول
✅/❌ أوّل سطر فيه اسم الخادم.

## الفجوات وتفسيرها

| الكائن الغائب | الملف | التفسير |
|---|---|---|
| `bot_booking_refund_line` | v14.18 | حُذف عمداً في v14.24 — كان كوداً ميتاً لا يناديه أحد |
| `_taki_v1380_audit` | v13.80 وملفّاه المجمَّعان | دالة تدقيق مؤقّتة يحذفها سكربتها بنفسه في آخر سطر |
| `pg_temp` | v13.89 | ليس كائناً — نمط الجرد التقط `CREATE FUNCTION pg_temp.…` خطأً |
| `can_seller_add_deal` · `global_settings` | مايو ٢٠٢٦ | تجاوزهما التصميم: سقف الفروع صار مشغّلات، والإعدادات صارت `platform_settings` |

**لا فجوة غير مفسَّرة.**

## الجدول الزمني

| التاريخ | الملف | كائنات | موجودة |
|---|---|---:|---|
| 2026-05-03 | `migration_v7_3_add_missing_columns.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v7_4_cleanup_phantom_accounts.sql` | 1 | ✅ 1/1 |
| 2026-05-03 | `migration_v7_5_phone_login_recovery.sql` | 1 | ✅ 1/1 |
| 2026-05-03 | `migration_v7_6_tighten_rls.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_10_user_shop_location.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_11_server_smart_notifications.sql` | 1 | ✅ 1/1 |
| 2026-05-03 | `migration_v8_12_deal_soft_delete.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_13_smart_alerts_v2.sql` | 7 | ✅ 7/7 |
| 2026-05-03 | `migration_v8_13b_geo_seed.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_14_user_google_link.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_15_add_paused_status.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_16_deal_expiry_type.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `migration_v8_5_realtime_promo.sql` | 2 | ✅ 2/2 |
| 2026-05-03 | `migration_v8_6_fix_booking.sql` | 1 | ✅ 1/1 |
| 2026-05-03 | `migration_v8_6_follow_trigger.sql` | 1 | ✅ 1/1 |
| 2026-05-03 | `migration_v8_7_server_side_flow.sql` | 2 | ✅ 2/2 |
| 2026-05-03 | `migration_v8_8_admin_role.sql` | 2 | ✅ 2/2 |
| 2026-05-03 | `migration_v8_9_add_missing_user_columns.sql` | — | — (فحص/تدقيق) |
| 2026-05-03 | `schema.sql` | 12 | ✅ 12/12 |
| 2026-05-04 | `migration_v9_security_hardening.sql` | — | — (فحص/تدقيق) |
| 2026-05-06 | `migration_v10_admin_store_management.sql` | — | — (فحص/تدقيق) |
| 2026-05-06 | `migration_v11_saas_billing.sql` | 2 | ⚠️ 0/2 |
| 2026-05-06 | `migration_v12_trial_automation.sql` | 2 | ✅ 2/2 |
| 2026-05-06 | `migration_v13_analytics_tracking.sql` | 2 | ✅ 2/2 |
| 2026-05-06 | `migration_v14_banners_system.sql` | 1 | ✅ 1/1 |
| 2026-05-06 | `migration_v9_0_phase2_cleanup.sql` | — | — (فحص/تدقيق) |
| 2026-05-06 | `migration_v9_1_phase2_subscriptions.sql` | 15 | ✅ 15/15 |
| 2026-05-06 | `migration_v9_2_phase2_branches.sql` | 2 | ✅ 2/2 |
| 2026-05-06 | `migration_v9_3_phase2_sponsorships.sql` | 4 | ✅ 4/4 |
| 2026-05-06 | `migration_v9_4_phase2_analytics.sql` | 6 | ✅ 6/6 |
| 2026-05-07 | `migration_v9_7_admin_pro.sql` | 12 | ✅ 12/12 |
| 2026-05-08 | `migration_v9_13_smart_trial.sql` | 1 | ✅ 1/1 |
| 2026-05-12 | `migration_v10_38_fix_users_rls_infinite_recursion.sql` | — | — (فحص/تدقيق) |
| 2026-05-12 | `migration_v10_41_smart_notifications_security_definer.sql` | — | — (فحص/تدقيق) |
| 2026-05-12 | `migration_v10_46_enforce_seller_location_cap.sql` | 1 | ✅ 1/1 |
| 2026-05-13 | `migration_v10_51_security_hardening.sql` | — | — (فحص/تدقيق) |
| 2026-05-14 | `migration_v10_64_smart_alerts_combined_plus_backfill.sql` | 5 | ✅ 5/5 |
| 2026-05-25 | `migration_v11_20_coming_soon.sql` | 1 | ✅ 1/1 |
| 2026-06-13 | `migration_v11_73_bot_seller_deal_parity.sql` | 8 | ✅ 8/8 |
| 2026-08-06 | `audit_v13_71_production_checks.sql` | 1 | ⚠️ 0/1 |
| 2026-08-06 | `migration_v13_67_branch_cap_on_package_change.sql` | 1 | ✅ 1/1 |
| 2026-08-06 | `migration_v13_71_seller_pii_and_admin_scope.sql` | — | — (فحص/تدقيق) |
| 2026-08-07 | `audit_v13_75_jeddah_security_parity.sql` | 1 | ⚠️ 0/1 |
| 2026-08-07 | `migration_v13_75_public_views_readonly.sql` | 1 | ✅ 1/1 |
| 2026-08-08 | `JEDDAH_EXPORT_db_logic.sql` | — | — (فحص/تدقيق) |
| 2026-08-08 | `JEDDAH_RUN_v13_80_82.sql` | 4 | ⚠️ 3/4 |
| 2026-08-08 | `JEDDAH_VERIFY_v13_82.sql` | — | — (فحص/تدقيق) |
| 2026-08-08 | `JEDDAH_WHICH_SERVER.sql` | — | — (فحص/تدقيق) |
| 2026-08-08 | `migration_v13_76_branch_display_admin_perms_auth_sync.sql` | 6 | ✅ 6/6 |
| 2026-08-08 | `migration_v13_80_hardening_and_realtime.sql` | 1 | ⚠️ 0/1 |
| 2026-08-08 | `migration_v13_81_atomic_stock.sql` | 2 | ✅ 2/2 |
| 2026-08-08 | `migration_v13_82_chat_recipient.sql` | 1 | ✅ 1/1 |
| 2026-08-11 | `JEDDAH_CATCHUP_v13_67_to_82.sql` | 11 | ⚠️ 10/11 |
| 2026-08-22 | `JEDDAH_COMPLETENESS_CHECK.sql` | — | — (فحص/تدقيق) |
| 2026-08-27 | `JEDDAH_DIAGNOSE_bot_gate.sql` | 1 | ⚠️ 0/1 |
| 2026-08-27 | `JEDDAH_VERIFY_bot_surface.sql` | — | — (فحص/تدقيق) |
| 2026-08-27 | `migration_v13_84_bot_get_deal_gate.sql` | — | — (فحص/تدقيق) |
| 2026-08-31 | `migration_v13_89_rewrite_storage_urls.sql` | 1 | ⚠️ 0/1 |
| 2026-09-02 | `JEDDAH_v13_92_email_lang.sql` | 2 | ✅ 2/2 |
| 2026-09-02 | `JEDDAH_v13_95_bot_invoice.sql` | 1 | ✅ 1/1 |
| 2026-09-03 | `JEDDAH_v13_97_sub_warning_only_if_lapsing.sql` | 1 | ✅ 1/1 |
| 2026-09-03 | `JEDDAH_v14_06_delivery_rating_invoice.sql` | 16 | ✅ 16/16 |
| 2026-09-03 | `JEDDAH_v14_07_delivery_tracking.sql` | 9 | ✅ 9/9 |
| 2026-09-06 | `JEDDAH_v14_08_zones_addresses_payment.sql` | 13 | ✅ 13/13 |
| 2026-09-10 | `JEDDAH_v14_10_booking_hold.sql` | 9 | ✅ 9/9 |
| 2026-09-11 | `JEDDAH_v14_11_booking_total.sql` | 6 | ✅ 6/6 |
| 2026-09-11 | `JEDDAH_v14_13_web_push.sql` | 2 | ✅ 2/2 |
| 2026-09-11 | `JEDDAH_v14_14_images_cache.sql` | — | — (فحص/تدقيق) |
| 2026-09-13 | `JEDDAH_v14_17_merchant_tax_invoice.sql` | 9 | ✅ 9/9 |
| 2026-09-13 | `JEDDAH_v14_18_refunds_policies.sql` | 13 | ⚠️ 12/13 |
| 2026-09-13 | `JEDDAH_v14_19_privacy_consent_retention.sql` | 3 | ✅ 3/3 |
| 2026-09-13 | `JEDDAH_v14_20_delete_guard.sql` | 2 | ✅ 2/2 |
| 2026-09-13 | `JEDDAH_v14_21_refund_fixes.sql` | 4 | ✅ 4/4 |
| 2026-09-13 | `JEDDAH_v14_22_retention_fixes.sql` | 3 | ✅ 3/3 |
| 2026-09-13 | `JEDDAH_v14_23_review_round3.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_24_browse_refund.sql` | 1 | ✅ 1/1 |
| 2026-09-14 | `JEDDAH_v14_26_pagination.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_27_chat_attachments.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_29_bot_attachments.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_30_rotate_bot_secret.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_31_barcode_lookup.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_32_real_suspension.sql` | 6 | ✅ 6/6 |
| 2026-09-14 | `JEDDAH_v14_33_campaigns_reports.sql` | 5 | ✅ 5/5 |
| 2026-09-14 | `JEDDAH_v14_34_true_numbers.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_35_bot_delivery.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_36_store_name.sql` | 7 | ✅ 7/7 |
| 2026-09-14 | `JEDDAH_v14_37_attestation_gate.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_38_subpermissions.sql` | 1 | ✅ 1/1 |
| 2026-09-14 | `JEDDAH_v14_39_delivery_admin.sql` | 7 | ✅ 7/7 |
| 2026-09-14 | `JEDDAH_v14_39b_delivery_killswitch.sql` | 1 | ✅ 1/1 |
| 2026-09-14 | `JEDDAH_v14_39c_jsonb_fix.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_40_moderation_actions.sql` | 4 | ✅ 4/4 |
| 2026-09-14 | `JEDDAH_v14_40b_flag_ref.sql` | 1 | ✅ 1/1 |
| 2026-09-14 | `JEDDAH_v14_41_launch_audit.sql` | 3 | ✅ 3/3 |
| 2026-09-14 | `JEDDAH_v14_42_track_state.sql` | 2 | ✅ 2/2 |
| 2026-09-14 | `JEDDAH_v14_42b_card_track.sql` | 2 | ✅ 2/2 |
