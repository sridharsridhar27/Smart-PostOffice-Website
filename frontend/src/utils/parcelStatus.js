export const STATUS_LABELS = {
  REGISTERED: "Registered",
  NOTIFIED: "Awaiting Slot Booking",
  SLOT_BOOKED: "Slot Booked",
  ASSIGNED: "Assigned",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery Failed",
  RETURN_REQUESTED: "Return Requested",
  PICKUP_ASSIGNED: "Pickup Assigned",
  OUT_FOR_PICKUP: "Out for Pickup",
  PICKUP_FAILED: "Pickup Failed",
  RETURNED_TO_SENDER: "Returned to Sender",
};

// Only used on delivery partner cards (not a parcel status, so not in the filter list)
export const CARD_ONLY_LABELS = {
  PICKED_UP: "Picked Up",
};

export const STATUS_COLORS = {
  REGISTERED: "bg-slate-100 text-slate-700",
  NOTIFIED: "bg-amber-100 text-amber-800",
  SLOT_BOOKED: "bg-blue-100 text-blue-800",
  ASSIGNED: "bg-indigo-100 text-indigo-800",
  OUT_FOR_DELIVERY: "bg-purple-100 text-purple-800",
  DELIVERED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  RETURN_REQUESTED: "bg-orange-100 text-orange-800",
  PICKUP_ASSIGNED: "bg-orange-100 text-orange-800",
  OUT_FOR_PICKUP: "bg-purple-100 text-purple-800",
  PICKUP_FAILED: "bg-red-100 text-red-800",
  RETURNED_TO_SENDER: "bg-slate-200 text-slate-700",
  PICKED_UP: "bg-green-100 text-green-800",
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

// Why the customer is returning it
export const RETURN_REASON_LABELS = {
  DAMAGED: "Parcel damaged",
  WRONG_ITEM: "Wrong item",
  NOT_NEEDED: "No longer needed",
  OTHER: "Other",
};

// Why it went back to the sender
export const RTS_REASON_LABELS = {
  NOT_COLLECTED: "Not collected within 7 days",
  CUSTOMER_REFUSED: "Customer refused the parcel",
  ADMIN_DECISION: "Post office decision",
  CUSTOMER_RETURN: "Returned by customer",
};

export const PICKUP_STATUSES = ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "OUT_FOR_PICKUP", "PICKUP_FAILED"];