// Supabase Edge Function: send-push
// Invoked by the `tr_notification_push` Postgres trigger via pg_net.
// Deploy with:
//   supabase functions deploy send-push --no-verify-jwt
// Then run once in SQL:
//   ALTER DATABASE postgres SET taki.push_url = 'https://<project>.functions.supabase.co/send-push';
//
// Env (set in Supabase project → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@taki.app),
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:notify@taki.app",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!
);

Deno.serve(async (req) => {
    try {
        const payload = await req.json();
        const userId: string = payload.userId;
        if (!userId) return new Response("missing userId", { status: 400 });

        const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .eq("user_id", userId);

        if (!subs || subs.length === 0) return new Response("no subs", { status: 200 });

        const body = JSON.stringify({
            titleAr: payload.titleAr,
            titleEn: payload.titleEn,
            bodyAr:  payload.bodyAr,
            bodyEn:  payload.bodyEn,
            type:    payload.type,
            data:    payload.data,
            notifId: payload.notifId
        });

        const results = await Promise.allSettled(subs.map((s: any) =>
            webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                body
            )
        ));

        // Drop subscriptions that the push service has rejected (410 Gone).
        const dead: string[] = [];
        results.forEach((r, i) => {
            if (r.status === "rejected") {
                const code = (r.reason as any)?.statusCode;
                if (code === 404 || code === 410) dead.push(subs[i].endpoint);
            }
        });
        if (dead.length > 0) {
            await supabase.from("push_subscriptions").delete().in("endpoint", dead);
        }

        return new Response(JSON.stringify({ sent: results.length, dropped: dead.length }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(`error: ${(e as Error).message}`, { status: 500 });
    }
});
