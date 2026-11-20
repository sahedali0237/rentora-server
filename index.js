import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";

import { MongoClient, ObjectId } from "mongodb";

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

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("Rentora-site");
const userCollection = db.collection("user");
const equipmentCollection = db.collection("equipment");
const bookingCollection = db.collection("bookings");
const reviewsCollection = db.collection("reviews");

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
    const user = await usersCollection.findOne({
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

    res.status(200).json(bookings);
  } catch (err) {
    console.error("Error fetching bookings:", err);

    res.status(500).json({
      error: "Failed to fetch bookings",
    });
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
