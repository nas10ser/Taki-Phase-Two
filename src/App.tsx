import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Switch, Route, Redirect, useHistory, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { validationService } from './services/validationService';
import { normalizeArabicNumerals } from './utils/helpers';
import { supabase } from './services/supabaseClient';
import { logger } from './utils/logger';

// Code-split each route. Initial bundle no longer pays for pages the user
// hasn't visited (e.g. SellerDashboard's 1124 lines on a buyer's first paint).
const Home            = lazy(() => import('./pages/Home'));
const Bookings        = lazy(() => import('./pages/Bookings'));
const Nearby          = lazy(() => import('./pages/Nearby'));
const DealDetails     = lazy(() => import('./pages/DealDetails'));
const DealsList       = lazy(() => import('./pages/DealsList'));
const Profile         = lazy(() => import('./pages/Profile'));
const Register        = lazy(() => import('./pages/Register'));
const CompleteProfile = lazy(() => import('./pages/CompleteProfile'));
const SellerDashboard = lazy(() => import('./pages/SellerDashboard'));
const StoreDetails    = lazy(() => import('./pages/StoreDetails'));
const Notifications   = lazy(() => import('./pages/Notifications'));
const SeasonalOffers  = lazy(() => import('./pages/SeasonalOffers'));
const AdminDashboard  = lazy(() => import('./pages/AdminDashboard'));
const Subscription    = lazy(() => import('./pages/Subscription'));

