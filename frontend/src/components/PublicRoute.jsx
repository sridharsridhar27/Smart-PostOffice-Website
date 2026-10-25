import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getHomePath } from "../utils/roleHome";
import Loader from "./Loader";

// Login/Register pages: if already logged in, go to that role's dashboard
export default function PublicRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <Loader />;
  if (user) return <Navigate to={getHomePath(user.role)} replace />;

  return children;
}