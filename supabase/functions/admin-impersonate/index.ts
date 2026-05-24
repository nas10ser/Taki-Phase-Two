// admin-impersonate — issues a real Supabase auth session for any user, on
// behalf of a verified admin. The client uses the returned hashed_token to
// call supabase.auth.verifyOtp(...) which swaps the Supabase session to the
// target. After that, every Supabase call from the admin's browser is
// authorized as the target — they can post, delete, message, edit DB rows
// just as the target would, subject to the target's own RLS.
//
// Security model:
//   - Edge Function requires a valid Supabase JWT (verify_jwt=true)
//   - Caller must have user_type = 'admin' in the public.users table
//     (NOT trusting the JWT user_metadata — admins could otherwise be
//      spoofed by a tampered token before the server-side check)
//   - Cannot impersonate self, or another admin
//   - Every start/stop is logged to public.admin_impersonation_log
//
// Requires the target user to have an email (Supabase generateLink with
// type=magiclink uses email). Phone-only accounts get a clear error.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

        // 1. Caller identity — verify via the JWT in the Authorization header.
        const authHeader = req.headers.get("Authorization") || "";
        const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
        if (callerErr || !callerData?.user) {
            return jsonResponse({ error: "غير مُصرَّح — يَجب تَسجيل الدخول" }, 401);
        }
        const caller = callerData.user;

        // 2. Service-role admin client — used for privileged reads/writes.
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        // 3. Caller authorization — trust the DB, not the JWT metadata.
        const { data: callerProfile, error: callerProfileErr } = await admin
            .from("users")
            .select("id, name, user_type")
            .eq("id", caller.id)
            .maybeSingle();
        if (callerProfileErr) {
            return jsonResponse({ error: "خَطأ في قِراءة بَيانات المُتَّصِل" }, 500);
        }
        if (!callerProfile || callerProfile.user_type !== "admin") {
            return jsonResponse({ error: "ممنوع — هذه الخاصية للمدير فَقَط" }, 403);
        }

        // 4. Parse + validate target.
        let body: any = {};
        try { body = await req.json(); } catch { /* keep body = {} */ }
        const targetUserId: string | undefined = body?.targetUserId;
        if (!targetUserId || typeof targetUserId !== "string") {
            return jsonResponse({ error: "targetUserId مَطلوب" }, 400);
        }
        if (targetUserId === caller.id) {
            return jsonResponse({ error: "لا يُمكنك التَّصفُّح كَحساب نَفسك" }, 400);
        }

        // 5. Fetch target's auth + profile records.
        const { data: targetAuthData, error: targetAuthErr } =
            await admin.auth.admin.getUserById(targetUserId);
        if (targetAuthErr || !targetAuthData?.user) {
            return jsonResponse({ error: "المُستَخدِم غَير موجود" }, 404);
        }
        const targetAuth = targetAuthData.user;

        const { data: targetProfile } = await admin
            .from("users")
            .select("id, name, user_type, shop, phone")
            .eq("id", targetUserId)
            .maybeSingle();

        const targetType = targetProfile?.user_type as string | undefined;
        if (targetType === "admin") {
            return jsonResponse({ error: "لا يُمكن التَّصفُّح كَحساب مدير آخر" }, 403);
        }

        const targetEmail = targetAuth.email;
        if (!targetEmail) {
            return jsonResponse({
                error: "هذا الحساب مُسجَّل بِالجوّال فَقَط (بِدون إيميل) — الميزة تَحتاج إيميل",
            }, 400);
        }

        // 6. Generate magic link — returns a hashed_token the client can
        //    exchange for a real session via auth.verifyOtp. Does NOT send
        //    an email when called from service_role.
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: targetEmail,
        });
        if (linkErr || !linkData?.properties?.hashed_token) {
            return jsonResponse({
                error: "تَعذَّر إنشاء جَلسة التَّصفُّح: " + (linkErr?.message || "خَطأ غَير مَعروف"),
            }, 500);
        }

        // 7. Audit log — record the start. Includes IP + UA for forensics.
        await admin.from("admin_impersonation_log").insert({
            admin_id: caller.id,
            target_id: targetUserId,
            target_email: targetEmail,
            action: "start",
            ip_address: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
            user_agent: req.headers.get("user-agent") || null,
        }).then(({ error }) => {
            if (error) console.warn("[admin-impersonate] audit log failed:", error.message);
        });

        return jsonResponse({
            hashed_token: linkData.properties.hashed_token,
            email: targetEmail,
            target: {
                id: targetProfile?.id || targetUserId,
                name: targetProfile?.name || "مُستَخدِم",
                userType: targetType || "buyer",
                shop: targetProfile?.shop || null,
                phone: targetProfile?.phone || null,
            },
            admin: {
                id: caller.id,
                name: callerProfile.name || "مدير",
            },
        }, 200);
    } catch (e) {
        const msg = (e as Error)?.message || String(e);
        console.error("[admin-impersonate] fatal:", msg);
        return jsonResponse({ error: "خَطأ داخلي: " + msg }, 500);
    }
});
