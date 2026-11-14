import express from "express";
import process from "node:process";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DATABASE_NAME = process.env.MONGODB_DATABASE || "algoviz_db";
const SECRET_KEY = process.env.JWT_SECRET || "exam_secret";
const mongoClient = new MongoClient(MONGODB_URI);

let users;
let activityLogs;

function getUserId(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", database: "mongodb" });
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const hash = await bcrypt.hash(password, 8);
    const result = await users.insertOne({
      username,
      password: hash,
      createdAt: new Date(),
      lastActive: new Date(),
    });
    res.status(201).json({ message: "Registered!", userId: result.insertedId });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "Username already taken" });
    }
    console.error("Registration failed:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const user = await users.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user._id.toString() }, SECRET_KEY, { expiresIn: "24h" });
    res.json({
      token,
      user: { id: user._id.toString(), username: user.username },
    });
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/log-activity", async (req, res) => {
  const { userId, type, name } = req.body;
  const objectUserId = getUserId(userId);
  if (!objectUserId || !type || !name) {
    return res.status(400).json({ error: "userId, type, and name are required" });
  }

  try {
    const executionTime = new Date();
    await activityLogs.insertOne({
      userId: objectUserId,
      algorithmType: type,
      algorithmName: name,
      executionTime,
    });
    await users.updateOne({ _id: objectUserId }, { $set: { lastActive: executionTime } });
    res.json({ message: "Logged" });
  } catch (error) {
    console.error("Activity logging failed:", error);
    res.status(500).json({ error: "Log failed" });
  }
});

app.get("/stats/:userId", async (req, res) => {
  const userId = getUserId(req.params.userId);
  if (!userId) return res.status(400).json({ error: "Invalid user ID" });

  try {
    const [total, favorite, history] = await Promise.all([
      activityLogs.countDocuments({ userId }),
      activityLogs
        .aggregate([
          { $match: { userId } },
          { $group: { _id: "$algorithmName", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ])
        .next(),
      activityLogs
        .find({ userId })
        .sort({ executionTime: -1 })
        .limit(5)
        .toArray(),
    ]);

    res.json({
      total,
      favorite: favorite?._id || "None",
      history: history.map((log) => ({
        algorithm_type: log.algorithmType,
        algorithm_name: log.algorithmName,
        execution_time: log.executionTime,
      })),
    });
  } catch (error) {
    console.error("Stats lookup failed:", error);
    res.status(500).json({ error: "Stats lookup failed" });
  }
});

async function startServer() {
  await mongoClient.connect();
  const database = mongoClient.db(DATABASE_NAME);
  users = database.collection("users");
  activityLogs = database.collection("activity_logs");
  await users.createIndex({ username: 1 }, { unique: true });
  console.log(`Connected to MongoDB database "${DATABASE_NAME}"`);
  app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error("Backend startup failed:", error);
  process.exitCode = 1;
});
