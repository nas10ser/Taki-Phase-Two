import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

/**
 * Admin Service
 * --------------------------------------------------------------------
 * Thin, typed wrappers around the v15 admin RPCs. Every function calls
 * a SECURITY DEFINER function on the server that re-checks the caller's
 * role — so even if the bundle is tampered with locally, the database
 * remains the single source of authority.
 */

export interface OverviewStats {
  totals: {
    users: number; buyers: number; sellers: number;
    active_now: number; active_today: number; active_week: number;
    suspended: number;
    deals_active: number; deals_paused: number; deals_total: number;
    bookings_total: number; bookings_today: number;
    bookings_pending: number; bookings_completed: number;
    banners_active: number; banners_total: number;
    subs_active: number; subs_expired: number; subs_premium: number;
    total_views: number; total_clicks: number;
    avg_rating: number; ratings_count: number;
  };
  today: {
    new_users: number; new_sellers: number; new_buyers: number;
    new_deals: number; new_bookings: number;
  };
  yesterday: {
    new_users: number; new_bookings: number;
  };
}

export interface TimeseriesPoint {
  day: string;
  new_users: number;
  new_sellers: number;
  new_deals: number;
  new_bookings: number;
  active_users: number;
}

export interface CityRow {
  city: string;
  users: number;
  sellers: number;
  buyers: number;
}

export interface TopStoreRow {
  store_id: string;
  shop: string;
  address: string;
  deal_count: number;
  total_views: number;
  total_clicks: number;
  total_bookings: number;
  avg_rating: number;
  subscription_plan: string;
}

export interface SellerAnalytics {
  totals: {
    deals_total: number; deals_active: number; deals_paused: number; deals_expired: number;
    views: number; clicks: number;
    bookings: number; bookings_completed: number; bookings_pending: number; bookings_cancelled: number;
    avg_rating: number; rating_count: number;
    followers: number;
    revenue_estimate: number;
  };
  last7days: { date: string; bookings: number; completed: number }[];
  top_deals: { id: string; name: string; views: number; clicks: number; bookings: number; image: string | null }[];
  busiest_hour: number | null;
}

export interface ActivityRow {
  id: number;
  user_id: string | null;
  actor_type: string | null;
  event_type: string;
  target_table: string | null;
  target_id: string | null;
  severity: 'info' | 'warning' | 'critical' | 'success';
  metadata: Record<string, any>;
  created_at: string;
}

// ============== ANALYTICS ==============

export async function getOverviewStats(): Promise<OverviewStats | null> {
  const { data, error } = await supabase.rpc('admin_overview_stats');
  if (error) { logger.error('admin_overview_stats:', error); return null; }
  return data as OverviewStats;
}

export async function getTimeseries(daysBack = 30): Promise<TimeseriesPoint[]> {
  const { data, error } = await supabase.rpc('admin_timeseries', { days_back: daysBack });
  if (error) { logger.error('admin_timeseries:', error); return []; }
  return (data as TimeseriesPoint[]) || [];
}

export async function getCityBreakdown(): Promise<CityRow[]> {
  const { data, error } = await supabase.rpc('admin_city_breakdown');
  if (error) { logger.error('admin_city_breakdown:', error); return []; }
  return (data as CityRow[]) || [];
}

export async function getTopStores(limit = 10): Promise<TopStoreRow[]> {
  const { data, error } = await supabase.rpc('admin_top_stores', { limit_count: limit });
  if (error) { logger.error('admin_top_stores:', error); return []; }
  return (data as TopStoreRow[]) || [];
}

export async function getSellerAnalytics(sellerId: string): Promise<SellerAnalytics | null> {
  const { data, error } = await supabase.rpc('seller_analytics', { seller_id: sellerId });
  if (error) { logger.error('seller_analytics:', error); return null; }
  return data as SellerAnalytics;
}

// ============== ACTIVITY LOG ==============

export async function getRecentActivity(limit = 50): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { logger.error('activity_log read:', error); return []; }
  return (data as ActivityRow[]) || [];
}

export function subscribeToActivity(onInsert: (row: ActivityRow) => void) {
  const channel = supabase
    .channel('admin-activity-feed')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_log' },
        (payload) => onInsert(payload.new as ActivityRow))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function logActivity(
  eventType: string,
  opts?: { targetTable?: string; targetId?: string; severity?: string; metadata?: Record<string, any> }
) {
  try {
    await supabase.rpc('log_activity', {
      p_event_type: eventType,
      p_target_table: opts?.targetTable ?? null,
      p_target_id: opts?.targetId ?? null,
      p_severity: opts?.severity ?? 'info',
      p_metadata: opts?.metadata ?? {}
    });
  } catch (e) {
    logger.warn('log_activity failed (non-fatal):', e);
  }
}

