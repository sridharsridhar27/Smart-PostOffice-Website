import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { getHomePath } from "./utils/roleHome";

import ProtectedRoute from "./components/ProtectedRoute";
import PublicRoute from "./components/PublicRoute";
import DashboardLayout from "./components/DashboardLayout";
import Loader from "./components/Loader";

import Login from "./pages/Login";
import Register from "./pages/Register";
import AdminDashboard from "./pages/admin/AdminDashboard";
import CustomerDashboard from "./pages/customer/CustomerDashboard";
import DeliveryDashboard from "./pages/delivery/DeliveryDashboard";

import ScanParcel from "./pages/admin/ScanParcel";
import AdminParcels from "./pages/admin/AdminParcels";
import AdminParcelDetail from "./pages/admin/AdminParcelDetail";
import BarcodeGenerator from "./pages/admin/BarcodeGenerator";
import CustomerParcelDetail from "./pages/customer/CustomerParcelDetail";
import SlotBookings from "./pages/admin/SlotBookings";

import AdminAssignments from "./pages/admin/AdminAssignments";
import UnassignedQueue from "./pages/admin/UnassignedQueue";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  return <Navigate to={user ? getHomePath(user.role) : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />

      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

            <Route
        path="/admin"
        element={<ProtectedRoute roles={["ADMIN"]}><DashboardLayout /></ProtectedRoute>}
      >
        <Route index element={<AdminDashboard />} />
        <Route path="scan" element={<ScanParcel />} />
        <Route path="parcels" element={<AdminParcels />} />
        <Route path="parcels/:id" element={<AdminParcelDetail />} />
        <Route path="barcodes" element={<BarcodeGenerator />} />
        <Route path="slot-bookings" element={<SlotBookings />} />
        <Route path="assignments" element={<AdminAssignments />} />
        <Route path="unassigned" element={<UnassignedQueue />} />
      </Route>

      <Route
        path="/customer"
        element={<ProtectedRoute roles={["CUSTOMER"]}><DashboardLayout /></ProtectedRoute>}
      >
        <Route index element={<CustomerDashboard />} />
        <Route path="parcels/:id" element={<CustomerParcelDetail />} />
      </Route>

      <Route
        path="/delivery"
        element={<ProtectedRoute roles={["DELIVERY"]}><DashboardLayout /></ProtectedRoute>}
      >
        <Route index element={<DeliveryDashboard />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}