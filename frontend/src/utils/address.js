// "No 12, Gandhi Street, Area A – 635601"
export const formatAddress = (c) => {
  if (!c) return "";
  const parts = [c.addressLine, c.street?.name, c.area?.name].filter(Boolean).join(", ");
  return c.area?.pincode ? `${parts} – ${c.area.pincode}` : parts;
};

// "Area A – 635601"
export const areaWithPin = (area) => {
  if (!area) return "-";
  return area.pincode ? `${area.name} – ${area.pincode}` : area.name;
};