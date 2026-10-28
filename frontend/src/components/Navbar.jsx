import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

const roleLabel = {
  ADMIN: "Admin",
  CUSTOMER: "Customer",
  DELIVERY: "Delivery Partner",
};

const navLinks = {
  ADMIN: [
    { to: "/admin", label: "Dashboard", end: true },
    { to: "/admin/scan", label: "Scan Parcel" },
    { to: "/admin/parcels", label: "Parcels" },
    { to: "/admin/slot-bookings", label: "Slot Bookings" },
        { to: "/admin/assignments", label: "Assignments" },
    { to: "/admin/unassigned", label: "Unassigned" },
        { to: "/admin/returns", label: "Returns" },
    { to: "/admin/barcodes", label: "Barcode Generator" },
  ],
  CUSTOMER: [{ to: "/customer", label: "My Parcels", end: true }],
   DELIVERY: [{ to: "/delivery", label: "My Deliveries", end: true }],
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="bg-red-700 text-white shadow print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-lg font-bold">Smart Post Office</h1>
          <p className="text-xs text-red-100">Parcel Slot Booking & Delivery</p>
        </div>

        <div className="flex items-center gap-3">
          <NotificationBell />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium">{user?.name}</p>
            <span className="rounded bg-white/20 px-2 py-0.5 text-xs">{roleLabel[user?.role]}</span>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Logout
          </button>
        </div>
      </div>

      <nav className="bg-red-800">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4">
          {(navLinks[user?.role] || []).map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `px-3 py-2 text-sm font-medium ${
                  isActive ? "border-b-2 border-yellow-300 text-white" : "text-red-100 hover:text-white"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}