// ============== MODERATION ==============

export async function suspendUser(userId: string, reason: string) {
  return supabase.rpc('admin_suspend_user', { target_user_id: userId, reason });
}

export async function unsuspendUser(userId: string) {
  return supabase.rpc('admin_unsuspend_user', { target_user_id: userId });
}

export async function adminDeleteDeal(dealId: string) {
  return supabase.rpc('admin_delete_deal', { deal_id: dealId });
}

export async function adminUpdateDeal(dealId: string, fields: Record<string, any>) {
  return supabase.from('deals').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', dealId);
}

export async function startImpersonation(targetId: string, notes?: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('admin_start_impersonation', { target_id: targetId, notes: notes ?? null });
  if (error) { logger.error('start_impersonation:', error); return null; }
  return data as number;
}

export async function endImpersonation(logId: number) {
  return supabase.rpc('admin_end_impersonation', { log_id: logId });
}

// ============== PRESENCE ==============

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(intervalMs = 60_000) {
  if (heartbeatTimer) return;
  const ping = () => { supabase.rpc('heartbeat').catch(() => {}); };
  ping();
  heartbeatTimer = setInterval(ping, intervalMs);
}

export function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ============== ALL STORES (with full join) ==============

export interface AdminStoreRow {
  id: string;
  name: string;
  shop: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  store_profiles: {
    subscription_plan: string | null;
    subscription_expires_at: string | null;
    discount_percentage: number | null;
    is_pinned: boolean | null;
    max_branches: number | null;
  } | null;
}

export async function getAllStores(): Promise<AdminStoreRow[]> {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, name, shop, phone, email, address, avatar_url,
      is_active, last_seen_at, suspended_at, suspension_reason, created_at,
      store_profiles (
        subscription_plan, subscription_expires_at,
        discount_percentage, is_pinned, max_branches
      )
    `)
    .eq('user_type', 'seller')
    .order('created_at', { ascending: false });
  if (error) { logger.error('getAllStores:', error); return []; }
  return (data as any) || [];
}

export interface AdminUserRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  user_type: string;
  address: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  suspended_at: string | null;
  bookings_count: number | null;
  savings: number | null;
  created_at: string;
}

export async function getAllUsers(typeFilter?: 'buyer' | 'seller' | 'admin'): Promise<AdminUserRow[]> {
  let q = supabase
    .from('users')
    .select('id, name, phone, email, user_type, address, is_active, last_seen_at, suspended_at, bookings_count, savings, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (typeFilter) q = q.eq('user_type', typeFilter);
  const { data, error } = await q;
  if (error) { logger.error('getAllUsers:', error); return []; }
  return (data as any) || [];
}

export interface AdminDealRow {
  id: string;
  store_id: string;
  shop_name: string;
  item_name: string;
  category: string;
  original_price: number;
  discounted_price: number;
  discount_percentage: number | null;
  status: string;
  views: number | null;
  clicks: number | null;
  images: string[];
  created_at: number;
  updated_at: string;
}

export async function getAllDeals(opts?: { status?: string; storeId?: string }): Promise<AdminDealRow[]> {
  let q = supabase
    .from('deals')
    .select('id, store_id, shop_name, item_name, category, original_price, discounted_price, discount_percentage, status, views, clicks, images, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.storeId) q = q.eq('store_id', opts.storeId);
  const { data, error } = await q;
  if (error) { logger.error('getAllDeals:', error); return []; }
  return (data as any) || [];
}

export interface AdminBanner {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  subtitle_ar: string | null;
  subtitle_en: string | null;
  image_url: string;
  target_url: string | null;
  deal_id: string | null;
  store_id: string | null;
  position: string;
  is_active: boolean;
  display_order: number;
  priority: number | null;
  expires_at: string | null;
  starts_at: string | null;
  discount_percentage: number | null;
  amount: number | null;
  target_city: string | null;
  view_count: number | null;
  click_count: number | null;
  background_color: string | null;
  cta_label_ar: string | null;
  cta_label_en: string | null;
  created_at: string;
}

export async function getAllBanners(): Promise<AdminBanner[]> {
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .order('priority', { ascending: false })
    .order('display_order', { ascending: true });
  if (error) { logger.error('getAllBanners:', error); return []; }
  return (data as any) || [];
}
