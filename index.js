import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";

import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

const app = express();

app.use(
  cors({
    origin: process.env.ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
const port = process.env.PORT || 5000;

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({ error: "Missing authentication token" });
    }

    const user = await userCollection.findOne({ email: token });
    if (!user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Error during auth check:", err);
    res.status(500).json({ error: "Failed to authenticate" });
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("Rentora-site");
const userCollection = db.collection("user");
const equipmentCollection = db.collection("equipment");
const bookingCollection = db.collection("bookings");
const reviewsCollection = db.collection("reviews");

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
  }
}

connectToMongoDB().catch(console.error);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/users", async (req, res) => {
  try {
    const users = await userCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.post("/add-equipment", async (req, res) => {
  try {
    const newEquipment = req.body;
    const result = await equipmentCollection.insertOne(newEquipment);
    res.status(201).json(result);
  } catch (err) {
    console.error("Error adding equipment", err);
    res.status(500).json({ error: "Failed to add equipment" });
  }
});
app.get("/equipment", async (req, res) => {
  try {
    const query = { status: "Approved" };
    if (req.query.search) {
      query.title = { $regex: req.query.search, $options: "i" };
    }
    if (req.query.category) {
      query.category = req.query.category;
    }

    const items = await equipmentCollection.find(query).toArray();
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch equipment" });
  }
});

app.get("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found" });
    }
    res.json(equipment);
  } catch (err) {
    console.error("Error fetching equipment", err);
    res.status(500).json({ error: "Failed to fetch equipment" });
  }
});

app.patch("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const updateData = { ...req.body };

    if (updateData.rentalPrice !== undefined) {
      updateData.rentalPrice = Number(updateData.rentalPrice);
    }

    if (updateData.availableQuantity !== undefined) {
      updateData.availableQuantity = Number(updateData.availableQuantity);
    }

    const result = await equipmentCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        error: "Equipment not found",
      });
    }

    res.json({
      message: "Equipment updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Error updating equipment:", err);

    res.status(500).json({
      error: "Failed to update equipment",
    });
  }
});

app.delete("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await equipmentCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        error: "Equipment not found",
      });
    }

    res.json({
      message: "Equipment deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("Error deleting equipment:", err);

    res.status(500).json({
      error: "Failed to delete equipment",
    });
  }
});

