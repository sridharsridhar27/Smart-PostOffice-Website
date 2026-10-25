const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { userSelect } = require("./authController");

const phoneRegex = /^[6-9]\d{9}$/;

// POST /api/admin/delivery-persons
const createDeliveryPerson = async (req, res, next) => {
  try {
    const { name, email, phone, password, homeAreaId } = req.body;

    if (!name || !email || !phone || !password || !homeAreaId) {
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

    const area = await prisma.area.findUnique({ where: { id: Number(homeAreaId) } });
    if (!area) {
      return res.status(404).json({ message: "Home area not found" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const deliveryPerson = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        phone,
        password: hashedPassword,
        role: "DELIVERY",
        homeAreaId: Number(homeAreaId),
      },
      select: userSelect,
    });

    res.status(201).json({ message: "Delivery person created", deliveryPerson });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/delivery-persons
const getDeliveryPersons = async (req, res, next) => {
  try {
    const deliveryPersons = await prisma.user.findMany({
      where: { role: "DELIVERY" },
      select: userSelect,
      orderBy: { name: "asc" },
    });

    res.json({ deliveryPersons });
  } catch (err) {
    next(err);
  }
};

module.exports = { createDeliveryPerson, getDeliveryPersons };