const RouteFallback = () => (
    <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', fontFamily: 'Tajawal, sans-serif', color: 'var(--text-secondary)'
    }}>
        <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid var(--border-color)', borderTopColor: '#10b981',
            animation: 'taki-spin 0.8s linear infinite'
        }} />
        <style>{`@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
);

const AuthRedirector = () => {
    const context = useApp();
    const user = context.user;
    const isAuthReady = context.isAuthReady;
    const language = context.language;
    const customAlert = context.customAlert;
    const history = useHistory();
    const location = useLocation();
    const isRTL = language === 'ar';

    // Helper: determine user type from context user OR directly from Supabase session metadata
    const getUserType = async (): Promise<string> => {
        if (user && user.userType) return user.userType;
        // Fallback: read directly from Supabase session
        try {
            const { data } = await supabase.auth.getSession();
            const meta = data?.session?.user?.user_metadata;
            if (meta?.user_type) return meta.user_type;
        } catch {}
        return 'buyer';
    };

    // Helper: figure out where to send the user post-auth. OAuth users
    // (Google/Apple) arrive with no phone/shop, so they must complete
    // their profile before reaching the role-specific dashboard.
    const getPostAuthDestination = async (uType: string): Promise<string> => {
        // Direct DB lookup is safer than trusting user_metadata mirrors.
        try {
            const { data: sess } = await supabase.auth.getSession();
            const uid = sess?.session?.user?.id;
            if (uid) {
                const { data: row } = await supabase
                    .from('users')
                    .select('phone, shop, user_type')
                    .eq('id', uid)
                    .maybeSingle();
                const phoneMissing = !row?.phone || String(row.phone).length < 9;
                const effectiveType = row?.user_type || uType;
                const shopMissing = effectiveType === 'seller' && !row?.shop;
                if (phoneMissing || shopMissing) return '/complete-profile';
            }
        } catch {}
        return uType === 'admin' ? '/admin' : uType === 'seller' ? '/seller' : '/';
    };

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (location.hash) {
            logger.info('🔗 AuthRedirector: Hash detected:', location.hash.substring(0, 50) + '...');
            if (location.hash.indexOf('access_token') !== -1 || location.hash.indexOf('type=signup') !== -1 || location.hash.indexOf('type=magiclink') !== -1) {
                timer = setTimeout(async () => {
                    const uType = await getUserType();
                    const dest = await getPostAuthDestination(uType);
                    logger.info('🔄 Redirecting based on hash auth to:', dest);
                    // After magic-link / signup auth, buyers land on the
                    // home feed. Admins/sellers go to their dashboards.
                    // OAuth users with an incomplete profile are funneled
                    // through /complete-profile first (see getPostAuthDestination).
                    history.replace(dest);
                }, 1000);
            }

            if (location.hash.indexOf('error_description') !== -1) {
                const params = new URLSearchParams(location.hash.replace('#', ''));
                const errorDesc = params.get('error_description') || '';
                const decodedError = decodeURIComponent(errorDesc.replace(/\+/g, ' '));
                customAlert(isRTL ? '⚠️ خطأ في الرابط: ' + decodedError : '⚠️ Link Error: ' + decodedError);
                history.replace('/register');
            }
        }

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('access_token')) {
            logger.info('🔗 AuthRedirector: Query access_token detected');
            timer = setTimeout(async () => {
                const uType = await getUserType();
                const dest = await getPostAuthDestination(uType);
                logger.info('🔄 Redirecting based on query auth to:', dest);
                history.replace(dest);
            }, 1000);
        }
        return () => clearTimeout(timer);
    }, [location.hash, history, user, customAlert, isRTL]);

    useEffect(() => {
        if (user) {
            // Detect OAuth users whose profile is missing required fields.
            // Email/password signups never reach this branch with a missing
            // phone — the Register form blocks that. OAuth providers
            // (Google/Apple) hand us email+name but never the Saudi phone
            // or the buyer/seller choice, so funnel them through
            // /complete-profile before granting access to the rest of the
            // app. Once they fill it in, CompleteProfile redirects to the
            // correct landing page.
            const phoneMissing = !user.phone || String(user.phone).length < 9;
            const shopMissing = user.userType === 'seller' && !user.shop;
            const profileIncomplete = phoneMissing || shopMissing;

            if (profileIncomplete && location.pathname !== '/complete-profile') {
                history.replace('/complete-profile');
                return;
            }

            if (location.pathname === '/register' || (!profileIncomplete && location.pathname === '/complete-profile')) {
                const dest = user.userType === 'admin' ? '/admin'
                           : user.userType === 'seller' ? '/seller'
                           : '/';
                history.replace(dest);
            }
        } else if (isAuthReady) {
            // Only kick to home AFTER auth has resolved. Without this guard,
            // a refresh on /admin or /seller bounces logged-in users to '/'
            // because user is briefly null while the Supabase session loads
            // (the white-screen bug the admin reported).
            if (location.pathname === '/seller' || location.pathname === '/admin') {
                logger.info('🚪 AuthRedirector: Guest on protected route, redirecting to home');
                history.replace('/');
            }
        }
    }, [user, isAuthReady, location.pathname, location.search, history]);

    return null;
};

// Gate the seasonal page on the admin-controlled flag. When the section
// is hidden, navigating directly to /seasonal silently redirects home so
// stale links don't leak the page.
const SeasonalGate: React.FC = () => {
    const { platformSettings } = useApp();
    if (!platformSettings.seasonalOffersVisible) {
        return <Redirect to="/" />;
    }
    return <SeasonalOffers />;
};

const UpdateBanner = lazy(() => import('./components/UpdateBanner'));

const App = () => {
    return (
        <Router>
            <AuthRedirector />
            <Suspense fallback={null}>
                <UpdateBanner />
            </Suspense>
            <div className="app-container">
                <Suspense fallback={<RouteFallback />}>
                    <Switch>
                        <Route exact path="/" component={Home} />
                        <Route path="/register" component={Register} />
                        <Route path="/complete-profile" component={CompleteProfile} />
                        <Route path="/seller" component={SellerDashboard} />
                        <Route path="/admin" component={AdminDashboard} />
                        <Route path="/subscription" component={Subscription} />
                        <Route path="/store/:id" component={StoreDetails} />
                        <Route path="/nearby" component={Nearby} />
                        <Route path="/bookings" component={Bookings} />
                        <Route path="/deals" component={DealsList} />
                        <Route path="/deal/:id" component={DealDetails} />
                        <Route path="/profile" component={Profile} />
                        <Route path="/notifications" component={Notifications} />
                        <Route path="/seasonal" component={SeasonalGate} />
                        {/* 🔄 Unified Redirects for v7.2 */}
                        <Route path="/dashboard">
                            <Redirect to="/seller" />
                        </Route>
                        <Redirect from="*" to="/" />
                    </Switch>
                </Suspense>
            </div>
        </Router>
    );
};

export default App;
