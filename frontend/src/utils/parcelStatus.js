export const STATUS_LABELS = {
  REGISTERED: "Registered",
  NOTIFIED: "Awaiting Slot Booking",
  SLOT_BOOKED: "Slot Booked",
  ASSIGNED: "Assigned",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery Failed",
};

export const STATUS_COLORS = {
  REGISTERED: "bg-slate-100 text-slate-700",
  NOTIFIED: "bg-amber-100 text-amber-800",
  SLOT_BOOKED: "bg-blue-100 text-blue-800",
  ASSIGNED: "bg-indigo-100 text-indigo-800",
  OUT_FOR_DELIVERY: "bg-purple-100 text-purple-800",
  DELIVERED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

export const PARCEL_TYPES = ["LETTER", "SMALL", "MEDIUM", "LARGE"];

export const PARCEL_TYPE_LABELS = {
  LETTER: "Letter",
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
};
export const FAILURE_REASON_LABELS = {
  CUSTOMER_NOT_AVAILABLE: "Customer not available",
  WRONG_ADDRESS: "Wrong / incomplete address",
  CUSTOMER_REFUSED: "Customer refused the parcel",
  PREMISES_LOCKED: "Premises locked",
  OTHER: "Other",
};