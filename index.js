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
app.listen(port, () => {
  console.log(`Server initialized on port ${port}`);
});
export default app;
