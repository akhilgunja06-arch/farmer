import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Spinner } from '@/components/ui/Card';

/**
 * Route table.
 *
 * Pages are lazy-loaded so the public landing page does not carry the weight of
 * the dashboards, charts and admin tooling that most visitors never open.
 */

// Public
const LandingPage = lazy(() => import('@/pages/public/LandingPage'));
const ExplorePage = lazy(() => import('@/pages/public/ExplorePage'));
const ProductDetailPage = lazy(() => import('@/pages/public/ProductDetailPage'));
const FarmersPage = lazy(() => import('@/pages/public/FarmersPage'));
const FarmerDetailPage = lazy(() => import('@/pages/public/FarmerDetailPage'));
const LocationsPage = lazy(() => import('@/pages/public/LocationsPage'));
const HowItWorksPage = lazy(() => import('@/pages/public/HowItWorksPage'));
const QualityStandardsPage = lazy(() => import('@/pages/public/QualityStandardsPage'));
const AboutPage = lazy(() => import('@/pages/public/AboutPage'));
const ContactPage = lazy(() => import('@/pages/public/ContactPage'));
const HelpPage = lazy(() => import('@/pages/public/HelpPage'));
const LegalPage = lazy(() => import('@/pages/public/LegalPage'));
const NotificationsPage = lazy(() => import('@/pages/public/NotificationsPage'));

// Auth
const ChooseRolePage = lazy(() => import('@/pages/auth/ChooseRolePage'));
const FarmerRegisterPage = lazy(() => import('@/pages/auth/FarmerRegisterPage'));
const CustomerRegisterPage = lazy(() => import('@/pages/auth/CustomerRegisterPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));

// Farmer
const FarmerDashboard = lazy(() => import('@/pages/farmer/FarmerDashboard'));
const FarmerProducts = lazy(() => import('@/pages/farmer/FarmerProducts'));
const FarmerProductForm = lazy(() => import('@/pages/farmer/FarmerProductForm'));
const FarmerOrders = lazy(() => import('@/pages/farmer/FarmerOrders'));
const FarmerOrderDetail = lazy(() => import('@/pages/farmer/FarmerOrderDetail'));
const FarmerMessages = lazy(() => import('@/pages/farmer/FarmerMessages'));
const FarmerQualityReports = lazy(() => import('@/pages/farmer/FarmerQualityReports'));
const FarmerMarketInsights = lazy(() => import('@/pages/farmer/FarmerMarketInsights'));
const FarmerProfile = lazy(() => import('@/pages/farmer/FarmerProfile'));
const FarmerEarnings = lazy(() => import('@/pages/farmer/FarmerEarnings'));
const FarmerSettings = lazy(() => import('@/pages/farmer/FarmerSettings'));

// Customer
const CustomerDashboard = lazy(() => import('@/pages/customer/CustomerDashboard'));
const CustomerCart = lazy(() => import('@/pages/customer/CustomerCart'));
const CustomerCheckout = lazy(() => import('@/pages/customer/CustomerCheckout'));
const CustomerOrders = lazy(() => import('@/pages/customer/CustomerOrders'));
const CustomerOrderDetail = lazy(() => import('@/pages/customer/CustomerOrderDetail'));
const CustomerMessages = lazy(() => import('@/pages/customer/CustomerMessages'));
const CustomerSaved = lazy(() => import('@/pages/customer/CustomerSaved'));
const CustomerAddresses = lazy(() => import('@/pages/customer/CustomerAddresses'));
const CustomerProfile = lazy(() => import('@/pages/customer/CustomerProfile'));
const CustomerSettings = lazy(() => import('@/pages/customer/CustomerSettings'));

// Admin
const AdminLogin = lazy(() => import('@/pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminFarmers = lazy(() => import('@/pages/admin/AdminFarmers'));
const AdminProducts = lazy(() => import('@/pages/admin/AdminProducts'));
const AdminOrders = lazy(() => import('@/pages/admin/AdminOrders'));
const AdminQualityReviews = lazy(() => import('@/pages/admin/AdminQualityReviews'));
const AdminReports = lazy(() => import('@/pages/admin/AdminReports'));
const AdminSettings = lazy(() => import('@/pages/admin/AdminSettings'));
const AdminAuditLogs = lazy(() => import('@/pages/admin/AdminAuditLogs'));

const NotFoundPage = lazy(() => import('@/pages/public/NotFoundPage'));

function PageFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner />
    </div>
  );
}

/**
 * Redirects `/farmer` and friends to the dashboard.
 *
 * Kept as a component so the redirect target lives in one place.
 */
function RedirectTo({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* ---------------------------------------------------------------
              Public
          --------------------------------------------------------------- */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/farmers" element={<FarmersPage />} />
            <Route path="/farmers/:id" element={<FarmerDetailPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/quality-standards" element={<QualityStandardsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute roles={['farmer', 'customer', 'admin']}>
                  <NotificationsPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* ---------------------------------------------------------------
              Authentication
          --------------------------------------------------------------- */}
          <Route path="/auth/choose-role" element={<ChooseRolePage />} />
          <Route path="/farmer/register" element={<FarmerRegisterPage />} />
          <Route path="/customer/register" element={<CustomerRegisterPage />} />
          <Route path="/farmer/login" element={<LoginPage role="farmer" />} />
          <Route path="/customer/login" element={<LoginPage role="customer" />} />
          <Route path="/auth/login" element={<ChooseRolePage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* ---------------------------------------------------------------
              Farmer
          --------------------------------------------------------------- */}
          <Route
            path="/farmer/dashboard"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/products"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerProducts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/products/new"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerProductForm mode="create" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/products/:id/edit"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerProductForm mode="edit" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/orders"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/orders/:id"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/messages"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerMessages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/quality-reports"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerQualityReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/market-insights"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerMarketInsights />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/profile"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/earnings"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerEarnings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/farmer/settings"
            element={
              <ProtectedRoute roles={['farmer']}>
                <FarmerSettings />
              </ProtectedRoute>
            }
          />
          <Route path="/farmer" element={<RedirectTo to="/farmer/dashboard" />} />

          {/* ---------------------------------------------------------------
              Customer
          --------------------------------------------------------------- */}
          <Route
            path="/customer/dashboard"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/cart"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerCart />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/checkout"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerCheckout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/orders"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/orders/:id"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/messages"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerMessages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/saved"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerSaved />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/addresses"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerAddresses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/profile"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/settings"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerSettings />
              </ProtectedRoute>
            }
          />
          <Route path="/customer" element={<RedirectTo to="/customer/dashboard" />} />

          {/* ---------------------------------------------------------------
              Administrator
          --------------------------------------------------------------- */}
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/farmers"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminFarmers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/products"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminProducts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/orders"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/quality-reviews"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminQualityReviews />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-logs"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminAuditLogs />
              </ProtectedRoute>
            }
          />
          <Route path="/admin" element={<RedirectTo to="/admin/dashboard" />} />

          {/* Fallback for anything else, inside the public shell. */}
          <Route
            path="*"
            element={
              <PublicLayout />
            }
          >
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
