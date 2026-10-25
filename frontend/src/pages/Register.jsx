import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { getErrorMessage } from "../api/axios";
import { useAuth } from "../context/AuthContext";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 disabled:bg-slate-100";

const initialForm = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  addressLine: "",
  areaId: "",
  streetId: "",
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(initialForm);
  const [areas, setAreas] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load areas + streets for the dropdowns
  useEffect(() => {
    api
      .get("/areas")
      .then((res) => setAreas(res.data.areas))
      .catch(() => setError("Could not load areas. Is the backend running?"));
  }, []);

  const selectedArea = areas.find((a) => a.id === Number(form.areaId));
  const streets = selectedArea ? selectedArea.streets : [];

  const handleChange = (e) => {
    const { name, value } = e.target;

    // When the area changes, reset the street
    if (name === "areaId") {
      setForm({ ...form, areaId: value, streetId: "" });
    } else {
      setForm({ ...form, [name]: value });
    }
  };

  const validate = () => {
    const { name, email, phone, password, confirmPassword, addressLine, areaId, streetId } = form;

    if (!name || !email || !phone || !password || !addressLine || !areaId || !streetId) {
      return "All fields are required";
    }
    if (!/^[6-9]\d{9}$/.test(phone)) return "Enter a valid 10-digit phone number";
    if (password.length < 6) return "Password must be at least 6 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const { confirmPassword, ...payload } = form;
      await register({
        ...payload,
        areaId: Number(payload.areaId),
        streetId: Number(payload.streetId),
      });
      navigate("/customer", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl rounded-xl bg-white p-8 shadow-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-red-700">Customer Registration</h1>
          <p className="mt-1 text-sm text-slate-500">
            Register to get parcel arrival alerts and book delivery slots
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Full Name</label>
            <input name="name" value={form.name} onChange={handleChange} className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Phone Number</label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              maxLength={10}
              className={inputClass}
              placeholder="10-digit mobile number"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Confirm Password</label>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Area</label>
            <select name="areaId" value={form.areaId} onChange={handleChange} className={inputClass}>
              <option value="">Select area</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Street</label>
            <select
              name="streetId"
              value={form.streetId}
              onChange={handleChange}
              disabled={!form.areaId}
              className={inputClass}
            >
              <option value="">{form.areaId ? "Select street" : "Select area first"}</option>
              {streets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">Door No / House Name</label>
            <input
              name="addressLine"
              value={form.addressLine}
              onChange={handleChange}
              className={inputClass}
              placeholder="e.g. No 12, Lakshmi Illam"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-red-700 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {submitting ? "Registering..." : "Register"}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already registered?{" "}
          <Link to="/login" className="font-medium text-red-700 hover:underline">
            Login here
          </Link>
        </p>
      </div>
    </div>
  );
}