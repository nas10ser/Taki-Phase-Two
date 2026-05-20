/**
 * AdminLaunch — wrapper page for the Pre-Launch Suite tab.
 *
 * Kept thin so AdminDashboard can lazy-load it identically to the other
 * tabs (each tab = its own bundle, paid for only when opened).
 */

import React from 'react';
import { PreLaunchSuite } from '../../components/admin/PreLaunchSuite';

const AdminLaunch: React.FC = () => <PreLaunchSuite />;

export default AdminLaunch;
