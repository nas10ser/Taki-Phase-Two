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

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (location.hash) {
            logger.info('🔗 AuthRedirector: Hash detected:', location.hash.substring(0, 50) + '...');
            if (location.hash.indexOf('access_token') !== -1 || location.hash.indexOf('type=signup') !== -1 || location.hash.indexOf('type=magiclink') !== -1) {
                timer = setTimeout(async () => {
                    const uType = await getUserType();
                    logger.info('🔄 Redirecting based on hash auth to:', uType);
                    // After magic-link / signup auth, buyers land on the
                    // home feed. Admins/sellers go to their dashboards.
                    // (Previously this restored TAKI_LAST_PATH from
                    // localStorage — removed so the only source of truth
                    // for routing is the DB-driven user_type.)
                    history.replace(uType === 'admin' ? '/admin' : uType === 'seller' ? '/seller' : '/');
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
                logger.info('🔄 Redirecting based on query auth to:', uType);
                history.replace(uType === 'admin' ? '/admin' : uType === 'seller' ? '/seller' : '/');
            }, 1000);
        }
        return () => clearTimeout(timer);
    }, [location.hash, history, user, customAlert, isRTL]);

    useEffect(() => {
        if (user) {
            if (location.pathname === '/register') {
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