app.get("/bookings", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    // Find user by email
    const user = await userCollection.findOne({
      email: email,
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Find bookings using user's ID
    const bookings = await bookingCollection
      .find({
        renterId: user._id.toString(),
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Ensure every booking returns its status/paymentStatus for the renter view,
    // defaulting legacy documents that predate these fields.
    for (const booking of bookings) {
      if (!booking.status) booking.status = "pending";
      if (!booking.paymentStatus) booking.paymentStatus = "unpaid";
    }

    res.status(200).json(bookings);
  } catch (err) {
    console.error("Error fetching bookings:", err);

    res.status(500).json({
      error: "Failed to fetch bookings",
    });
  }
});

// Renter's own bookings, with equipment details populated for display.
app.get("/bookings/my-rentals", requireAuth, async (req, res) => {
  try {
    const renterId = req.user._id.toString();
    const bookings = await bookingCollection
      .find({ renterId })
      .sort({ createdAt: -1 })
      .toArray();

    // Fetch equipment details for each booking so the renter view gets the
    // equipment title, name, image(s) and daily rate alongside the booking.
    const equipmentIds = [
      ...new Set(bookings.map((b) => b.equipmentId?.toString()).filter(Boolean)),
    ];
    const equipmentById = new Map();
    if (equipmentIds.length > 0) {
      const equipment = await equipmentCollection
        .find({ _id: { $in: equipmentIds.map((id) => new ObjectId(id)) } })
        .project({
          _id: 1,
          title: 1,
          name: 1,
          image: 1,
          images: 1,
          rentalPrice: 1,
          price: 1,
          pricePerDay: 1,
        })
        .toArray();
      for (const doc of equipment) {
        equipmentById.set(doc._id.toString(), doc);
      }
    }

    for (const booking of bookings) {
      const equipmentDoc = booking.equipmentId
        ? equipmentById.get(booking.equipmentId.toString())
        : undefined;
      booking.equipment = equipmentDoc || null;
      if (!booking.status) booking.status = "pending";
      if (!booking.paymentStatus) booking.paymentStatus = "unpaid";
    }

    res.status(200).json(bookings);
  } catch (err) {
    console.error("Error fetching renter bookings:", err);

    res.status(500).json({
      error: "Failed to fetch bookings",
    });
  }
});

app.post("/bookings", requireAuth, async (req, res) => {
  try {
    const { equipmentId, startDate, endDate } = req.body;

    if (!equipmentId || !startDate || !endDate) {
      return res.status(400).json({
        error: "equipmentId, startDate and endDate are required",
      });
    }

    if (!ObjectId.isValid(equipmentId)) {
      return res.status(400).json({ error: "Invalid equipment ID" });
    }

    // Look up the equipment so we never trust the client for price or owner.
    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(equipmentId),
    });
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!start.getTime() || !end.getTime() || end < start) {
      return res.status(400).json({ error: "Invalid rental dates" });
    }
    // Inclusive day count: renting start through end counts both days.
    const days = Math.round((end - start) / 86400000) + 1;

    // Price is read from the equipment document, never from the client body.
    // Legacy equipment docs store the daily rate as `rentalPrice`; newer ones
    // may use `pricePerDay`/`price`.
    const price =
      Number(equipment.rentalPrice ?? equipment.pricePerDay ?? equipment.price) || 0;
    if (!Number.isFinite(price) || price <= 0) {
      return res
        .status(400)
        .json({ error: "Equipment has no valid daily rate" });
    }
    const total = price * days;

    const now = new Date();
    // Also write `amount` (the field legacy reader code and the UI read) so
    // every new booking is consistent with the existing documents.
    const newBooking = {
      equipmentId: new ObjectId(equipmentId),
      renterId: req.user._id.toString(),
      startDate: start,
      endDate: end,
      quantity: req.body.quantity,
      totalPrice: total,
      amount: total,
      // Booking model defaults: pending / unpaid.
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: now,
      updatedAt: now,
    };

    const result = await bookingCollection.insertOne(newBooking);

    res.status(201).json({
      message: "Booking created successfully",
      booking: { ...newBooking, _id: result.insertedId },
    });
  } catch (err) {
    console.error("Error creating booking:", err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// Owner view of their equipment's bookings.
app.get("/bookings/owner", requireAuth, async (req, res) => {
  try {
    const bookings = await bookingCollection
      .find({
        ownerId: req.user._id.toString(),
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Ensure every booking returns its status/paymentStatus for the owner view.
    for (const booking of bookings) {
      if (!booking.status) booking.status = "pending";
      if (!booking.paymentStatus) booking.paymentStatus = "unpaid";
    }

    res.status(200).json(bookings);
  } catch (err) {
    console.error("Error fetching owner bookings:", err);

    res.status(500).json({
      error: "Failed to fetch owner bookings",
    });
  }
});

// Create a Stripe Checkout Session so the renter can pay their own booking.
app.post("/bookings/:id/pay", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Renter can only pay their own booking.
    if (booking.renterId !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ error: "You can only pay for your own bookings" });
    }

    // Only allow payment when unpaid and not cancelled.
    if (booking.paymentStatus !== "unpaid" || booking.status === "cancelled") {
      return res.status(400).json({
        error: "This booking is not available for payment",
      });
    }

    const amountCents = Math.round(Number(booking.totalPrice ?? booking.total) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid booking total" });
    }

    if (!stripe) {
      return res
        .status(503)
        .json({ error: "Stripe is not configured on the server" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Booking ${booking._id}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId: booking._id.toString(),
      },
      success_url: `${process.env.CLIENT_URL}/bookings/${booking._id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/my-rentals`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: "Failed to create payment session" });
  }
});

app.post("/bookings/:id/verify-payment", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Only the renter can verify their own booking.
    if (booking.renterId !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ error: "You can only verify your own bookings" });
    }

    if (!stripe) {
      return res
        .status(503)
        .json({ error: "Stripe is not configured on the server" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.metadata?.bookingId !== booking._id.toString() ||
      session.payment_status !== "paid"
    ) {
      return res
        .status(400)
        .json({ error: "Payment is not valid for this booking" });
    }

    // Idempotent: only transition bookings still marked unpaid and not
    // cancelled, so calling this twice is harmless. All status values are
    // lowercase in this codebase.
    const result = await bookingCollection.updateOne(
      {
        _id: booking._id,
        paymentStatus: "unpaid",
        status: { $ne: "cancelled" },
      },
      {
        $set: {
          paymentStatus: "paid",
          status: "confirmed",
          updatedAt: new Date(),
        },
      },
    );

    // Nothing matched: either already paid/confirmed, cancelled, or otherwise
    // no longer payable. Refund and surface a conflict when it isn't already paid.
    if (result.matchedCount === 0 && booking.paymentStatus !== "paid") {
      // Booking was cancelled or otherwise no longer payable; refund the payment.
      if (session.payment_intent) {
        try {
          await stripe.refunds.create({
            payment_intent: session.payment_intent,
          });
        } catch (refundErr) {
          console.error("Refund failed:", refundErr);
        }
      }
      return res
        .status(409)
        .json({ error: "Booking was cancelled. Your payment was refunded." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Error verifying payment:", err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

app.patch("/bookings/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Only the renter can cancel, and only while unpaid and not already
    // confirmed beyond pending (paid or cancelled).
    if (booking.renterId !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ error: "You can only cancel your own bookings" });
    }

    if (
      booking.paymentStatus === "paid" ||
      booking.status !== "pending"
    ) {
      return res.status(400).json({
        error: "This booking can't be cancelled",
      });
    }

    booking.status = "cancelled";
    booking.updatedAt = new Date();
    await bookingCollection.updateOne(
      { _id: booking._id },
      { $set: booking },
    );

    res.json({
      message: "Booking cancelled successfully",
      bookingId: booking._id.toString(),
    });
  } catch (err) {
    console.error("Error cancelling booking:", err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

app.post("/reviews", async (req, res) => {
  try {
    const {
      equipmentId,
      bookingId,
      renterEmail,
      renterName,
      renterImage,
      rating,
      comment,
    } = req.body;

    // Basic validation
    if (!equipmentId || !bookingId || !renterEmail || !rating) {
      return res.status(400).send({
        success: false,
        message: "Required information is missing.",
      });
    }

    const numericRating = Number(rating);

    if (
      numericRating < 1 ||
      numericRating > 5 ||
      !Number.isInteger(numericRating)
    ) {
      return res.status(400).send({
        success: false,
        message: "Rating must be between 1 and 5.",
      });
    }

    // Check booking
    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
    });

    if (!booking) {
      return res.status(404).send({
        success: false,
        message: "Booking not found.",
      });
    }

    // Make sure this booking belongs to the renter
    if (booking.renterEmail !== renterEmail) {
      return res.status(403).send({
        success: false,
        message: "You cannot review this booking.",
      });
    }

    // Only completed bookings can be reviewed
    if (booking.status !== "completed") {
      return res.status(400).send({
        success: false,
        message: "You can only review completed rentals.",
      });
    }

    // Prevent duplicate review
    const existingReview = await reviewsCollection.findOne({
      bookingId: new ObjectId(bookingId),
      renterEmail,
    });

    if (existingReview) {
      return res.status(409).send({
        success: false,
        message: "You have already reviewed this rental.",
      });
    }

    // Create review
    const review = {
      equipmentId: new ObjectId(equipmentId),
      bookingId: new ObjectId(bookingId),
      renterEmail,
      renterName: renterName || "Anonymous",
      renterImage: renterImage || "",
      rating: numericRating,
      comment: comment?.trim() || "",
      createdAt: new Date(),
    };

    const result = await reviewsCollection.insertOne(review);

    res.status(201).send({
      success: true,
      message: "Review submitted successfully.",
      reviewId: result.insertedId,
    });
  } catch (error) {
    console.error("Create review error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to create review.",
    });
  }
});

app.get("/reviews", async (req, res) => {
  try {
    const { email, userId } = req.query;

    const query = {};
    if (email) {
      // Match whichever field name your review documents use (e.g., userEmail or email)
      query.$or = [{ userEmail: email }, { email: email }];
    } else if (userId) {
      query.userId = userId;
    }

    const reviews = await reviewsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(reviews);
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
});

app.patch("/reviews/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment, email } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    if (rating === undefined && comment === undefined) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const existingReview = await reviewsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingReview) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Optional ownership check if email is sent from the client
    if (
      email &&
      existingReview.userEmail !== email &&
      existingReview.email !== email
    ) {
      return res
        .status(403)
        .json({ message: "You can only edit your own reviews" });
    }

    const updateFields = {
      updatedAt: new Date(),
    };

    if (rating !== undefined) {
      const numericRating = Number(rating);
      if (
        Number.isNaN(numericRating) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res
          .status(400)
          .json({ message: "Rating must be between 1 and 5" });
      }
      updateFields.rating = numericRating;
    }

    if (comment !== undefined) {
      const trimmedComment = String(comment).trim();
      if (!trimmedComment) {
        return res.status(400).json({ message: "Comment cannot be empty" });
      }
      updateFields.comment = trimmedComment;
    }

    const result = await reviewsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const updatedReview = await reviewsCollection.findOne({
      _id: new ObjectId(id),
    });

    res.status(200).json({
      message: "Review updated successfully",
      review: updatedReview,
    });
  } catch (error) {
    console.error("Error updating review:", error);
    res.status(500).json({ message: "Failed to update review" });
  }
});

app.delete("/reviews/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Example using Mongoose:
    const deletedReview = await Review.findByIdAndDelete(id);

    if (!deletedReview) {
      return res.status(404).json({ message: "Review not found" });
    }

    return res
      .status(200)
      .json({ message: "Review deleted successfully", deletedReview });
  } catch (error) {
    console.error("Error deleting review:", error);
    return res.status(500).json({ message: "Failed to delete review" });
  }
});

app.listen(port, () => {
  console.log(`Server initialized on port ${port}`);
});
export default app;
