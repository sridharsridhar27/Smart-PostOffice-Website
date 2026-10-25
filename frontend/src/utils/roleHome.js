const roleHome = {
  ADMIN: "/admin",
  CUSTOMER: "/customer",
  DELIVERY: "/delivery",
};

export const getHomePath = (role) => roleHome[role] || "/login";