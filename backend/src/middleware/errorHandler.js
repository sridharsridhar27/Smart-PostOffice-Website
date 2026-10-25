const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Prisma unique constraint error
  if (err.code === "P2002") {
    return res.status(409).json({ message: `Already exists: ${err.meta?.target}` });
  }

  res.status(err.statusCode || 500).json({
    message: err.message || "Internal server error",
  });
};

module.exports = errorHandler;