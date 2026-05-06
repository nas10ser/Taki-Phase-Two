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
                    // Save current path before redirect
                    const savedPath = localStorage.getItem('TAKI_LAST_PATH') || '/';
                    history.replace(uType === 'admin' ? '/admin' : uType === 'seller' ? '/seller' : savedPath);
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
        } else {
            // Protected routes
            if (location.pathname === '/seller' || location.pathname === '/admin') {
                logger.info('🚪 AuthRedirector: Guest on protected route, redirecting to home');
                history.replace('/');
            }
        }
        // Save current path to localStorage
        if (location.pathname && location.pathname !== '/register') {
            localStorage.setItem('TAKI_LAST_PATH', location.pathname + location.search);
        }
    }, [user, location.pathname, location.search, history]);

    return null;
};

const App = () => {
    return (
        <Router>
            <AuthRedirector />
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
                        <Route path="/deal/:id" component={DealDetails} />
                        <Route path="/profile" component={Profile} />
                        <Route path="/notifications" component={Notifications} />
                        <Route path="/seasonal" component={SeasonalOffers} />
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
