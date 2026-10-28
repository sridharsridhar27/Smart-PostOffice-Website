const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const generateToken = require("../utils/generateToken");

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  addressLine: true,
   area: { select: { id: true, name: true, pincode: true } },
  street: { select: { id: true, name: true } },
  homeArea: { select: { id: true, name: true, pincode: true } },
  createdAt: true,
};

const phoneRegex = /^[6-9]\d{9}$/;

// POST /api/auth/register  (customer self-registration)
const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, addressLine, areaId, streetId } = req.body;

    if (!name || !email || !phone || !password || !addressLine || !areaId || !streetId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: "Enter a valid 10-digit phone number" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { phone }] },
    });

    if (existing) {
      const field = existing.email === normalizedEmail ? "Email" : "Phone number";
      return res.status(409).json({ message: `${field} already registered` });
    }

    // Street must belong to the selected area
    const street = await prisma.street.findUnique({ where: { id: Number(streetId) } });

    if (!street || street.areaId !== Number(areaId)) {
      return res.status(400).json({ message: "Selected street does not belong to the selected area" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        phone,
        password: hashedPassword,
        role: "CUSTOMER",
        addressLine: addressLine.trim(),
        areaId: Number(areaId),
        streetId: Number(streetId),
      },
      select: userSelect,
    });

    res.status(201).json({
      message: "Registered successfully",
      token: generateToken(user),
      user,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login  (all roles)
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const found = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!found || !(await bcrypt.compare(password, found.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!found.isActive) {
      return res.status(403).json({ message: "Account is inactive" });
    }

    const user = await prisma.user.findUnique({
      where: { id: found.id },
      select: userSelect,
    });

    res.json({
      message: "Login successful",
      token: generateToken(user),
      user,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: userSelect,
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe, userSelect };